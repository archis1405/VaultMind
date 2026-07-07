/**
 * Retrieval evaluation: recall@k over hand-labeled query → expected-source pairs.
 *
 * The scoring here is pure and synchronous (and unit-tested) — it takes the
 * already-retrieved results per case and computes the metrics. The actual
 * retrieval (query embedding + hybrid search) is async and browser-side, and is
 * injected via {@link runEval}. Keeping the math pure means the numbers you quote
 * are reproducible and testable without a model in the loop.
 */

/** An expected relevant source for a query. `path` may be a partial path/filename. */
export interface ExpectedSource {
  path: string;
  /** For a book, the expected page (optional; omit to match any page of the file). */
  page?: number;
}

export interface EvalCase {
  query: string;
  expected: ExpectedSource[];
}

/** A retrieved chunk reduced to what matching needs. */
export interface RetrievedRef {
  notePath: string;
  page?: number;
}

export interface CaseResult {
  query: string;
  expected: ExpectedSource[];
  /** 1-based rank of each expected source in the retrieved list; null = not found. */
  ranks: (number | null)[];
  /** Fraction of this case's expected sources found within each k. */
  recallAt: Record<number, number>;
}

export interface EvalReport {
  numCases: number;
  ks: number[];
  /** Mean per-case recall at each k (the headline recall@k numbers). */
  recallAt: Record<number, number>;
  /** Fraction of cases with ≥1 expected source in the top-k. */
  hitRateAt: Record<number, number>;
  cases: CaseResult[];
}

/**
 * Flexible path match: an expected `path` matches a retrieved `notePath` if they
 * are equal, if the notePath ends with `/path`, or if their base filenames match.
 * This lets you label with just "SICP.pdf" or "Projects/plan" without the full
 * vault-relative path. Page (if given) must also match.
 */
export function matchesSource(ref: RetrievedRef, expected: ExpectedSource): boolean {
  if (expected.page !== undefined && ref.page !== expected.page) return false;

  const actual = ref.notePath.toLowerCase();
  const want = expected.path.toLowerCase();
  if (actual === want) return true;
  if (actual.endsWith(`/${want}`)) return true;

  const base = (p: string) => p.split("/").pop() ?? p;
  return base(actual) === base(want);
}

/** 1-based rank of the first retrieved ref matching `expected`, or null. */
function rankOf(retrieved: RetrievedRef[], expected: ExpectedSource): number | null {
  for (let i = 0; i < retrieved.length; i++) {
    if (matchesSource(retrieved[i], expected)) return i + 1;
  }
  return null;
}

/**
 * Score retrieval results against labeled cases.
 *
 * recall@k for a case = (expected sources found at rank ≤ k) / (total expected).
 * The report's recall@k is the mean of that across all cases (macro-average).
 * hitRate@k = fraction of cases with at least one expected source in the top-k.
 *
 * @param cases      Labeled query/expected pairs.
 * @param retrieved  Retrieved refs per case (aligned to `cases`), ordered best-first.
 * @param ks         Cutoffs to report (default 5 and 10).
 */
export function evaluateRetrieval(
  cases: EvalCase[],
  retrieved: RetrievedRef[][],
  ks: number[] = [5, 10],
): EvalReport {
  const caseResults: CaseResult[] = cases.map((c, i) => {
    const results = retrieved[i] ?? [];
    const ranks = c.expected.map((exp) => rankOf(results, exp));

    const recallAt: Record<number, number> = {};
    for (const k of ks) {
      const found = ranks.filter((r) => r !== null && r <= k).length;
      recallAt[k] = c.expected.length > 0 ? found / c.expected.length : 0;
    }
    return { query: c.query, expected: c.expected, ranks, recallAt };
  });

  const recallAt: Record<number, number> = {};
  const hitRateAt: Record<number, number> = {};
  const n = caseResults.length || 1;
  for (const k of ks) {
    recallAt[k] = caseResults.reduce((s, r) => s + r.recallAt[k], 0) / n;
    hitRateAt[k] =
      caseResults.filter((r) => r.ranks.some((rank) => rank !== null && rank <= k)).length / n;
  }

  return { numCases: cases.length, ks, recallAt, hitRateAt, cases: caseResults };
}

/**
 * Drive the evaluation end-to-end: retrieve for every case, then score. The
 * `retrieve` function is injected (the browser wires in the real hybrid pipeline),
 * so this stays independent of the store and the embedding worker.
 */
export async function runEval(
  cases: EvalCase[],
  retrieve: (query: string, topK: number) => Promise<RetrievedRef[]>,
  options: { depth?: number; ks?: number[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<EvalReport> {
  const ks = options.ks ?? [5, 10];
  const depth = options.depth ?? Math.max(...ks, 10);

  const retrieved: RetrievedRef[][] = [];
  for (let i = 0; i < cases.length; i++) {
    retrieved.push(await retrieve(cases[i].query, depth));
    options.onProgress?.(i + 1, cases.length);
  }
  return evaluateRetrieval(cases, retrieved, ks);
}
