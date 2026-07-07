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
  const pdfs = useVaultStore((s) => s.pdfs);
  const progress = useVaultStore((s) => s.indexProgress);
  const summary = useVaultStore((s) => s.indexSummary);
  const warnings = useVaultStore((s) => s.indexWarnings);
  const info = useVaultStore((s) => s.embedderInfo);
  const embeddedChunks = useVaultStore((s) => s.embeddedChunks);
  const indexRestored = useVaultStore((s) => s.indexRestored);
  const buildIndex = useVaultStore((s) => s.buildIndex);

  const hasSources = notes.length > 0 || pdfs.length > 0;
  const hasIndex = embeddedChunks.length > 0;
  if (!hasSources && !hasIndex) return null;

  const indexing = status === "indexing";

  return (
    <div className="space-y-2">
      {hasSources && (
        <button
          type="button"
          onClick={() => void buildIndex()}
          disabled={indexing}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {indexing ? "Building index…" : hasIndex ? "Update index" : "Build index"}
        </button>
      )}

      {pdfs.length > 0 && !indexing && (
        <p className="text-[11px] text-neutral-400">
          {notes.length} notes · {pdfs.length} PDF{pdfs.length === 1 ? "" : "s"}
        </p>
      )}

      {indexing && progress && (
        <div className="space-y-1">
          {progress.phase === "loading-model" && (
            <>
              <Bar fraction={progress.modelPercent ? progress.modelPercent / 100 : undefined} />
              <p className="truncate text-xs text-neutral-500">
                Loading model{progress.modelFile ? ` · ${progress.modelFile}` : "…"}
              </p>
            </>
          )}
          {progress.phase === "extracting" && (
            <>
              <Bar
                fraction={
                  progress.extractTotal ? (progress.extractPage ?? 0) / progress.extractTotal : undefined
                }
              />
              <p className="truncate text-xs text-neutral-500">
                Extracting {progress.extractingFile?.split("/").pop()}
                {progress.extractTotal ? ` · page ${progress.extractPage}/${progress.extractTotal}` : "…"}
              </p>
            </>
          )}
          {progress.phase === "embedding" && (
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
          {indexRestored && !hasSources && (
            <span className="block text-neutral-400">restored from disk — load the vault to update</span>
          )}
        </p>
      )}

      {!indexing && summary && (
        <p className="text-xs text-neutral-500">
          Embedded {summary.notesEmbedded} note{summary.notesEmbedded === 1 ? "" : "s"}
          {summary.pdfsEmbedded > 0 && ` + ${summary.pdfsEmbedded} book${summary.pdfsEmbedded === 1 ? "" : "s"}`}{" "}
          ({summary.chunksEmbedded} chunks) · reused {summary.reused} · removed {summary.deleted}
        </p>
      )}

      {!indexing && warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {warnings.map((w) => (
            <p key={w.path}>
              <span className="font-medium">{w.path.split("/").pop()}</span>: {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
