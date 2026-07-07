/**
 * Detect whether a PDF actually yielded extractable text, or is effectively a
 * scanned/image-only document. We do NOT do OCR (per spec) — we detect the
 * empty-text case so the user gets a clear warning instead of a book that
 * silently contributes zero searchable chunks.
 *
 * Pure and dependency-free so the extraction worker and the tests can share it.
 */

export interface Extractability {
  /** Total non-whitespace characters across all pages. */
  charCount: number;
  /** Pages that contain a meaningful amount of text. */
  pagesWithText: number;
  totalPages: number;
  /** True when the document appears to have (almost) no extractable text. */
  scanned: boolean;
}

/** A page is considered to "have text" if it has at least this many non-ws chars. */
const MIN_CHARS_PER_TEXT_PAGE = 10;
/** Below this fraction of text-bearing pages, we call the document scanned. */
const SCANNED_TEXT_PAGE_FRACTION = 0.1;

export function detectExtractability(pages: { text: string }[]): Extractability {
  let charCount = 0;
  let pagesWithText = 0;

  for (const { text } of pages) {
    const nonWs = text.replace(/\s+/g, "").length;
    charCount += nonWs;
    if (nonWs >= MIN_CHARS_PER_TEXT_PAGE) pagesWithText += 1;
  }

  const totalPages = pages.length;
  const scanned =
    totalPages > 0 && pagesWithText / totalPages < SCANNED_TEXT_PAGE_FRACTION;

  return { charCount, pagesWithText, totalPages, scanned };
}
