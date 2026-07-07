export interface Fused {
  id: string;
  score: number;
}

export interface RRFOptions {
  /** Rank-damping constant (see below). Standard value from the RRF paper: 60. */
  k?: number;
  topK?: number;
}

/**
 * Reciprocal Rank Fusion — combine several ranked lists into one.
 *
 * For each ranked list, a document at 1-based rank r contributes:
 *
 *        1 / (k + r)
 *
 * and a document's final score is the SUM of these contributions across all
 * lists it appears in. Higher score → better. (Cormack, Clarke & Buettcher 2009.)
 *
 * Why RRF instead of adding the raw scores?
 *   BM25 scores are unbounded and query-dependent; cosine scores live in [-1, 1].
 *   Summing them directly would let BM25's scale silently dominate, and would
 *   require fragile per-query normalization. RRF throws the *scores* away and
 *   fuses on *rank position* only, so the two systems combine on equal footing
 *   regardless of scale. It's simple, parameter-light, and hard to beat.
 *
 * What does k do?
 *   k dampens the reward for being ranked #1. With k=60, rank 1 contributes
 *   1/61 ≈ 0.0164 and rank 2 contributes 1/62 ≈ 0.0161 — nearly equal, so a
 *   single list can't crown a winner by itself. Agreement across lists is what
 *   wins: a doc ranked #2 in *both* lists (2 × 1/62 ≈ 0.0323) beats a doc ranked
 *   #1 in only *one* (1/61 ≈ 0.0164). Smaller k sharpens the top-rank advantage;
 *   larger k flattens it. 60 is the well-tested default.
 *
 * Documents absent from a list simply contribute nothing from that list (rank ∞).
 * Ties break by id for deterministic output.
 *
 * @param rankings Ranked lists, each already ordered best-first. Only order is used.
 */
export function reciprocalRankFusion(
  rankings: { id: string }[][],
  options: RRFOptions = {},
): Fused[] {
  const k = options.k ?? 60;
  const scores = new Map<string, number>();

  for (const list of rankings) {
    list.forEach((item, i) => {
      const rank = i + 1; // ranks are 1-based
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank));
    });
  }

  const fused = [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  return options.topK === undefined ? fused : fused.slice(0, options.topK);
}
