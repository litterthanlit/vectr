/**
 * Editable vector paths: anchors with Bézier handles, the way Figma and
 * Illustrator model them. Everything here is pure and DOM-free so the canvas,
 * the MCP server and the tests share one implementation.
 *
 * Handles are stored relative to their anchor. `null` means "no handle", so a
 * segment between two handle-less anchors is a straight line.
 */
import type { Vec2 } from './types';

export type AnchorKind = 'corner' | 'smooth' | 'symmetric';

export interface Anchor {
  x: number;
  y: number;
  /** Incoming handle, relative to the anchor. */
  in: Vec2 | null;
  /** Outgoing handle, relative to the anchor. */
  out: Vec2 | null;
  /** corner = handles move independently, smooth = collinear, symmetric = mirrored. */
  kind: AnchorKind;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
}

export interface VectorPath {
  subpaths: SubPath[];
  fillRule?: 'nonzero' | 'evenodd';
}

/** Affine matrix [a, b, c, d, e, f] as in SVG: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];
export type Cubic = [Vec2, Vec2, Vec2, Vec2];

const EPS = 1e-9;
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

const vadd = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const vsub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const vmul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const vdot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const vlen = (a: Vec2) => Math.hypot(a[0], a[1]);
const vnorm = (a: Vec2): Vec2 => {
  const l = vlen(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
};
const vlerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const round = (n: number, p = 3) => {
  const k = 10 ** p;
  const r = Math.round(n * k) / k;
  return Object.is(r, -0) ? 0 : r;
};

export const anchor = (x: number, y: number, inH: Vec2 | null = null, outH: Vec2 | null = null, kind?: AnchorKind): Anchor => ({
  x, y, in: inH, out: outH, kind: kind ?? inferKind(inH, outH),
});

export const pos = (a: Anchor): Vec2 => [a.x, a.y];

/** Classify a handle pair by geometry. */
export function inferKind(inH: Vec2 | null, outH: Vec2 | null): AnchorKind {
  if (!inH || !outH) return 'corner';
  const li = vlen(inH), lo = vlen(outH);
  if (li < EPS || lo < EPS) return 'corner';
  const cos = vdot(inH, outH) / (li * lo);
  if (cos > -0.9995) return 'corner';
  return Math.abs(li - lo) < Math.max(0.01, 0.01 * Math.max(li, lo)) ? 'symmetric' : 'smooth';
}

export const clonePath = (p: VectorPath): VectorPath => ({
  ...p,
  subpaths: p.subpaths.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({ ...a, in: a.in && [a.in[0], a.in[1]], out: a.out && [a.out[0], a.out[1]] })),
  })),
});

export const anchorCount = (p: VectorPath) => p.subpaths.reduce((n, s) => n + s.anchors.length, 0);

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export const segmentCount = (s: SubPath) => (s.closed ? s.anchors.length : Math.max(0, s.anchors.length - 1));

/** The cubic for segment i (from anchor i to i+1, wrapping when closed). */
export function segmentCubic(s: SubPath, i: number): Cubic {
  const a = s.anchors[i];
  const b = s.anchors[(i + 1) % s.anchors.length];
  const p0 = pos(a), p3 = pos(b);
  return [p0, a.out ? vadd(p0, a.out) : p0, b.in ? vadd(p3, b.in) : p3, p3];
}

export const isLine = (s: SubPath, i: number) => {
  const a = s.anchors[i];
  const b = s.anchors[(i + 1) % s.anchors.length];
  return !a.out && !b.in;
};

export function cubicAt([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function cubicDeriv([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const u = 1 - t;
  return [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
}

/** de Casteljau split: returns the two halves of a cubic at t. */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = vlerp(p0, p1, t), b = vlerp(p1, p2, t), c = vlerp(p2, p3, t);
  const d = vlerp(a, b, t), e = vlerp(b, c, t);
  const m = vlerp(d, e, t);
  return [[p0, a, d, m], [m, e, c, p3]];
}

/** Extrema-aware bounding box of a cubic. */
function cubicBounds(c: Cubic): [number, number, number, number] {
  const ts = [0, 1];
  for (const k of [0, 1] as const) {
    const [p0, p1, p2, p3] = c.map((p) => p[k]);
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const cc = p1 - p0;
    if (Math.abs(a) < EPS) {
      if (Math.abs(b) > EPS) ts.push(-cc / b);
    } else {
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
      }
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of ts) {
    if (t < 0 || t > 1) continue;
    const [x, y] = cubicAt(c, t);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export interface Box { x: number; y: number; w: number; h: number }

export function pathBounds(p: VectorPath): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of p.subpaths) {
    if (s.anchors.length === 1) {
      const a = s.anchors[0];
      x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y);
    }
    for (let i = 0; i < segmentCount(s); i++) {
      const [a, b, c, d] = cubicBounds(segmentCubic(s, i));
      x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------
// Affine transforms
// ---------------------------------------------------------------------------

export const applyAffine = (m: Affine, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const applyLinear = (m: Affine, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/** m1 · m2 (apply m2 first). */
export const multiply = (m1: Affine, m2: Affine): Affine => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const i = 1 / det;
  return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
}

/** Affine maps preserve Béziers exactly, so transforming anchors + handles is lossless. */
export function transformPath(p: VectorPath, m: Affine): VectorPath {
  return {
    ...p,
    subpaths: p.subpaths.map((s) => ({
      closed: s.closed,
      anchors: s.anchors.map((a) => {
        const [x, y] = applyAffine(m, pos(a));
        const inH = a.in && applyLinear(m, a.in);
        const outH = a.out && applyLinear(m, a.out);
        // Non-uniform scale can break symmetry; re-derive the kind but keep "corner" intent.
        const kind = a.kind === 'corner' ? 'corner' : inferKind(inH, outH);
        return { x, y, in: inH, out: outH, kind };
      }),
    })),
  };
}

export const translatePath = (p: VectorPath, dx: number, dy: number) => transformPath(p, [1, 0, 0, 1, dx, dy]);

// ---------------------------------------------------------------------------
// Serialisation: VectorPath -> SVG path data
// ---------------------------------------------------------------------------

const fmt = (n: number, precision: number) => {
  const r = round(n, precision);
  return r.toString();
};

export function pathToD(p: VectorPath, precision = 2): string {
  const out: string[] = [];
  const P = (v: Vec2) => `${fmt(v[0], precision)} ${fmt(v[1], precision)}`;
  for (const s of p.subpaths) {
    if (!s.anchors.length) continue;
    out.push(`M${P(pos(s.anchors[0]))}`);
    const n = segmentCount(s);
    for (let i = 0; i < n; i++) {
      const [, c1, c2, p3] = segmentCubic(s, i);
      const lastClosing = s.closed && i === n - 1;
      if (isLine(s, i)) {
        if (!lastClosing) out.push(`L${P(p3)}`);
      } else {
        out.push(`C${P(c1)} ${P(c2)} ${P(p3)}`);
      }
    }
    if (s.closed) out.push('Z');
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Parsing: SVG path data -> VectorPath (all commands, absolute and relative)
// ---------------------------------------------------------------------------

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) tokens.push(m[1] ?? parseFloat(m[2]));
  return tokens;
}

/** Arc flags may be written without separators ("a1 1 0 00 1 1"), so read them digit by digit. */
function readArcArgs(d: string): string {
  return d.replace(/([Aa])([^MmLlHhVvCcSsQqTtAaZz]*)/g, (_, cmd: string, body: string) => {
    const nums: string[] = [];
    const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
    let idx = 0;
    let pos0 = 0;
    while (pos0 < body.length) {
      const slot = idx % 7;
      const rest = body.slice(pos0);
      const lead = rest.match(/^[\s,]*/)![0].length;
      pos0 += lead;
      if (pos0 >= body.length) break;
      if (slot === 3 || slot === 4) {
        const ch = body[pos0];
        if (ch === '0' || ch === '1') {
          nums.push(ch);
          pos0 += 1;
          idx++;
          continue;
        }
      }
      re.lastIndex = pos0;
      const mm = re.exec(body);
      if (!mm || mm.index !== pos0) break;
      nums.push(mm[0]);
      pos0 += mm[0].length;
      idx++;
    }
    return `${cmd}${nums.join(' ')} `;
  });
}

/** Convert an SVG elliptical arc to cubic Béziers (each ≤ 90°). */
function arcToCubics(p0: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p: Vec2): Cubic[] {
  if (rx === 0 || ry === 0) return [[p0, p0, p, p]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p[0]) / 2, dy = (p0[1] - p[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / segs;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number): Vec2 => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const dv = (t: number): Vec2 => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: Cubic[] = [];
  let ta = t1;
  let pa = p0;
  for (let i = 0; i < segs; i++) {
    const tb = ta + step;
    const pb = i === segs - 1 ? p : pt(tb);
    const da = dv(ta), db = dv(tb);
    out.push([pa, vadd(pa, vmul(da, alpha)), vsub(pb, vmul(db, alpha)), pb]);
    ta = tb;
    pa = pb;
  }
  return out;
}

export function parsePathD(d: string): VectorPath {
  const tokens = tokenize(/[Aa]/.test(d) ? readArcArgs(d) : d);
  const subpaths: SubPath[] = [];
  let cur: SubPath | null = null;
  let pt: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let lastCtrl: Vec2 | null = null; // for S/T reflection
  let lastCmd = '';
  let i = 0;

  const begin = (p: Vec2) => {
    cur = { anchors: [anchor(p[0], p[1])], closed: false };
    subpaths.push(cur);
    start = p;
  };
  const ensure = () => {
    if (!cur) begin(pt);
    return cur!;
  };
  const cubicTo = (c1: Vec2, c2: Vec2, p: Vec2) => {
    const s = ensure();
    const last = s.anchors[s.anchors.length - 1];
    const o = vsub(c1, pos(last));
    last.out = vlen(o) < EPS ? null : o;
    const inH = vsub(c2, p);
    s.anchors.push(anchor(p[0], p[1], vlen(inH) < EPS ? null : inH, null));
    pt = p;
  };
  const lineTo = (p: Vec2) => {
    const s = ensure();
    s.anchors.push(anchor(p[0], p[1]));
    pt = p;
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    if (typeof cmd === 'string') {
      i++;
    } else {
      // Implicit repeat of the previous command (M repeats as L).
      if (!lastCmd) break;
      cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
    }
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    const n = ARG_COUNT[C];
    if (n === undefined) break;
    if (C === 'Z') {
      if (cur) {
        const s: SubPath = cur;
        if (s.anchors.length > 1) {
          const first = s.anchors[0], last = s.anchors[s.anchors.length - 1];
          if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
            first.in = last.in;
            s.anchors.pop();
          }
        }
        s.closed = true;
      }
      pt = start;
      cur = null;
      lastCtrl = null;
      lastCmd = cmd;
      continue;
    }
    const args: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i++];
      if (typeof v !== 'number') return finish(subpaths);
      args.push(v);
    }
    const ox = rel ? pt[0] : 0, oy = rel ? pt[1] : 0;
    switch (C) {
      case 'M': {
        const p: Vec2 = [args[0] + ox, args[1] + oy];
        begin(p);
        pt = p;
        lastCtrl = null;
        break;
      }
      case 'L':
        lineTo([args[0] + ox, args[1] + oy]);
        lastCtrl = null;
        break;
      case 'H':
        lineTo([args[0] + (rel ? pt[0] : 0), pt[1]]);
        lastCtrl = null;
        break;
      case 'V':
        lineTo([pt[0], args[0] + (rel ? pt[1] : 0)]);
        lastCtrl = null;
        break;
      case 'C': {
        const c1: Vec2 = [args[0] + ox, args[1] + oy], c2: Vec2 = [args[2] + ox, args[3] + oy], p: Vec2 = [args[4] + ox, args[5] + oy];
        cubicTo(c1, c2, p);
        lastCtrl = c2;
        break;
      }
      case 'S': {
        const c1: Vec2 = lastCtrl && /[CcSs]/.test(lastCmd) ? vsub(vmul(pt, 2), lastCtrl) : pt;
        const c2: Vec2 = [args[0] + ox, args[1] + oy], p: Vec2 = [args[2] + ox, args[3] + oy];
        cubicTo(c1, c2, p);
        lastCtrl = c2;
        break;
      }
      case 'Q': {
        const q: Vec2 = [args[0] + ox, args[1] + oy], p: Vec2 = [args[2] + ox, args[3] + oy];
        const p0 = pt;
        cubicTo(vlerp(p0, q, 2 / 3), vlerp(p, q, 2 / 3), p);
        lastCtrl = q;
        break;
      }
      case 'T': {
        const q: Vec2 = lastCtrl && /[QqTt]/.test(lastCmd) ? vsub(vmul(pt, 2), lastCtrl) : pt;
        const p: Vec2 = [args[0] + ox, args[1] + oy];
        const p0 = pt;
        cubicTo(vlerp(p0, q, 2 / 3), vlerp(p, q, 2 / 3), p);
        lastCtrl = q;
        break;
      }
      case 'A': {
        const p: Vec2 = [args[5] + ox, args[6] + oy];
        const cubics = arcToCubics(pt, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, p);
        for (const [, c1, c2, e] of cubics) cubicTo(c1, c2, e);
        lastCtrl = null;
        break;
      }
    }
    lastCmd = cmd;
  }
  return finish(subpaths);
}

function finish(subpaths: SubPath[]): VectorPath {
  for (const s of subpaths) for (const a of s.anchors) a.kind = inferKind(a.in, a.out);
  return { subpaths: subpaths.filter((s) => s.anchors.length > 0) };
}

// ---------------------------------------------------------------------------
// Construction helpers (agent friendly)
// ---------------------------------------------------------------------------

/**
 * A smooth curve passing through every point (Catmull-Rom converted to cubic
 * Béziers). Agents are good at placing points and bad at handle maths, so this
 * is the main way they sketch organic shapes.
 */
export function smoothThrough(points: Vec2[], closed = false, tension = 1): SubPath {
  const n = points.length;
  const anchors = points.map(([x, y]) => anchor(x, y));
  if (n < 3 && !closed) return { anchors, closed };
  const k = tension / 6;
  for (let i = 0; i < n; i++) {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tan = vmul(vsub(next, prev), k);
    const a = anchors[i];
    if (!closed && i === 0) {
      a.out = vlen(tan) < EPS ? null : tan;
      a.kind = 'corner';
    } else if (!closed && i === n - 1) {
      a.in = vlen(tan) < EPS ? null : vmul(tan, -1);
      a.kind = 'corner';
    } else {
      a.in = vmul(tan, -1);
      a.out = tan;
      a.kind = 'symmetric';
    }
  }
  return { anchors, closed };
}

export const polyline = (points: Vec2[], closed = false): SubPath => ({ anchors: points.map(([x, y]) => anchor(x, y)), closed });

const KAPPA = 0.5522847498;

export function ellipsePath(cx: number, cy: number, rx: number, ry = rx): VectorPath {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    subpaths: [{
      closed: true,
      anchors: [
        anchor(cx, cy - ry, [-kx, 0], [kx, 0], 'symmetric'),
        anchor(cx + rx, cy, [0, -ky], [0, ky], 'symmetric'),
        anchor(cx, cy + ry, [kx, 0], [-kx, 0], 'symmetric'),
        anchor(cx - rx, cy, [0, ky], [0, -ky], 'symmetric'),
      ],
    }],
  };
}

export function rectPath(x: number, y: number, w: number, h: number, r = 0): VectorPath {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < EPS) return { subpaths: [polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)] };
  const k = r * KAPPA;
  const A = (px: number, py: number, inH: Vec2 | null, outH: Vec2 | null) => anchor(px, py, inH, outH, 'corner');
  return {
    subpaths: [{
      closed: true,
      anchors: [
        A(x + r, y, [-k, 0], null), A(x + w - r, y, null, [k, 0]),
        A(x + w, y + r, [0, -k], null), A(x + w, y + h - r, null, [0, k]),
        A(x + w - r, y + h, [k, 0], null), A(x + r, y + h, null, [-k, 0]),
        A(x, y + h - r, [0, k], null), A(x, y + r, null, [0, -k]),
      ],
    }],
  };
}

export function polygonPath(cx: number, cy: number, r: number, sides: number, rotationDeg = 0): VectorPath {
  const pts: Vec2[] = [];
  const n = Math.max(3, Math.round(sides));
  for (let i = 0; i < n; i++) {
    const a = ((rotationDeg - 90) * Math.PI) / 180 + (i * 2 * Math.PI) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { subpaths: [polyline(pts, true)] };
}

export function starPath(cx: number, cy: number, outer: number, inner: number, points: number, rotationDeg = 0): VectorPath {
  const pts: Vec2[] = [];
  const n = Math.max(2, Math.round(points));
  for (let i = 0; i < n * 2; i++) {
    const a = ((rotationDeg - 90) * Math.PI) / 180 + (i * Math.PI) / n;
    const r = i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { subpaths: [polyline(pts, true)] };
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

/** Insert an anchor on segment `seg` at parameter t without changing the shape. */
export function insertAnchor(s: SubPath, seg: number, t: number): SubPath {
  const n = s.anchors.length;
  const anchors = s.anchors.map((a) => ({ ...a }));
  const i = seg, j = (seg + 1) % n;
  if (isLine(s, seg)) {
    const p = vlerp(pos(anchors[i]), pos(anchors[j]), t);
    anchors.splice(i + 1, 0, anchor(p[0], p[1]));
    return { closed: s.closed, anchors };
  }
  const [left, right] = splitCubic(segmentCubic(s, seg), t);
  const m = left[3];
  anchors[i] = { ...anchors[i], out: nullIfZero(vsub(left[1], left[0])) };
  anchors[j] = { ...anchors[j], in: nullIfZero(vsub(right[2], right[3])) };
  const inH = nullIfZero(vsub(left[2], m));
  const outH = nullIfZero(vsub(right[1], m));
  anchors.splice(i + 1, 0, { x: m[0], y: m[1], in: inH, out: outH, kind: inH && outH ? 'smooth' : 'corner' });
  return { closed: s.closed, anchors };
}

const nullIfZero = (v: Vec2): Vec2 | null => (vlen(v) < 1e-6 ? null : v);

export interface NearestHit { sub: number; seg: number; t: number; point: Vec2; dist: number }

/** Closest point on the path (coarse sampling refined by bisection). */
export function nearestOnPath(p: VectorPath, target: Vec2): NearestHit | null {
  let best: NearestHit | null = null;
  p.subpaths.forEach((s, si) => {
    for (let seg = 0; seg < segmentCount(s); seg++) {
      const c = segmentCubic(s, seg);
      const N = 48;
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const d = vlen(vsub(cubicAt(c, t), target));
        if (d < bd) { bd = d; bt = t; }
      }
      let lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
      for (let it = 0; it < 24; it++) {
        const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
        if (vlen(vsub(cubicAt(c, t1), target)) < vlen(vsub(cubicAt(c, t2), target))) hi = t2;
        else lo = t1;
      }
      const t = (lo + hi) / 2;
      const pt = cubicAt(c, t);
      const d = vlen(vsub(pt, target));
      if (!best || d < best.dist) best = { sub: si, seg, t, point: pt, dist: d };
    }
  });
  return best;
}

export type AnchorRef = [sub: number, index: number];
export const refKey = ([s, i]: AnchorRef) => `${s}:${i}`;
export const parseRef = (k: string): AnchorRef => k.split(':').map(Number) as AnchorRef;

/** Remove anchors. Subpaths left with fewer than two anchors disappear. */
export function deleteAnchors(p: VectorPath, refs: AnchorRef[]): VectorPath {
  const kill = new Set(refs.map(refKey));
  const subpaths = p.subpaths
    .map((s, si) => ({ closed: s.closed, anchors: s.anchors.filter((_, ai) => !kill.has(`${si}:${ai}`)) }))
    .filter((s) => s.anchors.length >= 2)
    .map((s) => (s.anchors.length === 2 && s.closed ? { ...s, closed: false } : s));
  return { ...p, subpaths };
}

/** Auto handles from neighbours (used when a corner is converted to smooth). */
export function autoHandles(s: SubPath, i: number, tension = 1): { in: Vec2 | null; out: Vec2 | null } {
  const n = s.anchors.length;
  const a = pos(s.anchors[i]);
  const hasPrev = s.closed || i > 0, hasNext = s.closed || i < n - 1;
  const prev = hasPrev ? pos(s.anchors[(i - 1 + n) % n]) : null;
  const next = hasNext ? pos(s.anchors[(i + 1) % n]) : null;
  if (!prev && !next) return { in: null, out: null };
  const dir = vnorm(prev && next ? vsub(next, prev) : next ? vsub(next, a) : vsub(a, prev!));
  const li = prev ? (vlen(vsub(a, prev)) / 3) * tension : 0;
  const lo = next ? (vlen(vsub(next, a)) / 3) * tension : 0;
  return { in: prev ? vmul(dir, -li) : null, out: next ? vmul(dir, lo) : null };
}

export type KindChange = AnchorKind | 'straight';

/** Change an anchor's type: straight removes handles, smooth/symmetric align (or create) them. */
export function setAnchorKind(s: SubPath, i: number, kind: KindChange): Anchor {
  const a = s.anchors[i];
  if (kind === 'straight') return { ...a, in: null, out: null, kind: 'corner' };
  if (kind === 'corner') return { ...a, kind: 'corner' };
  let inH = a.in, outH = a.out;
  if (!inH && !outH) {
    const h = autoHandles(s, i);
    inH = h.in;
    outH = h.out;
  } else {
    const auto = autoHandles(s, i);
    const dir = inH && outH ? vnorm(vsub(outH, inH)) : vnorm(outH ?? vmul(inH!, -1));
    const li = inH ? vlen(inH) : auto.in ? vlen(auto.in) : 0;
    const lo = outH ? vlen(outH) : auto.out ? vlen(auto.out) : 0;
    inH = li > EPS ? vmul(dir, -li) : null;
    outH = lo > EPS ? vmul(dir, lo) : null;
  }
  if (kind === 'symmetric' && inH && outH) {
    const l = (vlen(inH) + vlen(outH)) / 2;
    const dir = vnorm(outH);
    inH = vmul(dir, -l);
    outH = vmul(dir, l);
  }
  return { ...a, in: inH, out: outH, kind: inH && outH ? kind : 'corner' };
}

/**
 * Move one handle to a new relative position, honouring the anchor's kind:
 * symmetric mirrors the opposite handle, smooth keeps it collinear (preserving
 * its length), corner (or `breakLink`) leaves it alone.
 */
export function moveHandle(a: Anchor, which: 'in' | 'out', rel: Vec2, breakLink = false): Anchor {
  const other = which === 'in' ? 'out' : 'in';
  const next: Anchor = { ...a, [which]: nullIfZero(rel) };
  if (breakLink) next.kind = 'corner';
  else if (a.kind === 'symmetric') next[other] = nullIfZero(vmul(rel, -1));
  else if (a.kind === 'smooth' && a[other]) {
    const l = vlen(a[other]!);
    next[other] = vlen(rel) < EPS ? a[other] : vmul(vnorm(rel), -l);
  }
  if (!next.in || !next.out) next.kind = next.kind === 'corner' ? 'corner' : a.kind;
  return next;
}

export const reverseSub = (s: SubPath): SubPath => {
  const anchors = [...s.anchors].reverse().map((a) => ({ ...a, in: a.out, out: a.in }));
  return { closed: s.closed, anchors };
};

// ---------------------------------------------------------------------------
// Flattening, curve fitting and clean-up
// ---------------------------------------------------------------------------

/** Adaptive flattening of a cubic into a polyline (excluding the start point). */
function flattenCubic(c: Cubic, tol: number, out: Vec2[], depth = 0) {
  const [p0, p1, p2, p3] = c;
  const d1 = distToLine(p1, p0, p3), d2 = distToLine(p2, p0, p3);
  if (depth > 12 || Math.max(d1, d2) <= tol) {
    out.push(p3);
    return;
  }
  const [a, b] = splitCubic(c, 0.5);
  flattenCubic(a, tol, out, depth + 1);
  flattenCubic(b, tol, out, depth + 1);
}

function distToLine(p: Vec2, a: Vec2, b: Vec2) {
  const ab = vsub(b, a);
  const l = vlen(ab);
  if (l < EPS) return vlen(vsub(p, a));
  return Math.abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / l;
}

export function flattenSub(s: SubPath, tol = 0.25): Vec2[] {
  if (!s.anchors.length) return [];
  const pts: Vec2[] = [pos(s.anchors[0])];
  for (let i = 0; i < segmentCount(s); i++) {
    if (isLine(s, i)) pts.push(segmentCubic(s, i)[3]);
    else flattenCubic(segmentCubic(s, i), tol, pts);
  }
  return pts;
}

/** Densely resample a polyline so the fitter gets even parameterisation. */
function resample(pts: Vec2[], spacing: number): Vec2[] {
  if (pts.length < 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = vlen(vsub(b, a));
    const steps = Math.max(1, Math.ceil(l / spacing));
    for (let k = 1; k <= steps; k++) out.push(vlerp(a, b, k / steps));
  }
  return out;
}

/** Ramer–Douglas–Peucker. */
export function rdp(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  let idx = -1, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToLine(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  const a = rdp(pts.slice(0, idx + 1), tol);
  const b = rdp(pts.slice(idx), tol);
  return [...a.slice(0, -1), ...b];
}

// --- Schneider's "An Algorithm for Automatically Fitting Digitized Curves" ---

function chordParams(pts: Vec2[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(pts: Vec2[], u: number[], t1: Vec2, t2: Vec2): Cubic {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a1 = vmul(t1, b1), a2 = vmul(t2, b2);
    c00 += vdot(a1, a1); c01 += vdot(a1, a2); c11 += vdot(a2, a2);
    const tmp = vsub(pts[i], vadd(vmul(p0, b0 + b1), vmul(p3, b2 + b3)));
    x0 += vdot(a1, tmp); x1 += vdot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0, alpha2 = 0;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }
  const seg = vlen(vsub(p3, p0));
  const eps = 1e-6 * seg;
  if (alpha1 < eps || alpha2 < eps) {
    alpha1 = alpha2 = seg / 3;
  }
  return [p0, vadd(p0, vmul(t1, alpha1)), vadd(p3, vmul(t2, alpha2)), p3];
}

function maxError(pts: Vec2[], c: Cubic, u: number[]): [number, number] {
  let max = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = vlen(vsub(cubicAt(c, u[i]), pts[i]));
    if (d > max) { max = d; idx = i; }
  }
  return [max, idx];
}

function reparameterize(pts: Vec2[], u: number[], c: Cubic): number[] {
  return u.map((t, i) => {
    const d = vsub(cubicAt(c, t), pts[i]);
    const d1 = cubicDeriv(c, t);
    // second derivative
    const [p0, p1, p2, p3] = c;
    const d2: Vec2 = [
      6 * (1 - t) * (p2[0] - 2 * p1[0] + p0[0]) + 6 * t * (p3[0] - 2 * p2[0] + p1[0]),
      6 * (1 - t) * (p2[1] - 2 * p1[1] + p0[1]) + 6 * t * (p3[1] - 2 * p2[1] + p1[1]),
    ];
    const num = vdot(d, d1);
    const den = vdot(d1, d1) + vdot(d, d2);
    if (Math.abs(den) < EPS) return t;
    return Math.min(1, Math.max(0, t - num / den));
  });
}

function fitCubic(pts: Vec2[], t1: Vec2, t2: Vec2, error: number, out: Cubic[], depth = 0) {
  if (pts.length === 2) {
    const d = vlen(vsub(pts[1], pts[0])) / 3;
    out.push([pts[0], vadd(pts[0], vmul(t1, d)), vadd(pts[1], vmul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let c = generateBezier(pts, u, t1, t2);
  let [err, split] = maxError(pts, c, u);
  if (err < error) { out.push(c); return; }
  if (err < error * 4) {
    for (let k = 0; k < 20; k++) {
      u = reparameterize(pts, u, c);
      c = generateBezier(pts, u, t1, t2);
      [err, split] = maxError(pts, c, u);
      if (err < error) { out.push(c); return; }
    }
  }
  if (depth > 18) { out.push(c); return; }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const center = vnorm(vsub(pts[split - 1], pts[split + 1]));
  fitCubic(pts.slice(0, split + 1), t1, center, error, out, depth + 1);
  fitCubic(pts.slice(split), vmul(center, -1), t2, error, out, depth + 1);
}

function tangentAt(pts: Vec2[], i: number, forward: boolean): Vec2 {
  // Look a few samples ahead for a stable tangent on noisy input.
  const step = forward ? 1 : -1;
  const base = pts[i];
  for (let k = 1; k < Math.min(6, pts.length); k++) {
    const j = i + step * k;
    if (j < 0 || j >= pts.length) break;
    const v = vsub(pts[j], base);
    if (vlen(v) > EPS && k >= Math.min(3, pts.length - 1)) return vnorm(v);
  }
  const j = Math.max(0, Math.min(pts.length - 1, i + step));
  return vnorm(vsub(pts[j], base));
}

/** Indices of sharp turns in a polyline (angle in degrees between incoming and outgoing directions). */
function findCorners(pts: Vec2[], closed: boolean, angleDeg: number, reach: number): number[] {
  const n = pts.length;
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  const corners: number[] = [];
  const at = (i: number) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    // Walk out by arc length so the test ignores sampling noise.
    const walk = (dir: 1 | -1) => {
      let j = i, acc = 0;
      while (acc < reach && Math.abs(j - i) < n - 1) {
        const nj = j + dir;
        if (!closed && (nj < 0 || nj >= n)) break;
        acc += vlen(vsub(at(nj), at(j)));
        j = nj;
      }
      return at(j);
    };
    const a = vnorm(vsub(pts[i], walk(-1)));
    const b = vnorm(vsub(walk(1), pts[i]));
    if (vdot(a, b) < cosLimit) corners.push(i);
  }
  // Keep only the sharpest index in each cluster.
  const out: number[] = [];
  for (const c of corners) {
    if (out.length && c - out[out.length - 1] <= 2) continue;
    out.push(c);
  }
  return out;
}

export interface SimplifyOptions {
  /** Max deviation from the original, in path units. */
  tolerance?: number;
  /** Turns sharper than this (degrees) stay corners. */
  cornerAngle?: number;
}

/**
 * Rebuild a subpath with as few anchors as possible while staying within
 * `tolerance` of the original. Corners stay corners, straight runs become
 * handle-less lines and curves become smooth anchors.
 */
export function simplifySub(s: SubPath, opts: SimplifyOptions = {}): SubPath {
  const tolerance = Math.max(0.01, opts.tolerance ?? 1);
  const cornerAngle = opts.cornerAngle ?? 40;
  let pts = flattenSub(s, tolerance / 8);
  if (s.closed && pts.length > 1 && vlen(vsub(pts[0], pts[pts.length - 1])) < EPS) pts.pop();
  // Collapse duplicates.
  pts = pts.filter((p, i) => i === 0 || vlen(vsub(p, pts[i - 1])) > EPS);
  if (pts.length < 3) return { closed: s.closed && pts.length > 2, anchors: pts.map(([x, y]) => anchor(x, y)) };

  const spacing = Math.max(tolerance / 2, 0.25);
  const cornersRaw = findCorners(pts, s.closed, cornerAngle, spacing * 3);

  // Split into runs between corners.
  let ring = pts;
  let corners = cornersRaw;
  if (s.closed) {
    const startAt = corners.length ? corners[0] : 0;
    ring = [...pts.slice(startAt), ...pts.slice(0, startAt)];
    corners = corners.map((c) => (c - startAt + pts.length) % pts.length);
    ring.push(ring[0]);
    if (!corners.length || corners[0] !== 0) corners = [0, ...corners];
    corners.push(ring.length - 1);
  } else {
    corners = [0, ...corners, pts.length - 1];
  }
  const cornerSet = new Set(corners);
  const hadCorner = cornersRaw.length > 0;

  const cubics: Cubic[] = [];
  const cornerAfter: boolean[] = []; // whether the end of cubic k is a hard corner
  for (let k = 0; k < corners.length - 1; k++) {
    const run = resample(ring.slice(corners[k], corners[k + 1] + 1), spacing);
    if (run.length < 2) continue;
    const before = cubics.length;
    const straight = rdp(run, tolerance);
    if (straight.length === 2) {
      const [a, b] = straight;
      cubics.push([a, a, b, b]);
    } else {
      const smoothLoop = s.closed && !hadCorner;
      const t1 = smoothLoop ? vnorm(vsub(run[1], run[run.length - 2])) : tangentAt(run, 0, true);
      const t2 = smoothLoop ? vmul(t1, -1) : tangentAt(run, run.length - 1, false);
      fitCubic(run, t1, t2, tolerance, cubics);
    }
    for (let j = before; j < cubics.length; j++) cornerAfter.push(j === cubics.length - 1 && cornerSet.has(corners[k + 1]));
  }
  if (!cubics.length) return s;

  const anchors: Anchor[] = [];
  const isStraight = (c: Cubic) => distToLine(c[1], c[0], c[3]) < tolerance * 0.05 && distToLine(c[2], c[0], c[3]) < tolerance * 0.05;
  cubics.forEach((c, k) => {
    const straight = isStraight(c);
    if (k === 0) anchors.push(anchor(c[0][0], c[0][1]));
    const prev = anchors[anchors.length - 1];
    prev.out = straight ? null : nullIfZero(vsub(c[1], c[0]));
    anchors.push({ x: c[3][0], y: c[3][1], in: straight ? null : nullIfZero(vsub(c[2], c[3])), out: null, kind: 'corner' });
  });
  if (s.closed) {
    const last = anchors.pop()!;
    anchors[0].in = last.in;
  }
  // Kinds: anything not flagged as a corner with two collinear handles is smooth.
  anchors.forEach((a, i) => {
    const k = inferKind(a.in, a.out);
    const hard = s.closed ? (i === 0 ? hadCorner : cornerAfter[i - 1]) : i === 0 || i === anchors.length - 1 || cornerAfter[i - 1];
    a.kind = hard ? 'corner' : k;
    if (!hard && a.in && a.out && k === 'corner') {
      // Nearly collinear from fitting noise: snap to smooth.
      const dir = vnorm(vsub(a.out, a.in));
      a.in = vmul(dir, -vlen(a.in));
      a.out = vmul(dir, vlen(a.out));
      a.kind = 'smooth';
    }
  });
  return { closed: s.closed, anchors };
}

export function simplifyPath(p: VectorPath, opts: SimplifyOptions = {}): VectorPath {
  return { ...p, subpaths: p.subpaths.map((s) => simplifySub(s, opts)) };
}

/**
 * Light-touch tidy that never moves the curve by more than `eps`:
 * merges coincident anchors, drops zero-length handles, removes redundant
 * anchors in the middle of straight lines and rounds coordinates.
 */
export function cleanupPath(p: VectorPath, eps = 0.01, precision = 2): VectorPath {
  const subpaths: SubPath[] = [];
  for (const s of p.subpaths) {
    let anchors: Anchor[] = s.anchors.map((a) => ({
      x: round(a.x, precision), y: round(a.y, precision),
      in: a.in && vlen(a.in) > eps ? [round(a.in[0], precision), round(a.in[1], precision)] as Vec2 : null,
      out: a.out && vlen(a.out) > eps ? [round(a.out[0], precision), round(a.out[1], precision)] as Vec2 : null,
      kind: a.kind,
    }));
    // Merge coincident neighbours.
    const merged: Anchor[] = [];
    for (const a of anchors) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.x - a.x) <= eps && Math.abs(last.y - a.y) <= eps) {
        last.out = a.out;
        last.kind = inferKind(last.in, last.out);
      } else merged.push(a);
    }
    if (s.closed && merged.length > 1) {
      const f = merged[0], l = merged[merged.length - 1];
      if (Math.abs(f.x - l.x) <= eps && Math.abs(f.y - l.y) <= eps) {
        f.in = l.in;
        merged.pop();
      }
    }
    anchors = merged;
    // Drop anchors that sit on a straight line between straight neighbours.
    let changed = true;
    while (changed && anchors.length > (s.closed ? 3 : 2)) {
      changed = false;
      const n = anchors.length;
      for (let i = 0; i < n; i++) {
        if (!s.closed && (i === 0 || i === n - 1)) continue;
        const a = anchors[i];
        if (a.in || a.out) continue;
        const prev = anchors[(i - 1 + n) % n], next = anchors[(i + 1) % n];
        if (prev.out || next.in) continue;
        if (distToLine(pos(a), pos(prev), pos(next)) <= eps) {
          const t = vdot(vsub(pos(a), pos(prev)), vsub(pos(next), pos(prev)));
          if (t >= 0 && t <= vdot(vsub(pos(next), pos(prev)), vsub(pos(next), pos(prev)))) {
            anchors.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
    }
    for (const a of anchors) if (!(a.in && a.out)) a.kind = 'corner';
    if (anchors.length) subpaths.push({ closed: s.closed && anchors.length > 1, anchors });
  }
  return { ...p, subpaths };
}

/** Rough "how clean is this?" metric shown to designers and agents. */
export function pathStats(p: VectorPath) {
  let anchors = 0, corners = 0, smooth = 0, lines = 0, curves = 0;
  for (const s of p.subpaths) {
    anchors += s.anchors.length;
    for (const a of s.anchors) a.kind === 'corner' ? corners++ : smooth++;
    for (let i = 0; i < segmentCount(s); i++) isLine(s, i) ? lines++ : curves++;
  }
  return { subpaths: p.subpaths.length, anchors, corners, smooth, lines, curves };
}
