import { cross, norm } from '../../math.js';
import type { GeoNode, Polyline, Vec3 } from '../../types.js';

export type SurfaceFn = (u: number, v: number) => Vec3;

export interface SurfaceOpts {
  /** Lines drawn at fixed v, running along u. */
  uLines: number;
  /** Lines drawn at fixed u, running along v. */
  vLines: number;
  uClosed?: boolean;
  vClosed?: boolean;
  /** Parameter ranges; default 0–1. */
  u0?: number;
  u1?: number;
  v0?: number;
  v1?: number;
  /** Samples per u-line (and per v-line unless `vSamples` is given). */
  samples?: number;
  /** Samples per v-line. */
  vSamples?: number;
  /**
   * Space the v-lines as if u were closed even though u-lines stay open: for
   * surfaces like the Möbius band whose u-lines meet their mirror image.
   */
  uPeriodic?: boolean;
  /** Put a node at every crossing of the two families. */
  nodes?: boolean;
  /** Flip normals when the surface is parametrised inside-out. */
  flip?: boolean;
}

/** Surface normal from a finite-difference cross product; falls back to the radial direction. */
export function surfaceNormal(f: SurfaceFn, u: number, v: number, flip = false): Vec3 {
  const h = 1e-4;
  const p = f(u, v);
  const a = f(u + h, v), b = f(u, v + h);
  const du: Vec3 = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
  const dv: Vec3 = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
  const c = cross(du, dv);
  const len = Math.hypot(c[0], c[1], c[2]);
  if (len < 1e-14) return norm(p[0] || p[1] || p[2] ? p : [0, 0, 1]);
  const s = flip ? -1 : 1;
  return [(s * c[0]) / len, (s * c[1]) / len, (s * c[2]) / len];
}

/**
 * Wireframe of a parametric surface: two families of iso-lines with normals, so
 * hidden faces style themselves. Families are numbered 0 (u-lines) and 1 (v-lines);
 * u-lines share a band so ribbon fills run between them.
 */
export function surface(f: SurfaceFn, o: SurfaceOpts): { lines: Polyline[]; nodes: GeoNode[] } {
  const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1, v0 = o.v0 ?? 0, v1 = o.v1 ?? 1;
  const SU = o.samples ?? 96, SV = o.vSamples ?? SU;
  const lines: Polyline[] = [];
  const nodes: GeoNode[] = [];
  const at = (count: number, closed: boolean | undefined, a: number, b: number) => (i: number) =>
    count <= 1 ? (a + b) / 2 : a + ((b - a) * i) / (closed ? count : count - 1);
  const uAt = at(o.vLines, o.uClosed || o.uPeriodic, u0, u1);
  const vAt = at(o.uLines, o.vClosed, v0, v1);
  const line = (fixed: 'u' | 'v', value: number, closed: boolean | undefined, lo: number, hi: number, family: number, band?: number): Polyline => {
    const pts: Vec3[] = [], normals: Vec3[] = [], t: number[] = [];
    const S = fixed === 'v' ? SU : SV;
    const n = closed ? S : S + 1;
    for (let k = 0; k < n; k++) {
      const s = lo + ((hi - lo) * k) / S;
      const [u, v] = fixed === 'v' ? [s, value] : [value, s];
      pts.push(f(u, v));
      normals.push(surfaceNormal(f, u, v, o.flip));
      t.push(k / S);
    }
    return { pts, normals, t, closed, family, band };
  };
  for (let j = 0; j < o.uLines; j++) lines.push(line('v', vAt(j), o.uClosed, u0, u1, j, 1));
  for (let i = 0; i < o.vLines; i++) lines.push(line('u', uAt(i), o.vClosed, v0, v1, o.uLines + i));
  if (o.nodes)
    for (let j = 0; j < o.uLines; j++)
      for (let i = 0; i < o.vLines; i++) {
        const u = uAt(i), v = vAt(j);
        nodes.push({ p: f(u, v), n: surfaceNormal(f, u, v, o.flip) });
      }
  return { lines, nodes };
}

/** Sample a 3D curve into a polyline. */
export function curve3(f: (t: number) => Vec3, n: number, closed = false): Polyline {
  const pts: Vec3[] = [];
  const count = closed ? n : n + 1;
  for (let i = 0; i < count; i++) pts.push(f(i / n));
  return { pts, closed };
}

/** Scale points so the largest extent from the origin is 1, after centring. */
export function fit(lines: Polyline[], nodes: GeoNode[] = [], centre = true): void {
  let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const l of lines)
    for (const p of l.pts)
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
  if (!Number.isFinite(min[0])) return;
  const c: Vec3 = centre ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
  let r = 0;
  for (const l of lines) for (const p of l.pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  const s = r > 1e-12 ? 1 / r : 1;
  const tf = (p: Vec3): Vec3 => [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s];
  for (const l of lines) l.pts = l.pts.map(tf);
  for (const nd of nodes) nd.p = tf(nd.p);
}

/**
 * Isolines of a scalar field on the square [-1, 1]² at the given level (marching
 * squares), joined into polylines.
 */
export function isolines(field: (x: number, y: number) => number, level: number, res: number): [number, number][][] {
  const N = res;
  const val: number[] = new Array((N + 1) * (N + 1));
  const X = (i: number) => -1 + (2 * i) / N;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) val[j * (N + 1) + i] = field(X(i), X(j));
  const V = (i: number, j: number) => val[j * (N + 1) + i];
  const key = (x: number, y: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
  const segs: [[number, number], [number, number]][] = [];
  const lerpEdge = (i0: number, j0: number, i1: number, j1: number): [number, number] => {
    const a = V(i0, j0), b = V(i1, j1);
    const t = Math.abs(b - a) < 1e-12 ? 0.5 : (level - a) / (b - a);
    return [X(i0) + (X(i1) - X(i0)) * t, X(j0) + (X(j1) - X(j0)) * t];
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const c = (V(i, j) > level ? 1 : 0) | (V(i + 1, j) > level ? 2 : 0) | (V(i + 1, j + 1) > level ? 4 : 0) | (V(i, j + 1) > level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const e = [
        () => lerpEdge(i, j, i + 1, j), // bottom
        () => lerpEdge(i + 1, j, i + 1, j + 1), // right
        () => lerpEdge(i, j + 1, i + 1, j + 1), // top
        () => lerpEdge(i, j, i, j + 1), // left
      ];
      const table: Record<number, [number, number][]> = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]],
        8: [[2, 3]], 9: [[2, 0]], 10: [[0, 3], [1, 2]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
      };
      for (const [a, b] of table[c]) segs.push([e[a](), e[b]()]);
    }
  // Join segments that share endpoints.
  const byEnd = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p[0], p[1]);
      const list = byEnd.get(k);
      if (list) list.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: [number, number][][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const chain: [number, number][] = [segs[s][0], segs[s][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? chain[chain.length - 1] : chain[0];
        const next = (byEnd.get(key(end[0], end[1])) ?? []).find((i) => !used[i]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segs[next];
        const other = key(a[0], a[1]) === key(end[0], end[1]) ? b : a;
        if (dir === 1) chain.push(other);
        else chain.unshift(other);
      }
    }
    out.push(chain);
  }
  return out;
}

