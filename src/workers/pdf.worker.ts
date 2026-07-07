/// <reference lib="webworker" />

import * as pdfjs from "pdfjs-dist";
// Vite resolves this to an emitted asset URL; pdf.js parses in its own worker,
// so the heavy page decoding never runs on our thread (which itself is already
// off the main thread). This keeps a 300-page book from janking the UI.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ExtractedPage } from "../lib/pdf/chunkPdf";
import { detectExtractability } from "../lib/pdf/extractability";
import type { PdfExtractRequest, PdfExtractResponse } from "../lib/pdf/protocol";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function post(msg: PdfExtractResponse, transfer?: Transferable[]) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

/** Minimal shapes we rely on from pdf.js (avoids depending on its full types here). */
interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

/**
 * Build a page-number → chapter-title map from the PDF outline (bookmarks).
 * Each top-level (and nested) outline entry points at a destination; we resolve
 * that to a page index and record the nearest preceding chapter for every page.
 * PDFs without an outline simply get no chapters (chunks fall back to page-only).
 */
async function buildChapterMap(
  doc: pdfjs.PDFDocumentProxy,
): Promise<Map<number, string>> {
  const pageForChapter: { page: number; title: string }[] = [];

  const walk = async (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      try {
        const dest = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref) {
          const pageIndex = await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
          pageForChapter.push({ page: pageIndex + 1, title: node.title.trim() });
        }
      } catch {
        // Unresolvable destination — skip this heading.
      }
      if (node.items && node.items.length > 0) await walk(node.items);
    }
  };

  try {
    const outline = (await doc.getOutline()) as OutlineNode[] | null;
    if (outline) await walk(outline);
  } catch {
    // No/!broken outline → no chapters.
  }

  // Sort chapter start pages, then assign each page the nearest preceding chapter.
  pageForChapter.sort((a, b) => a.page - b.page);
  const map = new Map<number, string>();
  for (let p = 1; p <= doc.numPages; p++) {
    let current: string | undefined;
    for (const c of pageForChapter) {
      if (c.page <= p) current = c.title;
      else break;
    }
    if (current) map.set(p, current);
  }
  return map;
}

async function extract(req: PdfExtractRequest) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(req.buffer) }).promise;
  const total = doc.numPages;
  const chapters = await buildChapterMap(doc);

  const pages: ExtractedPage[] = [];
  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Join text items; pdf.js exposes each run's string on `.str`.
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: pageNum, text, chapter: chapters.get(pageNum) });
    page.cleanup();
    post({ type: "progress", id: req.id, page: pageNum, total });
  }

  await doc.destroy();
  post({ type: "result", id: req.id, pages, extractability: detectExtractability(pages) });
}

self.onmessage = async (e: MessageEvent<PdfExtractRequest>) => {
  const req = e.data;
  try {
    await extract(req);
  } catch (err) {
    post({ type: "error", id: req.id, message: (err as Error).message ?? String(err) });
  }
};
