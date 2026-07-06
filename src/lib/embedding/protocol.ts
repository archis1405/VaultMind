/**
 * Typed message protocol between the main thread and the embedding worker.
 *
 * Every request carries a monotonic `id`; the matching responses echo it so the
 * client can correlate async replies (multiple embed calls can be in flight).
 * These types are shared by both sides — the worker and the client import them —
 * so the contract can't silently drift.
 */

export type EmbedderBackend = "webgpu" | "wasm";

/** Progress emitted while the model weights download + initialize. */
export interface ModelLoadProgress {
  /** transformers.js status: "initiate" | "download" | "progress" | "done" | "ready". */
  status: string;
  /** File currently being fetched, when applicable. */
  file?: string;
  /** 0–100 for the current file, when applicable. */
  progress?: number;
}

/** main → worker */
export type EmbedderRequest =
  | { type: "init"; id: number }
  | { type: "embed"; id: number; texts: string[]; batchSize: number };

/** worker → main */
export type EmbedderResponse =
  // init lifecycle
  | { type: "model-progress"; id: number; progress: ModelLoadProgress }
  | { type: "ready"; id: number; backend: EmbedderBackend; dimension: number }
  // embed lifecycle
  | { type: "embed-progress"; id: number; embedded: number; total: number }
  | {
      type: "embed-result";
      id: number;
      /** Flattened row-major [count × dimension] embeddings; buffer is transferred. */
      data: ArrayBuffer;
      count: number;
      dimension: number;
    }
  // either flow
  | { type: "error"; id: number; message: string };
