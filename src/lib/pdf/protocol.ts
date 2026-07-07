import type { ExtractedPage } from "./chunkPdf";
import type { Extractability } from "./extractability";

/** main → worker: extract text from this PDF's bytes. */
export interface PdfExtractRequest {
  id: number;
  /** The PDF file bytes; transferred to the worker (zero-copy). */
  buffer: ArrayBuffer;
  path: string;
}

/** worker → main */
export type PdfExtractResponse =
  | { type: "progress"; id: number; page: number; total: number }
  | {
      type: "result";
      id: number;
      pages: ExtractedPage[];
      extractability: Extractability;
    }
  | { type: "error"; id: number; message: string };
