import { arcLengths, deform, noise3, resampleLine, sampleLine } from '../geo.js';
import { clamp, int, lerp, num, rng, smoothstep, str } from '../math.js';
import type { GeoNode, OpDef, Polyline, Vec3 } from '../types.js';

type Local = (l: number, u: number, w: number, amt: number, freq: number) => [number, number, number];

/** Warps written in local coordinates: l runs along the chosen axis, u/w across it. */
const LOCAL: Record<string, Local> = {
  bend: (l, u, w, amt) => {
    if (Math.abs(amt) < 1e-4) return [l, u, w];
    const R = 1 / amt, th = l / R;
    return [Math.sin(th) * (R - u), R - Math.cos(th) * (R - u), w];
  },
  twist: (l, u, w, amt) => {
    const a = amt * Math.PI * l;
    return [l, u * Math.cos(a) - w * Math.sin(a), u * Math.sin(a) + w * Math.cos(a)];
  },
  taper: (l, u, w, amt) => {
    const k = Math.max(0.01, 1 + (amt * l) / 2);
    return [l, u * k, w * k];
  },
  wave: (l, u, w, amt, f) => [l, u + amt * 0.3 * Math.sin(f * Math.PI * l), w],
  fan: (l, u, w, amt) => {
    const s = smoothstep(-1, 1, l);
    return [l, u * (1 + amt * s * s * 1.5), w];
  },
};

const RADIAL: Record<string, (q: Vec3, amt: number, freq: number) => Vec3> = {
  ripple: ([x, y, z], amt, f) => {
    const r = Math.hypot(x, y);
    return [x, y, z + amt * 0.25 * Math.cos(f * Math.PI * r) * Math.max(0, 1 - r / 1.6)];
  },
  bulge: ([x, y, z], amt) => [x, y, z + amt * 0.6 * Math.max(0, 1 - (x * x + y * y) / 2)],
  pinch: ([x, y, z], amt) => {
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) return [x, y, z];
    const k = Math.pow(Math.min(r, 1.6) / 1.6, amt * 0.8) * (1.6 / r);
    return r < 1.6 ? [x * k, y * k, z * k] : [x, y, z];
  },
  spherize: ([x, y, z], amt) => {
    const r = Math.hypot(x, y, z) || 1;
    const t = clamp(amt, -1, 1);
    return [lerp(x, x / r, t), lerp(y, y / r, t), lerp(z, z / r, t)];
  },
};

const swizzle = (axis: string, [x, y, z]: Vec3): Vec3 => (axis === 'y' ? [y, z, x] : axis === 'z' ? [z, x, y] : [x, y, z]);
const unswizzle = (axis: string, [a, b, c]: Vec3): Vec3 => (axis === 'y' ? [c, a, b] : axis === 'z' ? [b, c, a] : [a, b, c]);

export const warp: OpDef = {
  kind: 'warp',
  name: 'Warp',
  blurb: 'Bend, twist, taper, ripple or stir the whole form',
  params: [
    {
      key: 'kind', label: 'Warp', kind: 'select',
      options: ['bend', 'twist', 'taper', 'wave', 'fan', 'ripple', 'bulge', 'pinch', 'spherize', 'noise'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
    { key: 'amount', label: 'Amount', kind: 'range', min: -2, max: 2, step: 0.01 },
    { key: 'frequency', label: 'Frequency', kind: 'range', min: 0.25, max: 8, step: 0.05, when: { key: 'kind', in: ['wave', 'ripple', 'noise'] } },
    { key: 'axis', label: 'Axis', kind: 'select', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }], when: { key: 'kind', in: Object.keys(LOCAL) } },
    { key: 'seed', label: 'Seed', kind: 'seed', when: { key: 'kind', in: ['noise'] } },
  ],
  defaults: { kind: 'twist', amount: 0.5, frequency: 2, axis: 'y', seed: 9 },
  apply(g, p) {
    const kind = str(p, 'kind'), amt = num(p, 'amount'), f = num(p, 'frequency'), axis = str(p, 'axis');
    if (kind === 'noise') {
      const [nx, ny, nz] = [0, 1, 2].map((k) => noise3(int(p, 'seed') * 7 + k));
      return deform(g, (q) => [q[0] + amt * 0.3 * nx(q, f), q[1] + amt * 0.3 * ny(q, f), q[2] + amt * 0.3 * nz(q, f)]);
    }
    if (RADIAL[kind]) return deform(g, (q) => RADIAL[kind](q, amt, f));
    const local = LOCAL[kind] ?? LOCAL.twist;
    return deform(g, (q) => {
      const [l, u, w] = swizzle(axis, q);
      return unswizzle(axis, local(l, u, w, amt, f));
    });
  },
};

export const jitter: OpDef = {
  kind: 'jitter',
  name: 'Jitter',
  blurb: 'Shake points loose — from a tremble to a hand-drawn wobble',
  params: [
    { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 0.5, step: 0.005 },
    { key: 'smooth', label: 'Smoothness', kind: 'range', min: 0, max: 1, step: 0.01, help: '0 = grainy, 1 = flowing' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { amount: 0.03, smooth: 0.6, seed: 4 },
  apply(g, p) {
    const amt = num(p, 'amount'), sm = num(p, 'smooth'), seed = int(p, 'seed');
    const r = rng(seed);
    const [nx, ny, nz] = [0, 1, 2].map((k) => noise3(seed * 13 + k));
    const move = (q: Vec3): Vec3 => {
      const rand: Vec3 = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
      const smooth: Vec3 = [nx(q, 4), ny(q, 4), nz(q, 4)];
      return [q[0] + amt * lerp(rand[0], smooth[0], sm), q[1] + amt * lerp(rand[1], smooth[1], sm), q[2] + amt * lerp(rand[2], smooth[2], sm)];
    };
    return {
      lines: g.lines.map((l) => ({ ...l, pts: l.pts.map(move) })),
      nodes: g.nodes.map((n) => ({ ...n, p: move(n.p) })),
      labels: g.labels,
    };
  },
};

export const resample: OpDef = {
  kind: 'resample',
  name: 'Resample',
  blurb: 'Re-space lines evenly, or break them into dashes or dots',
  params: [
    { key: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'even', label: 'Even points' }, { value: 'dashes', label: 'Dashes' }, { value: 'dots', label: 'Dots' }] },
    { key: 'points', label: 'Points per line', kind: 'range', min: 3, max: 400, step: 1, when: { key: 'mode', in: ['even'] } },
    { key: 'spacing', label: 'Spacing', kind: 'range', min: 0.01, max: 0.5, step: 0.005, when: { key: 'mode', in: ['dashes', 'dots'] } },
    { key: 'duty', label: 'Dash length', kind: 'range', min: 0.05, max: 0.95, step: 0.01, when: { key: 'mode', in: ['dashes'] } },
  ],
  defaults: { mode: 'dashes', points: 24, spacing: 0.08, duty: 0.55 },
  apply(g, p) {
    const mode = str(p, 'mode');
    if (mode === 'even') return { ...g, lines: g.lines.map((l) => resampleLine(l, int(p, 'points'))) };
    const spacing = Math.max(0.005, num(p, 'spacing')), duty = num(p, 'duty');
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [...g.nodes];
    for (const line of g.lines) {
      const lens = arcLengths(line.pts, line.closed);
      const total = lens[lens.length - 1];
      const count = Math.min(2000, Math.floor(total / spacing));
      for (let i = 0; i < count; i++) {
        const u0 = (i * spacing) / total;
        if (mode === 'dots') {
          const s = sampleLine(line, u0, lens);
          nodes.push({ p: s.p, n: s.n, t: s.t, family: line.family });
          continue;
        }
        const u1 = Math.min(1, (i * spacing + spacing * duty) / total);
        const a = sampleLine(line, u0, lens), b = sampleLine(line, (u0 + u1) / 2, lens), c = sampleLine(line, u1, lens);
        lines.push({
          pts: [a.p, b.p, c.p], t: [a.t, b.t, c.t], tone: line.tone, family: line.family,
          normals: a.n && b.n && c.n ? [a.n, b.n, c.n] : undefined,
        });
      }
    }
    return { lines, nodes, labels: g.labels };
  },
};
