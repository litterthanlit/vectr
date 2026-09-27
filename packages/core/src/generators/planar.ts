import { TAU, bool, circle, gcd, int, lerp, num, rng, smoothstep, str } from '../math.js';
import type { GeoLabel, GeoNode, Generator, Polyline, Vec3 } from '../types.js';

const archShapes: Record<string, (s: number) => number> = {
  round: (s) => Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2)),
  parabola: (s) => 1 - (2 * s - 1) ** 2,
  gothic: (s) => Math.pow(1 - Math.abs(2 * s - 1), 0.55),
  catenary: (s) => (Math.cosh(2) - Math.cosh(2 * (2 * s - 1))) / (Math.cosh(2) - 1),
};

export const arches: Generator = {
  type: 'arches',
  name: 'Arches',
  blurb: 'Receding arches with construction lines and a trajectory',
  params: [
    { key: 'shape', label: 'Shape', kind: 'select', options: Object.keys(archShapes).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })) },
    { key: 'count', label: 'Arches', kind: 'range', min: 1, max: 9, step: 1 },
    { key: 'width', label: 'Span', kind: 'range', min: 0.2, max: 1.2, step: 0.01 },
    { key: 'height', label: 'Height', kind: 'range', min: 0.3, max: 2, step: 0.01 },
    { key: 'depth', label: 'Depth step', kind: 'range', min: 0, max: 0.8, step: 0.01 },
    { key: 'shrink', label: 'Shrink', kind: 'range', min: -0.6, max: 0.8, step: 0.01 },
    { key: 'construction', label: 'Construction lines', kind: 'toggle' },
    { key: 'arrow', label: 'Trajectory arrow', kind: 'toggle' },
  ],
  defaults: { shape: 'parabola', count: 3, width: 0.6, height: 1.4, depth: 0.45, shrink: 0.1, construction: true, arrow: true },
  transform: { rx: -8, ry: 38 },
  build(p) {
    const f = archShapes[str(p, 'shape')] ?? archShapes.round;
    const n = int(p, 'count');
    const W = num(p, 'width'), H = num(p, 'height'), D = num(p, 'depth');
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const base = -H / 2;
    const feet: Vec3[][] = [];
    for (let i = 0; i < n; i++) {
      const k = 1 - (num(p, 'shrink') * i) / Math.max(1, n - 1);
      const w = W * k, h = H * k;
      const z = (i - (n - 1) / 2) * D;
      const pt = (s: number): Vec3 => [lerp(-w, w, s), base + h * f(s), z];
      const pts: Vec3[] = [];
      for (let s = 0; s <= 72; s++) pts.push(pt(s / 72));
      lines.push({ pts, tone: i === 0 ? 'front' : 'auto' });
      for (const s of [0, 0.2, 0.5, 0.8, 1]) nodes.push({ p: pt(s) });
      feet.push([pt(0), pt(1)]);
      if (bool(p, 'construction')) {
        lines.push({ pts: [pt(0), pt(0.2), pt(0.5)], tone: 'back' });
        lines.push({ pts: [pt(0.5), pt(0.8), pt(1)], tone: 'back' });
        lines.push({ pts: [pt(0), pt(1)], tone: 'back' });
      }
    }
    if (bool(p, 'construction')) {
      for (let i = 1; i < feet.length; i++) {
        lines.push({ pts: [feet[i - 1][0], feet[i][0]], tone: 'back' });
        lines.push({ pts: [feet[i - 1][1], feet[i][1]], tone: 'back' });
      }
    }
    if (bool(p, 'arrow') && n > 0) {
      const a = feet[0][0];
      const zb = feet[feet.length - 1][1][2];
      const b: Vec3 = [W * 1.25, base + H * 0.78, zb];
      const c: Vec3 = [0, base + H * 0.9, (a[2] + zb) / 2];
      const pts: Vec3[] = [];
      for (let s = 0; s <= 40; s++) {
        const t = s / 40;
        pts.push([
          (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
          (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
          (1 - t) ** 2 * a[2] + 2 * (1 - t) * t * c[2] + t * t * b[2],
        ]);
      }
      lines.push({ pts, tone: 'front', arrow: true });
    }
    return { lines, nodes };
  },
};

type Warp = (u: number, v: number, amt: number, freq: number) => Vec3;
const warps: Record<string, Warp> = {
  none: (u, v) => [u, v, 0],
  bend: (u, v, a) => {
    const s = smoothstep(-0.1, 1, u) ** 2;
    return [u - a * 0.35 * s * (v + 1) * 0.5, v + a * s * (v + 1.35), 0];
  },
  fan: (u, v, a) => {
    const t = (u + 1) / 2;
    return [u, v * (1 + a * t * t * 1.5), 0];
  },
  wave: (u, v, a, f) => [u, v, a * 0.35 * Math.sin(f * Math.PI * u) * Math.cos(f * Math.PI * v * 0.5)],
  ripple: (u, v, a, f) => {
    const r = Math.hypot(u, v);
    return [u, v, a * 0.25 * Math.cos(f * Math.PI * r) * (1 - Math.min(1, r / 1.5))];
  },
  pinch: (u, v, a) => {
    const r = Math.hypot(u, v) || 1e-6;
    const k = Math.pow(Math.min(r, 1.5) / 1.5, a * 0.8) * 1.5 / r;
    return [u * (r < 1.5 ? k : 1), v * (r < 1.5 ? k : 1), 0];
  },
  twist: (u, v, a) => {
    const r = Math.hypot(u, v);
    const ang = a * Math.PI * 0.6 * Math.max(0, 1 - r / 1.45);
    return [u * Math.cos(ang) - v * Math.sin(ang), u * Math.sin(ang) + v * Math.cos(ang), 0];
  },
  bulge: (u, v, a) => [u, v, a * 0.6 * Math.max(0, 1 - (u * u + v * v) / 2)],
};

export const grid: Generator = {
  type: 'grid',
  name: 'Flow grid',
  blurb: 'Deformable grid — bend, fan, twist or make terrain',
  params: [
    { key: 'warp', label: 'Warp', kind: 'select', options: Object.keys(warps).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })) },
    { key: 'amount', label: 'Amount', kind: 'range', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'frequency', label: 'Frequency', kind: 'range', min: 0.5, max: 6, step: 0.1 },
    { key: 'rows', label: 'Rows', kind: 'range', min: 0, max: 40, step: 1 },
    { key: 'cols', label: 'Columns', kind: 'range', min: 0, max: 40, step: 1 },
    { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.4, max: 2.5, step: 0.01 },
    { key: 'nodeEvery', label: 'Node every', kind: 'range', min: 0, max: 6, step: 1 },
    { key: 'dotted', label: 'Dotted lines', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { warp: 'bend', amount: 0.32, frequency: 2, rows: 14, cols: 13, aspect: 1, nodeEvery: 2, dotted: 0.2, seed: 3 },
  build(p) {
    const w = warps[str(p, 'warp')] ?? warps.none;
    const amt = num(p, 'amount'), fr = num(p, 'frequency'), asp = num(p, 'aspect');
    const at = (u: number, v: number): Vec3 => {
      const [x, y, z] = w(u, v, amt, fr);
      return [x * asp, y, z];
    };
    const rows = int(p, 'rows'), cols = int(p, 'cols');
    const r = rng(int(p, 'seed'));
    const dotted = num(p, 'dotted');
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const coord = (i: number, n: number) => (n <= 1 ? 0 : -1 + (2 * i) / (n - 1));
    const S = 64;
    for (let j = 0; j < rows; j++) {
      const v = coord(j, rows);
      const pts: Vec3[] = [];
      for (let s = 0; s <= S; s++) pts.push(at(-1 + (2 * s) / S, v));
      lines.push({ pts, tone: r() < dotted ? 'back' : 'front' });
    }
    for (let i = 0; i < cols; i++) {
      const u = coord(i, cols);
      const pts: Vec3[] = [];
      for (let s = 0; s <= S; s++) pts.push(at(u, -1 + (2 * s) / S));
      lines.push({ pts, tone: r() < dotted ? 'back' : 'front' });
    }
    const every = int(p, 'nodeEvery');
    if (every > 0 && rows > 0 && cols > 0) {
      for (let j = 0; j < rows; j += every)
        for (let i = 0; i < cols; i += every) nodes.push({ p: at(coord(i, cols), coord(j, rows)) });
    } else if (every > 0) {
      // Only one family of lines: put nodes on their ends.
      for (const l of lines) nodes.push({ p: l.pts[0] }, { p: l.pts[l.pts.length - 1] });
    }
    return { lines, nodes };
  },
};

export const truchet: Generator = {
  type: 'truchet',
  name: 'Maze',
  blurb: 'Truchet tiles that link into meandering loops',
  params: [
    { key: 'tiles', label: 'Tiles', kind: 'range', min: 2, max: 16, step: 1 },
    { key: 'mask', label: 'Mask', kind: 'select', options: [
      { value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }, { value: 'diamond', label: 'Diamond' },
    ] },
    { key: 'style', label: 'Tile', kind: 'select', options: [
      { value: 'arcs', label: 'Arcs' }, { value: 'lines', label: 'Diagonals' }, { value: 'mixed', label: 'Mixed' },
    ] },
    { key: 'dotted', label: 'Dotted loops', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'ends', label: 'Open-end nodes', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { tiles: 6, mask: 'square', style: 'arcs', dotted: 0.45, ends: 0.8, seed: 11 },
  transform: { rz: 45, scale: 150 },
  build(p) {
    const n = int(p, 'tiles');
    const s = 2 / n;
    const r = rng(int(p, 'seed'));
    const mask = str(p, 'mask');
    const inside = (x: number, y: number) =>
      mask === 'circle' ? Math.hypot(x, y) <= 1 : mask === 'diamond' ? Math.abs(x) + Math.abs(y) <= 1.001 : true;
    type Seg = { pts: Vec3[]; a: string; b: string };
    const segs: Seg[] = [];
    const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
    const style = str(p, 'style');
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = -1 + i * s, y0 = -1 + j * s;
        if (!inside(x0 + s / 2, y0 + s / 2)) continue;
        const flip = r() < 0.5;
        const arcs = style === 'arcs' || (style === 'mixed' && r() < 0.6);
        const corners: [number, number, number][] = flip
          ? [[x0, y0, 0], [x0 + s, y0 + s, Math.PI]]
          : [[x0 + s, y0, Math.PI / 2], [x0, y0 + s, -Math.PI / 2]];
        for (const [cx, cy, a0] of corners) {
          const e1: [number, number] = [cx + (s / 2) * Math.cos(a0), cy + (s / 2) * Math.sin(a0)];
          const e2: [number, number] = [cx + (s / 2) * Math.cos(a0 + Math.PI / 2), cy + (s / 2) * Math.sin(a0 + Math.PI / 2)];
          const pts: Vec3[] = arcs
            ? circle([cx, cy, 0], [1, 0, 0], [0, 1, 0], s / 2, 16, a0, a0 + Math.PI / 2)
            : [[e1[0], e1[1], 0], [e2[0], e2[1], 0]];
          segs.push({ pts, a: key(...e1), b: key(...e2) });
        }
      }
    }
    // Union-find on shared endpoints so a whole loop gets one tone.
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let x = k;
      while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    const count = new Map<string, number>();
    for (const g of segs) {
      for (const k of [g.a, g.b]) {
        if (!parent.has(k)) parent.set(k, k);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      parent.set(find(g.a), find(g.b));
    }
    const tone = new Map<string, 'front' | 'back'>();
    const lines: Polyline[] = segs.map((g) => {
      const root = find(g.a);
      if (!tone.has(root)) tone.set(root, r() < num(p, 'dotted') ? 'back' : 'front');
      return { pts: g.pts, tone: tone.get(root) };
    });
    const nodes: GeoNode[] = [];
    const ends = num(p, 'ends');
    for (const [k, c] of count) {
      if ((c === 1 && r() < ends) || (c > 1 && r() < ends * 0.12)) {
        const [x, y] = k.split(',').map(Number);
        nodes.push({ p: [x, y, 0] });
      }
    }
    return { lines, nodes };
  },
};

function outline(kind: string, sides: number, inner: number, round: number, seed: number): Vec3[] {
  const pts: Vec3[] = [];
  if (kind === 'circle' || kind === 'squircle' || kind === 'flower' || kind === 'blob') {
    const r = rng(seed);
    const harmonics = [2, 3, 5].map((k) => ({ k, amp: (r() * 0.6 + 0.4) / k, ph: r() * TAU }));
    const N = 180;
    for (let i = 0; i < N; i++) {
      const t = (TAU * i) / N;
      if (kind === 'squircle') {
        const e = 2 / (2 + round * 8);
        const c = Math.cos(t), s = Math.sin(t);
        pts.push([Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e, 0]);
        continue;
      }
      let rad = 1;
      if (kind === 'flower') rad = 1 - inner * 0.5 + inner * 0.5 * Math.cos(sides * t);
      if (kind === 'blob') rad = 1 + inner * 0.5 * harmonics.reduce((acc, h) => acc + h.amp * Math.sin(h.k * t + h.ph), 0);
      pts.push([rad * Math.cos(t), rad * Math.sin(t), 0]);
    }
    return pts;
  }
  const verts: Vec3[] = [];
  const count = kind === 'star' ? sides * 2 : sides;
  for (let i = 0; i < count; i++) {
    const t = -Math.PI / 2 + (TAU * i) / count;
    const rad = kind === 'star' && i % 2 ? inner : 1;
    verts.push([rad * Math.cos(t), rad * Math.sin(t), 0]);
  }
  if (round <= 0) return verts;
  const t = Math.min(0.5, round * 0.5);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i], a = verts[(i - 1 + verts.length) % verts.length], b = verts[(i + 1) % verts.length];
    const A: Vec3 = [lerp(v[0], a[0], t), lerp(v[1], a[1], t), 0];
    const B: Vec3 = [lerp(v[0], b[0], t), lerp(v[1], b[1], t), 0];
    for (let k = 0; k <= 10; k++) {
      const q = k / 10;
      pts.push([
        (1 - q) ** 2 * A[0] + 2 * (1 - q) * q * v[0] + q * q * B[0],
        (1 - q) ** 2 * A[1] + 2 * (1 - q) * q * v[1] + q * q * B[1],
        0,
      ]);
    }
  }
  return pts;
}

export const shape: Generator = {
  type: 'shape',
  name: 'Shape',
  blurb: 'Rounded polygons, stars, squircles and blobs with echoes',
  params: [
    { key: 'kind', label: 'Kind', kind: 'select', options: [
      { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }, { value: 'squircle', label: 'Squircle' },
      { value: 'circle', label: 'Circle' }, { value: 'flower', label: 'Flower' }, { value: 'blob', label: 'Blob' },
    ] },
    { key: 'sides', label: 'Sides / petals', kind: 'range', min: 3, max: 16, step: 1 },
    { key: 'inner', label: 'Inner / wobble', kind: 'range', min: 0.1, max: 1, step: 0.01 },
    { key: 'round', label: 'Roundness', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'echoes', label: 'Echoes', kind: 'range', min: 1, max: 16, step: 1 },
    { key: 'spacing', label: 'Echo spacing', kind: 'range', min: 0.02, max: 0.3, step: 0.005 },
    { key: 'stack', label: 'Depth stack', kind: 'range', min: 0, max: 0.4, step: 0.005 },
    { key: 'alternate', label: 'Alternate dotted', kind: 'toggle' },
    { key: 'vertexNodes', label: 'Vertex nodes', kind: 'toggle' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { kind: 'polygon', sides: 6, inner: 0.5, round: 0.35, echoes: 1, spacing: 0.1, stack: 0, alternate: false, vertexNodes: false, seed: 4 },
  style: { width: 3, nodes: true },
  build(p) {
    const kind = str(p, 'kind');
    const base = outline(kind, int(p, 'sides'), num(p, 'inner'), num(p, 'round'), int(p, 'seed'));
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const echoes = int(p, 'echoes');
    for (let e = 0; e < echoes; e++) {
      const k = Math.max(0.02, 1 - e * num(p, 'spacing'));
      const z = (e - (echoes - 1) / 2) * num(p, 'stack');
      lines.push({
        pts: base.map(([x, y]) => [x * k, y * k, z] as Vec3),
        closed: true,
        tone: bool(p, 'alternate') && e % 2 ? 'back' : 'front',
      });
      if (bool(p, 'vertexNodes') && (kind === 'polygon' || kind === 'star')) {
        const count = kind === 'star' ? int(p, 'sides') * 2 : int(p, 'sides');
        for (let i = 0; i < count; i++) {
          const t = -Math.PI / 2 + (TAU * i) / count;
          const rad = kind === 'star' && i % 2 ? num(p, 'inner') : 1;
          nodes.push({ p: [rad * Math.cos(t) * k, rad * Math.sin(t) * k, z] });
        }
      }
    }
    return { lines, nodes };
  },
};

export const spirograph: Generator = {
  type: 'spirograph',
  name: 'Spirograph',
  blurb: 'Hypo- and epitrochoid rosettes',
  params: [
    { key: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'hypo', label: 'Inside (hypo)' }, { value: 'epi', label: 'Outside (epi)' }] },
    { key: 'ring', label: 'Ring teeth', kind: 'range', min: 10, max: 120, step: 1 },
    { key: 'wheel', label: 'Wheel teeth', kind: 'range', min: 3, max: 100, step: 1 },
    { key: 'pen', label: 'Pen offset', kind: 'range', min: 0, max: 1.6, step: 0.01 },
    { key: 'beads', label: 'Beads', kind: 'range', min: 0, max: 60, step: 1 },
  ],
  defaults: { mode: 'hypo', ring: 96, wheel: 36, pen: 0.8, beads: 0 },
  style: { width: 1 },
  build(p) {
    const R = int(p, 'ring'), r = Math.max(1, int(p, 'wheel')), d = num(p, 'pen') * r;
    const epi = str(p, 'mode') === 'epi';
    const turns = r / gcd(R, r);
    const N = Math.min(9000, Math.max(400, Math.round(turns * 260)));
    const raw: [number, number][] = [];
    let max = 0;
    for (let i = 0; i < N; i++) {
      const t = (TAU * turns * i) / N;
      const x = epi ? (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t) : (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      const y = epi ? (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t) : (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      raw.push([x, y]);
      max = Math.max(max, Math.hypot(x, y));
    }
    const pts = raw.map(([x, y]) => [x / (max || 1), y / (max || 1), 0] as Vec3);
    const beads = int(p, 'beads');
    const nodes: GeoNode[] = [];
    for (let i = 0; i < beads; i++) nodes.push({ p: pts[Math.floor((i * pts.length) / beads)] });
    return { lines: [{ pts, closed: true }], nodes };
  },
};

export const frame: Generator = {
  type: 'frame',
  name: 'Figure frame',
  blurb: 'Plate border, crosshair, ruler ticks and a FIG. label',
  params: [
    { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.5, max: 2.5, step: 0.01 },
    { key: 'crosshair', label: 'Crosshair', kind: 'select', options: [
      { value: 'none', label: 'None' }, { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'both', label: 'Both' },
    ] },
    { key: 'ticks', label: 'Ruler ticks', kind: 'range', min: 0, max: 40, step: 1 },
    { key: 'corners', label: 'Registration marks', kind: 'toggle' },
    { key: 'fig', label: 'Figure label', kind: 'text', placeholder: 'Optional' },
    { key: 'caption', label: 'Caption', kind: 'text', placeholder: 'Optional' },
  ],
  defaults: { aspect: 1.45, crosshair: 'vertical', ticks: 0, corners: false, fig: '', caption: '' },
  style: { width: 1, nodes: false },
  build(p) {
    const a = num(p, 'aspect');
    const lines: Polyline[] = [
      { pts: [[-a, -1, 0], [a, -1, 0], [a, 1, 0], [-a, 1, 0]], closed: true, tone: 'front' },
    ];
    const ch = str(p, 'crosshair');
    if (ch === 'vertical' || ch === 'both') lines.push({ pts: [[0, -1, 0], [0, 1, 0]], tone: 'front' });
    if (ch === 'horizontal' || ch === 'both') lines.push({ pts: [[-a, 0, 0], [a, 0, 0]], tone: 'front' });
    const ticks = int(p, 'ticks');
    for (let i = 1; i < ticks; i++) {
      const x = -a + (2 * a * i) / ticks;
      const len = i % 5 === 0 ? 0.06 : 0.03;
      lines.push({ pts: [[x, -1, 0], [x, -1 + len, 0]], tone: 'front' });
      lines.push({ pts: [[x, 1, 0], [x, 1 - len, 0]], tone: 'front' });
    }
    if (bool(p, 'corners')) {
      const m = 0.08;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = sx * (a + 0.04), cy = sy * 1.04;
        lines.push({ pts: [[cx, cy + sy * m, 0], [cx, cy, 0], [cx + sx * m, cy, 0]], tone: 'front' });
      }
    }
    const labels: GeoLabel[] = [];
    if (str(p, 'fig')) labels.push({ p: [-a + 0.05, -1 + 0.06, 0], text: str(p, 'fig') });
    if (str(p, 'caption')) labels.push({ p: [a - 0.05, 1 - 0.1, 0], text: str(p, 'caption'), anchor: 'end' });
    return { lines, nodes: [], labels };
  },
};
