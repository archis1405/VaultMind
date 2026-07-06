/**
 * A single parsed markdown note read from the user's vault.
 *
 * This is the in-memory representation only (Step 2). Persistence (IndexedDB),
 * chunking, and embeddings are layered on in later steps and deliberately kept
 * out of this shape so ingestion stays a pure "files → structured text" concern.
 */
export interface VaultNote {
  /** Vault-relative POSIX path, e.g. "Projects/AskVault/notes.md". Stable id. */
  path: string;
  /** File name without the .md extension, e.g. "notes". */
  name: string;
  /** Parsed YAML frontmatter. Empty object when the note has no frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Markdown body with the frontmatter block stripped out. */
  body: string;
  /** Full original file contents, frontmatter included. Kept for re-hashing later. */
  raw: string;
  /** File.lastModified epoch ms — used for incremental re-indexing in Step 5. */
  lastModified: number;
  /** Raw byte size of the file. */
  size: number;
}

/** Progress reported while walking + reading the vault, for UI feedback. */
export interface IngestProgress {
  /** Total .md files discovered so far during the directory walk. */
  filesFound: number;
  /** Files fully read + parsed so far. */
  filesRead: number;
  /** Path currently being read, for a live status line. */
  current?: string;
}
