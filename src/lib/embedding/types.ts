import type { Chunk } from "../chunking/chunk";

/**
 * A chunk plus its embedding, held in memory after Step 4's index build.
 * Step 5 persists this same shape (minus the live Float32Array niceties) to
 * IndexedDB and adds a content hash for incremental re-indexing.
 */
export interface EmbeddedChunk extends Chunk {
  /** Source path: a note's vault path, or a PDF's filename/path. */
  notePath: string;
  /** 0-based position of this chunk within its source document. */
  chunkIndex: number;
  /** Whether this chunk came from a markdown note or a PDF book. */
  sourceType: "note" | "pdf";
  /** 1-based page number for PDF chunks (undefined for notes). */
  page?: number;
  /** L2-normalized sentence embedding (384-dim for all-MiniLM-L6-v2). */
  embedding: Float32Array;
}
