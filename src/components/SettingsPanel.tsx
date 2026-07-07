import { useEffect, useState } from "react";
import { useChatStore } from "../store/chatStore";

/**
 * BYOK settings: OpenRouter API key + model picker. The key is stored only in
 * IndexedDB and sent only to OpenRouter. Collapsed by default so it stays out of
 * the way once configured.
 */
export function SettingsPanel() {
  const apiKey = useChatStore((s) => s.apiKey);
  const model = useChatStore((s) => s.model);
  const models = useChatStore((s) => s.models);
  const setApiKey = useChatStore((s) => s.setApiKey);
  const setModel = useChatStore((s) => s.setModel);
  const loadModels = useChatStore((s) => s.loadModels);

  const [open, setOpen] = useState(!apiKey);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (models.length === 0) void loadModels();
  }, [models.length, loadModels]);

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500"
      >
        <span>OpenRouter</span>
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${apiKey ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
            title={apiKey ? "API key set" : "no API key"}
          />
          <span className="text-neutral-400">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">API key</label>
            <div className="flex gap-1">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => void setApiKey(e.target.value)}
                placeholder="sk-or-…"
                autoComplete="off"
                className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 rounded border border-neutral-300 px-2 text-xs text-neutral-500 dark:border-neutral-700"
              >
                {showKey ? "hide" : "show"}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-neutral-400">
              Stored locally in IndexedDB. Sent only to openrouter.ai.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-neutral-500">Model</label>
            <input
              list="openrouter-models"
              value={model}
              onChange={(e) => void setModel(e.target.value)}
              placeholder="anthropic/claude-…"
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <datalist id="openrouter-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </div>
        </div>
      )}
    </div>
  );
}
