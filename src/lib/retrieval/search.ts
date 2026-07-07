import type { EmbeddedChunk } from "../embedding/types";
import { BM25, type BM25Options } from "./bm25";
import { cosineSearch, type Vector } from "./cosine";
import { reciprocalRankFusion } from "./rrf";

/** Stable chunk id used across BM25 / vector / fusion. */
export function chunkKey(c: { notePath: string; chunkIndex: number }): string {
  return `${c.notePath}#${c.chunkIndex}`;
}

/**
 * A prebuilt retrieval index over a set of chunks. Build it once when the chunk
 * set changes (indexing the BM25 postings is the expensive bit) and reuse across
 * many queries — don't rebuild per keystroke.
 */
export interface ChunkIndex {
  bm25: BM25;
  vectors: Vector[];
  byId: Map<string, EmbeddedChunk>;
}

export function buildChunkIndex(chunks: EmbeddedChunk[], options?: BM25Options): ChunkIndex {
  const byId = new Map<string, EmbeddedChunk>();
  const vectors: Vector[] = [];
  const docs = chunks.map((c) => {
    const id = chunkKey(c);
    byId.set(id, c);
    vectors.push({ id, embedding: c.embedding });
    return { id, text: c.text };
  });
  return { bm25: new BM25(docs, options), vectors, byId };
}

export interface HybridResult {
  id: string;
  chunk: EmbeddedChunk;
  /** Fused RRF score. */
  score: number;
  /** 1-based rank in the BM25 list, or undefined if it didn't make the cut. */
  bm25Rank?: number;
  /** 1-based rank in the vector list, or undefined. */
  vectorRank?: number;
}

export interface HybridOptions {
  /** Final number of results to return. */
  topK?: number;
  /** How deep to take each list before fusing. Bounds RRF ranks. */
  candidateDepth?: number;
  /** RRF rank-damping constant. */
  rrfK?: number;
}

/**
 * Hybrid retrieval: run BM25 (lexical) and cosine (semantic) independently, take
 * the top `candidateDepth` of each, then fuse with RRF. Lexical catches exact
 * terms / rare keywords the embedding may blur; semantic catches paraphrases the
 * keywords miss. RRF gives us the best of both without tuning score weights.
 */
export function hybridSearch(
  index: ChunkIndex,
  query: string,
  queryEmbedding: Float32Array,
  options: HybridOptions = {},
): HybridResult[] {
  const depth = options.candidateDepth ?? 50;
  const topK = options.topK ?? 10;

  const bm25Ranked = index.bm25.search(query, depth);
  const vecRanked = cosineSearch(queryEmbedding, index.vectors, depth);

  const bm25Rank = new Map(bm25Ranked.map((r, i) => [r.id, i + 1]));
  const vecRank = new Map(vecRanked.map((r, i) => [r.id, i + 1]));

  const fused = reciprocalRankFusion([bm25Ranked, vecRanked], { k: options.rrfK, topK });

  return fused.map((f) => ({
    id: f.id,
    chunk: index.byId.get(f.id)!,
    score: f.score,
    bm25Rank: bm25Rank.get(f.id),
    vectorRank: vecRank.get(f.id),
  }));
}
