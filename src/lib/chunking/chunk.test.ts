import { describe, test, expect } from "vitest";
import {
  chunkMarkdown,
  estimateTokens,
  DEFAULT_TARGET_TOKENS,
  DEFAULT_OVERLAP_RATIO,
} from "./chunk";

/** Build a body of N distinct, index-encoded words: "w0 w1 w2 ...". */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

/** Parse a windowed chunk of index-encoded words back to [firstIdx, lastIdx]. */
function span(text: string): [number, number] {
  const ids = text.split(/\s+/).map((w) => Number(w.slice(1)));
  return [ids[0], ids[ids.length - 1]];
}

describe("estimateTokens", () => {
  test("empty / whitespace → 0", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n  ")).toBe(0);
  });

  test("scales with word count", () => {
    expect(estimateTokens("one two three")).toBe(Math.ceil(3 * 1.3));
  });
});

describe("empty and trivial notes", () => {
  test("empty body → no chunks", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  test("whitespace-only body → no chunks", () => {
    expect(chunkMarkdown("   \n\n  \t ")).toEqual([]);
  });

  test("heading with no body → no chunks (title survives in children only)", () => {
    expect(chunkMarkdown("# Just a title")).toEqual([]);
  });
});

describe("heading-based sectioning", () => {
  test("single-heading note → one chunk carrying its heading path", () => {
    const chunks = chunkMarkdown("# Title\n\nSome content under the title.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["Title"]);
    expect(chunks[0].text).toContain("# Title");
    expect(chunks[0].text).toContain("Some content");
  });

  test("preamble before first heading becomes its own path-less chunk", () => {
    const body = "Intro paragraph.\n\n# Section\n\nBody of section.";
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual([]);
    expect(chunks[0].text).toContain("Intro paragraph");
    expect(chunks[1].headingPath).toEqual(["Section"]);
  });

  test("nested headings produce breadcrumb paths", () => {
    const body = [
      "# Chapter 1",
      "chapter intro",
      "## Overview",
      "overview text",
      "### Details",
      "detail text",
      "## Summary",
      "summary text",
    ].join("\n");
    const chunks = chunkMarkdown(body);
    const paths = chunks.map((c) => c.headingPath);
    expect(paths).toEqual([
      ["Chapter 1"],
      ["Chapter 1", "Overview"],
      ["Chapter 1", "Overview", "Details"],
      ["Chapter 1", "Summary"], // H2 pops the H3 (and prior H2) off the stack
    ]);
  });

  test("a heading that only groups sub-headings is dropped", () => {
    const body = "# Parent\n## Child\nchild body";
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["Parent", "Child"]);
  });
});

describe("code fences are not headings", () => {
  test("`#` lines inside a fenced block stay in the section body", () => {
    const body = [
      "# Real Heading",
      "text",
      "```bash",
      "# this is a shell comment, not a heading",
      "echo hi",
      "```",
      "more text",
    ].join("\n");
    const chunks = chunkMarkdown(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["Real Heading"]);
    expect(chunks[0].text).toContain("# this is a shell comment");
  });
});

describe("sliding-window fallback (no headings)", () => {
  const body = words(500);
  const chunks = chunkMarkdown(body);

  test("splits a long no-heading note into multiple overlapping chunks", () => {
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toEqual([]);
  });

  test("covers the whole note start-to-end with no gaps", () => {
    const spans = chunks.map((c) => span(c.text)).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBe(0); // starts at w0
    expect(spans[spans.length - 1][1]).toBe(499); // ends at w499
    // No gaps: each window starts no later than the previous window's end + 1.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0]).toBeLessThanOrEqual(spans[i - 1][1] + 1);
    }
  });

  test("consecutive windows actually overlap", () => {
    const spans = chunks.map((c) => span(c.text));
    for (let i = 1; i < spans.length; i++) {
      // start of this window is inside the previous window → shared words
      expect(spans[i][0]).toBeLessThanOrEqual(spans[i - 1][1]);
    }
  });

  test("overlap width matches the configured ratio", () => {
    const targetWords = Math.round(DEFAULT_TARGET_TOKENS / 1.3);
    const overlapWords = Math.round(targetWords * DEFAULT_OVERLAP_RATIO);
    const spans = chunks.map((c) => span(c.text));
    // First two full windows: overlap = win0.end - win1.start + 1.
    const overlap = spans[0][1] - spans[1][0] + 1;
    expect(overlap).toBe(overlapWords);
  });
});

describe("oversized heading section is sub-windowed", () => {
  test("long content under one heading yields many chunks sharing the path", () => {
    const body = `# Big Section\n\n${words(600)}`;
    const chunks = chunkMarkdown(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toEqual(["Big Section"]);
  });
});

describe("options are honored", () => {
  test("smaller target + zero overlap produces tight non-overlapping windows", () => {
    const chunks = chunkMarkdown(words(100), { targetTokens: 13, overlapRatio: 0 });
    // 13 tokens ≈ 10 words per window, no overlap → 10 windows of 10 words.
    expect(chunks).toHaveLength(10);
    const spans = chunks.map((c) => span(c.text));
    expect(spans[0]).toEqual([0, 9]);
    expect(spans[1]).toEqual([10, 19]);
  });
});
