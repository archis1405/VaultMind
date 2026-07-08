import type { EvalCase } from "./evaluate";

/**
 * Hand-labeled retrieval eval set — EDIT THIS with your own vault + books.
 *
 * Each case is a real question you'd ask, plus the source(s) that actually answer
 * it. `path` can be a full vault-relative path, a partial path, or just a
 * filename ("SICP.pdf", "Projects/roadmap"). For a book, add `page` to require a
 * specific page; omit it to accept any page of that file.
 *
 * Aim for 20–30 cases spanning notes and books, including a few hard ones
 * (paraphrases with no keyword overlap) — those are where hybrid retrieval earns
 * its keep, and where the recall numbers get interesting.
 *
 * Then: load your vault → Build index → open the "Eval" tab → Run.
 */
export const EVAL_SET: EvalCase[] = [
  // --- replace the examples below with your own labeled pairs ---
  {
    query: "How did I decide to structure the retrieval pipeline?",
    expected: [{ path: "Memora/architecture.md" }],
  },
  {
    query: "What does reciprocal rank fusion actually combine?",
    expected: [{ path: "notes/rrf.md" }],
  },
  {
    query: "the definition of a higher-order procedure",
    expected: [{ path: "SICP.pdf", page: 44 }],
  },
  {
    query: "meeting action items from the March planning session",
    expected: [{ path: "Journal/2026-03-planning.md" }],
  },
];
