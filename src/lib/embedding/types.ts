import type { Chunk } from "../chunking/chunk";

/**
 * A chunk plus its embedding, held in memory after Step 4's index build.
 * Step 5 persists this same shape (minus the live Float32Array niceties) to
 * IndexedDB and adds a content hash for incremental re-indexing.
 */
export interface EmbeddedChunk extends Chunk {
  /** Vault-relative path of the source note. */
  notePath: string;
  /** 0-based position of this chunk within its note. */
  chunkIndex: number;
  /** L2-normalized sentence embedding (384-dim for all-MiniLM-L6-v2). */
  embedding: Float32Array;
}
