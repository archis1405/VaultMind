import { useEffect, useState } from "react";
import { useVaultStore } from "./store/vaultStore";
import { useChatStore } from "./store/chatStore";
import { VaultPicker } from "./components/VaultPicker";
import { IndexPanel } from "./components/IndexPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { NoteList } from "./components/NoteList";
import { NotePreview } from "./components/NotePreview";
import { SourcePreview } from "./components/SourcePreview";
import { SearchPanel } from "./components/SearchPanel";
import { ChatPanel } from "./components/ChatPanel";
import { EvalPanel } from "./components/EvalPanel";

type Tab = "chat" | "search" | "eval";

export default function App() {
  const status = useVaultStore((s) => s.status);
  const noteCount = useVaultStore((s) => s.notes.length);
  const vaultName = useVaultStore((s) => s.vaultName);
  const restoreIndex = useVaultStore((s) => s.restoreIndex);
  const selectedNotePath = useVaultStore((s) => s.selectedNotePath);
  const selectNote = useVaultStore((s) => s.selectNote);
  const previewSource = useVaultStore((s) => s.previewSource);
  const previewChunk = useVaultStore((s) => s.previewChunk);
  const loadSettings = useChatStore((s) => s.loadSettings);

  const showPreview = Boolean(previewSource || selectedNotePath);

  const [tab, setTab] = useState<Tab>("chat");

  // Restore persisted index + chat settings/history on startup.
  useEffect(() => {
    void restoreIndex();
    void loadSettings();
  }, [restoreIndex, loadSettings]);

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">Memora</span>
        </div>
        <span className="text-xs text-neutral-500">
          {vaultName ? `${vaultName} · ${noteCount} notes` : `status: ${status}`}
        </span>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Left: vault, index, settings, notes */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
          <div className="space-y-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
            <VaultPicker />
            <IndexPanel />
            <SettingsPanel />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <NoteList />
          </div>
        </aside>

        {/* Center: chat / search tabs */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-neutral-200 px-4 pt-3 dark:border-neutral-800">
            {(["chat", "search", "eval"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-t-md px-3 py-1.5 text-sm font-medium capitalize ${
                  tab === t
                    ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">
            {tab === "chat" ? <ChatPanel /> : tab === "search" ? <SearchPanel /> : <EvalPanel />}
          </div>
        </section>

        {/* Right: source preview — a cited chunk (note or book) or a full note */}
        {showPreview && (
          <aside className="flex w-96 shrink-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Source
              </span>
              <button
                type="button"
                onClick={() => {
                  selectNote(undefined);
                  previewChunk(undefined);
                }}
                className="text-sm text-neutral-400 hover:text-neutral-700"
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {previewSource ? <SourcePreview source={previewSource} /> : <NotePreview />}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
