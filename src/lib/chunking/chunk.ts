/**
 * Semantic markdown chunking.
 *
 * Strategy, in priority order:
 *   1. Split the note at markdown heading boundaries into "sections". Each
 *      section carries a `headingPath` breadcrumb (its heading plus ancestors),
 *      which later becomes citation context ("Note › Chapter 1 › Overview").
 *   2. Any section that fits under the token target is emitted whole — this is
 *      the semantic ideal: one coherent heading-delimited passage per chunk.
 *   3. A section too large for the target (long prose under one heading), or a
 *      note with no headings at all, is sliced into fixed-size sliding windows
 *      with overlap so no idea is split cleanly down the middle.
 *
 * Everything here is pure and synchronous so it can be unit-tested in isolation
 * and run either on the main thread or inside the embedding worker (Step 4).
 */

/** A unit of text ready to be embedded and indexed. */
export interface Chunk {
  /** The chunk's text (a heading section includes its heading line inline). */
  text: string;
  /** Estimated token count (see {@link estimateTokens}). */
  tokenCount: number;
  /**
   * Heading breadcrumb from document root to this chunk's section, e.g.
   * `["Chapter 1", "Overview"]`. Empty for a note's preamble (text before the
   * first heading) or a note with no headings at all.
   */
  headingPath: string[];
}

export interface ChunkOptions {
  /** Target chunk size in (estimated) tokens for the sliding-window fallback. */
  targetTokens?: number;
  /** Fraction of a window shared with the next window, e.g. 0.15 = 15%. */
  overlapRatio?: number;
}

/**
 * all-MiniLM-L6-v2 truncates inputs at 256 word-piece tokens. We default the
 * chunk target to 300 (per the project spec), which means the longest chunks
 * may be lightly truncated by the model. If you want zero truncation, drop
 * DEFAULT_TARGET_TOKENS to <= MINILM_MAX_TOKENS — it's a single constant.
 */
export const MINILM_MAX_TOKENS = 256;
export const DEFAULT_TARGET_TOKENS = 300;
export const DEFAULT_OVERLAP_RATIO = 0.15;

/**
 * Approximate WordPiece token count without running the real (async, heavy)
 * tokenizer. English WordPiece averages ~1.3 subword tokens per whitespace
 * word; that ratio is accurate enough to size chunks. The true count is only
 * needed by the model at embed time, which enforces its own 256-token cap.
 */
const TOKENS_PER_WORD = 1.3;

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * TOKENS_PER_WORD);
}

/** ATX heading: up to 3 leading spaces, 1–6 `#`, a space, then the title. */
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
/** Fenced code block open/close: ``` or ~~~ (3+), up to 3 leading spaces. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

interface Section {
  headingPath: string[];
  text: string;
}

/**
 * Split a markdown body into heading-delimited sections.
 *
 * `#` lines inside fenced code blocks are ignored (a shell comment or Python
 * code is not a heading). The heading stack yields correct nesting: an H3 under
 * an H2 gets path `[h2title, h3title]`. A section that is only a heading with no
 * body (a parent that just groups sub-headings) is dropped — its title still
 * survives in its children's `headingPath`.
 */
function splitIntoSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];

  let buffer: string[] = [];
  let bufferPath: string[] = [];
  let bufferHasHeading = false;

  let inFence = false;
  let fenceMarker = "";

  const flush = () => {
    const trimmed = buffer.join("\n").trim();
    if (trimmed.length > 0) {
      // Drop heading-only sections (heading line, nothing beneath it).
      const bodyOnly = bufferHasHeading ? buffer.slice(1).join("\n").trim() : trimmed;
      if (bodyOnly.length > 0) {
        sections.push({ headingPath: bufferPath, text: trimmed });
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        inFence = false;
      }
      buffer.push(line);
      continue;
    }

    const heading = inFence ? null : HEADING_RE.exec(line);
    if (heading) {
      flush(); // close the previous section using its (still-current) path
      const level = heading[1].length;
      const title = heading[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      bufferPath = stack.map((s) => s.title);
      bufferHasHeading = true;
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Slice text into overlapping fixed-size windows.
 *
 * We window at the *word* level (atomic units, never split mid-word) and size
 * windows in words derived from the token target. The overlap carries the tail
 * of one window into the head of the next so a sentence spanning a boundary is
 * still fully present in at least one chunk. `step = targetWords - overlapWords`
 * guarantees forward progress; the break avoids emitting a redundant final
 * window once the tail is already covered.
 *
 * Note: whitespace is normalized to single spaces here (the fallback path is for
 * unstructured prose, where exact formatting doesn't matter for embeddings).
 */
function slidingWindow(
  text: string,
  targetTokens: number,
  overlapRatio: number,
): { text: string; tokenCount: number }[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const targetWords = Math.max(1, Math.round(targetTokens / TOKENS_PER_WORD));
  const overlapWords = Math.min(
    targetWords - 1,
    Math.max(0, Math.round(targetWords * overlapRatio)),
  );
  const step = Math.max(1, targetWords - overlapWords);

  const windows: { text: string; tokenCount: number }[] = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + targetWords);
    const chunkText = slice.join(" ");
    windows.push({ text: chunkText, tokenCount: estimateTokens(chunkText) });
    if (start + targetWords >= words.length) break; // tail covered — stop
  }
  return windows;
}

/**
 * Chunk unstructured plain text (e.g. one PDF page) with the sliding-window
 * strategy only — no heading detection, so a stray `#` in extracted PDF text is
 * never misread as a heading. Returns chunks with an empty `headingPath`; the
 * caller (PDF pipeline) attaches page/chapter metadata.
 */
export function chunkPlainText(text: string, options: ChunkOptions = {}): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO;

  const trimmed = text.trim();
  if (!trimmed) return [];

  const tokens = estimateTokens(trimmed);
  if (tokens <= targetTokens) {
    return [{ text: trimmed, tokenCount: tokens, headingPath: [] }];
  }
  return slidingWindow(trimmed, targetTokens, overlapRatio).map((w) => ({
    text: w.text,
    tokenCount: w.tokenCount,
    headingPath: [],
  }));
}

/**
 * Chunk a frontmatter-stripped markdown body into embeddable chunks.
 *
 * @param body   The note body (frontmatter already removed in Step 2).
 * @param options Optional target size / overlap overrides.
 */
export function chunkMarkdown(body: string, options: ChunkOptions = {}): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO;

  const chunks: Chunk[] = [];
  for (const section of splitIntoSections(body)) {
    const tokens = estimateTokens(section.text);
    if (tokens <= targetTokens) {
      chunks.push({ text: section.text, tokenCount: tokens, headingPath: section.headingPath });
    } else {
      for (const w of slidingWindow(section.text, targetTokens, overlapRatio)) {
        chunks.push({
          text: w.text,
          tokenCount: w.tokenCount,
          headingPath: section.headingPath,
        });
      }
    }
  }
  return chunks;
}
