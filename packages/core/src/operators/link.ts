import { circle } from '../math.js';
import { bool, int, num, rng, str } from '../math.js';
import type { GeoNode, OpDef, Polyline, Vec3 } from '../types.js';

const MAX_NODES = 1500;

/** Nodes to work with: the geometry's nodes, or (if none) a thinned set of line vertices. */
function anchors(g: { lines: Polyline[]; nodes: GeoNode[] }): GeoNode[] {
  let list: GeoNode[] = g.nodes;
  if (!list.length) {
    list = [];
    for (const l of g.lines) {
      const stride = Math.max(1, Math.floor(l.pts.length / 12));
      for (let i = 0; i < l.pts.length; i += stride) list.push({ p: l.pts[i], t: l.t?.[i], family: l.family });
    }
  }
  if (list.length > MAX_NODES) {
    const stride = list.length / MAX_NODES;
    list = Array.from({ length: MAX_NODES }, (_, i) => list[Math.floor(i * stride)]);
  }
  return list;
}

const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export const connect: OpDef = {
  kind: 'connect',
  name: 'Connect',
  blurb: 'Draw links between points — constellations, webs and meshes',
  params: [
    {
      key: 'mode', label: 'Link', kind: 'select',
      options: [{ value: 'nearest', label: 'Nearest neighbours' }, { value: 'within', label: 'Within distance' }, { value: 'sequence', label: 'In order' }, { value: 'hub', label: 'To the centre' }],
    },
    { key: 'k', label: 'Neighbours', kind: 'range', min: 1, max: 8, step: 1, when: { key: 'mode', in: ['nearest'] } },
    { key: 'distance', label: 'Distance', kind: 'range', min: 0.02, max: 2, step: 0.01, when: { key: 'mode', in: ['within'] } },
    { key: 'bow', label: 'Bow', kind: 'range', min: -1, max: 1, step: 0.01, help: 'Curve links outward (+) or inward (−)' },
    { key: 'keepLines', label: 'Keep lines', kind: 'toggle' },
    { key: 'maxLinks', label: 'Max links', kind: 'range', min: 10, max: 4000, step: 10 },
  ],
  defaults: { mode: 'nearest', k: 3, distance: 0.4, bow: 0, keepLines: true, maxLinks: 1500 },
  apply(g, p) {
    const list = anchors(g);
    const mode = str(p, 'mode'), bow = num(p, 'bow'), max = int(p, 'maxLinks');
    const edges: [number, number][] = [];
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
      if (a === b || edges.length >= max) return;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    };
    if (mode === 'sequence') for (let i = 1; i < list.length; i++) add(i - 1, i);
    else if (mode === 'nearest') {
      const k = int(p, 'k');
      list.forEach((a, i) => {
        const near = list.map((b, j) => [d2(a.p, b.p), j] as const).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]).slice(0, k);
        for (const [, j] of near) add(i, j);
      });
    } else if (mode === 'within') {
      const lim = num(p, 'distance') ** 2;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (d2(list[i].p, list[j].p) <= lim) add(i, j);
    }
    const lines: Polyline[] = bool(p, 'keepLines') ? [...g.lines] : [];
    const curve = (a: Vec3, b: Vec3): Vec3[] => {
      if (Math.abs(bow) < 1e-3) return [a, b];
      const m: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const lm = Math.hypot(...m), target = (Math.hypot(...a) + Math.hypot(...b)) / 2;
      const c: Vec3 = lm > 1e-6 ? [m[0] + (m[0] / lm) * (target - lm) * bow * 2, m[1] + (m[1] / lm) * (target - lm) * bow * 2, m[2] + (m[2] / lm) * (target - lm) * bow * 2] : m;
      return Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return [0, 1, 2].map((k) => (1 - t) ** 2 * a[k] + 2 * (1 - t) * t * c[k] + t * t * b[k]) as Vec3;
      });
    };
    for (const [a, b] of edges) {
      const pts = curve(list[a].p, list[b].p);
      const ta = list[a].t ?? 0, tb = list[b].t ?? 0;
      lines.push({ pts, t: pts.map((_, i) => ta + ((tb - ta) * i) / Math.max(1, pts.length - 1)), family: list[a].family });
    }
    if (mode === 'hub') {
      const c = list.reduce<Vec3>((s, n) => [s[0] + n.p[0] / list.length, s[1] + n.p[1] / list.length, s[2] + n.p[2] / list.length], [0, 0, 0]);
      list.slice(0, max).forEach((n) => lines.push({ pts: curve(c, n.p), t: [0, n.t ?? 1], family: n.family }));
    }
    return { lines, nodes: g.nodes, labels: g.labels };
  },
};

export const tile: OpDef = {
  kind: 'tile',
  name: 'Tile',
  blurb: 'Place a small motif at every point; arcs link into meandering loops',
  params: [
    {
      key: 'motif', label: 'Motif', kind: 'select',
      options: [{ value: 'arcs', label: 'Quarter arcs' }, { value: 'diagonals', label: 'Diagonals' }, { value: 'mixed', label: 'Mixed' }, { value: 'crosses', label: 'Crosses' }, { value: 'rings', label: 'Rings' }],
    },
    { key: 'size', label: 'Size', kind: 'range', min: 0.2, max: 2, step: 0.01, help: '1 = exactly the spacing between points' },
    { key: 'hidden', label: 'Hidden loops', kind: 'range', min: 0, max: 1, step: 0.01, help: 'Share of loops drawn in the hidden style' },
    { key: 'keepNodes', label: 'Keep points', kind: 'toggle' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { motif: 'arcs', size: 1, hidden: 0.35, keepNodes: false, seed: 11 },
  apply(g, p) {
    const list = anchors(g);
    if (list.length < 2) return g;
    // Cell size = median nearest-neighbour spacing (sampled), so motifs meet their neighbours.
    const sample = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 200)) === 0);
    const nn = sample.map((a) => Math.sqrt(Math.min(...list.filter((b) => b !== a).map((b) => d2(a.p, b.p))))).sort((x, y) => x - y);
    const s = nn[Math.floor(nn.length / 2)] * num(p, 'size');
    const h = s / 2;
    const r = rng(int(p, 'seed'));
    const motif = str(p, 'motif');
    type Seg = { pts: Vec3[]; a: string; b: string };
    const segs: Seg[] = [];
    const key = (v: Vec3) => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
    for (const node of list) {
      const [cx, cy, cz] = node.p;
      const kind = motif === 'mixed' ? (r() < 0.6 ? 'arcs' : 'diagonals') : motif;
      if (kind === 'crosses') {
        segs.push({ pts: [[cx - h * 0.5, cy, cz], [cx + h * 0.5, cy, cz]], a: '', b: '' }, { pts: [[cx, cy - h * 0.5, cz], [cx, cy + h * 0.5, cz]], a: '', b: '' });
        continue;
      }
      if (kind === 'rings') {
        segs.push({ pts: circle([cx, cy, cz], [1, 0, 0], [0, 1, 0], h * 0.7, 32), a: '', b: '' });
        continue;
      }
      const flip = r() < 0.5;
      const corners: [number, number, number][] = flip
        ? [[cx - h, cy - h, 0], [cx + h, cy + h, Math.PI]]
        : [[cx + h, cy - h, Math.PI / 2], [cx - h, cy + h, -Math.PI / 2]];
      for (const [ox, oy, a0] of corners) {
        const e1: Vec3 = [ox + h * Math.cos(a0), oy + h * Math.sin(a0), cz];
        const e2: Vec3 = [ox + h * Math.cos(a0 + Math.PI / 2), oy + h * Math.sin(a0 + Math.PI / 2), cz];
        const pts = kind === 'arcs' ? circle([ox, oy, cz], [1, 0, 0], [0, 1, 0], h, 12, a0, a0 + Math.PI / 2) : [e1, e2];
        segs.push({ pts, a: key(e1), b: key(e2) });
      }
    }
    // Union-find so each connected loop gets a single tone and colour family.
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      while (parent.get(k) !== k) {
        const up = parent.get(parent.get(k)!)!;
        parent.set(k, up);
        k = up;
      }
      return k;
    };
    for (const sg of segs) {
      if (!sg.a) continue;
      for (const k of [sg.a, sg.b]) if (!parent.has(k)) parent.set(k, k);
      parent.set(find(sg.a), find(sg.b));
    }
    const loopInfo = new Map<string, { tone: 'front' | 'back'; family: number }>();
    const lines: Polyline[] = segs.map((sg, i) => {
      const root = sg.a ? find(sg.a) : `solo${i}`;
      if (!loopInfo.has(root)) loopInfo.set(root, { tone: r() < num(p, 'hidden') ? 'back' : 'front', family: loopInfo.size });
      const info = loopInfo.get(root)!;
      return { pts: sg.pts, tone: info.tone, family: info.family, t: sg.pts.map((_, k) => k / Math.max(1, sg.pts.length - 1)) };
    });
    return { lines, nodes: bool(p, 'keepNodes') ? g.nodes : [], labels: g.labels };
  },
};
