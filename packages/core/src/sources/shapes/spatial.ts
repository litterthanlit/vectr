import { TAU, basis, bool, circle, clamp, int, lerp, norm, num, rng, str } from '../../math.js';
import type { GeoLabel, GeoNode, SourceDef, Polyline, Vec3 } from '../../types.js';

const onSphere = (pts: Vec3[]): Polyline => ({ pts, normals: pts.map((p) => norm(p)), closed: true });

export const globe: SourceDef = {
  kind: 'globe',
  name: 'Globe',
  blurb: 'Latitude / longitude wireframe with orbiting rings',
  params: [
    { key: 'meridians', label: 'Meridians', kind: 'range', min: 0, max: 24, step: 1 },
    { key: 'parallels', label: 'Parallels', kind: 'range', min: 0, max: 24, step: 1 },
    { key: 'rings', label: 'Rings', kind: 'range', min: 0, max: 8, step: 1 },
    { key: 'ringSize', label: 'Ring size', kind: 'range', min: 0.1, max: 0.9, step: 0.01 },
    { key: 'nodeGrid', label: 'Nodes at crossings', kind: 'toggle' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { meridians: 6, parallels: 7, rings: 2, ringSize: 0.45, nodeGrid: false, seed: 7 },
  build(p) {
    const m = int(p, 'meridians');
    const k = int(p, 'parallels');
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    for (let i = 0; i < m; i++) {
      const phi = (Math.PI * i) / m;
      lines.push(onSphere(circle([0, 0, 0], [0, 1, 0], [Math.cos(phi), 0, Math.sin(phi)], 1, 128)));
    }
    for (let j = 1; j <= k; j++) {
      const th = (Math.PI * j) / (k + 1);
      lines.push(onSphere(circle([0, Math.cos(th), 0], [1, 0, 0], [0, 0, 1], Math.sin(th), 128)));
      if (bool(p, 'nodeGrid')) {
        for (let i = 0; i < m * 2; i++) {
          const phi = (Math.PI * i) / m;
          const q: Vec3 = [Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)];
          nodes.push({ p: q, n: q });
        }
      }
    }
    const r = rng(int(p, 'seed'));
    for (let i = 0; i < int(p, 'rings'); i++) {
      const c = norm([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
      const a = num(p, 'ringSize') * (0.6 + r() * 0.4) * (Math.PI / 2);
      const [u, v] = basis(c);
      const pts = circle(
        [c[0] * Math.cos(a), c[1] * Math.cos(a), c[2] * Math.cos(a)],
        u, v, Math.sin(a), 96,
      );
      lines.push(onSphere(pts));
    }
    return { lines, nodes };
  },
};

type Profile = (h: number, p: { top: number; bottom: number; curve: number }) => number;
const profiles: Record<string, Profile> = {
  trumpet: (h, { top, bottom, curve }) => bottom + (top - bottom) * Math.pow(h, curve),
  cone: (h, { top, bottom }) => lerp(bottom, top, h),
  hourglass: (h, { top, bottom, curve }) => bottom + (top - bottom) * Math.pow(Math.abs(2 * h - 1), curve),
  vase: (h, { top, bottom, curve }) => lerp(bottom, top, h) + 0.35 * Math.sin(Math.PI * Math.pow(h, 1 / curve)),
  bowl: (h, { top, bottom, curve }) => bottom + (top - bottom) * Math.pow(Math.sin((h * Math.PI) / 2), 1 / curve),
  bulb: (h, { top, bottom }) => lerp(bottom, top, h) + 0.6 * Math.sin(Math.PI * h) * (1 - h * 0.4),
};

export const funnel: SourceDef = {
  kind: 'funnel',
  name: 'Funnel',
  blurb: 'Surface of revolution — trumpets, vases, hourglasses',
  params: [
    {
      key: 'profile', label: 'Profile', kind: 'select',
      options: Object.keys(profiles).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
    },
    { key: 'rings', label: 'Rings', kind: 'range', min: 2, max: 16, step: 1 },
    { key: 'spokes', label: 'Spokes', kind: 'range', min: 3, max: 36, step: 1 },
    { key: 'top', label: 'Top radius', kind: 'range', min: 0.05, max: 1, step: 0.01 },
    { key: 'bottom', label: 'Bottom radius', kind: 'range', min: 0.05, max: 1, step: 0.01 },
    { key: 'height', label: 'Height', kind: 'range', min: 0.4, max: 2, step: 0.01 },
    { key: 'curve', label: 'Curvature', kind: 'range', min: 0.3, max: 5, step: 0.05 },
    { key: 'whiskers', label: 'Whiskers', kind: 'range', min: 0, max: 0.8, step: 0.01 },
  ],
  defaults: { profile: 'trumpet', rings: 4, spokes: 12, top: 0.95, bottom: 0.2, height: 1.5, curve: 2.4, whiskers: 0.35 },
  build(p) {
    const f = profiles[str(p, 'profile')] ?? profiles.trumpet;
    const cfg = { top: num(p, 'top'), bottom: num(p, 'bottom'), curve: num(p, 'curve') };
    const H = num(p, 'height');
    const R = (h: number) => Math.max(0.001, f(clamp(h, 0, 1), cfg));
    const dR = (h: number) => (R(h + 0.001) - R(h - 0.001)) / 0.002 / H;
    const at = (a: number, h: number): Vec3 => [R(h) * Math.cos(a), (h - 0.5) * H, R(h) * Math.sin(a)];
    const nrm = (a: number, h: number): Vec3 => norm([Math.cos(a), -dR(h), Math.sin(a)]);

    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const rings = int(p, 'rings');
    const spokes = int(p, 'spokes');
    for (let j = 0; j < rings; j++) {
      const h = j / (rings - 1);
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let i = 0; i < 128; i++) {
        const a = (TAU * i) / 128;
        pts.push(at(a, h));
        ns.push(nrm(a, h));
      }
      lines.push({ pts, normals: ns, closed: true });
    }
    const whisk = num(p, 'whiskers');
    for (let i = 0; i < spokes; i++) {
      const a = (TAU * i) / spokes;
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let s = 0; s <= 48; s++) {
        pts.push(at(a, s / 48));
        ns.push(nrm(a, s / 48));
      }
      lines.push({ pts, normals: ns });
      for (let j = 0; j < rings; j++) nodes.push({ p: at(a, j / (rings - 1)), n: nrm(a, j / (rings - 1)) });
      if (whisk > 0) {
        const top = at(a, 1);
        const d = norm([dR(1) * H * Math.cos(a), H, dR(1) * H * Math.sin(a)]);
        const end: Vec3 = [top[0] + d[0] * whisk, top[1] + d[1] * whisk, top[2] + d[2] * whisk];
        const bend: Vec3 = [end[0] + Math.cos(a) * whisk * 0.25, end[1], end[2] + Math.sin(a) * whisk * 0.25];
        const wp: Vec3[] = [];
        for (let s = 0; s <= 12; s++) {
          const t = s / 12;
          wp.push([
            (1 - t) * (1 - t) * top[0] + 2 * (1 - t) * t * end[0] + t * t * bend[0],
            (1 - t) * (1 - t) * top[1] + 2 * (1 - t) * t * end[1] + t * t * bend[1],
            (1 - t) * (1 - t) * top[2] + 2 * (1 - t) * t * end[2] + t * t * bend[2],
          ]);
        }
        lines.push({ pts: wp, normals: wp.map(() => nrm(a, 1)) });
        nodes.push({ p: bend, n: nrm(a, 1) });
      }
    }
    return { lines, nodes };
  },
};

export const vortex: SourceDef = {
  kind: 'vortex',
  name: 'Vortex',
  blurb: 'Tapering helix strands, like a tornado or a spring',
  params: [
    { key: 'turns', label: 'Turns', kind: 'range', min: 0.5, max: 10, step: 0.25 },
    { key: 'strands', label: 'Strands', kind: 'range', min: 1, max: 6, step: 1 },
    { key: 'top', label: 'Top radius', kind: 'range', min: 0, max: 1.2, step: 0.01 },
    { key: 'bottom', label: 'Bottom radius', kind: 'range', min: 0, max: 1.2, step: 0.01 },
    { key: 'height', label: 'Height', kind: 'range', min: 0, max: 2, step: 0.01 },
    { key: 'curve', label: 'Taper curve', kind: 'range', min: 0.3, max: 3, step: 0.05 },
    { key: 'loops', label: 'Level loops', kind: 'toggle' },
    { key: 'rungs', label: 'Rungs', kind: 'range', min: 0, max: 60, step: 1 },
    { key: 'nodesPerTurn', label: 'Nodes / turn', kind: 'range', min: 0, max: 8, step: 1 },
  ],
  defaults: { turns: 3.5, strands: 2, top: 1, bottom: 0.1, height: 1.7, curve: 0.8, loops: true, rungs: 18, nodesPerTurn: 2 },
  build(p) {
    const turns = num(p, 'turns');
    const strands = int(p, 'strands');
    const H = num(p, 'height');
    const radius = (t: number) => lerp(num(p, 'top'), num(p, 'bottom'), Math.pow(t, num(p, 'curve')));
    const at = (t: number, phase: number): Vec3 => {
      const a = TAU * turns * t + phase;
      const r = radius(t);
      return [r * Math.cos(a), H / 2 - t * H, r * Math.sin(a)];
    };
    const radial = (t: number, phase: number): Vec3 => {
      const a = TAU * turns * t + phase;
      return [Math.cos(a), 0, Math.sin(a)];
    };
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const samples = Math.ceil(96 * turns) + 1;
    for (let s = 0; s < strands; s++) {
      const ph = (TAU * s) / strands;
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let i = 0; i < samples; i++) {
        const t = i / (samples - 1);
        pts.push(at(t, ph));
        ns.push(radial(t, ph));
      }
      lines.push({ pts, normals: ns });
      const npt = int(p, 'nodesPerTurn');
      const count = Math.round(npt * turns);
      for (let i = 0; i <= count && npt > 0; i++) nodes.push({ p: at(i / count, ph), n: radial(i / count, ph) });
    }
    if (bool(p, 'loops')) {
      const levels = Math.max(1, Math.round(turns));
      for (let l = 0; l <= levels; l++) {
        const t = l / levels;
        const r = radius(t);
        if (r < 0.01) continue;
        lines.push(onSphere(circle([0, H / 2 - t * H, 0], [1, 0, 0], [0, 0, 1], r, 96)));
      }
    }
    const rungs = int(p, 'rungs');
    if (strands > 1) {
      for (let i = 0; i < rungs; i++) {
        const t = (i + 0.5) / rungs;
        const a = at(t, 0), b = at(t, TAU / strands);
        lines.push({ pts: [a, b], tone: 'back' });
      }
    }
    return { lines, nodes };
  },
};

export const torus: SourceDef = {
  kind: 'torus',
  name: 'Torus',
  blurb: 'Donut mesh with optional twist into spirals',
  params: [
    { key: 'major', label: 'Ring radius', kind: 'range', min: 0.3, max: 1, step: 0.01 },
    { key: 'minor', label: 'Tube radius', kind: 'range', min: 0.05, max: 0.7, step: 0.01 },
    { key: 'tubes', label: 'Tube lines', kind: 'range', min: 0, max: 48, step: 1 },
    { key: 'loops', label: 'Loops', kind: 'range', min: 0, max: 24, step: 1 },
    { key: 'twist', label: 'Twist', kind: 'range', min: -3, max: 3, step: 0.05 },
  ],
  defaults: { major: 0.68, minor: 0.3, tubes: 24, loops: 6, twist: 0 },
  build(p) {
    const R = num(p, 'major'), r = num(p, 'minor');
    const tw = num(p, 'twist');
    const at = (u: number, v: number): Vec3 => [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)];
    const nrm = (u: number, v: number): Vec3 => [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const tubes = int(p, 'tubes'), loops = int(p, 'loops');
    for (let i = 0; i < tubes; i++) {
      const u0 = (TAU * i) / tubes;
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let s = 0; s <= 96; s++) {
        const v = (TAU * s) / 96;
        const u = u0 + (tw * v) / (tubes || 1);
        pts.push(at(u, v));
        ns.push(nrm(u, v));
      }
      lines.push({ pts, normals: ns, closed: tw === 0 });
      for (let j = 0; j < loops; j++) {
        const v = (TAU * j) / loops;
        const u = u0 + (tw * v) / (tubes || 1);
        nodes.push({ p: at(u, v), n: nrm(u, v) });
      }
    }
    for (let j = 0; j < loops; j++) {
      const v = (TAU * j) / loops;
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let s = 0; s < 160; s++) {
        const u = (TAU * s) / 160;
        pts.push(at(u, v));
        ns.push(nrm(u, v));
      }
      lines.push({ pts, normals: ns, closed: true });
    }
    return { lines, nodes };
  },
};

export const knot: SourceDef = {
  kind: 'knot',
  name: 'Knot',
  blurb: 'Torus knot (p, q) with echoing strands',
  params: [
    { key: 'p', label: 'P winds', kind: 'range', min: 1, max: 9, step: 1 },
    { key: 'q', label: 'Q winds', kind: 'range', min: 1, max: 9, step: 1 },
    { key: 'major', label: 'Ring radius', kind: 'range', min: 0.3, max: 1, step: 0.01 },
    { key: 'minor', label: 'Loop radius', kind: 'range', min: 0.05, max: 0.6, step: 0.01 },
    { key: 'echoes', label: 'Echoes', kind: 'range', min: 1, max: 8, step: 1 },
    { key: 'spread', label: 'Echo spread', kind: 'range', min: 0, max: 0.2, step: 0.005 },
    { key: 'beads', label: 'Beads', kind: 'range', min: 0, max: 80, step: 1 },
  ],
  defaults: { p: 2, q: 5, major: 0.62, minor: 0.3, echoes: 1, spread: 0.05, beads: 20 },
  build(p) {
    const P = int(p, 'p'), Q = int(p, 'q');
    const R = num(p, 'major');
    const at = (t: number, r: number): Vec3 => {
      const c = R + r * Math.cos(Q * t);
      return [c * Math.cos(P * t), r * Math.sin(Q * t), c * Math.sin(P * t)];
    };
    const lines: Polyline[] = [];
    const echoes = int(p, 'echoes');
    for (let e = 0; e < echoes; e++) {
      const r = num(p, 'minor') + (e - (echoes - 1) / 2) * num(p, 'spread');
      const pts: Vec3[] = [];
      const n = 240 * Math.max(P, Q);
      for (let i = 0; i < n; i++) pts.push(at((TAU * i) / n, r));
      lines.push({ pts, closed: true });
    }
    const beads = int(p, 'beads');
    const nodes: GeoNode[] = [];
    for (let i = 0; i < beads; i++) nodes.push({ p: at((TAU * i) / beads, num(p, 'minor')) });
    return { lines, nodes };
  },
};

export const orbits: SourceDef = {
  kind: 'orbits',
  name: 'Orbits',
  blurb: 'Inscribed rings on an ellipsoid shell, with annotations',
  params: [
    { key: 'rings', label: 'Rings', kind: 'range', min: 1, max: 12, step: 1 },
    { key: 'minSize', label: 'Min size', kind: 'range', min: 0.1, max: 1, step: 0.01 },
    { key: 'maxSize', label: 'Max size', kind: 'range', min: 0.1, max: 1, step: 0.01 },
    { key: 'stretch', label: 'Stretch', kind: 'range', min: 0.5, max: 2, step: 0.01 },
    { key: 'shell', label: 'Shell outline', kind: 'toggle' },
    { key: 'equator', label: 'Equator', kind: 'toggle' },
    { key: 'axis', label: 'Axis', kind: 'toggle' },
    { key: 'labels', label: 'Labels', kind: 'text', placeholder: 'Separate with ;' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: {
    rings: 5, minSize: 0.35, maxSize: 0.8, stretch: 1.45, shell: true, equator: true, axis: true,
    labels: '', seed: 62,
  },
  build(p) {
    const sx = num(p, 'stretch');
    const squash = (pts: Vec3[]): Polyline => ({
      pts: pts.map(([x, y, z]) => [x * sx, y, z] as Vec3),
      normals: pts.map(([x, y, z]) => norm([x / sx, y, z])),
      closed: true,
    });
    const lines: Polyline[] = [];
    const labels: GeoLabel[] = [];
    const r = rng(int(p, 'seed'));
    if (bool(p, 'shell')) {
      lines.push({ pts: circle([0, 0, 0], [sx, 0, 0], [0, 1, 0], 1, 160), closed: true, tone: 'front' });
    }
    if (bool(p, 'equator')) lines.push(squash(circle([0, 0, 0], [1, 0, 0], [0, 0, 1], 1, 160)));
    if (bool(p, 'axis')) {
      lines.push({ pts: [[0, -1, 0], [0, 1, 0]], tone: 'front' });
    }
    const texts = str(p, 'labels').split(';').map((s) => s.trim()).filter(Boolean);
    const lo = num(p, 'minSize'), hi = Math.max(lo, num(p, 'maxSize'));
    for (let i = 0; i < int(p, 'rings'); i++) {
      // Bias ring centres toward the visible hemisphere so the composition reads well.
      const c = norm([r() * 2 - 1, r() * 2 - 1, r() * 0.8 + 0.2]);
      const s = lerp(lo, hi, r());
      const a = Math.asin(clamp(s, 0, 1));
      const [u, v] = basis(c);
      const pts = circle(
        [c[0] * Math.cos(a), c[1] * Math.cos(a), c[2] * Math.cos(a)],
        u, v, Math.sin(a), 128,
      );
      lines.push(squash(pts));
      if (texts[i]) {
        const q = c;
        labels.push({ p: [q[0] * sx * Math.cos(a) - 0.06, q[1] * Math.cos(a), q[2] * Math.cos(a)], text: texts[i] });
      }
    }
    return { lines, nodes: [], labels };
  },
};
