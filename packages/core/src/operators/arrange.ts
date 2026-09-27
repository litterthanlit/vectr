import { arcLengths, sampleLine } from '../geo.js';
import { apply, bool, int, num, rng, rotationMatrix, str } from '../math.js';
import type { GeoNode, Geometry, OpDef, Polyline, Vec3 } from '../types.js';

export const repeat: OpDef = {
  kind: 'repeat',
  name: 'Repeat',
  blurb: 'Array copies in a row, a ring or a grid, growing or turning as they go',
  params: [
    { key: 'layout', label: 'Layout', kind: 'select', options: [{ value: 'linear', label: 'Row' }, { value: 'radial', label: 'Ring' }, { value: 'grid', label: 'Grid' }] },
    { key: 'count', label: 'Copies', kind: 'range', min: 1, max: 64, step: 1 },
    { key: 'dx', label: 'Step X', kind: 'range', min: -2, max: 2, step: 0.01, when: { key: 'layout', in: ['linear'] } },
    { key: 'dy', label: 'Step Y', kind: 'range', min: -2, max: 2, step: 0.01, when: { key: 'layout', in: ['linear'] } },
    { key: 'dz', label: 'Step depth', kind: 'range', min: -2, max: 2, step: 0.01, when: { key: 'layout', in: ['linear'] } },
    { key: 'axis', label: 'Axis', kind: 'select', options: [{ value: 'z', label: 'Facing (Z)' }, { value: 'y', label: 'Vertical (Y)' }, { value: 'x', label: 'Horizontal (X)' }], when: { key: 'layout', in: ['radial'] } },
    { key: 'radius', label: 'Radius', kind: 'range', min: 0, max: 3, step: 0.01, when: { key: 'layout', in: ['radial'] } },
    { key: 'arc', label: 'Arc', kind: 'range', min: 10, max: 360, step: 1, unit: '°', when: { key: 'layout', in: ['radial'] } },
    { key: 'columns', label: 'Columns', kind: 'range', min: 1, max: 16, step: 1, when: { key: 'layout', in: ['grid'] } },
    { key: 'gap', label: 'Spacing', kind: 'range', min: 0.1, max: 4, step: 0.01, when: { key: 'layout', in: ['grid'] } },
    { key: 'grow', label: 'Grow per copy', kind: 'range', min: -0.3, max: 0.5, step: 0.005 },
    { key: 'turn', label: 'Turn per copy', kind: 'range', min: -90, max: 90, step: 0.5, unit: '°' },
    { key: 'alternate', label: 'Hide every other', kind: 'toggle' },
    { key: 'center', label: 'Centre the array', kind: 'toggle' },
  ],
  defaults: {
    layout: 'linear', count: 6, dx: 0, dy: 0, dz: 0.25, axis: 'z', radius: 0, arc: 360, columns: 3, gap: 2.2,
    grow: 0, turn: 0, alternate: false, center: true,
  },
  apply(g, p) {
    const n = int(p, 'count'), layout = str(p, 'layout');
    const grow = num(p, 'grow'), turn = num(p, 'turn');
    const cols = Math.max(1, int(p, 'columns')), rowsN = Math.ceil(n / cols), gap = num(p, 'gap');
    const arc = num(p, 'arc'), R = num(p, 'radius'), axis = str(p, 'axis');
    const step: Vec3 = [num(p, 'dx'), num(p, 'dy'), num(p, 'dz')];
    const center = bool(p, 'center');

    const xforms = Array.from({ length: n }, (_, i) => {
      const k = Math.max(0.02, 1 + i * grow);
      const own = rotationMatrix(0, 0, turn * i);
      let offset: Vec3 = [0, 0, 0];
      let place = rotationMatrix(0, 0, 0);
      if (layout === 'linear') {
        const c = center ? (n - 1) / 2 : 0;
        offset = [step[0] * (i - c), step[1] * (i - c), step[2] * (i - c)];
      } else if (layout === 'grid') {
        const cx = center ? (cols - 1) / 2 : 0, cy = center ? (rowsN - 1) / 2 : 0;
        offset = [((i % cols) - cx) * gap, -(Math.floor(i / cols) - cy) * gap, 0];
      } else {
        const a = arc >= 360 ? (360 * i) / n : n > 1 ? (arc * i) / (n - 1) - (center ? arc / 2 : 0) : 0;
        place = axis === 'y' ? rotationMatrix(0, a, 0) : axis === 'x' ? rotationMatrix(a, 0, 0) : rotationMatrix(0, 0, a);
      }
      const radial: Vec3 = layout === 'radial' ? (axis === 'x' ? [0, R, 0] : [R, 0, 0]) : [0, 0, 0];
      return {
        p: (q: Vec3): Vec3 => {
          const r = apply(own, [q[0] * k, q[1] * k, q[2] * k]);
          const m = apply(place, [r[0] + radial[0], r[1] + radial[1], r[2] + radial[2]]);
          return [m[0] + offset[0], m[1] + offset[1], m[2] + offset[2]];
        },
        n: (v: Vec3): Vec3 => apply(place, apply(own, v)),
      };
    });

    const lines: Polyline[] = [];
    g.lines.forEach((line) => {
      xforms.forEach((x, i) =>
        lines.push({
          ...line,
          pts: line.pts.map(x.p),
          normals: line.normals?.map(x.n),
          family: i,
          tone: bool(p, 'alternate') && i % 2 ? 'back' : line.tone,
        }),
      );
    });
    const nodes: GeoNode[] = [];
    for (const node of g.nodes) xforms.forEach((x, i) => nodes.push({ ...node, p: x.p(node.p), n: node.n && x.n(node.n), family: i }));
    return { lines, nodes, labels: g.labels };
  },
};

export const mirror: OpDef = {
  kind: 'mirror',
  name: 'Mirror',
  blurb: 'Reflect everything across one or more axes',
  params: [
    { key: 'x', label: 'Left ↔ right', kind: 'toggle' },
    { key: 'y', label: 'Top ↔ bottom', kind: 'toggle' },
    { key: 'z', label: 'Front ↔ back', kind: 'toggle' },
  ],
  defaults: { x: true, y: false, z: false },
  apply(g, p) {
    let out: Geometry = g;
    (['x', 'y', 'z'] as const).forEach((axis, k) => {
      if (!bool(p, axis)) return;
      const flip = (v: Vec3): Vec3 => {
        const r: Vec3 = [v[0], v[1], v[2]];
        r[k] = -r[k];
        return r;
      };
      out = {
        lines: [...out.lines, ...out.lines.map((l) => ({ ...l, pts: l.pts.map(flip), normals: l.normals?.map(flip) }))],
        nodes: [...out.nodes, ...out.nodes.map((nd) => ({ ...nd, p: flip(nd.p), n: nd.n && flip(nd.n) }))],
        labels: out.labels,
      };
    });
    return out;
  },
};

export const scatter: OpDef = {
  kind: 'scatter',
  name: 'Scatter',
  blurb: 'Drop points along the lines — for markers, connecting or tiling',
  params: [
    { key: 'count', label: 'Points', kind: 'range', min: 1, max: 600, step: 1 },
    { key: 'spacing', label: 'Spacing', kind: 'select', options: [{ value: 'even', label: 'Even' }, { value: 'random', label: 'Random' }] },
    { key: 'keepLines', label: 'Keep lines', kind: 'toggle' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { count: 48, spacing: 'even', keepLines: true, seed: 3 },
  apply(g, p) {
    const count = int(p, 'count');
    const r = rng(int(p, 'seed'));
    const lens = g.lines.map((l) => arcLengths(l.pts, l.closed));
    const totals = lens.map((l) => l[l.length - 1]);
    const total = totals.reduce((a, b) => a + b, 0);
    const nodes: GeoNode[] = [...g.nodes];
    if (total > 0) {
      for (let i = 0; i < count; i++) {
        let d = (str(p, 'spacing') === 'random' ? r() : (i + 0.5) / count) * total;
        let li = 0;
        while (li < totals.length - 1 && d > totals[li]) d -= totals[li++];
        const s = sampleLine(g.lines[li], totals[li] ? d / totals[li] : 0, lens[li]);
        nodes.push({ p: s.p, n: s.n, t: s.t, family: g.lines[li].family });
      }
    }
    return { lines: bool(p, 'keepLines') ? g.lines : [], nodes, labels: g.labels };
  },
};
