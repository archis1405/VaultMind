import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { EmbedderBackend } from "../embedding/protocol";
import type { Source } from "../llm/prompt";

/**
 * One chunk as persisted. Note the embedding is a real Float32Array: IndexedDB's
 * structured-clone storage preserves typed arrays, so there's no (de)serialize
 * step — we read back the exact same buffer we wrote.
 */
export interface StoredChunk {
  /** `${notePath}#${chunkIndex}` — stable primary key. */
  id: string;
  notePath: string;
  chunkIndex: number;
  /** "note" | "pdf". */
  sourceType: "note" | "pdf";
  /** 1-based page number for PDF chunks. */
  page?: number;
  text: string;
  headingPath: string[];
  tokenCount: number;
  embedding: Float32Array;
  /** Source document's lastModified, denormalized onto the chunk for convenience. */
  lastModified: number;
}

/** Per-note index metadata — the basis for incremental re-indexing. */
export interface NoteMeta {
  path: string;
  /** SHA-256 of the note's raw content at index time. */
  contentHash: string;
  lastModified: number;
  chunkCount: number;
  indexedAt: number;
}

/** Model fingerprint stored under meta["embedder"] to detect model changes. */
export interface EmbedderMeta {
  model: string;
  backend: EmbedderBackend;
  dimension: number;
}

/** BYOK settings, stored under meta["settings"]. Never leaves the browser except to OpenRouter. */
export interface AppSettings {
  apiKey?: string;
  model?: string;
}

/** A persisted chat message. `id` is a client-generated UUID. */
export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Citation sources attached to an assistant turn. */
  sources?: Source[];
  createdAt: number;
}

interface AskVaultSchema extends DBSchema {
  chunks: {
    key: string;
    value: StoredChunk;
    indexes: { "by-note": string };
  };
  notes: {
    key: string;
    value: NoteMeta;
  };
  meta: {
    key: string;
    value: unknown;
  };
  messages: {
    key: string;
    value: StoredMessage;
  };
}

export type AskVaultDB = IDBPDatabase<AskVaultSchema>;

const DB_NAME = "askvault";
const DB_VERSION = 2;

/** Build the composite chunk key. */
export function chunkId(notePath: string, chunkIndex: number): string {
  return `${notePath}#${chunkIndex}`;
}

let dbPromise: Promise<AskVaultDB> | null = null;

/** Open (once) and return the shared database connection. */
export function getDatabase(): Promise<AskVaultDB> {
  if (!dbPromise) {
    dbPromise = openDB<AskVaultSchema>(DB_NAME, DB_VERSION, {
      // Versioned migrations: each `if (oldVersion < n)` block runs once, so a
      // fresh install builds everything and a v1 user gains only the new store.
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const chunks = db.createObjectStore("chunks", { keyPath: "id" });
          // Delete/query all chunks of a note without scanning the store.
          chunks.createIndex("by-note", "notePath");
          db.createObjectStore("notes", { keyPath: "path" });
          db.createObjectStore("meta"); // out-of-line keys (put(value, key))
        }
        if (oldVersion < 2) {
          db.createObjectStore("messages", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

/** All stored note metadata, keyed by path. */
export async function getAllNoteMeta(db: AskVaultDB): Promise<Map<string, NoteMeta>> {
  const all = await db.getAll("notes");
  return new Map(all.map((m) => [m.path, m]));
}

/** Every stored chunk (loaded into memory for retrieval). */
export function getAllChunks(db: AskVaultDB): Promise<StoredChunk[]> {
  return db.getAll("chunks");
}

/**
 * Persist one note's metadata + its chunks atomically. A single transaction
 * spanning both stores means a crash can't leave chunks without their note meta
 * (or vice-versa).
 */
export async function saveIndexedNote(
  db: AskVaultDB,
  meta: NoteMeta,
  chunks: StoredChunk[],
): Promise<void> {
  const tx = db.transaction(["notes", "chunks"], "readwrite");
  await Promise.all([
    tx.objectStore("notes").put(meta),
    ...chunks.map((c) => tx.objectStore("chunks").put(c)),
  ]);
  await tx.done;
}

/** Delete a note's metadata and all of its chunks (via the by-note index). */
export async function deleteNote(db: AskVaultDB, path: string): Promise<void> {
  const tx = db.transaction(["notes", "chunks"], "readwrite");
  await tx.objectStore("notes").delete(path);
  const index = tx.objectStore("chunks").index("by-note");
  let cursor = await index.openCursor(path);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getEmbedderMeta(db: AskVaultDB): Promise<EmbedderMeta | undefined> {
  return (await db.get("meta", "embedder")) as EmbedderMeta | undefined;
}

export async function setEmbedderMeta(db: AskVaultDB, meta: EmbedderMeta): Promise<void> {
  await db.put("meta", meta, "embedder");
}

/** Wipe the index stores (used when the embedding model/dimension changes). */
export async function clearIndex(db: AskVaultDB): Promise<void> {
  const tx = db.transaction(["notes", "chunks"], "readwrite");
  await Promise.all([tx.objectStore("notes").clear(), tx.objectStore("chunks").clear()]);
  await tx.done;
}

// --- BYOK settings ---

export async function getSettings(db: AskVaultDB): Promise<AppSettings> {
  return ((await db.get("meta", "settings")) as AppSettings | undefined) ?? {};
}

export async function setSettings(db: AskVaultDB, settings: AppSettings): Promise<void> {
  await db.put("meta", settings, "settings");
}

// --- chat history ---

/** All persisted messages, oldest first. */
export async function getAllMessages(db: AskVaultDB): Promise<StoredMessage[]> {
  const all = await db.getAll("messages");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(db: AskVaultDB, message: StoredMessage): Promise<void> {
  await db.put("messages", message);
}

export async function clearMessages(db: AskVaultDB): Promise<void> {
  await db.clear("messages");
}
