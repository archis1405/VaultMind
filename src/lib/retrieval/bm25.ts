import { tokenize } from "./tokenize";

export interface BM25Doc {
  id: string;
  text: string;
}

export interface Ranked {
  id: string;
  score: number;
}

export interface BM25Options {
  /** Term-frequency saturation. Higher → tf keeps mattering longer. Lucene default 1.2. */
  k1?: number;
  /** Length normalization strength, 0..1. 0 = ignore length, 1 = full. Default 0.75. */
  b?: number;
}

/**
 * BM25 ranking function, implemented from scratch over an in-memory inverted index.
 *
 * Score of a document D for query Q:
 *
 *   score(D,Q) = Σ_{t∈Q} IDF(t) · ( f(t,D)·(k1+1) ) / ( f(t,D) + k1·(1 − b + b·|D|/avgdl) )
 *
 * where
 *   f(t,D)  = how many times term t occurs in D (term frequency),
 *   |D|     = length of D in tokens, avgdl = mean document length,
 *   IDF(t)  = ln( 1 + (N − df(t) + 0.5) / (df(t) + 0.5) )   ← the "+1" keeps IDF ≥ 0.
 *
 * Intuition:
 *   - IDF rewards *rare* terms (a term in every doc carries no signal).
 *   - The tf term saturates: the 2nd occurrence of a word matters far more than
 *     the 20th (controlled by k1), unlike raw tf-idf which grows linearly.
 *   - The |D|/avgdl factor penalizes long documents so they can't win just by
 *     containing more words (controlled by b).
 */
export class BM25 {
  private readonly k1: number;
  private readonly b: number;
  private readonly N: number;
  private readonly avgdl: number;
  /** term → document frequency (how many docs contain the term). */
  private readonly df = new Map<string, number>();
  /** term → (docId → term frequency within that doc). */
  private readonly postings = new Map<string, Map<string, number>>();
  /** docId → document length in tokens. */
  private readonly docLen = new Map<string, number>();

  constructor(docs: BM25Doc[], options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.N = docs.length;

    let totalLen = 0;
    for (const doc of docs) {
      const terms = tokenize(doc.text);
      this.docLen.set(doc.id, terms.length);
      totalLen += terms.length;

      const tf = new Map<string, number>();
      for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);

      for (const [term, freq] of tf) {
        let posting = this.postings.get(term);
        if (!posting) {
          posting = new Map();
          this.postings.set(term, posting);
        }
        posting.set(doc.id, freq);
        this.df.set(term, (this.df.get(term) ?? 0) + 1); // once per doc → doc freq
      }
    }
    this.avgdl = this.N > 0 ? totalLen / this.N : 0;
  }

  /** Inverse document frequency of a term (0 if unseen). */
  idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  /**
   * Rank documents against a query. Only documents sharing ≥1 query term score;
   * we walk each query term's postings (classic inverted-index traversal) rather
   * than scanning every document. Query terms are de-duplicated so a repeated
   * word isn't double-counted. Ties break by id for stable, testable output.
   */
  search(query: string, topK: number = Infinity): Ranked[] {
    const terms = new Set(tokenize(query));
    const scores = new Map<string, number>();

    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = this.idf(term);
      for (const [docId, freq] of posting) {
        const dl = this.docLen.get(docId)!;
        const denom = freq + this.k1 * (1 - this.b + (this.b * dl) / this.avgdl);
        const contribution = idf * ((freq * (this.k1 + 1)) / denom);
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
      }
    }

    return [...scores]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, topK);
  }
}
