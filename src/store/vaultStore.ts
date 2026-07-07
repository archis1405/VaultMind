import { create } from "zustand";
import {
  ingestVault,
  pickVaultDirectory,
  VaultPickCancelled,
} from "../lib/vault/ingest";
import type { IngestProgress, VaultNote } from "../lib/vault/types";
import { chunkMarkdown } from "../lib/chunking/chunk";
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
  phase: "loading-model" | "embedding";
  embedded: number;
  total: number;
  modelPercent?: number;
  modelFile?: string;
}

/** Summary of the last index build — the "incremental win" made visible. */
export interface IndexSummary {
  notesEmbedded: number;
  notesReused: number;
  notesDeleted: number;
  chunksEmbedded: number;
}

interface VaultState {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;

  vaultName?: string;
  notes: VaultNote[];
  progress?: IngestProgress;
  error?: string;
  selectedNotePath?: string;

  embeddedChunks: EmbeddedChunk[];
  embedderInfo?: EmbedderInfo;
  indexProgress?: IndexProgress;
  indexSummary?: IndexSummary;
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
  resetVault: () => void;
}

const storedToEmbedded = (c: StoredChunk): EmbeddedChunk => ({
  text: c.text,
  tokenCount: c.tokenCount,
  headingPath: c.headingPath,
  notePath: c.notePath,
  chunkIndex: c.chunkIndex,
  embedding: c.embedding,
});

export const useVaultStore = create<VaultState>((set, get) => ({
  status: "idle",
  notes: [],
  embeddedChunks: [],
  indexRestored: false,
  query: "",
  searching: false,

  setStatus: (status) => set({ status }),
  selectNote: (path) => set({ selectedNotePath: path }),
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
      error: undefined,
      selectedNotePath: undefined,
      progress: { filesFound: 0, filesRead: 0 },
    });

    try {
      const notes = await ingestVault(dir, (progress) => set({ progress }));
      set({ status: "ready", notes, progress: undefined });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, progress: undefined });
    }
  },

  /**
   * Incrementally (re)build the index:
   *   1. Load the model.
   *   2. If the model/dimension changed since last time, wipe the whole index.
   *   3. Hash every note; diff against stored metadata to get an embed/delete plan.
   *   4. Delete stale chunks, embed only new/changed notes, persist atomically.
   *   5. Reload all chunks from the DB into memory for retrieval.
   */
  buildIndex: async () => {
    const { notes } = get();
    if (notes.length === 0) return;

    set({
      status: "indexing",
      error: undefined,
      indexSummary: undefined,
      indexProgress: { phase: "loading-model", embedded: 0, total: 0 },
    });

    const db = await getDatabase();
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

      // Hash every note, then plan the minimal set of work.
      const hashed = await Promise.all(
        notes.map(async (note) => ({ note, hash: await sha256Hex(note.raw) })),
      );
      const byPath = new Map(hashed.map((h) => [h.note.path, h]));
      const storedMeta = await getAllNoteMeta(db);
      const plan = planIndex(
        hashed.map((h) => ({ path: h.note.path, hash: h.hash })),
        storedMeta,
      );

      // Remove stale / deleted notes' chunks.
      for (const path of plan.toDelete) await deleteNote(db, path);

      // Chunk every note that needs (re)embedding, flattening to a single list.
      const pending: { notePath: string; chunkIndex: number; hash: string; note: VaultNote; chunk: ReturnType<typeof chunkMarkdown>[number] }[] = [];
      for (const path of plan.toEmbed) {
        const { note, hash } = byPath.get(path)!;
        chunkMarkdown(note.body).forEach((chunk, chunkIndex) =>
          pending.push({ notePath: path, chunkIndex, hash, note, chunk }),
        );
      }

      set({ indexProgress: { phase: "embedding", embedded: 0, total: pending.length } });

      const embeddings =
        pending.length > 0
          ? await getEmbedder().embed(
              pending.map((p) => p.chunk.text),
              (embedded, total) => set({ indexProgress: { phase: "embedding", embedded, total } }),
            )
          : [];

      // Assemble stored chunks and group them by note for atomic per-note writes.
      const chunksByNote = new Map<string, StoredChunk[]>();
      pending.forEach((p, i) => {
        const stored: StoredChunk = {
          id: chunkId(p.notePath, p.chunkIndex),
          notePath: p.notePath,
          chunkIndex: p.chunkIndex,
          text: p.chunk.text,
          headingPath: p.chunk.headingPath,
          tokenCount: p.chunk.tokenCount,
          embedding: embeddings[i],
          lastModified: p.note.lastModified,
        };
        const bucket = chunksByNote.get(p.notePath);
        if (bucket) bucket.push(stored);
        else chunksByNote.set(p.notePath, [stored]);
      });

      for (const path of plan.toEmbed) {
        const { note, hash } = byPath.get(path)!;
        const chunks = chunksByNote.get(path) ?? [];
        const meta: NoteMeta = {
          path,
          contentHash: hash,
          lastModified: note.lastModified,
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
        _chunkIndex: undefined, // chunk set changed → invalidate cached retrieval index
        indexSummary: {
          notesEmbedded: plan.toEmbed.length,
          notesReused: plan.unchanged.length,
          notesDeleted: plan.toDelete.length,
          chunksEmbedded: pending.length,
        },
      });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, indexProgress: undefined });
    }
    // The embedder is intentionally kept alive (singleton) for query embedding.
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
      embeddedChunks: [],
      embedderInfo: undefined,
      vaultName: undefined,
      progress: undefined,
      indexProgress: undefined,
      indexSummary: undefined,
      indexRestored: false,
      error: undefined,
      selectedNotePath: undefined,
      query: "",
      searchResults: undefined,
      _chunkIndex: undefined,
      _chunkIndexSource: undefined,
    }),
}));
