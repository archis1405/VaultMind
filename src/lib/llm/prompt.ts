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
  /** The chunk text shown to the model / previewed in the UI. */
  text: string;
}

/** A short human label for a source, e.g. "notes.md › Overview". */
export function sourceLabel(s: Pick<Source, "notePath" | "headingPath">): string {
  const name = s.notePath.split("/").pop()?.replace(/\.md$/i, "") ?? s.notePath;
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
    text: r.chunk.text,
  }));

  const contextBlock = sources
    .map((s) => `[${s.n}] Source: ${sourceLabel(s)}\n${s.text}`)
    .join("\n\n");

  return { sources, contextBlock };
}

const SYSTEM_PROMPT = `You are AskVault, a careful assistant answering questions about the user's personal notes.

Rules:
- Answer using ONLY the information in the provided context sources.
- Cite every claim inline with bracketed source numbers like [1] or [2][3].
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
