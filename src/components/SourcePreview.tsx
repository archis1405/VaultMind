import { useVaultStore, type SourcePreviewData } from "../store/vaultStore";
import { sourceLabel } from "../lib/llm/prompt";

/**
 * Preview of a single retrieved chunk / cited source. Distinguishes a note from
 * a book and, for books, shows the page. For notes it offers a jump to the full
 * note body (which the plain note preview renders).
 */
export function SourcePreview({ source }: { source: SourcePreviewData }) {
  const selectNote = useVaultStore((s) => s.selectNote);
  const notes = useVaultStore((s) => s.notes);
  const isPdf = source.sourceType === "pdf";
  const noteLoaded = notes.some((n) => n.path === source.notePath);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            isPdf
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
              : "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
          }`}
        >
          {isPdf ? "Book" : "Note"}
        </span>
        <span className="min-w-0 truncate text-sm font-medium" title={source.notePath}>
          {sourceLabel(source)}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
        {source.text}
      </p>

      {!isPdf && noteLoaded && (
        <button
          type="button"
          onClick={() => selectNote(source.notePath)}
          className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          Open full note →
        </button>
      )}
    </div>
  );
}
