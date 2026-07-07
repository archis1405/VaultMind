import { describe, test, expect } from "vitest";
import {
  evaluateRetrieval,
  matchesSource,
  runEval,
  type EvalCase,
  type RetrievedRef,
} from "./evaluate";

const refs = (...paths: string[]): RetrievedRef[] => paths.map((notePath) => ({ notePath }));

describe("matchesSource", () => {
  test("exact, suffix, and basename matches", () => {
    expect(matchesSource({ notePath: "a/b/note.md" }, { path: "a/b/note.md" })).toBe(true);
    expect(matchesSource({ notePath: "a/b/note.md" }, { path: "b/note.md" })).toBe(true);
    expect(matchesSource({ notePath: "a/b/note.md" }, { path: "note.md" })).toBe(true);
    expect(matchesSource({ notePath: "a/mynote.md" }, { path: "note.md" })).toBe(false);
  });

  test("page must match when specified", () => {
    expect(matchesSource({ notePath: "book.pdf", page: 42 }, { path: "book.pdf", page: 42 })).toBe(true);
    expect(matchesSource({ notePath: "book.pdf", page: 41 }, { path: "book.pdf", page: 42 })).toBe(false);
    // No page in the expectation → any page matches.
    expect(matchesSource({ notePath: "book.pdf", page: 5 }, { path: "book.pdf" })).toBe(true);
  });
});

describe("evaluateRetrieval", () => {
  test("recall@k and rank reflect where the expected source landed", () => {
    const cases: EvalCase[] = [{ query: "q", expected: [{ path: "target.md" }] }];
    // target at rank 3.
    const retrieved = [refs("a.md", "b.md", "target.md", "c.md")];
    const report = evaluateRetrieval(cases, retrieved, [5, 10]);

    expect(report.cases[0].ranks).toEqual([3]);
    expect(report.recallAt[5]).toBe(1);
    expect(report.recallAt[10]).toBe(1);
    expect(report.hitRateAt[5]).toBe(1);
  });

  test("a source beyond k counts as a miss at that k", () => {
    const cases: EvalCase[] = [{ query: "q", expected: [{ path: "target.md" }] }];
    const retrieved = [refs("a", "b", "c", "d", "e", "f", "target.md")]; // rank 7
    const report = evaluateRetrieval(cases, retrieved, [5, 10]);
    expect(report.recallAt[5]).toBe(0); // rank 7 > 5
    expect(report.recallAt[10]).toBe(1); // rank 7 ≤ 10
  });

  test("multiple expected sources → partial per-case recall", () => {
    const cases: EvalCase[] = [
      { query: "q", expected: [{ path: "x.md" }, { path: "y.md" }] },
    ];
    const retrieved = [refs("x.md", "a", "b")]; // only x found (rank 1); y missing
    const report = evaluateRetrieval(cases, retrieved, [5]);
    expect(report.cases[0].ranks).toEqual([1, null]);
    expect(report.recallAt[5]).toBe(0.5);
    expect(report.hitRateAt[5]).toBe(1); // ≥1 found → hit
  });

  test("aggregate recall is the mean across cases", () => {
    const cases: EvalCase[] = [
      { query: "q1", expected: [{ path: "a.md" }] }, // found rank 1
      { query: "q2", expected: [{ path: "z.md" }] }, // missing
    ];
    const report = evaluateRetrieval(cases, [refs("a.md"), refs("b.md")], [5]);
    expect(report.recallAt[5]).toBe(0.5);
    expect(report.hitRateAt[5]).toBe(0.5);
  });
});

describe("runEval", () => {
  test("retrieves per case then scores", async () => {
    const cases: EvalCase[] = [
      { query: "cats", expected: [{ path: "cats.md" }] },
      { query: "dogs", expected: [{ path: "dogs.md" }] },
    ];
    const retrieve = async (query: string) =>
      query === "cats" ? refs("cats.md", "x") : refs("x", "y"); // dogs misses
    const report = await runEval(cases, retrieve, { ks: [5] });
    expect(report.recallAt[5]).toBe(0.5);
    expect(report.numCases).toBe(2);
  });
});
