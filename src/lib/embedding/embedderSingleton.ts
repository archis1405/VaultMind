import { Embedder, type EmbedderInfo } from "./embedder";
import type { ModelLoadProgress } from "./protocol";

/**
 * Process-wide single embedding worker. Both indexing (Step 5) and query
 * embedding (Step 6) go through it, so the model is loaded exactly once and
 * kept warm for the session rather than spun up and torn down per operation.
 */
let embedder: Embedder | null = null;
let initPromise: Promise<EmbedderInfo> | null = null;

export function getEmbedder(): Embedder {
  if (!embedder) embedder = new Embedder();
  return embedder;
}

/** Idempotent model load. Concurrent callers share one in-flight init. */
export function initEmbedder(onProgress?: (p: ModelLoadProgress) => void): Promise<EmbedderInfo> {
  if (!initPromise) {
    initPromise = getEmbedder()
      .init(onProgress)
      .catch((err) => {
        initPromise = null; // allow a retry after a failed load
        throw err;
      });
  }
  return initPromise;
}
