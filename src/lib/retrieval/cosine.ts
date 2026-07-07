import type { Ranked } from "./bm25";

/** Dot product of two equal-length vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface Vector {
  id: string;
  embedding: Float32Array;
}

/**
 * Rank documents by cosine similarity to the query vector.
 *
 * Our embeddings are L2-normalized at embed time (Step 4 used `normalize: true`),
 * so `cosine(a,b) = (a·b)/(‖a‖‖b‖)` collapses to just the **dot product** — no
 * per-vector magnitude division needed. This is a brute-force linear scan
 * (exact kNN); fine at vault scale. Swap in an ANN index (HNSW) if the corpus
 * grows into the hundreds of thousands.
 */
export function cosineSearch(
  query: Float32Array,
  vectors: Vector[],
  topK: number = Infinity,
): Ranked[] {
  return vectors
    .map((v) => ({ id: v.id, score: dot(query, v.embedding) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, topK);
}
