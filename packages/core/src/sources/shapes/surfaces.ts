import { TAU, circle, int, norm, num, str } from '../../math.js';
import type { GeoNode, Polyline, SourceDef, Vec3 } from '../../types.js';
import { fit, surface } from './util.js';

const opts = (...v: [string, string][]) => v.map(([value, label]) => ({ value, label }));
const DEG = Math.PI / 180;

export const hyperboloid: SourceDef = {
  kind: 'hyperboloid',
  name: 'Tower',
  blurb: 'A hyperboloid woven from straight lines, like a cooling tower or a string sculpture',
  params: [
    { key: 'lines', label: 'Lines', kind: 'range', min: 6, max: 72, step: 1 },
    { key: 'twist', label: 'Twist', kind: 'range', min: 0, max: 170, step: 1, unit: '°' },
    { key: 'height', label: 'Height', kind: 'range', min: 0.4, max: 2.4, step: 0.01 },
    { key: 'top', label: 'Top radius', kind: 'range', min: 0.2, max: 1.2, step: 0.01 },
    { key: 'bottom', label: 'Bottom radius', kind: 'range', min: 0.2, max: 1.2, step: 0.01 },
    { key: 'weave', label: 'Weave', kind: 'select', options: opts(['both', 'Both ways'], ['one', 'One way']) },
    { key: 'rims', label: 'Rims', kind: 'range', min: 0, max: 8, step: 1 },
  ],
  defaults: { lines: 28, twist: 110, height: 1.6, top: 0.7, bottom: 0.85, weave: 'both', rims: 2 },
  build(p) {
    const n = int(p, 'lines'), tw = num(p, 'twist') * DEG, H = num(p, 'height');
    const rt = num(p, 'top'), rb = num(p, 'bottom');
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const S = 24;
    const rule = (a: number, dir: number, fam: number) => {
      const A: Vec3 = [rb * Math.cos(a), -H / 2, rb * Math.sin(a)];
      const B: Vec3 = [rt * Math.cos(a + dir * tw), H / 2, rt * Math.sin(a + dir * tw)];
      const pts: Vec3[] = [], normals: Vec3[] = [];
      for (let k = 0; k <= S; k++) {
        const s = k / S;
        const q: Vec3 = [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s];
        pts.push(q);
        // The surface of all rulings is rotationally symmetric; its normal lies in the
        // plane through the axis, tilted by how fast the radius changes with height.
        const d: Vec3 = [(B[0] - A[0]) / H, 0, (B[2] - A[2]) / H];
        const r = Math.hypot(q[0], q[2]) || 1e-9;
        const dr = (q[0] * d[0] + q[2] * d[2]) / r;
        normals.push(norm([q[0] / r, -dr, q[2] / r]));
      }
      lines.push({ pts, normals, family: fam });
      nodes.push({ p: A, n: normals[0] }, { p: B, n: normals[S] });
    };
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n;
      rule(a, 1, 0);
      if (str(p, 'weave') === 'both') rule(a, -1, 1);
    }
    const rims = int(p, 'rims');
    for (let j = 0; j < rims; j++) {
      const h = rims === 1 ? 1 : j / (rims - 1);
      const y = -H / 2 + h * H;
      // Radius of the surface at this height (both families share it).
      const A: Vec3 = [rb, -H / 2, 0], B: Vec3 = [rt * Math.cos(tw), H / 2, rt * Math.sin(tw)];
      const q: Vec3 = [A[0] + (B[0] - A[0]) * h, y, A[2] + (B[2] - A[2]) * h];
      const r = Math.hypot(q[0], q[2]);
      const pts = circle([0, y, 0], [1, 0, 0], [0, 0, 1], r, 128);
      lines.push({ pts, normals: pts.map((c) => norm([c[0], 0, c[2]])), closed: true, family: 2 });
    }
    return { lines, nodes };
  },
};

export const saddle: SourceDef = {
  kind: 'saddle',
  name: 'Saddle',
  blurb: 'A hyperbolic paraboloid: a curved surface made entirely of straight lines',
  params: [
    { key: 'lines', label: 'Lines', kind: 'range', min: 3, max: 48, step: 1 },
    { key: 'curve', label: 'Curvature', kind: 'range', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'draw', label: 'Draw', kind: 'select', options: opts(['both', 'Both ways'], ['one', 'One way']) },
  ],
  defaults: { lines: 16, curve: 0.7, draw: 'both' },
  build(p) {
    const c = num(p, 'curve'), n = int(p, 'lines');
    const g = surface((u, v) => [u, c * u * v, v], {
      uLines: n, vLines: str(p, 'draw') === 'both' ? n : 0, u0: -1, u1: 1, v0: -1, v1: 1, samples: 24, nodes: true, flip: true,
    });
    return g;
  },
};

export const mobius: SourceDef = {
  kind: 'mobius',
  name: 'Möbius',
  blurb: 'A band with half-twists; with an odd count it has only one side',
  params: [
    { key: 'twists', label: 'Half-twists', kind: 'range', min: 0, max: 7, step: 1 },
    { key: 'width', label: 'Width', kind: 'range', min: 0.1, max: 1, step: 0.01 },
    { key: 'along', label: 'Lines along', kind: 'range', min: 1, max: 16, step: 1 },
    { key: 'across', label: 'Lines across', kind: 'range', min: 0, max: 96, step: 1 },
  ],
  defaults: { twists: 1, width: 0.5, along: 5, across: 48 },
  build(p) {
    const k = int(p, 'twists'), w = num(p, 'width');
    const f = (u: number, v: number): Vec3 => {
      const a = u * TAU, h = (v - 0.5) * w;
      const r = 1 + h * Math.cos((k * a) / 2);
      return [r * Math.cos(a), h * Math.sin((k * a) / 2), r * Math.sin(a)];
    };
    return surface(f, { uLines: int(p, 'along'), vLines: int(p, 'across'), uClosed: k % 2 === 0, uPeriodic: true, samples: 160, vSamples: 6 });
  },
};

export const klein: SourceDef = {
  kind: 'klein',
  name: 'Klein bottle',
  blurb: 'A closed surface with no inside, shown as a figure-eight tube passing through itself',
  params: [
    { key: 'along', label: 'Lines along', kind: 'range', min: 0, max: 48, step: 1 },
    { key: 'around', label: 'Lines around', kind: 'range', min: 0, max: 48, step: 1 },
    { key: 'radius', label: 'Ring radius', kind: 'range', min: 2, max: 5, step: 0.05 },
  ],
  defaults: { along: 14, around: 36, radius: 2.6 },
  build(p) {
    const R = num(p, 'radius');
    const f = (u: number, v: number): Vec3 => {
      const a = u * TAU, b = v * TAU;
      const r = R + Math.cos(a / 2) * Math.sin(b) - Math.sin(a / 2) * Math.sin(2 * b);
      return [r * Math.cos(a), Math.sin(a / 2) * Math.sin(b) + Math.cos(a / 2) * Math.sin(2 * b), r * Math.sin(a)];
    };
    const g = surface(f, { uLines: int(p, 'along'), vLines: int(p, 'around'), uPeriodic: true, vClosed: true, samples: 120, vSamples: 64 });
    fit(g.lines, g.nodes);
    return g;
  },
};

export const seashell: SourceDef = {
  kind: 'seashell',
  name: 'Seashell',
  blurb: 'A tube growing along a logarithmic spiral, like a snail or a conch',
  params: [
    { key: 'turns', label: 'Turns', kind: 'range', min: 1, max: 8, step: 0.1 },
    { key: 'growth', label: 'Growth', kind: 'range', min: 0.05, max: 0.6, step: 0.01 },
    { key: 'flare', label: 'Opening', kind: 'range', min: 0.1, max: 1.2, step: 0.01 },
    { key: 'drop', label: 'Height', kind: 'range', min: 0, max: 3, step: 0.01 },
    { key: 'ribs', label: 'Ribs', kind: 'range', min: 0, max: 120, step: 1 },
    { key: 'spirals', label: 'Spiral lines', kind: 'range', min: 0, max: 24, step: 1 },
  ],
  defaults: { turns: 6, growth: 0.1, flare: 0.9, drop: 2.5, ribs: 56, spirals: 8 },
  build(p) {
    const T = num(p, 'turns') * TAU, g = num(p, 'growth'), fl = num(p, 'flare'), drop = num(p, 'drop');
    const f = (u: number, v: number): Vec3 => {
      const a = u * T, b = v * TAU;
      const s = Math.exp(g * (a - T)); // 1 at the mouth, shrinking toward the apex
      const rad: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const cy = drop * (1 - s);
      const tube = fl * s;
      return [
        s * rad[0] + tube * Math.cos(b) * rad[0],
        cy + tube * Math.sin(b),
        s * rad[2] + tube * Math.cos(b) * rad[2],
      ];
    };
    const out = surface(f, { uLines: int(p, 'spirals'), vLines: int(p, 'ribs'), vClosed: true, samples: 240, vSamples: 40 });
    // Ribs sample their circle more coarsely than the long spiral lines need.
    fit(out.lines, out.nodes);
    return out;
  },
};

export const helix: SourceDef = {
  kind: 'helix',
  name: 'Helix',
  blurb: 'Strands winding round a shared axis, joined by rungs',
  params: [
    { key: 'strands', label: 'Strands', kind: 'range', min: 1, max: 6, step: 1 },
    { key: 'turns', label: 'Turns', kind: 'range', min: 0.5, max: 8, step: 0.25 },
    { key: 'radius', label: 'Radius', kind: 'range', min: 0.1, max: 1, step: 0.01 },
    { key: 'height', label: 'Height', kind: 'range', min: 0.5, max: 3, step: 0.01 },
    { key: 'rungs', label: 'Rungs', kind: 'range', min: 0, max: 80, step: 1 },
    { key: 'offset', label: 'Strand offset', kind: 'range', min: 30, max: 180, step: 1, unit: '°' },
  ],
  defaults: { strands: 2, turns: 2.5, radius: 0.42, height: 2, rungs: 30, offset: 150 },
  build(p) {
    const n = int(p, 'strands'), T = num(p, 'turns') * TAU, R = num(p, 'radius'), H = num(p, 'height');
    const off = num(p, 'offset') * DEG;
    const phase = (s: number) => (n === 2 ? s * off : (TAU * s) / n);
    const at = (t: number, s: number): Vec3 => {
      const a = t * T + phase(s);
      return [R * Math.cos(a), -H / 2 + t * H, R * Math.sin(a)];
    };
    const radial = (t: number, s: number): Vec3 => {
      const a = t * T + phase(s);
      return [Math.cos(a), 0, Math.sin(a)];
    };
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const S = Math.ceil(64 * num(p, 'turns')) + 1;
    for (let s = 0; s < n; s++) {
      const pts: Vec3[] = [], ns: Vec3[] = [];
      for (let i = 0; i < S; i++) {
        pts.push(at(i / (S - 1), s));
        ns.push(radial(i / (S - 1), s));
      }
      lines.push({ pts, normals: ns, family: s });
    }
    const rungs = int(p, 'rungs');
    if (n > 1)
      for (let i = 0; i < rungs; i++) {
        const t = (i + 0.5) / rungs;
        for (let s = 0; s < (n === 2 ? 1 : n); s++) {
          const a = at(t, s), b = at(t, (s + 1) % n);
          lines.push({ pts: [a, b], family: n });
          nodes.push({ p: a, n: radial(t, s) }, { p: b, n: radial(t, (s + 1) % n) });
        }
      }
    return { lines, nodes };
  },
};

const PHI = (1 + Math.sqrt(5)) / 2;
const perms = (x: number, y: number, z: number): Vec3[] => [[x, y, z], [y, z, x], [z, x, y]];
const signs = (v: Vec3): Vec3[] => {
  const out: Vec3[] = [];
  for (const sx of v[0] ? [1, -1] : [1]) for (const sy of v[1] ? [1, -1] : [1]) for (const sz of v[2] ? [1, -1] : [1]) out.push([v[0] * sx, v[1] * sy, v[2] * sz]);
  return out;
};
const cyc = (x: number, y: number, z: number) => perms(x, y, z).flatMap(signs);

const SOLIDS: Record<string, () => Vec3[]> = {
  tetrahedron: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  cube: () => signs([1, 1, 1]),
  octahedron: () => cyc(1, 0, 0),
  dodecahedron: () => [...signs([1, 1, 1]), ...cyc(0, 1 / PHI, PHI)],
  icosahedron: () => cyc(0, 1, PHI),
  cuboctahedron: () => cyc(1, 1, 0),
};

/** Edges of a regular solid: the vertex pairs at the shortest distance. */
function edgesOf(verts: Vec3[]): [number, number][] {
  let min = Infinity;
  const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) min = Math.min(min, d(verts[i], verts[j]));
  const out: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) if (d(verts[i], verts[j]) < min * 1.001) out.push([i, j]);
  return out;
}

/** Geodesic sphere: an icosahedron whose faces are split `freq` times and pushed onto the sphere. */
function geodesic(freq: number): { verts: Vec3[]; edges: [number, number][] } {
  const base = SOLIDS.icosahedron().map(norm);
  const e = edgesOf(base);
  const adj = new Set(e.map(([a, b]) => `${a},${b}`));
  const has = (a: number, b: number) => adj.has(a < b ? `${a},${b}` : `${b},${a}`);
  const faces: [number, number, number][] = [];
  for (let a = 0; a < base.length; a++)
    for (let b = a + 1; b < base.length; b++)
      for (let c = b + 1; c < base.length; c++) if (has(a, b) && has(b, c) && has(a, c)) faces.push([a, b, c]);
  const verts: Vec3[] = [];
  const index = new Map<string, number>();
  const vid = (p: Vec3) => {
    const q = norm(p);
    const k = q.map((x) => Math.round(x * 1e6)).join(',');
    let i = index.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(q);
      index.set(k, i);
    }
    return i;
  };
  const edges = new Set<string>();
  const add = (a: number, b: number) => edges.add(a < b ? `${a},${b}` : `${b},${a}`);
  for (const [A, B, C] of faces) {
    const P = (i: number, j: number): Vec3 => {
      const k = freq - i - j;
      return [0, 1, 2].map((x) => (base[A][x] * k + base[B][x] * i + base[C][x] * j) / freq) as Vec3;
    };
    for (let i = 0; i < freq; i++)
      for (let j = 0; j < freq - i; j++) {
        const a = vid(P(i, j)), b = vid(P(i + 1, j)), c = vid(P(i, j + 1));
        add(a, b); add(b, c); add(a, c);
        if (i + j < freq - 1) {
          const d = vid(P(i + 1, j + 1));
          add(b, d); add(c, d);
        }
      }
  }
  return { verts, edges: [...edges].map((s) => s.split(',').map(Number) as [number, number]) };
}

export const polyhedron: SourceDef = {
  kind: 'polyhedron',
  name: 'Polyhedron',
  blurb: 'Platonic solids, a cuboctahedron or a geodesic sphere, optionally nested',
  params: [
    { key: 'solid', label: 'Solid', kind: 'select', options: opts(['tetrahedron', 'Tetrahedron'], ['cube', 'Cube'], ['octahedron', 'Octahedron'], ['dodecahedron', 'Dodecahedron'], ['icosahedron', 'Icosahedron'], ['cuboctahedron', 'Cuboctahedron'], ['geodesic', 'Geodesic sphere']) },
    { key: 'frequency', label: 'Frequency', kind: 'range', min: 1, max: 6, step: 1, when: { key: 'solid', in: ['geodesic'] } },
    { key: 'nested', label: 'Nested copies', kind: 'range', min: 1, max: 6, step: 1 },
    { key: 'spacing', label: 'Nest spacing', kind: 'range', min: 0.05, max: 0.4, step: 0.01 },
  ],
  defaults: { solid: 'icosahedron', frequency: 3, nested: 1, spacing: 0.18 },
  build(p) {
    const solid = str(p, 'solid');
    const shape = solid === 'geodesic' ? geodesic(int(p, 'frequency')) : (() => {
      const v = (SOLIDS[solid] ?? SOLIDS.icosahedron)();
      const r = Math.hypot(...v[0]);
      return { verts: v.map((q) => q.map((x) => x / r) as Vec3), edges: edgesOf(v) };
    })();
    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const nest = int(p, 'nested');
    for (let k = 0; k < nest; k++) {
      const s = Math.max(0.05, 1 - k * num(p, 'spacing'));
      const V = shape.verts.map((q) => q.map((x) => x * s) as Vec3);
      for (const [a, b] of shape.edges) {
        const A = V[a], B = V[b];
        const pts: Vec3[] = [];
        for (let i = 0; i <= 8; i++) pts.push([A[0] + (B[0] - A[0]) * (i / 8), A[1] + (B[1] - A[1]) * (i / 8), A[2] + (B[2] - A[2]) * (i / 8)]);
        // For a convex solid round the origin, the edge's outward direction is its midpoint.
        const n = norm([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
        lines.push({ pts, normals: pts.map(() => n), family: k });
      }
      for (const q of V) nodes.push({ p: q, n: norm(q), family: k });
    }
    return { lines, nodes };
  },
};

const sp = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);

export const superquadric: SourceDef = {
  kind: 'superquadric',
  name: 'Superquadric',
  blurb: 'One family of solids from pillow to sphere to cube to star',
  params: [
    { key: 'e1', label: 'Roundness (top–bottom)', kind: 'range', min: 0.1, max: 4, step: 0.01 },
    { key: 'e2', label: 'Roundness (around)', kind: 'range', min: 0.1, max: 4, step: 0.01 },
    { key: 'parallels', label: 'Parallels', kind: 'range', min: 0, max: 36, step: 1 },
    { key: 'meridians', label: 'Meridians', kind: 'range', min: 0, max: 48, step: 1 },
    { key: 'stretch', label: 'Height', kind: 'range', min: 0.3, max: 2, step: 0.01 },
  ],
  defaults: { e1: 0.4, e2: 0.4, parallels: 12, meridians: 16, stretch: 1 },
  build(p) {
    const e1 = num(p, 'e1'), e2 = num(p, 'e2'), h = num(p, 'stretch');
    const f = (u: number, v: number): Vec3 => {
      const th = u * TAU, ph = -Math.PI / 2 + v * Math.PI;
      const c = sp(Math.cos(ph), e1);
      return [c * sp(Math.cos(th), e2), h * sp(Math.sin(ph), e1), c * sp(Math.sin(th), e2)];
    };
    // Parallels are spaced pole to pole, then the two zero-length pole rings are dropped.
    const par = int(p, 'parallels');
    const g = surface(f, { uLines: par + 2, vLines: int(p, 'meridians'), uClosed: true, samples: 96, vSamples: 64, flip: true });
    g.lines = g.lines.filter((_, i) => i !== 0 && i !== par + 1);
    fit(g.lines, g.nodes, false);
    return g;
  },
};
