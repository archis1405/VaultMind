import { create } from "zustand";
import {
  getDatabase,
  getSettings,
  setSettings,
  getAllMessages,
  putMessage,
  clearMessages,
} from "../lib/storage/db";
import { fetchModels, streamChatCompletion, type OpenRouterModel } from "../lib/llm/openrouter";
import { buildContext, buildMessages, type ChatMessage, type Source } from "../lib/llm/prompt";
import { useVaultStore } from "./vaultStore";

/** An in-memory chat turn (mirrors StoredMessage plus streaming state). */
export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  /** True while this assistant turn is still streaming. */
  streaming?: boolean;
}

interface ChatState {
  apiKey: string;
  model: string;
  models: OpenRouterModel[];
  messages: ChatTurn[];
  busy: boolean;
  error?: string;
  abort?: AbortController;

  loadSettings: () => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  loadModels: () => Promise<void>;
  send: (question: string) => Promise<void>;
  stop: () => void;
  clearChat: () => Promise<void>;
}

/** Patch a single message by id (used for streaming content updates). */
function patchMessage(messages: ChatTurn[], id: string, patch: Partial<ChatTurn>): ChatTurn[] {
  return messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

export const useChatStore = create<ChatState>((set, get) => ({
  apiKey: "",
  model: "",
  models: [],
  messages: [],
  busy: false,

  loadSettings: async () => {
    const db = await getDatabase();
    const [settings, stored] = await Promise.all([getSettings(db), getAllMessages(db)]);
    set({
      apiKey: settings.apiKey ?? "",
      model: settings.model ?? "",
      messages: stored.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources })),
    });
  },

  setApiKey: async (key) => {
    set({ apiKey: key });
    const db = await getDatabase();
    await setSettings(db, { apiKey: key, model: get().model });
  },

  setModel: async (model) => {
    set({ model });
    const db = await getDatabase();
    await setSettings(db, { apiKey: get().apiKey, model });
  },

  loadModels: async () => {
    const models = await fetchModels();
    set({ models });
    // Default to a Claude model (catalog is sorted Anthropic-first) if unset.
    if (!get().model && models.length > 0) await get().setModel(models[0].id);
  },

  send: async (question) => {
    const q = question.trim();
    if (!q || get().busy) return;

    const { apiKey, model } = get();
    if (!apiKey) return set({ error: "Add your OpenRouter API key in Settings first." });
    if (!model) return set({ error: "Pick a model in Settings first." });

    const db = await getDatabase();

    // Prior conversation (before this turn) becomes chat history for continuity.
    const history: ChatMessage[] = get().messages.map((m) => ({ role: m.role, content: m.content }));

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", content: q };
    const assistantId = crypto.randomUUID();
    set((s) => ({
      messages: [...s.messages, userTurn, { id: assistantId, role: "assistant", content: "", streaming: true }],
      busy: true,
      error: undefined,
    }));
    await putMessage(db, { ...userTurn, createdAt: Date.now() });

    const abort = new AbortController();
    set({ abort });

    try {
      // Retrieve fresh context for this question via the Step 6 hybrid pipeline.
      const results = await useVaultStore.getState().retrieve(q, 8);
      const { sources, contextBlock } = buildContext(results);
      set((s) => ({ messages: patchMessage(s.messages, assistantId, { sources }) }));

      const llmMessages = buildMessages(q, contextBlock, history);

      let content = "";
      for await (const delta of streamChatCompletion({
        apiKey,
        model,
        messages: llmMessages,
        signal: abort.signal,
      })) {
        content += delta;
        set((s) => ({ messages: patchMessage(s.messages, assistantId, { content }) }));
      }

      set((s) => ({ messages: patchMessage(s.messages, assistantId, { streaming: false }), busy: false, abort: undefined }));
      await putMessage(db, {
        id: assistantId,
        role: "assistant",
        content,
        sources,
        createdAt: Date.now(),
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      set((s) => ({
        messages: patchMessage(s.messages, assistantId, { streaming: false }),
        busy: false,
        abort: undefined,
        error: aborted ? undefined : (err as Error).message,
      }));
      // Persist whatever streamed before an error/stop, so history stays consistent.
      const finalTurn = get().messages.find((m) => m.id === assistantId);
      if (finalTurn && finalTurn.content) {
        await putMessage(db, {
          id: assistantId,
          role: "assistant",
          content: finalTurn.content,
          sources: finalTurn.sources,
          createdAt: Date.now(),
        });
      }
    }
  },

  stop: () => get().abort?.abort(),

  clearChat: async () => {
    get().abort?.abort();
    set({ messages: [], error: undefined, busy: false, abort: undefined });
    await clearMessages(await getDatabase());
  },
}));
