import { chunkPlainText, type Chunk, type ChunkOptions } from "../chunking/chunk";

/** One extracted PDF page: its 1-based number, text, and (optional) chapter title. */
export interface ExtractedPage {
  page: number;
  text: string;
  /** Chapter/section title from the PDF outline, if this page falls under one. */
  chapter?: string;
}

/** A chunk that knows which PDF page it came from. */
export interface PdfChunk extends Chunk {
  /** 1-based source page number — the basis for "page N" citations. */
  page: number;
}

/**
 * Chunk extracted PDF pages, preserving the page number on every chunk.
 *
 * We chunk **page by page** rather than concatenating the whole book: this keeps
 * a clean 1:1 chunk→page mapping (so citations can say "page N" unambiguously),
 * at the cost of not merging text that flows across a page break. The chapter
 * title (from the outline) rides along in `headingPath` so it unifies with the
 * note breadcrumb model — a book chunk reads as `Book › Chapter › p.N`.
 */
export function chunkPdfPages(pages: ExtractedPage[], options?: ChunkOptions): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  for (const { page, text, chapter } of pages) {
    for (const chunk of chunkPlainText(text, options)) {
      chunks.push({
        ...chunk,
        page,
        headingPath: chapter ? [chapter] : [],
      });
    }
  }
  return chunks;
}
