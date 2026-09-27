import { TAU, rng } from './math.js';
import type { Geometry, Polyline, Vec3 } from './types.js';

/** Shared geometry helpers for sources and operators. */

export const emptyGeo = (): Geometry => ({ lines: [], nodes: [] });

export function pointCount(g: Geometry): number {
  let n = g.nodes.length;
  for (const l of g.lines) n += l.pts.length;
  return n;
}

/** Cumulative arc length along a polyline (closed lines include the closing segment). */
export function arcLengths(pts: Vec3[], closed = false): number[] {
  const out = [0];
  const n = closed ? pts.length + 1 : pts.length;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    out.push(out[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return out;
}

/** Point (and interpolated normal) at fraction u (0–1) of the line's length. */
export function sampleLine(line: Polyline, u: number, lens = arcLengths(line.pts, line.closed)): { p: Vec3; n?: Vec3; t: number } {
  const total = lens[lens.length - 1] || 1;
  const target = Math.min(1, Math.max(0, u)) * total;
  let lo = 0, hi = lens.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = lens[hi] - lens[lo] || 1;
  const f = (target - lens[lo]) / seg;
  const N = line.pts.length;
  const a = line.pts[lo % N], b = line.pts[hi % N];
  const p: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  let n: Vec3 | undefined;
  if (line.normals) {
    const na = line.normals[lo % N], nb = line.normals[hi % N];
    n = [na[0] + (nb[0] - na[0]) * f, na[1] + (nb[1] - na[1]) * f, na[2] + (nb[2] - na[2]) * f];
  }
  const ta = tAt(line, lo % N), tb = tAt(line, hi % N);
  return { p, n, t: ta + (tb - ta) * f };
}

/** The t value of point i (falls back to its index fraction). */
export function tAt(line: Polyline, i: number): number {
  return line.t ? line.t[i] : line.pts.length > 1 ? i / (line.pts.length - 1) : 0;
}

/** Evenly re-space a line to `count` points. */
export function resampleLine(line: Polyline, count: number): Polyline {
  const lens = arcLengths(line.pts, line.closed);
  const pts: Vec3[] = [], normals: Vec3[] = [], t: number[] = [];
  const n = Math.max(2, Math.round(count));
  const steps = line.closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const s = sampleLine(line, i / steps, lens);
    pts.push(s.p);
    t.push(s.t);
    if (s.n) normals.push(s.n);
  }
  return { ...line, pts, t, normals: line.normals ? normals : undefined };
}

export function bbox(g: Geometry) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: Vec3) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  };
  for (const l of g.lines) l.pts.forEach(grow);
  for (const n of g.nodes) grow(n.p);
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
  return { min, max };
}

/** Map every point (and node) through f. Normals are dropped; callers recompute if they can. */
export function mapPoints(g: Geometry, f: (p: Vec3) => Vec3, keepNormals = false): Geometry {
  return {
    lines: g.lines.map((l) => ({ ...l, pts: l.pts.map(f), normals: keepNormals ? l.normals : undefined })),
    nodes: g.nodes.map((n) => ({ ...n, p: f(n.p), n: keepNormals ? n.n : undefined })),
    labels: g.labels?.map((lb) => ({ ...lb, p: f(lb.p) })),
  };
}

/**
 * Map points through a deformation and carry normals along using the inverse
 * transpose of a finite-difference Jacobian, so hidden-line styling survives warps.
 */
export function deform(g: Geometry, f: (p: Vec3) => Vec3): Geometry {
  const h = 1e-3;
  const normalAt = (p: Vec3, n: Vec3): Vec3 => {
    const f0 = f(p);
    const cols: Vec3[] = [0, 1, 2].map((k) => {
      const q: Vec3 = [p[0], p[1], p[2]];
      q[k] += h;
      const fq = f(q);
      return [(fq[0] - f0[0]) / h, (fq[1] - f0[1]) / h, (fq[2] - f0[2]) / h];
    });
    // J columns = cols; inverse-transpose applied to n equals cofactor matrix * n (up to scale).
    const [a, b, c] = cols;
    const cof: Vec3[] = [
      [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]],
      [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]],
      [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    ];
    const out: Vec3 = [
      cof[0][0] * n[0] + cof[1][0] * n[1] + cof[2][0] * n[2],
      cof[0][1] * n[0] + cof[1][1] * n[1] + cof[2][1] * n[2],
      cof[0][2] * n[0] + cof[1][2] * n[1] + cof[2][2] * n[2],
    ];
    // cof rows are a cross products; the transpose relationship gives J^{-T} * det(J).
    const len = Math.hypot(out[0], out[1], out[2]) || 1;
    const det = a[0] * cof[0][0] + a[1] * cof[0][1] + a[2] * cof[0][2];
    const s = det < 0 ? -1 : 1;
    return [(s * out[0]) / len, (s * out[1]) / len, (s * out[2]) / len];
  };
  return {
    lines: g.lines.map((l) => ({
      ...l,
      pts: l.pts.map(f),
      normals: l.normals ? l.normals.map((n, i) => normalAt(l.pts[i], n)) : undefined,
    })),
    nodes: g.nodes.map((nd) => ({ ...nd, p: f(nd.p), n: nd.n ? normalAt(nd.p, nd.n) : undefined })),
    labels: g.labels?.map((lb) => ({ ...lb, p: f(lb.p) })),
  };
}

/**
 * Smooth pseudo-noise in 3D: a seeded sum of sinusoids along random directions.
 * Cheap, continuous and deterministic, which is all warps and jitter need.
 */
export function noise3(seed: number, octaves = 6) {
  const r = rng(seed);
  const waves = Array.from({ length: octaves }, (_, i) => {
    const th = r() * TAU, ph = Math.acos(r() * 2 - 1);
    return {
      d: [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)] as Vec3,
      f: 1 + i * 0.73 + r(),
      o: r() * TAU,
      a: 1 / (1 + i * 0.6),
    };
  });
  const norm = waves.reduce((s, w) => s + w.a, 0);
  return (p: Vec3, freq = 1) =>
    waves.reduce((s, w) => s + w.a * Math.sin((p[0] * w.d[0] + p[1] * w.d[1] + p[2] * w.d[2]) * w.f * freq + w.o), 0) / norm;
}
