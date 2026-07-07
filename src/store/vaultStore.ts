import { create } from "zustand";
import {
  ingestVault,
  pickVaultDirectory,
  VaultPickCancelled,
} from "../lib/vault/ingest";
import type { IngestProgress, PdfFile, VaultNote } from "../lib/vault/types";
import { chunkMarkdown } from "../lib/chunking/chunk";
import { chunkPdfPages } from "../lib/pdf/chunkPdf";
import { PdfExtractor } from "../lib/pdf/pdfExtractor";
import type { EmbedderInfo } from "../lib/embedding/embedder";
import { getEmbedder, initEmbedder } from "../lib/embedding/embedderSingleton";
import { EMBEDDING_MODEL } from "../lib/embedding/protocol";
import type { EmbeddedChunk } from "../lib/embedding/types";
import {
  buildChunkIndex,
  hybridSearch,
  type ChunkIndex,
  type HybridResult,
} from "../lib/retrieval/search";
import { planIndex } from "../lib/storage/incremental";
import { sha256Hex } from "../lib/storage/hash";
import {
  chunkId,
  clearIndex,
  deleteNote,
  getAllChunks,
  getAllNoteMeta,
  getDatabase,
  getEmbedderMeta,
  saveIndexedNote,
  setEmbedderMeta,
  type NoteMeta,
  type StoredChunk,
} from "../lib/storage/db";

export type AppStatus = "idle" | "ingesting" | "indexing" | "ready" | "error";

export interface IndexProgress {
  phase: "loading-model" | "extracting" | "embedding";
  embedded: number;
  total: number;
  modelPercent?: number;
  modelFile?: string;
  /** PDF currently being extracted (phase "extracting"). */
  extractingFile?: string;
  extractPage?: number;
  extractTotal?: number;
}

/** Summary of the last index build — the "incremental win" made visible. */
export interface IndexSummary {
  notesEmbedded: number;
  pdfsEmbedded: number;
  reused: number;
  deleted: number;
  chunksEmbedded: number;
}

/** A non-fatal problem surfaced during indexing (e.g. a scanned PDF). */
export interface IndexWarning {
  path: string;
  message: string;
}

/** Minimal data to preview a retrieved chunk / cited source in the side panel. */
export interface SourcePreviewData {
  sourceType: "note" | "pdf";
  notePath: string;
  headingPath: string[];
  page?: number;
  text: string;
}

interface VaultState {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;

  vaultName?: string;
  notes: VaultNote[];
  pdfs: PdfFile[];
  progress?: IngestProgress;
  error?: string;
  selectedNotePath?: string;
  /** A retrieved chunk / cited source shown in the preview pane. */
  previewSource?: SourcePreviewData;

  embeddedChunks: EmbeddedChunk[];
  embedderInfo?: EmbedderInfo;
  indexProgress?: IndexProgress;
  indexSummary?: IndexSummary;
  indexWarnings: IndexWarning[];
  /** True when the current index was loaded from IndexedDB, not just built. */
  indexRestored: boolean;

  // --- retrieval (Step 6) ---
  query: string;
  searchResults?: HybridResult[];
  searching: boolean;
  /** Cached retrieval index + the chunk array it was built from (identity check). */
  _chunkIndex?: ChunkIndex;
  _chunkIndexSource?: EmbeddedChunk[];

  loadVault: () => Promise<void>;
  buildIndex: () => Promise<void>;
  restoreIndex: () => Promise<void>;
  setQuery: (query: string) => void;
  search: (query: string) => Promise<void>;
  /** Run hybrid retrieval and return results without touching search UI state. */
  retrieve: (query: string, topK?: number) => Promise<HybridResult[]>;
  clearSearch: () => void;
  selectNote: (path?: string) => void;
  previewChunk: (source?: SourcePreviewData) => void;
  resetVault: () => void;
}

const storedToEmbedded = (c: StoredChunk): EmbeddedChunk => ({
  text: c.text,
  tokenCount: c.tokenCount,
  headingPath: c.headingPath,
  notePath: c.notePath,
  chunkIndex: c.chunkIndex,
  sourceType: c.sourceType,
  page: c.page,
  embedding: c.embedding,
});

export const useVaultStore = create<VaultState>((set, get) => ({
  status: "idle",
  notes: [],
  pdfs: [],
  embeddedChunks: [],
  indexWarnings: [],
  indexRestored: false,
  query: "",
  searching: false,

  setStatus: (status) => set({ status }),
  // Selecting a full note clears any single-chunk source preview, and vice-versa.
  selectNote: (path) => set({ selectedNotePath: path, previewSource: undefined }),
  previewChunk: (source) => set({ previewSource: source, selectedNotePath: undefined }),
  setQuery: (query) => set({ query }),
  clearSearch: () => set({ query: "", searchResults: undefined }),

  loadVault: async () => {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickVaultDirectory();
    } catch (err) {
      if (err instanceof VaultPickCancelled) return;
      set({ status: "error", error: (err as Error).message });
      return;
    }

    set({
      status: "ingesting",
      vaultName: dir.name,
      notes: [],
      pdfs: [],
      error: undefined,
      selectedNotePath: undefined,
      progress: { filesFound: 0, filesRead: 0 },
    });

    try {
      const { notes, pdfs } = await ingestVault(dir, (progress) => set({ progress }));
      set({ status: "ready", notes, pdfs, progress: undefined });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, progress: undefined });
    }
  },

  /**
   * Incrementally (re)build the index over notes AND PDFs:
   *   1. Load the model; wipe the index if the model/dimension changed.
   *   2. Fingerprint every source — notes by content SHA-256, PDFs by
   *      size+mtime (cheap; avoids re-reading huge books). Diff to a plan.
   *   3. Delete stale chunks; chunk changed notes and extract+chunk changed PDFs
   *      (page numbers + chapters preserved). Scanned PDFs are warned + skipped.
   *   4. Embed all pending chunks (notes + books together) in one pass; persist.
   *   5. Reload all chunks from the DB into memory for retrieval.
   */
  buildIndex: async () => {
    const { notes, pdfs } = get();
    if (notes.length === 0 && pdfs.length === 0) return;

    set({
      status: "indexing",
      error: undefined,
      indexSummary: undefined,
      indexWarnings: [],
      indexProgress: { phase: "loading-model", embedded: 0, total: 0 },
    });

    const db = await getDatabase();
    const pdfExtractor = new PdfExtractor();
    try {
      const info = await initEmbedder((p) =>
        set({
          indexProgress: {
            phase: "loading-model",
            embedded: 0,
            total: 0,
            modelPercent: p.progress,
            modelFile: p.file,
          },
        }),
      );

      // A different model or embedding dimension makes stored vectors incompatible.
      const prevMeta = await getEmbedderMeta(db);
      if (prevMeta && (prevMeta.model !== EMBEDDING_MODEL || prevMeta.dimension !== info.dimension)) {
        await clearIndex(db);
      }

      // Fingerprint sources: notes by content hash, PDFs by size+mtime (cheap).
      const noteByPath = new Map(
        await Promise.all(
          notes.map(async (note) => [note.path, { note, hash: await sha256Hex(note.raw) }] as const),
        ),
      );
      const pdfByPath = new Map(
        pdfs.map((pdf) => [pdf.path, { pdf, hash: `pdf:${pdf.size}:${pdf.lastModified}` }] as const),
      );

      const current = [
        ...[...noteByPath.values()].map((n) => ({ path: n.note.path, hash: n.hash })),
        ...[...pdfByPath.values()].map((p) => ({ path: p.pdf.path, hash: p.hash })),
      ];
      const storedMeta = await getAllNoteMeta(db);
      const plan = planIndex(current, storedMeta);

      // Remove stale / deleted sources' chunks.
      for (const path of plan.toDelete) await deleteNote(db, path);

      // A pending chunk carries everything needed to persist it after embedding.
      interface PendingChunk {
        sourcePath: string;
        chunkIndex: number;
        sourceType: "note" | "pdf";
        page?: number;
        text: string;
        headingPath: string[];
        tokenCount: number;
        lastModified: number;
      }
      const pending: PendingChunk[] = [];
      const warnings: IndexWarning[] = [];
      // Per-source metadata to persist (chunk count filled in after grouping).
      const metaByPath = new Map<string, { hash: string; lastModified: number }>();

      const notePaths = plan.toEmbed.filter((p) => noteByPath.has(p));
      const pdfPaths = plan.toEmbed.filter((p) => pdfByPath.has(p));

      // Notes → chunk synchronously.
      for (const path of notePaths) {
        const { note, hash } = noteByPath.get(path)!;
        metaByPath.set(path, { hash, lastModified: note.lastModified });
        chunkMarkdown(note.body).forEach((chunk, chunkIndex) =>
          pending.push({
            sourcePath: path,
            chunkIndex,
            sourceType: "note",
            text: chunk.text,
            headingPath: chunk.headingPath,
            tokenCount: chunk.tokenCount,
            lastModified: note.lastModified,
          }),
        );
      }

      // PDFs → extract in the worker (page by page), then chunk per page.
      for (const path of pdfPaths) {
        const { pdf, hash } = pdfByPath.get(path)!;
        metaByPath.set(path, { hash, lastModified: pdf.lastModified });
        set({ indexProgress: { phase: "extracting", embedded: 0, total: 0, extractingFile: path } });

        const file = await pdf.handle.getFile();
        const buffer = await file.arrayBuffer();
        const { pages, extractability } = await pdfExtractor.extract(buffer, path, (page, total) =>
          set({
            indexProgress: {
              phase: "extracting",
              embedded: 0,
              total: 0,
              extractingFile: path,
              extractPage: page,
              extractTotal: total,
            },
          }),
        );

        if (extractability.scanned) {
          // No OCR: warn, and still record meta so we don't retry every rebuild.
          warnings.push({
            path,
            message: "No extractable text — looks scanned/image-only. Skipped (no OCR).",
          });
          continue;
        }

        chunkPdfPages(pages).forEach((chunk, chunkIndex) =>
          pending.push({
            sourcePath: path,
            chunkIndex,
            sourceType: "pdf",
            page: chunk.page,
            text: chunk.text,
            headingPath: chunk.headingPath,
            tokenCount: chunk.tokenCount,
            lastModified: pdf.lastModified,
          }),
        );
      }

      set({ indexProgress: { phase: "embedding", embedded: 0, total: pending.length } });

      const embeddings =
        pending.length > 0
          ? await getEmbedder().embed(
              pending.map((p) => p.text),
              (embedded, total) => set({ indexProgress: { phase: "embedding", embedded, total } }),
            )
          : [];

      // Assemble stored chunks grouped by source path for atomic per-source writes.
      const chunksBySource = new Map<string, StoredChunk[]>();
      pending.forEach((p, i) => {
        const stored: StoredChunk = {
          id: chunkId(p.sourcePath, p.chunkIndex),
          notePath: p.sourcePath,
          chunkIndex: p.chunkIndex,
          sourceType: p.sourceType,
          page: p.page,
          text: p.text,
          headingPath: p.headingPath,
          tokenCount: p.tokenCount,
          embedding: embeddings[i],
          lastModified: p.lastModified,
        };
        const bucket = chunksBySource.get(p.sourcePath);
        if (bucket) bucket.push(stored);
        else chunksBySource.set(p.sourcePath, [stored]);
      });

      // Persist every (re)indexed source — including scanned PDFs with 0 chunks,
      // so their fingerprint is recorded and they aren't re-extracted next time.
      for (const path of plan.toEmbed) {
        const m = metaByPath.get(path);
        if (!m) continue;
        const chunks = chunksBySource.get(path) ?? [];
        const meta: NoteMeta = {
          path,
          contentHash: m.hash,
          lastModified: m.lastModified,
          chunkCount: chunks.length,
          indexedAt: Date.now(),
        };
        await saveIndexedNote(db, meta, chunks);
      }

      await setEmbedderMeta(db, {
        model: EMBEDDING_MODEL,
        backend: info.backend,
        dimension: info.dimension,
      });

      const all = await getAllChunks(db);
      set({
        status: "ready",
        embeddedChunks: all.map(storedToEmbedded),
        embedderInfo: info,
        indexRestored: false,
        indexProgress: undefined,
        indexWarnings: warnings,
        _chunkIndex: undefined, // chunk set changed → invalidate cached retrieval index
        indexSummary: {
          notesEmbedded: notePaths.length,
          pdfsEmbedded: pdfPaths.length - warnings.length,
          reused: plan.unchanged.length,
          deleted: plan.toDelete.length,
          chunksEmbedded: pending.length,
        },
      });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, indexProgress: undefined });
    } finally {
      pdfExtractor.terminate(); // one-shot per build; embedder singleton stays alive
    }
  },

  /**
   * Hybrid retrieval: embed the query, then fuse BM25 + cosine via RRF. The
   * BM25/vector index is built once per chunk set and cached (identity-checked)
   * so repeated searches don't re-index the corpus.
   */
  retrieve: async (query, topK = 8) => {
    const trimmed = query.trim();
    const { embeddedChunks } = get();
    if (!trimmed || embeddedChunks.length === 0) return [];

    await initEmbedder();
    const [queryEmbedding] = await getEmbedder().embed([trimmed]);

    // Build the BM25/vector index once per chunk set; reuse across queries.
    let index = get()._chunkIndex;
    if (!index || get()._chunkIndexSource !== embeddedChunks) {
      index = buildChunkIndex(embeddedChunks);
      set({ _chunkIndex: index, _chunkIndexSource: embeddedChunks });
    }
    return hybridSearch(index, trimmed, queryEmbedding, { topK });
  },

  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed || get().embeddedChunks.length === 0) {
      set({ searchResults: undefined });
      return;
    }
    set({ searching: true, query, error: undefined });
    try {
      const searchResults = await get().retrieve(trimmed, 10);
      set({ searchResults, searching: false });
    } catch (err) {
      set({ searching: false, error: (err as Error).message });
    }
  },

  /** Load a previously persisted index from IndexedDB (called on app start). */
  restoreIndex: async () => {
    try {
      const db = await getDatabase();
      const meta = await getEmbedderMeta(db);
      if (!meta) return;
      const all = await getAllChunks(db);
      if (all.length === 0) return;
      set({
        embeddedChunks: all.map(storedToEmbedded),
        embedderInfo: { backend: meta.backend, dimension: meta.dimension },
        indexRestored: true,
      });
    } catch {
      // A restore failure is non-fatal — the user can just rebuild.
    }
  },

  resetVault: () =>
    set({
      status: "idle",
      notes: [],
      pdfs: [],
      embeddedChunks: [],
      embedderInfo: undefined,
      vaultName: undefined,
      progress: undefined,
      indexProgress: undefined,
      indexSummary: undefined,
      indexWarnings: [],
      indexRestored: false,
      error: undefined,
      selectedNotePath: undefined,
      previewSource: undefined,
      query: "",
      searchResults: undefined,
      _chunkIndex: undefined,
      _chunkIndexSource: undefined,
    }),
}));
