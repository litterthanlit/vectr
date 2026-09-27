import { tAt } from '../geo.js';
import { bool, cross, int, norm, num, str } from '../math.js';
import type { Geometry, OpDef, Polyline, Vec3 } from '../types.js';

const DEG = Math.PI / 180;

/** Plane of a closed line (Newell's method): unit normal, in-plane basis and centroid. */
function planeOf(pts: Vec3[]) {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
    cx += a[0]; cy += a[1]; cz += a[2];
  }
  const len = Math.hypot(nx, ny, nz);
  const n: Vec3 = len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
  // Face the viewer's default side so hatch angles read the same on flat shapes.
  const nn: Vec3 = n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
  const helper: Vec3 = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(helper, nn));
  const e2 = cross(nn, e1);
  const c: Vec3 = [cx / pts.length, cy / pts.length, cz / pts.length];
  return { n: nn, e1, e2, c, d: nn[0] * c[0] + nn[1] * c[1] + nn[2] * c[2] };
}

/** How far a closed line strays from its plane, relative to its size. */
function flatness(pts: Vec3[], pl: ReturnType<typeof planeOf>) {
  let dev = 0, size = 1e-9;
  for (const p of pts) {
    dev = Math.max(dev, Math.abs(pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] - pl.d));
    size = Math.max(size, Math.hypot(p[0] - pl.c[0], p[1] - pl.c[1], p[2] - pl.c[2]));
  }
  return dev / size;
}

type Pl = ReturnType<typeof planeOf>;
const to2 = (p: Vec3, pl: Pl): [number, number] => {
  const q: Vec3 = [p[0] - pl.c[0], p[1] - pl.c[1], p[2] - pl.c[2]];
  return [q[0] * pl.e1[0] + q[1] * pl.e1[1] + q[2] * pl.e1[2], q[0] * pl.e2[0] + q[1] * pl.e2[1] + q[2] * pl.e2[2]];
};
const to3 = (x: number, y: number, pl: Pl): Vec3 => [
  pl.c[0] + pl.e1[0] * x + pl.e2[0] * y,
  pl.c[1] + pl.e1[1] * x + pl.e2[1] * y,
  pl.c[2] + pl.e1[2] * x + pl.e2[2] * y,
];

/**
 * Group closed, nearly flat lines that share a plane, so nested outlines (a ring, a
 * letter with a hole) are filled together by the even-odd rule.
 */
function planarGroups(g: Geometry) {
  const groups: { pl: Pl; lines: Polyline[] }[] = [];
  const rest: Polyline[] = [];
  for (const l of g.lines) {
    if (!l.closed || l.pts.length < 3) { rest.push(l); continue; }
    const pl = planeOf(l.pts);
    if (flatness(l.pts, pl) > 0.02) { rest.push(l); continue; }
    const same = groups.find((gr) => Math.abs(gr.pl.n[0] * pl.n[0] + gr.pl.n[1] * pl.n[1] + gr.pl.n[2] * pl.n[2]) > 0.999 && Math.abs(gr.pl.n[0] * pl.c[0] + gr.pl.n[1] * pl.c[1] + gr.pl.n[2] * pl.c[2] - gr.pl.d) < 1e-3);
    if (same) same.lines.push(l);
    else groups.push({ pl, lines: [l] });
  }
  return { groups, rest };
}

export const hatch: OpDef = {
  kind: 'hatch',
  name: 'Hatch',
  blurb: 'Fill closed outlines with parallel or crossed lines, the way a pen shades',
  params: [
    { key: 'angle', label: 'Angle', kind: 'range', min: -90, max: 90, step: 1, unit: '°' },
    { key: 'spacing', label: 'Spacing', kind: 'range', min: 0.008, max: 0.3, step: 0.001 },
    { key: 'cross', label: 'Cross-hatch', kind: 'toggle' },
    { key: 'outline', label: 'Keep outline', kind: 'toggle' },
    { key: 'inset', label: 'Inset', kind: 'range', min: 0, max: 0.1, step: 0.001, help: 'Leave a gap between the hatching and the outline' },
  ],
  defaults: { angle: 45, spacing: 0.04, cross: false, outline: true, inset: 0 },
  apply(g, p) {
    const { groups, rest } = planarGroups(g);
    const sp = num(p, 'spacing'), inset = num(p, 'inset');
    const angles = [num(p, 'angle')];
    if (bool(p, 'cross')) angles.push(num(p, 'angle') + 90);
    const lines: Polyline[] = [...rest];
    let budget = 20_000;
    groups.forEach((gr, gi) => {
      const polys = gr.lines.map((l) => l.pts.map((q) => to2(q, gr.pl)));
      for (const a of angles) {
        const c = Math.cos(-a * DEG), s = Math.sin(-a * DEG);
        const rot = polys.map((poly) => poly.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]));
        let lo = Infinity, hi = -Infinity;
        for (const poly of rot) for (const [, y] of poly) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
        for (let y = Math.ceil(lo / sp) * sp; y <= hi && budget > 0; y += sp) {
          const xs: number[] = [];
          for (const poly of rot)
            for (let i = 0; i < poly.length; i++) {
              const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
              if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
            }
          xs.sort((m, n) => m - n);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const xa = xs[k] + inset, xb = xs[k + 1] - inset;
            if (xb <= xa) continue;
            // Undo the rotation, then lift back into the outline's plane.
            const back = (x: number): Vec3 => to3(x * c + y * s, -x * s + y * c, gr.pl);
            lines.push({ pts: [back(xa), back(xb)], t: [0, 1], family: gr.lines[0].family ?? gi, tone: 'front' });
            budget--;
          }
        }
      }
      if (bool(p, 'outline')) lines.push(...gr.lines);
    });
    return { lines, nodes: g.nodes, labels: g.labels };
  },
};

export const offset: OpDef = {
  kind: 'offset',
  name: 'Offset',
  blurb: 'Echo closed outlines inward or outward at an even distance, like contour lines',
  params: [
    { key: 'count', label: 'Copies', kind: 'range', min: 1, max: 32, step: 1 },
    { key: 'distance', label: 'Distance', kind: 'range', min: -0.3, max: 0.3, step: 0.001 },
    { key: 'keep', label: 'Keep original', kind: 'toggle' },
  ],
  defaults: { count: 5, distance: -0.05, keep: true },
  apply(g, p) {
    const { groups, rest } = planarGroups(g);
    const n = int(p, 'count'), d = num(p, 'distance');
    const lines: Polyline[] = [...rest];
    for (const gr of groups)
      for (const l of gr.lines) {
        const poly = l.pts.map((q) => to2(q, gr.pl));
        // Winding decides which side is "out".
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
          const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
          area += x0 * y1 - x1 * y0;
        }
        const sgn = area >= 0 ? 1 : -1;
        const normals = poly.map((_, i) => {
          const [xa, ya] = poly[(i - 1 + poly.length) % poly.length], [xb, yb] = poly[(i + 1) % poly.length];
          const tx = xb - xa, ty = yb - ya, len = Math.hypot(tx, ty) || 1;
          return [(sgn * ty) / len, (-sgn * tx) / len] as [number, number];
        });
        if (bool(p, 'keep')) lines.push(l);
        for (let k = 1; k <= n; k++) {
          const dist = d * k;
          const moved = poly.map(([x, y], i) => [x + normals[i][0] * dist, y + normals[i][1] * dist] as [number, number]);
          // Stop once an inward echo has turned inside out (it has passed its own centre).
          let a2 = 0;
          for (let i = 0; i < moved.length; i++) {
            const [x0, y0] = moved[i], [x1, y1] = moved[(i + 1) % moved.length];
            a2 += x0 * y1 - x1 * y0;
          }
          if (Math.sign(a2) !== Math.sign(area) || Math.abs(a2) < Math.abs(area) * 0.004) break;
          lines.push({ ...l, pts: moved.map(([x, y]) => to3(x, y, gr.pl)), normals: undefined, family: (l.family ?? 0) + k });
        }
      }
    return { lines, nodes: g.nodes, labels: g.labels };
  },
};

export const kaleidoscope: OpDef = {
  kind: 'kaleidoscope',
  name: 'Kaleidoscope',
  blurb: 'Repeat round a centre with mirrored wedges, like a snowflake',
  params: [
    { key: 'count', label: 'Segments', kind: 'range', min: 2, max: 24, step: 1 },
    { key: 'mirror', label: 'Mirror each wedge', kind: 'toggle' },
    { key: 'axis', label: 'Axis', kind: 'select', options: [{ value: 'z', label: 'Facing (Z)' }, { value: 'y', label: 'Vertical (Y)' }] },
  ],
  defaults: { count: 6, mirror: true, axis: 'z' },
  apply(g, p) {
    const n = int(p, 'count');
    const aroundY = str(p, 'axis') === 'y';
    const xf = (k: number, flip: boolean) => {
      const a = (2 * Math.PI * k) / n, c = Math.cos(a), s = Math.sin(a);
      return (v: Vec3): Vec3 => {
        if (aroundY) {
          const x = v[0], z = flip ? -v[2] : v[2];
          return [x * c - z * s, v[1], x * s + z * c];
        }
        const x = v[0], y = flip ? -v[1] : v[1];
        return [x * c - y * s, x * s + y * c, v[2]];
      };
    };
    const lines: Polyline[] = [];
    const nodes = [] as Geometry['nodes'];
    for (let k = 0; k < n; k++)
      for (const flip of bool(p, 'mirror') ? [false, true] : [false]) {
        const f = xf(k, flip);
        for (const l of g.lines) lines.push({ ...l, pts: l.pts.map(f), normals: l.normals?.map(f), family: k });
        for (const nd of g.nodes) nodes.push({ ...nd, p: f(nd.p), n: nd.n && f(nd.n), family: k });
      }
    return { lines, nodes, labels: g.labels };
  },
};

export const smooth: OpDef = {
  kind: 'smooth',
  name: 'Smooth',
  blurb: 'Round off corners by repeatedly cutting them (Chaikin)',
  params: [
    { key: 'passes', label: 'Passes', kind: 'range', min: 1, max: 5, step: 1 },
    { key: 'cut', label: 'Cut', kind: 'range', min: 0.05, max: 0.45, step: 0.01 },
  ],
  defaults: { passes: 3, cut: 0.25 },
  apply(g, p) {
    const passes = int(p, 'passes'), q = num(p, 'cut');
    const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const lines = g.lines.map((line) => {
      let pts = line.pts, ns = line.normals, ts = line.pts.map((_, i) => tAt(line, i));
      for (let k = 0; k < passes && pts.length > 2; k++) {
        const P: Vec3[] = [], N: Vec3[] = [], T: number[] = [];
        const m = line.closed ? pts.length : pts.length - 1;
        if (!line.closed) { P.push(pts[0]); T.push(ts[0]); if (ns) N.push(ns[0]); }
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % pts.length;
          P.push(mix(pts[i], pts[j], q), mix(pts[i], pts[j], 1 - q));
          T.push(ts[i] + (ts[j] - ts[i]) * q, ts[i] + (ts[j] - ts[i]) * (1 - q));
          if (ns) N.push(norm(mix(ns[i], ns[j], q)), norm(mix(ns[i], ns[j], 1 - q)));
        }
        if (!line.closed) { P.push(pts[pts.length - 1]); T.push(ts[ts.length - 1]); if (ns) N.push(ns[ns.length - 1]); }
        pts = P; ts = T; ns = ns ? N : undefined;
      }
      return { ...line, pts, normals: ns, t: ts };
    });
    return { lines, nodes: g.nodes, labels: g.labels };
  },
};

export const extrude: OpDef = {
  kind: 'extrude',
  name: 'Extrude',
  blurb: 'Pull flat outlines into solid prisms, with side edges and caps',
  params: [
    { key: 'depth', label: 'Depth', kind: 'range', min: 0.02, max: 2, step: 0.01 },
    { key: 'sides', label: 'Side lines', kind: 'range', min: 0, max: 96, step: 1 },
    { key: 'caps', label: 'Back outline', kind: 'toggle' },
    { key: 'taper', label: 'Taper', kind: 'range', min: -0.9, max: 0.9, step: 0.01 },
  ],
  defaults: { depth: 0.4, sides: 24, caps: true, taper: 0 },
  apply(g, p) {
    const depth = num(p, 'depth'), sides = int(p, 'sides'), taper = num(p, 'taper');
    const lines: Polyline[] = [];
    const nodes = [...g.nodes];
    for (const l of g.lines) {
      const pl = planeOf(l.pts);
      const flat = l.pts.length >= 3 && flatness(l.pts, pl) < 0.02;
      const dir: Vec3 = flat ? pl.n : [0, 0, 1];
      const c = pl.c;
      // Front at +depth/2, back at -depth/2 (scaled toward the centre by the taper).
      const at = (q: Vec3, s: number): Vec3 => {
        const k = 1 - (taper * (1 - s)) / 2;
        return [c[0] + (q[0] - c[0]) * k + dir[0] * s * depth / 2, c[1] + (q[1] - c[1]) * k + dir[1] * s * depth / 2, c[2] + (q[2] - c[2]) * k + dir[2] * s * depth / 2];
      };
      // Wall normals: across the outline and outward. The winding of a closed outline
      // says which side is out (so concave corners face the right way); an open line
      // just faces away from its centre.
      const n = l.pts.length;
      let wind = 0;
      if (l.closed && flat)
        for (let i = 0; i < n; i++) {
          const [x0, y0] = to2(l.pts[i], pl), [x1, y1] = to2(l.pts[(i + 1) % n], pl);
          wind += x0 * y1 - x1 * y0;
        }
      const wall = l.pts.map((q, i) => {
        const ia = l.closed ? l.pts[(i - 1 + n) % n] : l.pts[Math.max(0, i - 1)];
        const ib = l.closed ? l.pts[(i + 1) % n] : l.pts[Math.min(n - 1, i + 1)];
        const tan: Vec3 = [ib[0] - ia[0], ib[1] - ia[1], ib[2] - ia[2]];
        let w = norm(cross(tan, dir));
        const out = wind ? wind < 0 : w[0] * (q[0] - c[0]) + w[1] * (q[1] - c[1]) + w[2] * (q[2] - c[2]) < 0;
        if (out) w = [-w[0], -w[1], -w[2]];
        return w;
      });
      // A cap edge is shared by the wall and the cap face, so it shows when either faces
      // the viewer: give it the average of the two normals.
      const edge = (sgn: number) => wall.map((w) => norm([w[0] + dir[0] * sgn, w[1] + dir[1] * sgn, w[2] + dir[2] * sgn]));
      lines.push({ ...l, pts: l.pts.map((q) => at(q, 1)), normals: edge(1), band: 7 });
      if (bool(p, 'caps')) lines.push({ ...l, pts: l.pts.map((q) => at(q, -1)), normals: edge(-1), band: 7 });
      for (let k = 0; k < sides; k++) {
        const i = Math.floor((k * (l.closed ? n : n - 1)) / Math.max(1, l.closed ? sides : sides - 1));
        const q = l.pts[Math.min(n - 1, i)];
        const pts: Vec3[] = [];
        for (let s = 0; s <= 6; s++) pts.push(at(q, 1 - (2 * s) / 6));
        lines.push({ pts, normals: pts.map(() => wall[Math.min(n - 1, i)]), family: l.family, tone: l.tone });
      }
    }
    return { lines, nodes, labels: g.labels };
  },
};
