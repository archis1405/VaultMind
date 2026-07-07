/**
 * Incremental-indexing planner.
 *
 * Given the current vault (each note reduced to a path + content hash) and the
 * metadata we stored on the last index run, decide what work is actually needed.
 * Pure and synchronous so it's trivially unit-testable — the I/O (embedding,
 * IndexedDB writes) is driven by the store from this plan.
 */

export interface IndexPlan {
  /** Note paths whose chunks must be (re)built and embedded — new or changed. */
  toEmbed: string[];
  /** Note paths whose stored chunks must be deleted — changed or vault-removed. */
  toDelete: string[];
  /** Note paths reused as-is; their chunks stay in the store untouched. */
  unchanged: string[];
}

/**
 * @param current Notes currently in the vault: `{ path, hash }`.
 * @param stored  Metadata from the previous index, keyed by path.
 *
 * Classification:
 *   - hash matches stored → **unchanged** (reuse; embed nothing).
 *   - path new, or hash differs → **toEmbed** (and if it existed before with a
 *     different hash, also **toDelete** so stale chunks are removed first).
 *   - stored path no longer in the vault → **toDelete** (note was deleted).
 */
export function planIndex(
  current: { path: string; hash: string }[],
  stored: Map<string, { contentHash: string }>,
): IndexPlan {
  const currentPaths = new Set(current.map((c) => c.path));
  const toEmbed: string[] = [];
  const toDelete: string[] = [];
  const unchanged: string[] = [];

  for (const { path, hash } of current) {
    const prev = stored.get(path);
    if (prev && prev.contentHash === hash) {
      unchanged.push(path);
    } else {
      toEmbed.push(path);
      if (prev) toDelete.push(path); // changed: drop the old chunks first
    }
  }

  for (const path of stored.keys()) {
    if (!currentPaths.has(path)) toDelete.push(path); // removed from vault
  }

  return { toEmbed, toDelete, unchanged };
}
