import { describe, test, expect } from "vitest";
import { reciprocalRankFusion } from "./rrf";

const ids = (list: { id: string }[]) => list.map((x) => x.id);
const r = (arr: string[]) => arr.map((id) => ({ id }));

describe("reciprocalRankFusion", () => {
  test("a doc ranked high in both lists beats one ranked high in only one", () => {
    // 'a' is #1 in both; 'x' is #1 in listB only.
    const fused = reciprocalRankFusion([r(["a", "b"]), r(["a", "x"])]);
    expect(fused[0].id).toBe("a");
  });

  test("cross-list agreement outweighs a single top rank", () => {
    // 'both' is #2 in each list; 'solo' is #1 in one list only.
    //   both: 2 × 1/(60+2) ≈ 0.03226   solo: 1/(60+1) ≈ 0.01639
    const fused = reciprocalRankFusion([
      r(["solo", "both"]),
      r(["other", "both"]),
    ]);
    expect(fused[0].id).toBe("both");
  });

  test("contribution is 1/(k+rank); scores are exact", () => {
    const fused = reciprocalRankFusion([r(["a", "b"])], { k: 60 });
    const a = fused.find((f) => f.id === "a")!;
    const b = fused.find((f) => f.id === "b")!;
    expect(a.score).toBeCloseTo(1 / 61, 12);
    expect(b.score).toBeCloseTo(1 / 62, 12);
  });

  test("smaller k sharpens the top-rank advantage", () => {
    // With k=1: solo #1 = 1/2 = 0.5 beats both-#2 = 2×1/3 ≈ 0.667? No — recompute:
    // both-#2 = 2/(1+2) = 0.667 > solo 1/(1+1)=0.5, so agreement still wins even at k=1.
    // The point we assert: shrinking k raises #1's share relative to #2's.
    const bigK = reciprocalRankFusion([r(["x", "y"])], { k: 1000 });
    const smallK = reciprocalRankFusion([r(["x", "y"])], { k: 1 });
    const ratio = (f: { id: string; score: number }[]) =>
      f.find((z) => z.id === "x")!.score / f.find((z) => z.id === "y")!.score;
    expect(ratio(smallK)).toBeGreaterThan(ratio(bigK));
  });

  test("ties break by id; topK truncates", () => {
    const fused = reciprocalRankFusion([r(["b", "a"]), r(["a", "b"])], { topK: 1 });
    expect(fused).toHaveLength(1);
    // a and b both get 1/61 + 1/62 → tie → 'a' wins on id.
    expect(fused[0].id).toBe("a");
  });

  test("empty input → empty output", () => {
    expect(ids(reciprocalRankFusion([]))).toEqual([]);
  });
});
