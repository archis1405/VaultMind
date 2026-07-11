import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { buildGraph, type Graph } from "../lib/graph/buildGraph";
import { createLayout, stepLayout, type Layout } from "../lib/graph/forceLayout";

/** Distinct, theme-agnostic cluster hues (cycled for large graphs). */
const CLUSTER_COLORS = [
  "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6",
  "#ef4444", "#22c55e", "#3b82f6", "#eab308", "#06b6d4",
];
const nodeColor = (cluster: number) => CLUSTER_COLORS[cluster % CLUSTER_COLORS.length];

/** Node radius from its chunk count (world units). */
const radiusOf = (chunkCount: number) => 6 + Math.sqrt(chunkCount) * 3;

interface Sim {
  layout: Layout;
  ids: string[];
  idToIndex: Map<string, number>;
  es: Int32Array;
  et: Int32Array;
  ew: Float32Array;
}

/** Build the simulation buffers for a graph, reusing prior positions by id. */
function buildSim(graph: Graph, prev?: Sim): Sim {
  const ids = graph.nodes.map((n) => n.id);
  const idToIndex = new Map(ids.map((id, i) => [id, i]));
  const layout = createLayout(graph.nodes.map((n) => radiusOf(n.chunkCount)));

  // Keep nodes that survived a threshold change roughly where they were.
  if (prev) {
    for (let i = 0; i < ids.length; i++) {
      const p = prev.idToIndex.get(ids[i]);
      if (p !== undefined) {
        layout.x[i] = prev.layout.x[p];
        layout.y[i] = prev.layout.y[p];
      }
    }
  }

  const es = new Int32Array(graph.edges.length);
  const et = new Int32Array(graph.edges.length);
  const ew = new Float32Array(graph.edges.length);
  graph.edges.forEach((e, k) => {
    es[k] = idToIndex.get(e.source)!;
    et[k] = idToIndex.get(e.target)!;
    ew[k] = e.weight;
  });
  return { layout, ids, idToIndex, es, et, ew };
}

export function GraphPanel() {
  const embeddedChunks = useVaultStore((s) => s.embeddedChunks);
  const selectNote = useVaultStore((s) => s.selectNote);
  const previewChunk = useVaultStore((s) => s.previewChunk);

  const [minSimilarity, setMinSimilarity] = useState(0.5);
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  const [hovered, setHovered] = useState<number | null>(null);

  const graph = useMemo(
    () => buildGraph(embeddedChunks, { neighbors: 4, minSimilarity }),
    [embeddedChunks, minSimilarity],
  );

  // First chunk per document — used to open a preview when a node is clicked.
  const firstChunkById = useMemo(() => {
    const m = new Map<string, (typeof embeddedChunks)[number]>();
    for (const c of embeddedChunks) if (!m.has(c.notePath)) m.set(c.notePath, c);
    return m;
  }, [embeddedChunks]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const graphRef = useRef(graph);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const alphaRef = useRef(1);
  const runningRef = useRef(false);
  const rafRef = useRef(0);
  const hoveredRef = useRef<number | null>(null);
  const dragRef = useRef<{ node: number | null; panning: boolean; px: number; py: number }>({
    node: null,
    panning: false,
    px: 0,
    py: 0,
  });
  const darkRef = useRef(dark);
  graphRef.current = graph;
  hoveredRef.current = hovered;
  darkRef.current = dark;

  // Track OS theme so the canvas repaints in the right palette.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const kick = (reheat = 0.7) => {
    alphaRef.current = Math.max(alphaRef.current, reheat);
    if (!runningRef.current) {
      runningRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const fitView = () => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas || sim.layout.n === 0) return;
    const { x, y, r } = sim.layout;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < sim.layout.n; i++) {
      minX = Math.min(minX, x[i] - r[i]);
      minY = Math.min(minY, y[i] - r[i]);
      maxX = Math.max(maxX, x[i] + r[i]);
      maxY = Math.max(maxY, y[i] + r[i]);
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const scale = Math.min(w / gw, h / gh, 2.5) * 0.85 || 1;
    viewRef.current = {
      scale,
      tx: w / 2 - ((minX + maxX) / 2) * scale,
      ty: h / 2 - ((minY + maxY) / 2) * scale,
    };
    draw();
  };

  // (Re)build the simulation whenever the graph structure changes.
  useEffect(() => {
    const first = !simRef.current;
    simRef.current = buildSim(graph, simRef.current ?? undefined);
    if (first) {
      // Let it settle a bit before the first fit so the view isn't a dot.
      alphaRef.current = 1;
      setTimeout(fitView, 250);
    }
    kick(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Canvas sizing (devicePixelRatio-aware) + repaint on container resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => draw(), [dark]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  function tick() {
    const sim = simRef.current;
    if (!sim) {
      runningRef.current = false;
      return;
    }
    const dragging = dragRef.current.node !== null;
    if (alphaRef.current > 0.01) {
      stepLayout(sim.layout, sim.es, sim.et, sim.ew, { alpha: alphaRef.current });
      if (!dragging) alphaRef.current *= 0.985;
    }
    draw();
    if (alphaRef.current > 0.01 || dragging) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      runningRef.current = false;
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { scale, tx, ty } = viewRef.current;
    const isDark = darkRef.current;
    const g = graphRef.current;
    const { layout, es, et, ew } = sim;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);

    const hov = hoveredRef.current;
    const neighborSet = new Set<number>();
    if (hov !== null) {
      for (let k = 0; k < es.length; k++) {
        if (es[k] === hov) neighborSet.add(et[k]);
        else if (et[k] === hov) neighborSet.add(es[k]);
      }
    }

    // Edges.
    for (let k = 0; k < es.length; k++) {
      const a = es[k], b = et[k];
      const active = hov === null || a === hov || b === hov;
      ctx.strokeStyle = isDark
        ? `rgba(148,163,184,${active ? 0.35 + ew[k] * 0.4 : 0.06})`
        : `rgba(100,116,139,${active ? 0.3 + ew[k] * 0.4 : 0.05})`;
      ctx.lineWidth = (active ? 0.6 + ew[k] * 1.6 : 0.5) / scale;
      ctx.beginPath();
      ctx.moveTo(layout.x[a], layout.y[a]);
      ctx.lineTo(layout.x[b], layout.y[b]);
      ctx.stroke();
    }

    // Nodes.
    for (let i = 0; i < layout.n; i++) {
      const node = g.nodes[i];
      const dim = hov !== null && hov !== i && !neighborSet.has(i);
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.beginPath();
      ctx.arc(layout.x[i], layout.y[i], layout.r[i], 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(node.cluster);
      ctx.fill();
      if (i === hov) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = isDark ? "#fff" : "#0f172a";
        ctx.stroke();
      } else if (node.sourceType === "pdf") {
        // Distinguish books with a ring.
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.55)" : "rgba(15,23,42,0.45)";
        ctx.stroke();
      }
    }

    // Labels — only for hovered/neighbors, or big nodes, to avoid clutter.
    ctx.globalAlpha = 1;
    ctx.font = `${12 / scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < layout.n; i++) {
      const node = g.nodes[i];
      const show = hov === i || neighborSet.has(i) || (hov === null && node.chunkCount >= 5);
      if (!show) continue;
      const label = node.name.length > 26 ? `${node.name.slice(0, 25)}…` : node.name;
      ctx.fillStyle = isDark ? "rgba(226,232,240,0.9)" : "rgba(15,23,42,0.85)";
      ctx.fillText(label, layout.x[i], layout.y[i] + layout.r[i] + 3 / scale);
    }
    ctx.globalAlpha = 1;
  }

  // --- pointer helpers ---
  const toWorld = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { scale, tx, ty } = viewRef.current;
    return {
      x: (e.clientX - rect.left - tx) / scale,
      y: (e.clientY - rect.top - ty) / scale,
    };
  };

  const nodeAt = (wx: number, wy: number): number | null => {
    const sim = simRef.current;
    if (!sim) return null;
    const { x, y, r, n } = sim.layout;
    for (let i = n - 1; i >= 0; i--) {
      const dx = wx - x[i], dy = wy - y[i];
      if (dx * dx + dy * dy <= (r[i] + 3) * (r[i] + 3)) return i;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    const { x, y } = toWorld(e);
    const hit = nodeAt(x, y);
    if (hit !== null && simRef.current) {
      dragRef.current = { node: hit, panning: false, px: e.clientX, py: e.clientY };
      simRef.current.layout.fixed[hit] = 1;
      kick();
    } else {
      dragRef.current = { node: null, panning: true, px: e.clientX, py: e.clientY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.node !== null && simRef.current) {
      const { x, y } = toWorld(e);
      simRef.current.layout.x[d.node] = x;
      simRef.current.layout.y[d.node] = y;
      kick(0.5);
      return;
    }
    if (d.panning) {
      viewRef.current.tx += e.clientX - d.px;
      viewRef.current.ty += e.clientY - d.py;
      d.px = e.clientX;
      d.py = e.clientY;
      draw();
      return;
    }
    // Plain hover.
    const { x, y } = toWorld(e);
    const hit = nodeAt(x, y);
    if (hit !== hoveredRef.current) {
      setHovered(hit);
      draw();
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.node !== null && simRef.current) simRef.current.layout.fixed[d.node] = 0;
    dragRef.current = { node: null, panning: false, px: 0, py: 0 };
    canvasRef.current?.releasePointerCapture(e.pointerId);
    kick(0.2);
  };

  const onClick = (e: React.PointerEvent) => {
    // A drag shouldn't count as a click (endDrag already handled movement).
    const { x, y } = toWorld(e);
    const hit = nodeAt(x, y);
    if (hit === null) return;
    const node = graphRef.current.nodes[hit];
    if (node.sourceType === "pdf") {
      const chunk = firstChunkById.get(node.id);
      if (chunk) previewChunk(chunk);
    } else {
      selectNote(node.id);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = viewRef.current;
    const wx = (mx - v.tx) / v.scale;
    const wy = (my - v.ty) / v.scale;
    const factor = Math.exp(-e.deltaY * 0.0015);
    v.scale = Math.min(6, Math.max(0.15, v.scale * factor));
    v.tx = mx - wx * v.scale;
    v.ty = my - wy * v.scale;
    draw();
  };

  if (embeddedChunks.length === 0) {
    return (
      <p className="mx-auto max-w-md pt-10 text-center text-sm text-neutral-400">
        Build an index first — the knowledge graph is drawn from your documents' embeddings.
      </p>
    );
  }

  const hoveredNode = hovered !== null ? graph.nodes[hovered] : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {graph.nodes.length} docs · {graph.edges.length} links · {graph.clusterCount} clusters
        </span>
        <label className="flex items-center gap-2">
          Similarity ≥ {minSimilarity.toFixed(2)}
          <input
            type="range"
            min={0.3}
            max={0.85}
            step={0.01}
            value={minSimilarity}
            onChange={(e) => setMinSimilarity(Number(e.target.value))}
            className="w-32 accent-indigo-500"
          />
        </label>
        <button
          type="button"
          onClick={fitView}
          className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Fit
        </button>
        <span className="text-neutral-400">drag nodes · scroll to zoom · click to open</span>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          style={{ cursor: hovered !== null ? "pointer" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => {
            endDrag(e);
            onClick(e);
          }}
          onPointerLeave={(e) => {
            if (dragRef.current.node !== null || dragRef.current.panning) endDrag(e);
            setHovered(null);
          }}
          onWheel={onWheel}
        />
        {hoveredNode && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-neutral-200 bg-white/90 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/90">
            <div className="flex items-center gap-1.5 font-medium">
              <span>{hoveredNode.sourceType === "pdf" ? "📖" : "📄"}</span>
              <span className="truncate">{hoveredNode.name}</span>
            </div>
            <div className="mt-0.5 text-neutral-500">
              {hoveredNode.chunkCount} chunk{hoveredNode.chunkCount === 1 ? "" : "s"} ·{" "}
              {hoveredNode.degree} link{hoveredNode.degree === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
