import { describe, test, expect } from "vitest";
import { detectExtractability } from "./extractability";
import { chunkPdfPages, type ExtractedPage } from "./chunkPdf";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("detectExtractability", () => {
  test("normal text PDF is not scanned", () => {
    const r = detectExtractability([{ text: "hello world" }, { text: "more text here" }]);
    expect(r.scanned).toBe(false);
    expect(r.pagesWithText).toBe(2);
    expect(r.charCount).toBeGreaterThan(0);
  });

  test("empty pages → scanned", () => {
    const r = detectExtractability([{ text: "" }, { text: "   \n " }, { text: "" }]);
    expect(r.scanned).toBe(true);
    expect(r.charCount).toBe(0);
    expect(r.pagesWithText).toBe(0);
  });

  test("a few text pages among many blanks → scanned", () => {
    const pages = [{ text: "real text content here" }, ...Array(50).fill({ text: "" })];
    expect(detectExtractability(pages).scanned).toBe(true);
  });

  test("no pages → not scanned (nothing to warn about)", () => {
    expect(detectExtractability([]).scanned).toBe(false);
  });
});

describe("chunkPdfPages", () => {
  test("preserves the page number on every chunk", () => {
    const pages: ExtractedPage[] = [
      { page: 1, text: "first page text" },
      { page: 2, text: "second page text" },
    ];
    const chunks = chunkPdfPages(pages);
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
  });

  test("a long page produces multiple chunks all sharing that page", () => {
    const chunks = chunkPdfPages([{ page: 7, text: words(600) }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.page).toBe(7);
  });

  test("empty / whitespace pages contribute no chunks", () => {
    const chunks = chunkPdfPages([
      { page: 1, text: "" },
      { page: 2, text: "content" },
      { page: 3, text: "   " },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page).toBe(2);
  });

  test("chapter title is carried in headingPath", () => {
    const chunks = chunkPdfPages([{ page: 12, text: "content", chapter: "Chapter 3" }]);
    expect(chunks[0].headingPath).toEqual(["Chapter 3"]);
  });
});
