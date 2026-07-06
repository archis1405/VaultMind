import { useMemo } from "react";
import { useVaultStore } from "../store/vaultStore";
import type { VaultNote } from "../lib/vault/types";

/** A note plus the folder path segments leading to it. */
interface FolderGroup {
  folder: string;
  notes: VaultNote[];
}

/** Group notes by their parent folder for a lightly structured sidebar. */
function groupByFolder(notes: VaultNote[]): FolderGroup[] {
  const groups = new Map<string, VaultNote[]>();
  for (const note of notes) {
    const slash = note.path.lastIndexOf("/");
    const folder = slash === -1 ? "" : note.path.slice(0, slash);
    const bucket = groups.get(folder);
    if (bucket) bucket.push(note);
    else groups.set(folder, [note]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, folderNotes]) => ({ folder, notes: folderNotes }));
}

/** Sidebar listing every ingested note, grouped by folder. */
export function NoteList() {
  const notes = useVaultStore((s) => s.notes);
  const selectedNotePath = useVaultStore((s) => s.selectedNotePath);
  const selectNote = useVaultStore((s) => s.selectNote);

  const groups = useMemo(() => groupByFolder(notes), [notes]);

  if (notes.length === 0) {
    return <p className="text-sm text-neutral-400">No notes loaded yet.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map(({ folder, notes: folderNotes }) => (
        <div key={folder || "__root__"}>
          <h3 className="mb-1 truncate text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {folder || "/"}
          </h3>
          <ul className="space-y-0.5">
            {folderNotes.map((note) => (
              <li key={note.path}>
                <button
                  type="button"
                  onClick={() => selectNote(note.path)}
                  className={`w-full truncate rounded px-2 py-1 text-left text-sm transition ${
                    selectedNotePath === note.path
                      ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
                  }`}
                  title={note.path}
                >
                  {note.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
