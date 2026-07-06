import type {
  EmbedderBackend,
  EmbedderRequest,
  EmbedderResponse,
  ModelLoadProgress,
} from "./protocol";

export interface EmbedderInfo {
  backend: EmbedderBackend;
  dimension: number;
}

/** How many texts to hand the model per forward pass. */
const DEFAULT_BATCH_SIZE = 32;

interface Pending {
  resolve: (value: never) => void;
  reject: (err: Error) => void;
  onEmbedProgress?: (embedded: number, total: number) => void;
  onModelProgress?: (p: ModelLoadProgress) => void;
}

/**
 * Main-thread handle to the embedding worker. Wraps the postMessage protocol in
 * promises: each request gets a unique id, and the matching worker response
 * resolves (or rejects) that request's promise. Progress messages are routed to
 * per-request callbacks. One worker is reused across many embed calls.
 */
export class Embedder {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private info: EmbedderInfo | null = null;

  constructor() {
    this.worker = new Worker(new URL("../../workers/embedder.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<EmbedderResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.failAll(new Error(e.message || "Embedder worker crashed"));
  }

  /** Backend + dimension, available after {@link init} resolves. */
  get information(): EmbedderInfo | null {
    return this.info;
  }

  /** Load the model. Resolves with the chosen backend and embedding dimension. */
  init(onModelProgress?: (p: ModelLoadProgress) => void): Promise<EmbedderInfo> {
    return this.request<EmbedderInfo>({ type: "init", id: 0 }, { onModelProgress });
  }

  /**
   * Embed an array of texts. Resolves with one Float32Array per input text (each
   * a view over the transferred buffer). Order matches the input.
   */
  async embed(
    texts: string[],
    onEmbedProgress?: (embedded: number, total: number) => void,
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<Float32Array[]> {
    return this.request<Float32Array[]>(
      { type: "embed", id: 0, texts, batchSize },
      { onEmbedProgress },
    );
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new Error("Embedder terminated"));
  }

  /** Assign an id, register the pending promise, and post the request. */
  private request<T>(
    req: EmbedderRequest,
    handlers: Pick<Pending, "onEmbedProgress" | "onModelProgress">,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject, ...handlers });
      this.worker.postMessage({ ...req, id });
    });
  }

  private handle(msg: EmbedderResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;

    switch (msg.type) {
      case "model-progress":
        p.onModelProgress?.(msg.progress);
        break;
      case "ready":
        this.info = { backend: msg.backend, dimension: msg.dimension };
        this.pending.delete(msg.id);
        (p.resolve as (v: EmbedderInfo) => void)(this.info);
        break;
      case "embed-progress":
        p.onEmbedProgress?.(msg.embedded, msg.total);
        break;
      case "embed-result": {
        this.pending.delete(msg.id);
        (p.resolve as (v: Float32Array[]) => void)(unpackEmbeddings(msg.data, msg.count, msg.dimension));
        break;
      }
      case "error":
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
        break;
    }
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}

/** Slice one flat [count × dim] buffer into `count` per-chunk Float32Arrays. */
function unpackEmbeddings(data: ArrayBuffer, count: number, dimension: number): Float32Array[] {
  const flat = new Float32Array(data);
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    // Copy (slice) so each embedding owns its memory — simpler lifetimes for
    // the store and IndexedDB than shared subarray views into one big buffer.
    out[i] = flat.slice(i * dimension, (i + 1) * dimension);
  }
  return out;
}
