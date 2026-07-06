import { create } from "zustand";
import {
  ingestVault,
  pickVaultDirectory,
  VaultPickCancelled,
} from "../lib/vault/ingest";
import type { IngestProgress, VaultNote } from "../lib/vault/types";
import { chunkMarkdown } from "../lib/chunking/chunk";
import { Embedder, type EmbedderInfo } from "../lib/embedding/embedder";
import type { EmbeddedChunk } from "../lib/embedding/types";

export type AppStatus = "idle" | "ingesting" | "indexing" | "ready" | "error";

/** Live progress of the index build (model load, then embedding). */
export interface IndexProgress {
  phase: "loading-model" | "embedding";
  /** Chunks embedded so far (phase "embedding"). */
  embedded: number;
  /** Total chunks to embed. */
  total: number;
  /** Model download %, 0–100 (phase "loading-model"). */
  modelPercent?: number;
  /** File currently downloading. */
  modelFile?: string;
}

interface VaultState {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;

  vaultName?: string;
  notes: VaultNote[];
  progress?: IngestProgress;
  error?: string;
  selectedNotePath?: string;

  // --- indexing (Step 4) ---
  embeddedChunks: EmbeddedChunk[];
  embedderInfo?: EmbedderInfo;
  indexProgress?: IndexProgress;

  loadVault: () => Promise<void>;
  buildIndex: () => Promise<void>;
  selectNote: (path?: string) => void;
  resetVault: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  status: "idle",
  notes: [],
  embeddedChunks: [],

  setStatus: (status) => set({ status }),
  selectNote: (path) => set({ selectedNotePath: path }),

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
      embeddedChunks: [], // a new vault invalidates any previous index
      embedderInfo: undefined,
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

  buildIndex: async () => {
    const { notes } = get();
    if (notes.length === 0) return;

    set({
      status: "indexing",
      error: undefined,
      embeddedChunks: [],
      indexProgress: { phase: "loading-model", embedded: 0, total: 0 },
    });

    const embedder = new Embedder();
    try {
      // 1. Load the model (streams download progress).
      const info = await embedder.init((p) =>
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

      // 2. Chunk every note, keeping the note path + position with each chunk.
      const pending: Omit<EmbeddedChunk, "embedding">[] = [];
      for (const note of notes) {
        chunkMarkdown(note.body).forEach((chunk, chunkIndex) =>
          pending.push({ ...chunk, notePath: note.path, chunkIndex }),
        );
      }

      set({ indexProgress: { phase: "embedding", embedded: 0, total: pending.length } });

      // 3. Embed all chunk texts, streaming progress.
      const embeddings = await embedder.embed(
        pending.map((c) => c.text),
        (embedded, total) =>
          set({ indexProgress: { phase: "embedding", embedded, total } }),
      );

      const embeddedChunks: EmbeddedChunk[] = pending.map((c, i) => ({
        ...c,
        embedding: embeddings[i],
      }));

      set({
        status: "ready",
        embeddedChunks,
        embedderInfo: info,
        indexProgress: undefined,
      });
    } catch (err) {
      set({ status: "error", error: (err as Error).message, indexProgress: undefined });
    } finally {
      embedder.terminate();
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
      error: undefined,
      selectedNotePath: undefined,
    }),
}));
