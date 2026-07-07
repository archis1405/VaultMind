import { useEffect, useRef, useState } from "react";
import { useChatStore, type ChatTurn } from "../store/chatStore";
import { useVaultStore } from "../store/vaultStore";
import { sourceLabel, type Source } from "../lib/llm/prompt";

/**
 * Render assistant text with inline [n] citations turned into clickable chips
 * that open the corresponding source note. Unknown [n] (no matching source) are
 * left as plain text.
 */
function renderWithCitations(content: string, sources: Source[], onCite: (s: Source) => void) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  // Split on bracketed numbers, keeping the delimiters.
  return content.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) {
      const source = byN.get(Number(m[1]));
      if (source) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCite(source)}
            title={sourceLabel(source)}
            className="mx-0.5 inline-flex items-center rounded bg-neutral-200 px-1 text-[11px] font-medium text-neutral-700 align-super hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200"
          >
            {m[1]}
          </button>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

function Turn({ turn }: { turn: ChatTurn }) {
  const previewChunk = useVaultStore((s) => s.previewChunk);

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">
          {turn.content}
        </div>
      </div>
    );
  }

  const sources = turn.sources ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
        {turn.content
          ? renderWithCitations(turn.content, sources, (s) => previewChunk(s))
          : turn.streaming && <span className="text-neutral-400">thinking…</span>}
        {turn.streaming && turn.content && <span className="ml-0.5 animate-pulse">▋</span>}
      </div>

      {!turn.streaming && sources.length > 0 && (
        <div className="max-w-[85%] space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Sources
          </p>
          <div className="flex flex-wrap gap-1">
            {sources.map((s) => (
              <button
                key={s.n}
                type="button"
                onClick={() => previewChunk(s)}
                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
                title={s.notePath}
              >
                {s.sourceType === "pdf" ? "📖" : "📄"} [{s.n}] {sourceLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The chat interface: message history + streamed answers with citations. */
export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const busy = useChatStore((s) => s.busy);
  const error = useChatStore((s) => s.error);
  const apiKey = useChatStore((s) => s.apiKey);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const clearChat = useChatStore((s) => s.clearChat);
  const hasIndex = useVaultStore((s) => s.embeddedChunks.length > 0);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as tokens stream in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    void send(q);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto pb-4">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-sm text-neutral-400">
            {!apiKey
              ? "Add your OpenRouter API key in the sidebar to start chatting."
              : !hasIndex
                ? "Build an index first — then ask questions grounded in your notes."
                : "Ask a question about your vault. Answers cite their sources."}
          </div>
        )}
        {messages.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask your notes…"
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
            >
              Send
            </button>
          )}
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void clearChat()}
            className="mt-2 text-xs text-neutral-400 hover:text-neutral-600"
          >
            Clear chat
          </button>
        )}
      </div>
    </div>
  );
}
