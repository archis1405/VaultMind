import { describe, test, expect } from "vitest";
import { BM25, type BM25Doc } from "./bm25";

// A small, hand-checkable corpus.
const corpus: BM25Doc[] = [
  { id: "d1", text: "the cat sat on the mat" }, // len 6
  { id: "d2", text: "the dog sat on the log" }, // len 6
  { id: "d3", text: "cats and dogs are great pets" }, // len 6
  { id: "d4", text: "the quick brown fox jumps over the lazy dog" }, // len 9
];

describe("BM25", () => {
  const bm25 = new BM25(corpus);

  test("a term unique to one doc ranks that doc first", () => {
    // "cat" appears only in d1 ("cats" in d3 is a different token — no stemming).
    const results = bm25.search("cat");
    expect(results[0].id).toBe("d1");
    expect(results.map((r) => r.id)).not.toContain("d3");
  });

  test("shorter document wins on equal term frequency (length normalization)", () => {
    // "dog" is in d2 (len 6) and d4 (len 9), both tf=1 → shorter d2 scores higher.
    const results = bm25.search("dog");
    expect(results.map((r) => r.id)).toEqual(["d2", "d4"]);
  });

  test("equal scores break ties deterministically by id", () => {
    // "sat" is in d1 and d2, identical stats → tie → id order.
    const results = bm25.search("sat");
    expect(results.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(results[0].score).toBeCloseTo(results[1].score, 10);
  });

  test("IDF rewards rarer terms", () => {
    expect(bm25.idf("fox")).toBeGreaterThan(bm25.idf("the")); // df 1 vs df 3
  });

  test("multi-term query sums contributions across terms", () => {
    // d4 contains both "fox" and "dog"; it should top a "fox dog" query.
    const results = bm25.search("fox dog");
    expect(results[0].id).toBe("d4");
  });

  test("unknown query terms yield no results", () => {
    expect(bm25.search("elephant zebra")).toEqual([]);
  });

  test("topK truncates the ranked list", () => {
    expect(bm25.search("the", 1)).toHaveLength(1);
  });
});
