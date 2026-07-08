import type { HybridResult } from "../retrieval/search";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * A retrieved chunk presented to the model as a numbered, citable source.
 * `n` is the 1-based citation number the model is told to reference as `[n]`.
 */
export interface Source {
  n: number;
  notePath: string;
  headingPath: string[];
  chunkIndex: number;
  sourceType: "note" | "pdf";
  /** 1-based page number for PDF sources. */
  page?: number;
  /** The chunk text shown to the model / previewed in the UI. */
  text: string;
}

type LabelFields = Pick<Source, "notePath" | "headingPath" | "sourceType" | "page">;

/** Base file name without a markdown/pdf extension. */
function baseName(path: string): string {
  return path.split("/").pop()?.replace(/\.(md|markdown|pdf)$/i, "") ?? path;
}

/**
 * A short human label for a source:
 *   note → "notes › Overview"
 *   book → "MyBook › Chapter 3, p.42"
 */
export function sourceLabel(s: LabelFields): string {
  const name = baseName(s.notePath);
  if (s.sourceType === "pdf") {
    const chapter = s.headingPath[0];
    const page = s.page !== undefined ? `p.${s.page}` : "";
    const suffix = [chapter, page].filter(Boolean).join(", ");
    return suffix ? `${name} › ${suffix}` : name;
  }
  return s.headingPath.length > 0 ? `${name} › ${s.headingPath.join(" › ")}` : name;
}

/**
 * Turn retrieval results into (a) a numbered source list for the UI and (b) a
 * context block for the prompt. Each source is fenced and labeled so the model
 * can attribute claims precisely.
 */
export function buildContext(results: HybridResult[]): {
  sources: Source[];
  contextBlock: string;
} {
  const sources: Source[] = results.map((r, i) => ({
    n: i + 1,
    notePath: r.chunk.notePath,
    headingPath: r.chunk.headingPath,
    chunkIndex: r.chunk.chunkIndex,
    sourceType: r.chunk.sourceType,
    page: r.chunk.page,
    text: r.chunk.text,
  }));

  // Label each source as a Note or Book so the model can cite pages for books.
  const contextBlock = sources
    .map((s) => `[${s.n}] ${s.sourceType === "pdf" ? "Book" : "Note"}: ${sourceLabel(s)}\n${s.text}`)
    .join("\n\n");

  return { sources, contextBlock };
}

const SYSTEM_PROMPT = `You are Memora, a careful assistant answering questions about the user's personal notes.

Rules:
- Answer using ONLY the information in the provided context sources.
- Cite every claim inline with bracketed source numbers like [1] or [2][3].
- Sources are labeled Note or Book; for a Book, mention the page in prose when useful (the label includes it).
- If the context does not contain the answer, say so plainly — do not invent facts.
- Be concise and direct.`;

/**
 * Assemble the message array for the chat API: a system instruction, any prior
 * conversation turns (for follow-up continuity), then the current question with
 * its freshly-retrieved context. Context is attached only to the latest turn —
 * re-retrieving per question keeps the model grounded in what's relevant now.
 */
export function buildMessages(
  question: string,
  contextBlock: string,
  history: ChatMessage[] = [],
): ChatMessage[] {
  const userContent =
    contextBlock.length > 0
      ? `Context:\n${contextBlock}\n\n---\n\nQuestion: ${question}`
      : `Question: ${question}\n\n(No context sources were retrieved from the vault.)`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userContent },
  ];
}
