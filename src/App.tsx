import { useVaultStore } from "./store/vaultStore";

/**
 * App shell only — no logic yet. This is the placeholder UI for Step 1.
 * The three-pane layout (vault/sources sidebar, chat center, sources/citations)
 * will be fleshed out as later steps land.
 */
export default function App() {
  const status = useVaultStore((s) => s.status);

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tracking-tight">AskVault</span>
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            client-side · zero backend
          </span>
        </div>
        <span className="text-xs text-neutral-500">status: {status}</span>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* Left: vault / sources (Step 2+) */}
        <aside className="hidden w-64 shrink-0 border-r border-neutral-200 p-4 md:block dark:border-neutral-800">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Sources
          </h2>
          <p className="text-sm text-neutral-400">
            No vault loaded yet.
          </p>
        </aside>

        {/* Center: chat / search (Step 7+) */}
        <section className="flex min-w-0 flex-1 items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-2xl font-semibold">
              Semantic search over your vault
            </h1>
            <p className="text-sm text-neutral-500">
              Everything — embedding, storage, and retrieval — runs locally in
              your browser. Nothing leaves your machine except the questions you
              choose to send to your own LLM key.
            </p>
            <p className="mt-6 text-xs text-neutral-400">
              Scaffold ready. Feature steps land incrementally.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
