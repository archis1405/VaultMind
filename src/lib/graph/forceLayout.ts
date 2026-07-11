/**
 * A tiny dependency-free force-directed layout, à la d3-force but purpose-built:
 * positions/velocities live in flat typed arrays and one `stepLayout` advances
 * the whole system by a frame. Three forces:
 *   - many-body repulsion  (every node pushes every other; O(n²))
 *   - link springs         (edges pull their endpoints toward a rest length)
 *   - centering gravity     (a gentle pull to origin so the graph can't drift away)
 * An external `alpha` (cooling factor, 1 → 0) scales all forces so motion settles.
 */
export interface Layout {
  n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Per-node radius (world units) — bigger nodes repel a bit harder. */
  r: Float32Array;
  /** 1 = pinned (e.g. being dragged): feels forces on others but doesn't move. */
  fixed: Uint8Array;
}

export interface LayoutOptions {
  alpha: number;
  repulsion?: number;
  attraction?: number;
  gravity?: number;
  linkDistance?: number;
  damping?: number;
}

const DEFAULTS = {
  repulsion: 2000,
  attraction: 0.08,
  gravity: 0.02,
  linkDistance: 90,
  damping: 0.82,
};

/** Create a layout with nodes seeded on a circle (deterministic, no overlap at r=0). */
export function createLayout(radii: number[]): Layout {
  const n = radii.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const R = 60 + n * 6;
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    x[i] = Math.cos(a) * R;
    y[i] = Math.sin(a) * R;
  }
  return {
    n,
    x,
    y,
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    r: Float32Array.from(radii),
    fixed: new Uint8Array(n),
  };
}

/**
 * Advance the simulation one frame in place. Edges are index-parallel arrays
 * (`es[k]`—`et[k]` with strength `ew[k]`). Returns the total kinetic movement,
 * so callers can stop the loop once the graph is at rest.
 */
export function stepLayout(
  l: Layout,
  es: Int32Array,
  et: Int32Array,
  ew: Float32Array,
  opts: LayoutOptions,
): number {
  const { alpha } = opts;
  const repulsion = opts.repulsion ?? DEFAULTS.repulsion;
  const attraction = opts.attraction ?? DEFAULTS.attraction;
  const gravity = opts.gravity ?? DEFAULTS.gravity;
  const linkDistance = opts.linkDistance ?? DEFAULTS.linkDistance;
  const damping = opts.damping ?? DEFAULTS.damping;
  const { n, x, y, vx, vy, r, fixed } = l;

  const fx = new Float32Array(n);
  const fy = new Float32Array(n);

  // Many-body repulsion (inverse-square, softened to avoid singularities).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = x[i] - x[j];
      let dy = y[i] - y[j];
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Coincident nodes: nudge apart deterministically.
        dx = (i - j) * 0.01 + 0.01;
        dy = 0.01;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const force = (repulsion * (1 + (r[i] + r[j]) * 0.02)) / d2;
      const ux = dx / d;
      const uy = dy / d;
      fx[i] += ux * force;
      fy[i] += uy * force;
      fx[j] -= ux * force;
      fy[j] -= uy * force;
    }
  }

  // Link springs — pull endpoints toward the rest length, scaled by edge weight.
  for (let k = 0; k < es.length; k++) {
    const a = es[k];
    const b = et[k];
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const strength = attraction * ew[k];
    const disp = (d - linkDistance) * strength;
    const ux = dx / d;
    const uy = dy / d;
    fx[a] += ux * disp;
    fy[a] += uy * disp;
    fx[b] -= ux * disp;
    fy[b] -= uy * disp;
  }

  // Centering gravity + integrate.
  let movement = 0;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) {
      vx[i] = 0;
      vy[i] = 0;
      continue;
    }
    fx[i] -= x[i] * gravity;
    fy[i] -= y[i] * gravity;
    vx[i] = (vx[i] + fx[i] * alpha) * damping;
    vy[i] = (vy[i] + fy[i] * alpha) * damping;
    x[i] += vx[i];
    y[i] += vy[i];
    movement += Math.abs(vx[i]) + Math.abs(vy[i]);
  }
  return movement;
}
