import { arcLengths, emptyGeo, sampleLine } from '../geo.js';
import { TAU, int, lerp, num, str } from '../math.js';
import type { GeoNode, Geometry, OpDef, Polyline, Vec3 } from '../types.js';

/** Unit 2D normal of the profile at u, as (radial, vertical). Profiles drawn bottom→top / CCW face outward. */
function profileNormal(line: Polyline, u: number, lens: number[]): [number, number] {
  const e = 0.002;
  const a = sampleLine(line, line.closed ? (u - e + 1) % 1 : Math.max(0, u - e), lens).p;
  const b = sampleLine(line, line.closed ? (u + e) % 1 : Math.min(1, u + e), lens).p;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

export const revolve: OpDef = {
  kind: 'revolve',
  name: 'Revolve',
  blurb: 'Spin each line around the vertical axis into a surface',
  params: [
    { key: 'rings', label: 'Rings', kind: 'range', min: 0, max: 64, step: 1 },
    { key: 'spokes', label: 'Spokes', kind: 'range', min: 0, max: 96, step: 1 },
    { key: 'sweep', label: 'Sweep', kind: 'range', min: 10, max: 360, step: 1, unit: '°' },
    { key: 'offset', label: 'Axis offset', kind: 'range', min: -1, max: 2, step: 0.01, help: 'Moves the line away from the axis — a circle becomes a torus' },
    { key: 'twist', label: 'Twist', kind: 'range', min: -3, max: 3, step: 0.05, help: 'Spokes corkscrew around the axis' },
  ],
  defaults: { rings: 9, spokes: 16, sweep: 360, offset: 0, twist: 0 },
  apply(g, p) {
    const rings = int(p, 'rings'), spokes = int(p, 'spokes');
    const sweep = (num(p, 'sweep') * Math.PI) / 180, full = num(p, 'sweep') >= 360;
    const off = num(p, 'offset'), twist = num(p, 'twist') * TAU;
    const out: Geometry = emptyGeo();
    const place = (x: number, y: number, a: number): Vec3 => [(x + off) * Math.cos(a), y, (x + off) * Math.sin(a)];
    const nrm = (nx: number, ny: number, a: number): Vec3 => [nx * Math.cos(a), ny, nx * Math.sin(a)];
    const angleOf = (k: number, count: number) => (full ? (sweep * k) / count : count > 1 ? (sweep * k) / (count - 1) : 0);

    for (const line of g.lines) {
      const lens = arcLengths(line.pts, line.closed);
      // Spokes: the profile copied around the axis.
      const M = Math.max(48, line.pts.length);
      const samples = Array.from({ length: M + (line.closed ? 1 : 0) }, (_, i) => {
        const u = line.closed ? i / M : i / (M - 1);
        return { ...sampleLine(line, u, lens), u, n2: profileNormal(line, line.closed ? u % 1 : u, lens) };
      });
      for (let k = 0; k < spokes; k++) {
        const a0 = angleOf(k, spokes);
        out.lines.push({
          pts: samples.map((s) => place(s.p[0], s.p[1], a0 + twist * s.u)),
          normals: samples.map((s) => nrm(s.n2[0], s.n2[1], a0 + twist * s.u)),
          t: samples.map((s) => s.t),
          family: k,
          band: 1,
        });
      }
      // Rings: circles through evenly spaced points of the profile.
      for (let j = 0; j < rings; j++) {
        const u = line.closed ? j / rings : rings === 1 ? 0.5 : j / (rings - 1);
        const s = sampleLine(line, u, lens);
        if (Math.abs(s.p[0] + off) < 1e-3) continue;
        const n2 = profileNormal(line, u, lens);
        const count = Math.max(24, Math.round((128 * num(p, 'sweep')) / 360));
        const steps = full ? count : count + 1;
        const pts: Vec3[] = [], normals: Vec3[] = [];
        for (let i = 0; i < steps; i++) {
          const a = (sweep * i) / count + twist * u;
          pts.push(place(s.p[0], s.p[1], a));
          normals.push(nrm(n2[0], n2[1], a));
        }
        out.lines.push({ pts, normals, closed: full, t: pts.map(() => s.t), family: j });
        for (let k = 0; k < spokes; k++) {
          const a = angleOf(k, spokes) + twist * u;
          out.nodes.push({ p: place(s.p[0], s.p[1], a), n: nrm(n2[0], n2[1], a), t: s.t, family: j });
        }
      }
    }
    return out;
  },
};

export const sweep: OpDef = {
  kind: 'sweep',
  name: 'Sweep',
  blurb: 'Copy lines along a path — straight, helical or in orbit — with rails between them',
  params: [
    { key: 'path', label: 'Path', kind: 'select', options: [{ value: 'straight', label: 'Straight' }, { value: 'helix', label: 'Helix' }, { value: 'orbit', label: 'Orbit' }] },
    { key: 'copies', label: 'Copies', kind: 'range', min: 2, max: 120, step: 1 },
    { key: 'length', label: 'Length', kind: 'range', min: 0, max: 4, step: 0.01, when: { key: 'path', in: ['straight', 'helix'] } },
    { key: 'turns', label: 'Turns', kind: 'range', min: 0.25, max: 8, step: 0.25, when: { key: 'path', in: ['helix'] } },
    { key: 'radius', label: 'Radius', kind: 'range', min: 0, max: 2, step: 0.01, when: { key: 'path', in: ['helix', 'orbit'] } },
    { key: 'twist', label: 'Twist', kind: 'range', min: -720, max: 720, step: 1, unit: '°' },
    { key: 'taper', label: 'End scale', kind: 'range', min: 0, max: 3, step: 0.01 },
    { key: 'rails', label: 'Rails', kind: 'range', min: 0, max: 64, step: 1, help: 'Lines running through every copy' },
  ],
  defaults: { path: 'straight', copies: 16, length: 1.6, turns: 2, radius: 0.8, twist: 0, taper: 1, rails: 0 },
  apply(g, p) {
    const n = int(p, 'copies'), L = num(p, 'length'), path = str(p, 'path');
    const twist = (num(p, 'twist') * Math.PI) / 180, taper = num(p, 'taper');
    const turns = num(p, 'turns'), R = num(p, 'radius');
    const place = (q: Vec3, i: number): Vec3 => {
      const s = path === 'orbit' ? i / n : n > 1 ? i / (n - 1) : 0;
      const k = lerp(1, taper, s), tw = twist * s;
      let x = q[0] * k, y = q[1] * k;
      const z = q[2] * k;
      [x, y] = [x * Math.cos(tw) - y * Math.sin(tw), x * Math.sin(tw) + y * Math.cos(tw)];
      if (path === 'straight') return [x, y, z - L / 2 + L * s];
      const a = path === 'helix' ? TAU * turns * s : TAU * s;
      const px = path === 'orbit' ? x + R : x;
      const py = path === 'helix' ? y + L / 2 - L * s : y;
      const cx = path === 'helix' ? R : 0;
      // Rotate the copy around the vertical axis so it follows the path.
      return [(px + cx) * Math.cos(a) - z * Math.sin(a), py, (px + cx) * Math.sin(a) + z * Math.cos(a)];
    };
    const out: Geometry = emptyGeo();
    g.lines.forEach((line, li) => {
      for (let i = 0; i < n; i++) {
        out.lines.push({ ...line, pts: line.pts.map((q) => place(q, i)), normals: undefined, family: i, band: li });
      }
      const rails = int(p, 'rails');
      const lens = arcLengths(line.pts, line.closed);
      for (let r = 0; r < rails; r++) {
        const s = sampleLine(line, line.closed ? r / rails : rails > 1 ? r / (rails - 1) : 0.5, lens);
        const idx = Array.from({ length: path === 'orbit' ? n + 1 : n }, (_, i) => i);
        out.lines.push({ pts: idx.map((i) => place(s.p, i % n)), t: idx.map(() => s.t), family: r, band: 1000 + li });
      }
    });
    for (const node of g.nodes) for (let i = 0; i < n; i++) out.nodes.push({ ...node, p: place(node.p, i), n: undefined, family: i } as GeoNode);
    out.labels = g.labels;
    return out;
  },
};
