/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />

import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import {
  EMBEDDING_MODEL,
  type EmbedderBackend,
  type EmbedderRequest,
  type EmbedderResponse,
} from "../lib/embedding/protocol";

// Always fetch weights from the HF hub + browser cache; there are no local model
// files bundled with the app. (Step 10 layers a service worker over this cache.)
env.allowLocalModels = false;

const MODEL_ID = EMBEDDING_MODEL;

/**
 * `pipeline()` has a giant overload union (one per task) that overflows the TS
 * checker (TS2590) when resolved. We only ever build a feature-extraction
 * pipeline, so narrow to a single, purpose-specific signature.
 */
const createExtractor = pipeline as unknown as (
  task: "feature-extraction",
  model: string,
  options: {
    device: EmbedderBackend;
    dtype: string;
    progress_callback: (p: unknown) => void;
  },
) => Promise<FeatureExtractionPipeline>;

let extractor: FeatureExtractionPipeline | null = null;
let backend: EmbedderBackend = "wasm";
let dimension = 0;

/** Typed postMessage helper. Optionally transfers ArrayBuffers (zero-copy). */
function post(msg: EmbedderResponse, transfer?: Transferable[]) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

/**
 * Prefer WebGPU when a GPU adapter is actually obtainable, else WASM. We probe
 * for a real adapter rather than just checking `navigator.gpu` existence —
 * the property can be present while adapter acquisition still fails (e.g. a
 * blocklisted GPU), and we'd rather fall back cleanly than crash on init.
 */
async function pickBackend(): Promise<EmbedderBackend> {
  if (typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      // fall through to wasm
    }
  }
  return "wasm";
}

/** Load the model, warming it up so we know the embedding dimension up front. */
async function init(id: number) {
  backend = await pickBackend();

  extractor = await createExtractor("feature-extraction", MODEL_ID, {
    device: backend,
    // fp32 on GPU for accuracy; q8 (quantized) on CPU for speed + smaller download.
    dtype: backend === "webgpu" ? "fp32" : "q8",
    progress_callback: (p: unknown) => {
      const { status, file, progress } = (p ?? {}) as {
        status?: string;
        file?: string;
        progress?: number;
      };
      post({
        type: "model-progress",
        id,
        progress: { status: status ?? "", file, progress },
      });
    },
  });

  // Warmup: one tiny embed compiles WebGPU shaders (the slow first run) and
  // reveals the output dimension, so callers can allocate storage in advance.
  const warm = await extractor("warmup", { pooling: "mean", normalize: true });
  dimension = warm.dims[warm.dims.length - 1];

  post({ type: "ready", id, backend, dimension });
}

/**
 * Embed `texts` in sub-batches, streaming progress. Results are accumulated into
 * one flat row-major Float32Array ([count × dimension]) whose buffer is then
 * transferred to the main thread — one copy-free handoff instead of N.
 */
async function embed(id: number, texts: string[], batchSize: number) {
  if (!extractor) throw new Error("Embedder not initialized");

  if (texts.length === 0) {
    post({ type: "embed-result", id, data: new ArrayBuffer(0), count: 0, dimension }, []);
    return;
  }

  const out = new Float32Array(texts.length * dimension);
  let offset = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    out.set(output.data as Float32Array, offset);
    offset += (output.data as Float32Array).length;
    post({
      type: "embed-progress",
      id,
      embedded: Math.min(i + batchSize, texts.length),
      total: texts.length,
    });
  }

  post(
    { type: "embed-result", id, data: out.buffer, count: texts.length, dimension },
    [out.buffer],
  );
}

self.onmessage = async (e: MessageEvent<EmbedderRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "init":
        await init(req.id);
        break;
      case "embed":
        await embed(req.id, req.texts, req.batchSize);
        break;
    }
  } catch (err) {
    post({ type: "error", id: req.id, message: (err as Error).message ?? String(err) });
  }
};
