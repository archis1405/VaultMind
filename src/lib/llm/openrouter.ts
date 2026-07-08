import type { ChatMessage } from "./prompt";

const BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength?: number;
}

/** A tiny fallback list if the live catalog can't be fetched (offline, etc.). */
const FALLBACK_MODELS: OpenRouterModel[] = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
  { id: "google/gemini-flash-1.5", name: "Gemini Flash 1.5" },
  { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B" },
];

/**
 * Fetch OpenRouter's public model catalog (no auth required) so the picker shows
 * real, current model slugs instead of hardcoded guesses. Falls back to a small
 * static list on failure. Sorted with Anthropic/Claude models first — that's our
 * preferred default for this app.
 */
export async function fetchModels(): Promise<OpenRouterModel[]> {
  try {
    const res = await fetch(`${BASE_URL}/models`);
    if (!res.ok) throw new Error(`models: ${res.status}`);
    const json = (await res.json()) as {
      data: { id: string; name?: string; context_length?: number }[];
    };
    const models = json.data.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length,
    }));
    models.sort((a, b) => {
      const ac = a.id.startsWith("anthropic/") ? 0 : 1;
      const bc = b.id.startsWith("anthropic/") ? 0 : 1;
      return ac - bc || a.name.localeCompare(b.name);
    });
    return models;
  } catch {
    return FALLBACK_MODELS;
  }
}

export interface StreamChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/** Pull a human-readable message out of an OpenRouter error response body. */
function parseError(body: string, status: number): string {
  try {
    const json = JSON.parse(body);
    return json?.error?.message ?? `OpenRouter error ${status}`;
  } catch {
    return body || `OpenRouter error ${status}`;
  }
}

/**
 * Stream a chat completion from OpenRouter, yielding content deltas as they
 * arrive. Requests go browser → OpenRouter directly (BYOK, no proxy). Parses the
 * SSE frames, buffering across network chunks so a token split mid-line isn't
 * dropped, and honors an AbortSignal for stop.
 */
export async function* streamChatCompletion(
  opts: StreamChatOptions,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter surfaces in dashboards.
      "HTTP-Referer": typeof location !== "undefined" ? location.origin : "https://memora.app",
      "X-Title": "Memora",
    },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
  });

  if (!res.ok) {
    throw new Error(parseError(await res.text(), res.status));
  }
  if (!res.body) throw new Error("OpenRouter returned no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are newline-delimited; keep the last (possibly partial) line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue; // skip keep-alive ':' comments
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta: string | undefined = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore non-JSON frames (comments, partial fragments).
      }
    }
  }
}
