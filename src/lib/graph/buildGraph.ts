import { dot } from "../retrieval/cosine";
import type { EmbeddedChunk } from "../embedding/types";

/**
 * A node in the knowledge graph — one source document (a note or a PDF),
 * summarized by the mean of its chunk embeddings.
 */
export interface GraphNode {
  /** Source path — same identity as `EmbeddedChunk.notePath`. */
  id: string;
  /** Display label (basename, extension stripped). */
  name: string;
  sourceType: "note" | "pdf";
  chunkCount: number;
  /** Number of edges after thresholding (filled in by `buildGraph`). */
  degree: number;
  /** Connected-component id, for coloring. */
  cluster: number;
  /** L2-normalized document vector (mean of chunk embeddings). */
  embedding: Float32Array;
}

/** An undirected semantic link between two documents. */
export interface GraphEdge {
  source: string;
  target: string;
  /** Cosine similarity of the two document vectors (0..1). */
  weight: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Distinct connected components (a proxy for "topics"). */
  clusterCount: number;
}

export interface BuildGraphOptions {
  /** Max nearest-neighbor edges kept per node (before dedupe). */
  neighbors?: number;
  /** Minimum cosine similarity for an edge to exist. */
  minSimilarity?: number;
}

const DEFAULTS: Required<BuildGraphOptions> = { neighbors: 4, minSimilarity: 0.5 };

function displayName(path: string): string {
  return path.split("/").pop()?.replace(/\.(md|pdf)$/i, "") ?? path;
}

/** Mean of a document's chunk embeddings, re-normalized to unit length. */
function meanEmbedding(chunks: EmbeddedChunk[]): Float32Array {
  const dim = chunks[0].embedding.length;
  const acc = new Float32Array(dim);
  for (const c of chunks) {
    const e = c.embedding;
    for (let i = 0; i < dim; i++) acc[i] += e[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    acc[i] /= chunks.length;
    norm += acc[i] * acc[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) acc[i] /= norm;
  return acc;
}

/** Union-find for connected-component clustering. */
class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

/**
 * Turn an embedded corpus into a semantic knowledge graph: one node per source
 * document, edges to each node's most-similar peers above a threshold. Because
 * embeddings are L2-normalized, cosine similarity is just the dot product.
 *
 * Cost is O(D²·dim) over D documents — fine at vault scale (hundreds of docs);
 * swap in an ANN index if D grows into the thousands.
 */
export function buildGraph(chunks: EmbeddedChunk[], options: BuildGraphOptions = {}): Graph {
  const { neighbors, minSimilarity } = { ...DEFAULTS, ...options };

  // Group chunks → documents.
  const byPath = new Map<string, EmbeddedChunk[]>();
  for (const c of chunks) {
    const bucket = byPath.get(c.notePath);
    if (bucket) bucket.push(c);
    else byPath.set(c.notePath, [c]);
  }

  const nodes: GraphNode[] = [...byPath.entries()].map(([path, docChunks]) => ({
    id: path,
    name: displayName(path),
    sourceType: docChunks[0].sourceType,
    chunkCount: docChunks.length,
    degree: 0,
    cluster: 0,
    embedding: meanEmbedding(docChunks),
  }));

  const n = nodes.length;
  const dsu = new DSU(n);
  const edgeMap = new Map<string, GraphEdge>();

  for (let i = 0; i < n; i++) {
    // Rank every other doc by similarity, keep the top `neighbors` above cutoff.
    const sims: { j: number; s: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const s = dot(nodes[i].embedding, nodes[j].embedding);
      if (s >= minSimilarity) sims.push({ j, s });
    }
    sims.sort((a, b) => b.s - a.s);
    for (const { j, s } of sims.slice(0, neighbors)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { source: nodes[i].id, target: nodes[j].id, weight: s });
        dsu.union(i, j);
      }
    }
  }

  const idToIndex = new Map(nodes.map((node, i) => [node.id, i]));
  const edges = [...edgeMap.values()];
  for (const e of edges) {
    nodes[idToIndex.get(e.source)!].degree++;
    nodes[idToIndex.get(e.target)!].degree++;
  }

  // Densely re-number clusters so ids are 0..clusterCount-1 (nice for palettes).
  const clusterId = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = dsu.find(i);
    if (!clusterId.has(root)) clusterId.set(root, clusterId.size);
    nodes[i].cluster = clusterId.get(root)!;
  }

  return { nodes, edges, clusterCount: clusterId.size };
}
