import { noise3 } from '../../geo.js';
import { TAU, int, num, rng, str } from '../../math.js';
import type { GeoNode, Polyline, SourceDef, Vec3 } from '../../types.js';
import { fit, isolines, surface } from './util.js';

const opts = (...v: [string, string][]) => v.map(([value, label]) => ({ value, label }));
const DEG = Math.PI / 180;

type Flow = (p: Vec3, k: number) => Vec3;
/** Classic chaotic flows. `k` nudges each system's main parameter around its usual value. */
const FLOWS: Record<string, { f: Flow; dt: number; start: Vec3 }> = {
  lorenz: { dt: 0.005, start: [0.1, 0, 0], f: ([x, y, z], k) => [10 * (y - x), x * (28 * k - z) - y, x * y - (8 / 3) * z] },
  aizawa: {
    dt: 0.01, start: [0.1, 0, 0],
    f: ([x, y, z], k) => {
      const a = 0.95 * k, b = 0.7, c = 0.6, d = 3.5, e = 0.25, g = 0.1;
      return [(z - b) * x - d * y, d * x + (z - b) * y, c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + g * z * x * x * x];
    },
  },
  thomas: { dt: 0.05, start: [0.1, 0, 0], f: ([x, y, z], k) => [Math.sin(y) - 0.208186 * k * x, Math.sin(z) - 0.208186 * k * y, Math.sin(x) - 0.208186 * k * z] },
  halvorsen: {
    dt: 0.004, start: [-1.48, -1.51, 2.04],
    f: ([x, y, z], k) => {
      const a = 1.89 * k;
      return [-a * x - 4 * y - 4 * z - y * y, -a * y - 4 * z - 4 * x - z * z, -a * z - 4 * x - 4 * y - x * x];
    },
  },
};

/** Two-dimensional maps drawn as clouds of points. */
const MAPS: Record<string, (x: number, y: number, a: number, b: number, c: number, d: number) => [number, number]> = {
  clifford: (x, y, a, b, c, d) => [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)],
  dejong: (x, y, a, b, c, d) => [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y)],
};

export const attractor: SourceDef = {
  kind: 'attractor',
  name: 'Attractor',
  blurb: 'The path of a chaotic system: 3D flows as one long line, 2D maps as clouds of points',
  params: [
    { key: 'system', label: 'System', kind: 'select', options: opts(['lorenz', 'Lorenz'], ['aizawa', 'Aizawa'], ['thomas', 'Thomas'], ['halvorsen', 'Halvorsen'], ['clifford', 'Clifford (points)'], ['dejong', 'De Jong (points)']) },
    { key: 'steps', label: 'Length', kind: 'range', min: 500, max: 20000, step: 100 },
    { key: 'tweak', label: 'Tweak', kind: 'range', min: 0.8, max: 1.2, step: 0.001, when: { key: 'system', in: Object.keys(FLOWS) } },
    { key: 'a', label: 'a', kind: 'range', min: -3, max: 3, step: 0.01, when: { key: 'system', in: Object.keys(MAPS) } },
    { key: 'b', label: 'b', kind: 'range', min: -3, max: 3, step: 0.01, when: { key: 'system', in: Object.keys(MAPS) } },
    { key: 'c', label: 'c', kind: 'range', min: -3, max: 3, step: 0.01, when: { key: 'system', in: Object.keys(MAPS) } },
    { key: 'd', label: 'd', kind: 'range', min: -3, max: 3, step: 0.01, when: { key: 'system', in: Object.keys(MAPS) } },
  ],
  defaults: { system: 'lorenz', steps: 8000, tweak: 1, a: -1.4, b: 1.6, c: 1, d: 0.7 },
  build(p) {
    const sys = str(p, 'system');
    const steps = int(p, 'steps');
    if (MAPS[sys]) {
      const m = MAPS[sys];
      const a = num(p, 'a'), b = num(p, 'b'), c = num(p, 'c'), d = num(p, 'd');
      let x = 0.1, y = 0.1;
      const nodes: GeoNode[] = [];
      for (let i = 0; i < steps + 100; i++) {
        [x, y] = m(x, y, a, b, c, d);
        if (i >= 100) nodes.push({ p: [x, y, 0], t: (i - 100) / steps, tone: 'front' });
      }
      // Scale the cloud into the unit disc.
      const r = Math.max(1e-9, ...nodes.map((n) => Math.hypot(n.p[0], n.p[1])));
      for (const n of nodes) n.p = [n.p[0] / r, n.p[1] / r, 0];
      return { lines: [], nodes };
    }
    const flow = FLOWS[sys] ?? FLOWS.lorenz;
    const k = num(p, 'tweak');
    let q: Vec3 = [...flow.start];
    const h = flow.dt;
    const step = (v: Vec3): Vec3 => {
      // Fourth-order Runge–Kutta keeps the orbit smooth at a coarse step.
      const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
      const k1 = flow.f(v, k), k2 = flow.f(add(v, k1, h / 2), k), k3 = flow.f(add(v, k2, h / 2), k), k4 = flow.f(add(v, k3, h), k);
      return [0, 1, 2].map((i) => v[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) as Vec3;
    };
    for (let i = 0; i < 400; i++) q = step(q);
    const pts: Vec3[] = [];
    for (let i = 0; i < steps; i++) {
      q = step(q);
      if (!q.every(Number.isFinite)) break;
      // Lorenz lives along z; stand it up so its wings open sideways.
      pts.push(sys === 'lorenz' ? [q[0], q[2], q[1]] : q);
    }
    const lines: Polyline[] = [{ pts }];
    fit(lines);
    return { lines, nodes: [] };
  },
};

export const harmonograph: SourceDef = {
  kind: 'harmonograph',
  name: 'Harmonograph',
  blurb: 'Decaying pendulums tracing overlapping loops; slight detuning makes them drift',
  params: [
    { key: 'fx', label: 'Swing X', kind: 'range', min: 1, max: 8, step: 1 },
    { key: 'fy', label: 'Swing Y', kind: 'range', min: 1, max: 8, step: 1 },
    { key: 'fz', label: 'Swing depth', kind: 'range', min: 0, max: 8, step: 1 },
    { key: 'detune', label: 'Detune', kind: 'range', min: 0, max: 0.05, step: 0.0005 },
    { key: 'phase', label: 'Phase', kind: 'range', min: 0, max: 180, step: 1, unit: '°' },
    { key: 'damping', label: 'Damping', kind: 'range', min: 0, max: 0.03, step: 0.0005 },
    { key: 'turns', label: 'Length', kind: 'range', min: 5, max: 200, step: 1 },
  ],
  defaults: { fx: 3, fy: 2, fz: 0, detune: 0.008, phase: 90, damping: 0.004, turns: 60 },
  build(p) {
    const fx = num(p, 'fx'), fy = num(p, 'fy'), fz = num(p, 'fz'), dt = num(p, 'detune');
    const ph = num(p, 'phase') * DEG, damp = num(p, 'damping'), T = num(p, 'turns') * TAU;
    const n = Math.min(20000, Math.round(num(p, 'turns') * 80));
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * T;
      const e = Math.exp(-damp * t);
      pts.push([
        (e * (Math.sin(fx * t + ph) + Math.sin((fx + dt) * t))) / 2,
        (e * (Math.sin(fy * t) + Math.sin((fy + dt) * t + ph / 2))) / 2,
        fz ? e * Math.sin(fz * t + ph / 3) * 0.6 : 0,
      ]);
    }
    return { lines: [{ pts, tone: fz ? undefined : 'front' }], nodes: [] };
  },
};

export const flowfield: SourceDef = {
  kind: 'flowfield',
  name: 'Flow field',
  blurb: 'Evenly spaced streamlines following a smooth invisible current',
  params: [
    { key: 'density', label: 'Density', kind: 'range', min: 4, max: 48, step: 1 },
    { key: 'length', label: 'Length', kind: 'range', min: 5, max: 400, step: 1 },
    { key: 'scale', label: 'Scale', kind: 'range', min: 0.2, max: 5, step: 0.05 },
    { key: 'curl', label: 'Curl', kind: 'range', min: 0.2, max: 4, step: 0.05 },
    { key: 'gap', label: 'Min gap', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'mask', label: 'Mask', kind: 'select', options: opts(['square', 'Square'], ['circle', 'Circle']) },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { density: 22, length: 120, scale: 1.4, curl: 1.6, gap: 0.45, mask: 'square', seed: 12 },
  build(p) {
    const N = int(p, 'density'), L = int(p, 'length'), sc = num(p, 'scale'), curl = num(p, 'curl');
    const n = noise3(int(p, 'seed'), 5);
    const circle = str(p, 'mask') === 'circle';
    const cell = 2 / N;
    const sep = cell * num(p, 'gap');
    const step = cell * 0.2;
    const inside = (x: number, y: number) => (circle ? x * x + y * y <= 1 : Math.abs(x) <= 1 && Math.abs(y) <= 1);
    // Spatial hash of points already drawn, to keep lines apart.
    const grid = new Map<string, [number, number][]>();
    const gk = (x: number, y: number) => `${Math.floor(x / Math.max(sep, 1e-3))},${Math.floor(y / Math.max(sep, 1e-3))}`;
    const near = (x: number, y: number) => {
      if (sep <= 0) return false;
      const cx = Math.floor(x / sep), cy = Math.floor(y / sep);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const q of grid.get(`${cx + i},${cy + j}`) ?? []) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < sep * sep) return true;
      return false;
    };
    const angle = (x: number, y: number) => n([x * sc, y * sc, 0]) * Math.PI * curl;
    const lines: Polyline[] = [];
    const rnd = rng(int(p, 'seed') + 1);
    const seeds: [number, number][] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) seeds.push([-1 + cell * (i + 0.5 + (rnd() - 0.5) * 0.6), -1 + cell * (j + 0.5 + (rnd() - 0.5) * 0.6)]);
    for (const [sx, sy] of seeds) {
      if (!inside(sx, sy) || near(sx, sy)) continue;
      const trace = (dir: number) => {
        const out: [number, number][] = [];
        let x = sx, y = sy;
        for (let k = 0; k < L; k++) {
          const a = angle(x, y);
          x += Math.cos(a) * step * dir;
          y += Math.sin(a) * step * dir;
          if (!inside(x, y) || near(x, y)) break;
          out.push([x, y]);
        }
        return out;
      };
      const pts2 = [...trace(-1).reverse(), [sx, sy] as [number, number], ...trace(1)];
      if (pts2.length < 4) continue;
      for (const [x, y] of pts2) {
        const k = gk(x, y);
        const list = grid.get(k);
        if (list) list.push([x, y]);
        else grid.set(k, [[x, y]]);
      }
      lines.push({ pts: pts2.map(([x, y]) => [x, y, 0] as Vec3), tone: 'front', family: lines.length });
    }
    return { lines, nodes: [] };
  },
};

export const contours: SourceDef = {
  kind: 'contours',
  name: 'Contours',
  blurb: 'Isolines of an invented landscape; lift them into stacked terraces',
  params: [
    { key: 'levels', label: 'Levels', kind: 'range', min: 2, max: 40, step: 1 },
    { key: 'scale', label: 'Scale', kind: 'range', min: 0.3, max: 4, step: 0.05 },
    { key: 'island', label: 'Island', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'lift', label: 'Lift', kind: 'range', min: 0, max: 1.5, step: 0.01 },
    { key: 'detail', label: 'Detail', kind: 'range', min: 30, max: 140, step: 1 },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { levels: 14, scale: 1.2, island: 0.6, lift: 0.5, detail: 90, seed: 31 },
  build(p) {
    const n = noise3(int(p, 'seed'), 5);
    const sc = num(p, 'scale'), isl = num(p, 'island'), lift = num(p, 'lift');
    const field = (x: number, y: number) => n([x * sc, y * sc, 0.37]) * (1 - isl) + isl * (n([x * sc, y * sc, 0.37]) * 0.5 + 0.9 - 1.3 * Math.hypot(x, y));
    const L = int(p, 'levels');
    const lines: Polyline[] = [];
    for (let i = 0; i < L; i++) {
      const level = -0.6 + (1.5 * (i + 0.5)) / L;
      for (const chain of isolines(field, level, int(p, 'detail'))) {
        if (chain.length < 3) continue;
        const first = chain[0], last = chain[chain.length - 1];
        const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
        const pts = (closed ? chain.slice(0, -1) : chain).map(([x, y]) => [x, (i / Math.max(1, L - 1) - 0.5) * lift, y] as Vec3);
        lines.push({ pts, closed, tone: 'front', family: i });
      }
    }
    return { lines, nodes: [] };
  },
};

interface LSys {
  axiom: string;
  rules: Record<string, string>;
  angle: number;
  /** Generation shown by default and the most allowed. */
  gen: number;
  max: number;
  branching: boolean;
}

const PLANTS: Record<string, LSys> = {
  fern: { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, gen: 5, max: 6, branching: true },
  bush: { axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22.5, gen: 4, max: 5, branching: true },
  weed: { axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, angle: 25.7, gen: 4, max: 5, branching: true },
  twig: { axiom: 'X', rules: { X: 'F[+X]F[-X]+X', F: 'FF' }, angle: 20, gen: 6, max: 7, branching: true },
};

const CURVES: Record<string, LSys> = {
  hilbert: { axiom: 'A', rules: { A: '+BF-AFA-FB+', B: '-AF+BFB+FA-' }, angle: 90, gen: 5, max: 7, branching: false },
  peano: { axiom: 'X', rules: { X: 'XFYFX+F+YFXFY-F-XFYFX', Y: 'YFXFY-F-XFYFX+F+YFXFY' }, angle: 90, gen: 3, max: 4, branching: false },
  gosper: { axiom: 'A', rules: { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' }, angle: 60, gen: 4, max: 5, branching: false },
  dragon: { axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, gen: 11, max: 14, branching: false },
  snowflake: { axiom: 'F++F++F', rules: { F: 'F-F++F-F' }, angle: 60, gen: 4, max: 6, branching: false },
};

const MAX_SYMBOLS = 400_000;

function expand(sys: LSys, gen: number): string {
  let s = sys.axiom;
  for (let i = 0; i < gen; i++) {
    let next = '';
    for (const ch of s) {
      next += sys.rules[ch] ?? ch;
      if (next.length > MAX_SYMBOLS) return s;
    }
    s = next;
  }
  return s;
}

/**
 * Turtle graphics over an L-system string. F and A/B draw; + and - turn; [ and ]
 * branch. With `spread` the turtle rolls at every branch, growing into 3D.
 */
function turtle(cmds: string, angle: number, spread: number, jitter: number, seed: number) {
  const r = rng(seed);
  type St = { p: Vec3; h: Vec3; l: Vec3; u: Vec3; depth: number };
  const rot = (a: Vec3, axis: Vec3, th: number): Vec3 => {
    const c = Math.cos(th), s = Math.sin(th), d = a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2];
    const x: Vec3 = [axis[1] * a[2] - axis[2] * a[1], axis[2] * a[0] - axis[0] * a[2], axis[0] * a[1] - axis[1] * a[0]];
    return [0, 1, 2].map((i) => a[i] * c + x[i] * s + axis[i] * d * (1 - c)) as Vec3;
  };
  let st: St = { p: [0, 0, 0], h: [0, 1, 0], l: [-1, 0, 0], u: [0, 0, 1], depth: 0 };
  const stack: St[] = [];
  const lines: Polyline[] = [];
  const tips: GeoNode[] = [];
  let cur: Vec3[] | null = null;
  const flush = () => {
    if (cur && cur.length > 1) lines.push({ pts: cur, family: st.depth, tone: 'front' });
    cur = null;
  };
  for (const ch of cmds) {
    switch (ch) {
      case 'F': case 'A': case 'B': {
        if (!cur) cur = [st.p];
        st = { ...st, p: [st.p[0] + st.h[0], st.p[1] + st.h[1], st.p[2] + st.h[2]] };
        cur.push(st.p);
        break;
      }
      case '+': case '-': {
        const a = (ch === '+' ? 1 : -1) * angle * DEG * (1 + (r() - 0.5) * jitter);
        st = { ...st, h: rot(st.h, st.u, a), l: rot(st.l, st.u, a) };
        break;
      }
      case '[':
        stack.push(st);
        if (spread > 0) {
          const a = (r() * 2 - 1) * Math.PI * spread;
          st = { ...st, l: rot(st.l, st.h, a), u: rot(st.u, st.h, a) };
        }
        st = { ...st, depth: st.depth + 1 };
        break;
      case ']':
        if (cur) tips.push({ p: cur[cur.length - 1], tone: 'front', family: st.depth });
        flush();
        st = stack.pop() ?? st;
        break;
    }
  }
  flush();
  return { lines, tips };
}

export const plant: SourceDef = {
  kind: 'plant',
  name: 'Plant',
  blurb: 'Branching growth from simple rewriting rules; roll the branches to grow it in 3D',
  params: [
    { key: 'species', label: 'Species', kind: 'select', options: opts(['fern', 'Fern'], ['bush', 'Bush'], ['weed', 'Weed'], ['twig', 'Twig']) },
    { key: 'generation', label: 'Growth', kind: 'range', min: 1, max: 7, step: 1 },
    { key: 'angle', label: 'Branch angle', kind: 'range', min: 5, max: 60, step: 0.5, unit: '°' },
    { key: 'spread', label: '3D spread', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'jitter', label: 'Wildness', kind: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { species: 'fern', generation: 5, angle: 25, spread: 0, jitter: 0.25, seed: 7 },
  build(p) {
    const sys = PLANTS[str(p, 'species')] ?? PLANTS.fern;
    const gen = Math.min(sys.max, int(p, 'generation'));
    const { lines, tips } = turtle(expand(sys, gen), num(p, 'angle'), num(p, 'spread'), num(p, 'jitter'), int(p, 'seed'));
    fit(lines, tips);
    return { lines, nodes: tips };
  },
};

export const spacefill: SourceDef = {
  kind: 'spacefill',
  name: 'Space-filling',
  blurb: 'One unbroken line that folds to fill an area: Hilbert, Peano, Gosper, dragon, snowflake',
  params: [
    { key: 'curve', label: 'Curve', kind: 'select', options: opts(['hilbert', 'Hilbert'], ['peano', 'Peano'], ['gosper', 'Gosper'], ['dragon', 'Dragon'], ['snowflake', 'Snowflake']) },
    { key: 'order', label: 'Order', kind: 'range', min: 1, max: 14, step: 1 },
  ],
  defaults: { curve: 'hilbert', order: 5 },
  build(p) {
    const sys = CURVES[str(p, 'curve')] ?? CURVES.hilbert;
    const gen = Math.min(sys.max, int(p, 'order'));
    const { lines } = turtle(expand(sys, gen), sys.angle, 0, 0, 1);
    // A single unbranched path: join the pieces into one line.
    const pts = lines.flatMap((l, i) => (i ? l.pts.slice(1) : l.pts));
    const out: Polyline[] = [{ pts, tone: 'front', closed: str(p, 'curve') === 'snowflake' }];
    fit(out);
    return { lines: out, nodes: [] };
  },
};

/** Gielis' superformula radius. */
function superR(phi: number, m: number, n1: number, n2: number, n3: number): number {
  const t = (m * phi) / 4;
  const r = Math.pow(Math.pow(Math.abs(Math.cos(t)), n2) + Math.pow(Math.abs(Math.sin(t)), n3), -1 / n1);
  return Number.isFinite(r) ? r : 0;
}

export const superformula: SourceDef = {
  kind: 'superformula',
  name: 'Superformula',
  blurb: 'One equation for petals, stars, shells and cells, in 2D or as a solid',
  params: [
    { key: 'mode', label: 'Form', kind: 'select', options: opts(['flat', 'Outline'], ['solid', 'Solid']) },
    { key: 'm', label: 'Symmetry', kind: 'range', min: 0, max: 20, step: 0.5 },
    { key: 'm2', label: 'Symmetry (vertical)', kind: 'range', min: 0, max: 20, step: 0.5, when: { key: 'mode', in: ['solid'] } },
    { key: 'n1', label: 'Pinch', kind: 'range', min: 0.1, max: 20, step: 0.05 },
    { key: 'n2', label: 'Shape A', kind: 'range', min: 0.1, max: 20, step: 0.05 },
    { key: 'n3', label: 'Shape B', kind: 'range', min: 0.1, max: 20, step: 0.05 },
    { key: 'echoes', label: 'Echoes', kind: 'range', min: 1, max: 24, step: 1, when: { key: 'mode', in: ['flat'] } },
    { key: 'spacing', label: 'Echo spacing', kind: 'range', min: 0.01, max: 0.2, step: 0.005, when: { key: 'mode', in: ['flat'] } },
    { key: 'lines', label: 'Lines', kind: 'range', min: 4, max: 48, step: 1, when: { key: 'mode', in: ['solid'] } },
  ],
  defaults: { mode: 'flat', m: 6, m2: 4, n1: 0.6, n2: 1.2, n3: 1.2, echoes: 6, spacing: 0.08, lines: 18 },
  build(p) {
    const m = num(p, 'm'), n1 = num(p, 'n1'), n2 = num(p, 'n2'), n3 = num(p, 'n3');
    if (str(p, 'mode') === 'solid') {
      const m2 = num(p, 'm2');
      const f = (u: number, v: number): Vec3 => {
        const th = -Math.PI + u * TAU, ph = -Math.PI / 2 + v * Math.PI;
        const r1 = superR(th, m, n1, n2, n3), r2 = superR(ph, m2, n1, n2, n3);
        return [r1 * Math.cos(th) * r2 * Math.cos(ph), r2 * Math.sin(ph), r1 * Math.sin(th) * r2 * Math.cos(ph)];
      };
      const L = int(p, 'lines');
      const g = surface(f, { uLines: L + 2, vLines: L, uClosed: true, samples: 160, vSamples: 90, flip: true });
      g.lines = g.lines.filter((_, i) => i !== 0 && i !== L + 1);
      fit(g.lines, g.nodes);
      return g;
    }
    const N = 720;
    const base: Vec3[] = [];
    for (let i = 0; i < N; i++) {
      const phi = (TAU * i) / N;
      const r = superR(phi, m, n1, n2, n3);
      base.push([r * Math.cos(phi), r * Math.sin(phi), 0]);
    }
    const lines: Polyline[] = [];
    const echoes = int(p, 'echoes');
    for (let e = 0; e < echoes; e++) {
      const k = Math.max(0.02, 1 - e * num(p, 'spacing'));
      lines.push({ pts: base.map(([x, y]) => [x * k, y * k, 0] as Vec3), closed: true, tone: 'front', family: e });
    }
    fit(lines);
    return { lines, nodes: [] };
  },
};

