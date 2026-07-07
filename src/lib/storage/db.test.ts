import "fake-indexeddb/auto";
import { beforeEach, describe, test, expect } from "vitest";
import {
  chunkId,
  clearIndex,
  clearMessages,
  deleteNote,
  getAllChunks,
  getAllMessages,
  getAllNoteMeta,
  getDatabase,
  getEmbedderMeta,
  getSettings,
  putMessage,
  saveIndexedNote,
  setEmbedderMeta,
  setSettings,
  type NoteMeta,
  type StoredChunk,
} from "./db";

function makeChunk(notePath: string, i: number): StoredChunk {
  return {
    id: chunkId(notePath, i),
    notePath,
    chunkIndex: i,
    text: `chunk ${i} of ${notePath}`,
    headingPath: ["H", `sub-${i}`],
    tokenCount: 5,
    embedding: new Float32Array([i, i + 0.25, i + 0.5]),
    lastModified: 1000 + i,
  };
}

function makeMeta(path: string, hash: string, chunkCount: number): NoteMeta {
  return { path, contentHash: hash, lastModified: 1000, chunkCount, indexedAt: 42 };
}

beforeEach(async () => {
  const db = await getDatabase();
  await clearIndex(db);
  await clearMessages(db);
  await db.clear("meta");
});

describe("IndexedDB persistence", () => {
  test("round-trips chunks with Float32Array embeddings intact", async () => {
    const db = await getDatabase();
    const chunks = [makeChunk("a.md", 0), makeChunk("a.md", 1)];
    await saveIndexedNote(db, makeMeta("a.md", "h1", 2), chunks);

    const all = await getAllChunks(db);
    expect(all).toHaveLength(2);

    const first = all.find((c) => c.id === "a.md#0")!;
    expect(first.embedding).toBeInstanceOf(Float32Array);
    expect(Array.from(first.embedding)).toEqual([0, 0.25, 0.5]);
    expect(first.headingPath).toEqual(["H", "sub-0"]);

    const meta = await getAllNoteMeta(db);
    expect(meta.get("a.md")?.contentHash).toBe("h1");
  });

  test("deleteNote removes only the target note's chunks", async () => {
    const db = await getDatabase();
    await saveIndexedNote(db, makeMeta("a.md", "h1", 2), [
      makeChunk("a.md", 0),
      makeChunk("a.md", 1),
    ]);
    await saveIndexedNote(db, makeMeta("b.md", "h2", 1), [makeChunk("b.md", 0)]);

    await deleteNote(db, "a.md");

    const all = await getAllChunks(db);
    expect(all.map((c) => c.notePath)).toEqual(["b.md"]);
    const meta = await getAllNoteMeta(db);
    expect([...meta.keys()]).toEqual(["b.md"]);
  });

  test("clearIndex wipes chunks + notes but preserves meta (settings survive a rebuild)", async () => {
    const db = await getDatabase();
    await setEmbedderMeta(db, { model: "m", backend: "wasm", dimension: 384 });
    await setSettings(db, { apiKey: "secret", model: "anthropic/x" });
    await saveIndexedNote(db, makeMeta("a.md", "h1", 1), [makeChunk("a.md", 0)]);

    await clearIndex(db);

    expect(await getAllChunks(db)).toHaveLength(0);
    expect(await getAllNoteMeta(db)).toEqual(new Map());
    // Embedder fingerprint and BYOK settings live in `meta` and must survive.
    expect(await getEmbedderMeta(db)).toEqual({ model: "m", backend: "wasm", dimension: 384 });
    expect(await getSettings(db)).toEqual({ apiKey: "secret", model: "anthropic/x" });
  });

  test("settings round-trip and default to empty", async () => {
    const db = await getDatabase();
    expect(await getSettings(db)).toEqual({});
    await setSettings(db, { apiKey: "k", model: "m" });
    expect(await getSettings(db)).toEqual({ apiKey: "k", model: "m" });
  });

  test("messages persist in createdAt order and clear", async () => {
    const db = await getDatabase();
    await putMessage(db, { id: "2", role: "assistant", content: "b", createdAt: 200 });
    await putMessage(db, { id: "1", role: "user", content: "a", createdAt: 100 });
    expect((await getAllMessages(db)).map((m) => m.id)).toEqual(["1", "2"]);
    await clearMessages(db);
    expect(await getAllMessages(db)).toHaveLength(0);
  });
});
