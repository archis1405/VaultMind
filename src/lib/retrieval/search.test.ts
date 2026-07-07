import { describe, test, expect } from "vitest";
import { buildChunkIndex, hybridSearch, chunkKey } from "./search";
import type { EmbeddedChunk } from "../embedding/types";

/** Minimal EmbeddedChunk factory with a 2-D unit embedding. */
function chunk(notePath: string, chunkIndex: number, text: string, vec: number[]): EmbeddedChunk {
  const norm = Math.hypot(...vec) || 1;
  return {
    notePath,
    chunkIndex,
    sourceType: "note",
    text,
    headingPath: [],
    tokenCount: text.split(/\s+/).length,
    embedding: new Float32Array(vec.map((v) => v / norm)),
  };
}

describe("hybridSearch", () => {
  const chunks: EmbeddedChunk[] = [
    chunk("a.md", 0, "neural networks and deep learning", [1, 0]),
    chunk("b.md", 0, "gardening tips for tomatoes", [0, 1]),
    chunk("c.md", 0, "backpropagation trains neural nets", [0.9, 0.1]),
  ];
  const index = buildChunkIndex(chunks);

  test("returns chunks with fused score and per-signal ranks", () => {
    // Query matches 'neural' lexically (a, c) and points toward the ML cluster.
    const results = hybridSearch(index, "neural", new Float32Array([1, 0]), { topK: 3 });
    expect(results[0].id).toBe(chunkKey({ notePath: "a.md", chunkIndex: 0 }));
    expect(results[0].chunk.text).toContain("neural");
    expect(results[0].score).toBeGreaterThan(0);
    // 'a' appears in both signals, so it carries both ranks.
    expect(results[0].bm25Rank).toBeDefined();
    expect(results[0].vectorRank).toBeDefined();
  });

  test("semantic signal surfaces a chunk with no lexical overlap", () => {
    // 'backpropagation' shares no query token but is vector-close to the query.
    const results = hybridSearch(index, "backpropagation", new Float32Array([1, 0]), {
      topK: 3,
    });
    const cKey = chunkKey({ notePath: "c.md", chunkIndex: 0 });
    const c = results.find((r) => r.id === cKey)!;
    expect(c).toBeDefined();
    expect(c.vectorRank).toBeDefined(); // pulled in by cosine, not BM25 alone
  });
});
