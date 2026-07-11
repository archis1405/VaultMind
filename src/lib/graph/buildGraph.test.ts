import { describe, it, expect } from "vitest";
import { buildGraph } from "./buildGraph";
import type { EmbeddedChunk } from "../embedding/types";

/** A unit-length 3-d embedding (enough to exercise cosine/dot). */
function vec(x: number, y: number, z: number): Float32Array {
  const n = Math.hypot(x, y, z) || 1;
  return Float32Array.from([x / n, y / n, z / n]);
}

function chunk(notePath: string, embedding: Float32Array, i = 0): EmbeddedChunk {
  return {
    text: `chunk ${i} of ${notePath}`,
    tokenCount: 10,
    headingPath: [],
    notePath,
    chunkIndex: i,
    sourceType: notePath.endsWith(".pdf") ? "pdf" : "note",
    embedding,
  };
}

describe("buildGraph", () => {
  it("makes one node per document and averages its chunks", () => {
    const chunks = [
      chunk("a.md", vec(1, 0, 0), 0),
      chunk("a.md", vec(1, 0, 0), 1),
      chunk("b.md", vec(0, 1, 0), 0),
    ];
    const g = buildGraph(chunks, { minSimilarity: 0.9 });
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.find((n) => n.id === "a.md")!.chunkCount).toBe(2);
  });

  it("links similar documents and separates dissimilar ones", () => {
    const chunks = [
      chunk("a.md", vec(1, 0, 0)),
      chunk("b.md", vec(0.95, 0.05, 0)), // very close to a
      chunk("c.md", vec(0, 0, 1)), // orthogonal
    ];
    const g = buildGraph(chunks, { minSimilarity: 0.6 });
    const linked = g.edges.some(
      (e) => (e.source === "a.md" && e.target === "b.md") || (e.source === "b.md" && e.target === "a.md"),
    );
    expect(linked).toBe(true);
    // c is orthogonal to both → its own cluster.
    expect(g.clusterCount).toBe(2);
    expect(g.nodes.find((n) => n.id === "c.md")!.degree).toBe(0);
  });

  it("respects the similarity threshold", () => {
    const chunks = [chunk("a.md", vec(1, 0, 0)), chunk("b.md", vec(0.7, 0.7, 0))];
    expect(buildGraph(chunks, { minSimilarity: 0.5 }).edges).toHaveLength(1);
    expect(buildGraph(chunks, { minSimilarity: 0.9 }).edges).toHaveLength(0);
  });

  it("carries source type onto the node", () => {
    const g = buildGraph([chunk("book.pdf", vec(1, 0, 0)), chunk("note.md", vec(0, 1, 0))]);
    expect(g.nodes.find((n) => n.id === "book.pdf")!.sourceType).toBe("pdf");
    expect(g.nodes.find((n) => n.id === "note.md")!.sourceType).toBe("note");
  });
});
