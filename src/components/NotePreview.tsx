import { useVaultStore } from "../store/vaultStore";

/** Bytes → a compact human-readable size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read-only preview of the currently selected note. This exists mainly to
 * verify Step 2 correctness by eye: parsed frontmatter as key/value rows, and
 * the frontmatter-stripped body as raw text.
 */
export function NotePreview() {
  const notes = useVaultStore((s) => s.notes);
  const selectedNotePath = useVaultStore((s) => s.selectedNotePath);
  const note = notes.find((n) => n.path === selectedNotePath);

  if (!note) {
    return (
      <div className="max-w-md text-center text-sm text-neutral-500">
        Select a note from the sidebar to preview its parsed frontmatter and body.
      </div>
    );
  }

  const frontmatterEntries = Object.entries(note.frontmatter);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4">
      <div className="border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">{note.name}</h1>
        <p className="truncate text-xs text-neutral-500" title={note.path}>
          {note.path} · {formatBytes(note.size)} ·{" "}
          {new Date(note.lastModified).toLocaleString()}
        </p>
      </div>

      {frontmatterEntries.length > 0 && (
        <div className="rounded-md border border-neutral-200 bg-neutral-100/60 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Frontmatter
          </h2>
          <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1 text-sm">
            {frontmatterEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="truncate font-medium text-neutral-500">{key}</dt>
                <dd className="min-w-0 break-words text-neutral-800 dark:text-neutral-200">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Body
        </h2>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-neutral-700 dark:text-neutral-300">
          {note.body || <span className="text-neutral-400">(empty)</span>}
        </pre>
      </div>
    </div>
  );
}
