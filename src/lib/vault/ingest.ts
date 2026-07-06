import { parseFrontmatter } from "./frontmatter";
import type { IngestProgress, VaultNote } from "./types";

/** Feature-detect the File System Access API (Chromium-only as of 2026). */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Directories we never descend into — editor/vcs metadata, not vault content. */
const IGNORED_DIRS = new Set([".obsidian", ".git", ".trash", ".stfolder", "node_modules"]);

/** True for markdown files we treat as notes. */
function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".markdown");
}

/** Strip a trailing markdown extension for the display name. */
function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

/**
 * Thrown when the user dismisses the native picker. The caller treats this as a
 * benign no-op rather than an error to surface.
 */
export class VaultPickCancelled extends Error {
  constructor() {
    super("Vault selection cancelled");
    this.name = "VaultPickCancelled";
  }
}

/**
 * Open the native directory picker and return the chosen directory handle.
 * Throws {@link VaultPickCancelled} if the user closes the dialog.
 */
export async function pickVaultDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "This browser doesn't support the File System Access API. Use a Chromium-based browser (Chrome, Edge, Arc, Brave).",
    );
  }
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    // The spec surfaces user cancellation as a DOMException named "AbortError".
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new VaultPickCancelled();
    }
    throw err;
  }
}

/**
 * Depth-first walk of a directory handle, yielding every markdown file's handle
 * paired with its vault-relative POSIX path. Nested folders are followed;
 * ignored/dot directories are skipped. Recursion (not an explicit stack) keeps
 * the code readable — vault trees are shallow and node counts modest.
 */
async function* walkMarkdownFiles(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  // `entries()` is an async iterator not yet in the base DOM lib types.
  const iterable = dir as FileSystemDirectoryHandleIterable;
  for await (const [name, handle] of iterable.entries()) {
    if (handle.kind === "directory") {
      if (IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
      yield* walkMarkdownFiles(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
    } else if (handle.kind === "file" && isMarkdownFile(name)) {
      yield { handle: handle as FileSystemFileHandle, path: `${prefix}${name}` };
    }
  }
}

/** Read + parse a single file handle into a VaultNote. */
async function readNote(handle: FileSystemFileHandle, path: string): Promise<VaultNote> {
  const file = await handle.getFile();
  const raw = await file.text();
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    path,
    name: stripExtension(path.split("/").pop() ?? path),
    frontmatter,
    body,
    raw,
    lastModified: file.lastModified,
    size: file.size,
  };
}

/**
 * Two-phase ingest of a chosen vault directory:
 *   1. Walk the tree to enumerate every markdown file (so we know the total up
 *      front and can show real progress rather than an indeterminate spinner).
 *   2. Read + parse each file, reporting progress as we go.
 *
 * Files are read sequentially: the File System Access API and disk I/O gain
 * little from unbounded parallelism here, and sequential reads keep progress
 * ordering intuitive. Returns notes sorted by path for stable UI rendering.
 */
export async function ingestVault(
  dir: FileSystemDirectoryHandle,
  onProgress?: (progress: IngestProgress) => void,
): Promise<VaultNote[]> {
  // Phase 1 — enumerate.
  const fileHandles: { handle: FileSystemFileHandle; path: string }[] = [];
  for await (const entry of walkMarkdownFiles(dir)) {
    fileHandles.push(entry);
    onProgress?.({ filesFound: fileHandles.length, filesRead: 0, current: entry.path });
  }

  // Phase 2 — read + parse.
  const notes: VaultNote[] = [];
  for (const { handle, path } of fileHandles) {
    onProgress?.({ filesFound: fileHandles.length, filesRead: notes.length, current: path });
    notes.push(await readNote(handle, path));
  }
  onProgress?.({ filesFound: fileHandles.length, filesRead: notes.length });

  notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes;
}
