import { useVaultStore } from "../store/vaultStore";

/** Progress bar with a 0–1 fraction; indeterminate when fraction is undefined. */
function Bar({ fraction }: { fraction?: number }) {
  const pct = fraction === undefined ? undefined : Math.round(fraction * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
      <div
        className="h-full rounded-full bg-neutral-900 transition-[width] dark:bg-white"
        style={{ width: pct === undefined ? "40%" : `${pct}%` }}
      />
    </div>
  );
}

/**
 * "Build index" control: chunks + embeds the vault in the worker, persists to
 * IndexedDB, and reports the incremental summary. Also surfaces an index that
 * was restored from disk on page load (before any vault is re-picked).
 */
export function IndexPanel() {
  const status = useVaultStore((s) => s.status);
  const notes = useVaultStore((s) => s.notes);
  const progress = useVaultStore((s) => s.indexProgress);
  const summary = useVaultStore((s) => s.indexSummary);
  const info = useVaultStore((s) => s.embedderInfo);
  const embeddedChunks = useVaultStore((s) => s.embeddedChunks);
  const indexRestored = useVaultStore((s) => s.indexRestored);
  const buildIndex = useVaultStore((s) => s.buildIndex);

  const hasIndex = embeddedChunks.length > 0;
  if (notes.length === 0 && !hasIndex) return null;

  const indexing = status === "indexing";

  return (
    <div className="space-y-2">
      {notes.length > 0 && (
        <button
          type="button"
          onClick={() => void buildIndex()}
          disabled={indexing}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {indexing ? "Building index…" : hasIndex ? "Update index" : "Build index"}
        </button>
      )}

      {indexing && progress && (
        <div className="space-y-1">
          {progress.phase === "loading-model" ? (
            <>
              <Bar fraction={progress.modelPercent ? progress.modelPercent / 100 : undefined} />
              <p className="truncate text-xs text-neutral-500">
                Loading model{progress.modelFile ? ` · ${progress.modelFile}` : "…"}
              </p>
            </>
          ) : (
            <>
              <Bar fraction={progress.total ? progress.embedded / progress.total : 1} />
              <p className="text-xs text-neutral-500">
                Embedding {progress.embedded} / {progress.total} chunks
              </p>
            </>
          )}
        </div>
      )}

      {!indexing && hasIndex && info && (
        <p className="text-xs text-neutral-500">
          {embeddedChunks.length} chunks ·{" "}
          <span className="font-medium uppercase">{info.backend}</span> · {info.dimension}-dim
          {indexRestored && notes.length === 0 && (
            <span className="block text-neutral-400">restored from disk — load the vault to update</span>
          )}
        </p>
      )}

      {!indexing && summary && (
        <p className="text-xs text-neutral-500">
          Embedded {summary.notesEmbedded} note{summary.notesEmbedded === 1 ? "" : "s"} (
          {summary.chunksEmbedded} chunks) · reused {summary.notesReused} · removed{" "}
          {summary.notesDeleted}
        </p>
      )}
    </div>
  );
}
