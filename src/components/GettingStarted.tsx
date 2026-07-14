import { useChatStore } from "../store/chatStore";
import { useVaultStore } from "../store/vaultStore";
import { isFileSystemAccessSupported } from "../lib/vault/ingest";
import { GlowBorderCard } from "./ui/GlowBorderCard";

interface Step {
  title: string;
  where: string;
  body: string;
  done: boolean;
  optional?: boolean;
}

function StepRow({ step, index }: { step: Step; index: number }) {
  return (
    <li className="flex gap-3">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          step.done
            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            : "border border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        }`}
      >
        {step.done ? "✓" : index}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {step.title}
          {step.optional && (
            <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
              optional
            </span>
          )}
          <span className="ml-2 text-xs font-normal text-neutral-400">{step.where}</span>
        </p>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{step.body}</p>
      </div>
    </li>
  );
}

function Capability({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 border-l-2 border-l-neutral-300 p-3 dark:border-neutral-800 dark:border-l-neutral-700">
      <p className="text-sm font-medium">{name}</p>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{desc}</p>
    </div>
  );
}

/**
 * First-run onboarding: a live checklist (steps tick off as the user completes
 * them) plus a tour of what each tab does. Shown automatically until dismissed,
 * and re-openable from the header "?" button.
 */
export function GettingStarted({ onClose }: { onClose: () => void }) {
  const vaultName = useVaultStore((s) => s.vaultName);
  const hasIndex = useVaultStore((s) => s.embeddedChunks.length > 0);
  const status = useVaultStore((s) => s.status);
  const apiKey = useChatStore((s) => s.apiKey);

  const supported = isFileSystemAccessSupported();
  const indexing = status === "indexing";

  const steps: Step[] = [
    {
      title: "Open your vault folder",
      where: "◀ sidebar, top",
      body: "Pick any folder of Markdown notes (an Obsidian vault) — PDFs inside it are included too. Files are read locally in your browser and never uploaded.",
      done: Boolean(vaultName),
    },
    {
      title: "Build the index",
      where: "◀ sidebar",
      body: indexing
        ? "Indexing now — the embedding model runs on your device (first run downloads it once)."
        : "This chunks your notes and computes embeddings on-device. The button appears once a vault is loaded; re-run it anytime to pick up changes.",
      done: hasIndex,
    },
    {
      title: "Add an OpenRouter API key",
      where: "◀ sidebar, Settings",
      body: "Only needed for Chat (grounded Q&A). Search and the Graph work without it. Your key is stored locally and only sent to OpenRouter.",
      done: Boolean(apiKey),
      optional: true,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <GlowBorderCard className="p-6">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Getting started</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Private, on-device semantic search and Q&A over your own notes. Nothing leaves your
              browser except the questions you choose to send to your own LLM.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900"
            title="Close guide"
            aria-label="Close guide"
          >
            ✕
          </button>
        </div>

        {!supported && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Heads up: this browser can't open local folders. Use a Chromium-based browser (Chrome,
            Edge, Arc, Brave) to load a vault.
          </div>
        )}

        <div className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Get set up
          </p>
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <StepRow key={step.title} step={step} index={i + 1} />
            ))}
          </ol>
        </div>

        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Then explore
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Capability
              name="Chat"
              desc="Ask questions in natural language; answers are grounded in your notes with clickable [n] citations."
            />
            <Capability
              name="Search"
              desc="Hybrid keyword + semantic retrieval. Finds the right passage even when wording differs."
            />
            <Capability
              name="Graph"
              desc="A force-directed map of how your documents relate. Drag nodes, zoom, and tune the similarity threshold."
            />
            <Capability
              name="Eval"
              desc="Measure retrieval quality against a small question set — see how well the index performs."
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-neutral-400">
            Reopen this guide anytime from the <span className="font-medium">?</span> in the top-right.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {hasIndex ? "Got it" : "Let's go"}
          </button>
        </div>
      </GlowBorderCard>
    </div>
  );
}
