import { useVaultStore } from "./store/vaultStore";
import { VaultPicker } from "./components/VaultPicker";
import { IndexPanel } from "./components/IndexPanel";
import { NoteList } from "./components/NoteList";
import { NotePreview } from "./components/NotePreview";

/**
 * App shell. Step 2 wires up the left pane (vault picker + note list) and the
 * center pane (note preview to verify ingestion). Retrieval/chat land later.
 */
export default function App() {
  const status = useVaultStore((s) => s.status);
  const noteCount = useVaultStore((s) => s.notes.length);
  const vaultName = useVaultStore((s) => s.vaultName);

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">AskVault</span>
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            client-side · zero backend
          </span>
        </div>
        <span className="text-xs text-neutral-500">
          {vaultName ? `${vaultName} · ${noteCount} notes` : `status: ${status}`}
        </span>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Left: vault picker + note list */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
          <div className="space-y-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
            <VaultPicker />
            <IndexPanel />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <NoteList />
          </div>
        </aside>

        {/* Center: note preview (verifies ingestion for now) */}
        <section className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-6">
          <NotePreview />
        </section>
      </main>
    </div>
  );
}
