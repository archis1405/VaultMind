import type { ExtractedPage } from "./chunkPdf";
import type { Extractability } from "./extractability";
import type { PdfExtractRequest, PdfExtractResponse } from "./protocol";

export interface PdfExtraction {
  pages: ExtractedPage[];
  extractability: Extractability;
}

interface Pending {
  resolve: (v: PdfExtraction) => void;
  reject: (err: Error) => void;
  onProgress?: (page: number, total: number) => void;
}

/**
 * Main-thread handle to the PDF extraction worker. Promise wrapper over the
 * postMessage protocol, one request per PDF, correlated by id. Reuses a single
 * worker across all PDFs in an index build.
 */
export class PdfExtractor {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("../../workers/pdf.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<PdfExtractResponse>) => this.handle(e.data);
    this.worker.onerror = (e) =>
      this.failAll(new Error(e.message || "PDF worker crashed"));
  }

  /** Extract text (+ chapter map) from a PDF's bytes. Transfers the buffer. */
  extract(
    buffer: ArrayBuffer,
    path: string,
    onProgress?: (page: number, total: number) => void,
  ): Promise<PdfExtraction> {
    const id = this.nextId++;
    return new Promise<PdfExtraction>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const req: PdfExtractRequest = { id, buffer, path };
      this.worker.postMessage(req, [buffer]);
    });
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new Error("PDF extractor terminated"));
  }

  private handle(msg: PdfExtractResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case "progress":
        p.onProgress?.(msg.page, msg.total);
        break;
      case "result":
        this.pending.delete(msg.id);
        p.resolve({ pages: msg.pages, extractability: msg.extractability });
        break;
      case "error":
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
        break;
    }
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
