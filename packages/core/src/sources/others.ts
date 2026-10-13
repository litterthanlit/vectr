import { TAU, int, num, rng, str } from '../math.js';
import type { GeoNode, Polyline, SourceDef, Vec3 } from '../types.js';

export const lattice: SourceDef = {
  kind: 'lattice',
  name: 'Lattice',
  blurb: 'A grid of points and lines — terrain, fields, tile boards',
  params: [
    { key: 'cols', label: 'Columns', kind: 'range', min: 2, max: 60, step: 1 },
    { key: 'rows', label: 'Rows', kind: 'range', min: 2, max: 60, step: 1 },
    { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.25, max: 4, step: 0.01 },
    { key: 'layout', label: 'Layout', kind: 'select', options: [{ value: 'square', label: 'Square' }, { value: 'hex', label: 'Hex' }] },
    {
      key: 'draw', label: 'Draw', kind: 'select',
      options: [{ value: 'both', label: 'Rows + columns' }, { value: 'rows', label: 'Rows' }, { value: 'cols', label: 'Columns' }, { value: 'points', label: 'Points only' }],
    },
    { key: 'mask', label: 'Mask', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: 'circle', label: 'Circle' }, { value: 'diamond', label: 'Diamond' }] },
  ],
  defaults: { cols: 16, rows: 12, aspect: 1.33, layout: 'square', draw: 'both', mask: 'none' },
  build(p) {
    const cols = int(p, 'cols'), rows = int(p, 'rows');
    const ax = Math.sqrt(num(p, 'aspect')), ay = 1 / ax;
    const hex = str(p, 'layout') === 'hex';
    const mask = str(p, 'mask');
    const draw = str(p, 'draw');
    const at = (i: number, j: number): Vec3 => {
      const u = cols > 1 ? i / (cols - 1) : 0.5, v = rows > 1 ? j / (rows - 1) : 0.5;
      const shift = hex && j % 2 ? 0.5 / Math.max(1, cols - 1) : 0;
      return [(-1 + 2 * (u + shift)) * ax, (-1 + 2 * v) * ay, 0];
    };
    const inside = ([x, y]: Vec3) =>
      mask === 'circle' ? Math.hypot(x / ax, y / ay) <= 1.0001 : mask === 'diamond' ? Math.abs(x / ax) + Math.abs(y / ay) <= 1.0001 : true;

    const nodes: GeoNode[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const q = at(i, j);
        if (inside(q)) nodes.push({ p: q, t: (j * cols + i) / Math.max(1, cols * rows - 1), family: j });
      }

    const lines: Polyline[] = [];
    // Split a row/column into runs that stay inside the mask.
    const pushRuns = (pts: Vec3[], family: number, band: number) => {
      let run: Vec3[] = [];
      const flush = () => {
        if (run.length > 1) lines.push({ pts: run, t: run.map((_, k) => k / (run.length - 1)), family, band });
        run = [];
      };
      for (const q of pts) (inside(q) ? run.push(q) : flush());
      flush();
    };
    const SUB = 4; // subdivisions per cell so later warps bend smoothly
    if (draw === 'both' || draw === 'rows') {
      for (let j = 0; j < rows; j++) {
        const pts: Vec3[] = [];
        for (let s = 0; s <= (cols - 1) * SUB; s++) pts.push(at(s / SUB, j));
        pushRuns(pts, j, 0);
      }
    }
    if (draw === 'both' || draw === 'cols') {
      for (let i = 0; i < cols; i++) {
        const pts: Vec3[] = [];
        for (let s = 0; s <= (rows - 1) * SUB; s++) pts.push(at(i, s / SUB));
        pushRuns(pts, i, 1);
      }
    }
    return { lines, nodes };
  },
};

export const points: SourceDef = {
  kind: 'points',
  name: 'Points',
  blurb: 'A seeded cloud of points — connect them, tile them, mark them',
  params: [
    { key: 'count', label: 'Count', kind: 'range', min: 3, max: 800, step: 1 },
    {
      key: 'spread', label: 'Spread', kind: 'select',
      options: [
        { value: 'disc', label: 'Disc' }, { value: 'ring', label: 'Ring' }, { value: 'box', label: 'Box' },
        { value: 'shell', label: 'Sphere shell' }, { value: 'ball', label: 'Ball' }, { value: 'phyllotaxis', label: 'Sunflower' },
      ],
    },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { count: 90, spread: 'shell', seed: 5 },
  build(p) {
    const n = int(p, 'count');
    const r = rng(int(p, 'seed'));
    const spread = str(p, 'spread');
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nodes: GeoNode[] = [];
    for (let i = 0; i < n; i++) {
      let q: Vec3;
      let nrm: Vec3 | undefined;
      switch (spread) {
        case 'disc': { const a = r() * TAU, rad = Math.sqrt(r()); q = [rad * Math.cos(a), rad * Math.sin(a), 0]; break; }
        case 'ring': { const a = r() * TAU, rad = 0.75 + r() * 0.25; q = [rad * Math.cos(a), rad * Math.sin(a), 0]; break; }
        case 'box': q = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; break;
        case 'ball': {
          const u = r() * 2 - 1, a = r() * TAU, rad = Math.cbrt(r()), s = Math.sqrt(1 - u * u);
          q = [rad * s * Math.cos(a), rad * u, rad * s * Math.sin(a)];
          break;
        }
        case 'phyllotaxis': { const rad = Math.sqrt((i + 0.5) / n), a = i * golden; q = [rad * Math.cos(a), rad * Math.sin(a), 0]; break; }
        default: {
          // Evenly spread on a sphere (Fibonacci), lightly jittered by the seed.
          const y = 1 - (2 * (i + 0.5)) / n, s = Math.sqrt(1 - y * y), a = i * golden + r() * 0.3;
          q = [s * Math.cos(a), y, s * Math.sin(a)];
          nrm = q;
        }
      }
      nodes.push({ p: q, n: nrm, t: n > 1 ? i / (n - 1) : 0, family: 0 });
    }
    return { lines: [], nodes };
  },
};

export const note: SourceDef = {
  kind: 'note',
  name: 'Note',
  blurb: 'An annotation: a dot, a leader line and your label',
  params: [
    { key: 'text', label: 'Text', kind: 'text', placeholder: 'Label' },
    { key: 'angle', label: 'Leader angle', kind: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'length', label: 'Leader length', kind: 'range', min: 0, max: 3, step: 0.01 },
    { key: 'elbow', label: 'Elbow', kind: 'range', min: 0, max: 2, step: 0.01, help: 'Horizontal run after the leader' },
  ],
  defaults: { text: '', angle: 35, length: 0.8, elbow: 0.4 },
  build(p) {
    const a = (num(p, 'angle') * Math.PI) / 180, len = num(p, 'length'), elbow = num(p, 'elbow');
    const mid: Vec3 = [Math.cos(a) * len, Math.sin(a) * len, 0];
    const dir = Math.cos(a) >= 0 ? 1 : -1;
    const end: Vec3 = [mid[0] + dir * elbow, mid[1], 0];
    const pts: Vec3[] = [[0, 0, 0], mid, end];
    const text = str(p, 'text');
    return {
      lines: len + elbow > 0 ? [{ pts, t: [0, 0.5, 1], tone: 'front', family: 0 }] : [],
      nodes: [{ p: [0, 0, 0], t: 0, family: 0 }],
      labels: text ? [{ p: [end[0] + dir * 0.06, end[1] + 0.03, 0], text, anchor: dir > 0 ? 'start' : 'end' }] : [],
    };
  },
};
