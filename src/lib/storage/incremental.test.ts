import { describe, test, expect } from "vitest";
import { planIndex } from "./incremental";

const stored = (entries: [string, string][]) =>
  new Map(entries.map(([path, contentHash]) => [path, { contentHash }]));

describe("planIndex", () => {
  test("first run: everything is new → embed all, delete nothing", () => {
    const plan = planIndex(
      [
        { path: "a.md", hash: "h1" },
        { path: "b.md", hash: "h2" },
      ],
      new Map(),
    );
    expect(plan.toEmbed.sort()).toEqual(["a.md", "b.md"]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.unchanged).toEqual([]);
  });

  test("all hashes match → everything reused, no work", () => {
    const plan = planIndex(
      [
        { path: "a.md", hash: "h1" },
        { path: "b.md", hash: "h2" },
      ],
      stored([
        ["a.md", "h1"],
        ["b.md", "h2"],
      ]),
    );
    expect(plan.toEmbed).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.unchanged.sort()).toEqual(["a.md", "b.md"]);
  });

  test("changed note → re-embed and delete its stale chunks first", () => {
    const plan = planIndex([{ path: "a.md", hash: "NEW" }], stored([["a.md", "OLD"]]));
    expect(plan.toEmbed).toEqual(["a.md"]);
    expect(plan.toDelete).toEqual(["a.md"]);
    expect(plan.unchanged).toEqual([]);
  });

  test("note removed from vault → delete only, never embed", () => {
    const plan = planIndex([{ path: "a.md", hash: "h1" }], stored([
      ["a.md", "h1"],
      ["gone.md", "hx"],
    ]));
    expect(plan.toEmbed).toEqual([]);
    expect(plan.toDelete).toEqual(["gone.md"]);
    expect(plan.unchanged).toEqual(["a.md"]);
  });

  test("mixed: new + unchanged + changed + removed", () => {
    const plan = planIndex(
      [
        { path: "new.md", hash: "n" },
        { path: "same.md", hash: "s" },
        { path: "edit.md", hash: "v2" },
      ],
      stored([
        ["same.md", "s"],
        ["edit.md", "v1"],
        ["deleted.md", "d"],
      ]),
    );
    expect(plan.toEmbed.sort()).toEqual(["edit.md", "new.md"]);
    expect(plan.toDelete.sort()).toEqual(["deleted.md", "edit.md"]);
    expect(plan.unchanged).toEqual(["same.md"]);
  });
});
