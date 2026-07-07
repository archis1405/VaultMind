import { describe, test, expect } from "vitest";
import { dot, cosineSearch, type Vector } from "./cosine";

/** L2-normalize a plain array into a Float32Array (mirrors embed-time output). */
function unit(values: number[]): Float32Array {
  const norm = Math.hypot(...values) || 1;
  return new Float32Array(values.map((v) => v / norm));
}

describe("dot", () => {
  test("computes the dot product", () => {
    expect(dot(new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6]))).toBeCloseTo(32);
  });
});

describe("cosineSearch", () => {
  const vectors: Vector[] = [
    { id: "up", embedding: unit([0, 1]) },
    { id: "right", embedding: unit([1, 0]) },
    { id: "diag", embedding: unit([1, 1]) },
  ];

  test("ranks by similarity to the query direction", () => {
    // Query points right → "right" (identical) best, "diag" (45°) next, "up" (90°) last.
    const results = cosineSearch(unit([1, 0]), vectors);
    expect(results.map((r) => r.id)).toEqual(["right", "diag", "up"]);
    expect(results[0].score).toBeCloseTo(1); // identical unit vectors
    expect(results[2].score).toBeCloseTo(0); // orthogonal
  });

  test("topK truncates", () => {
    expect(cosineSearch(unit([1, 0]), vectors, 2)).toHaveLength(2);
  });
});
