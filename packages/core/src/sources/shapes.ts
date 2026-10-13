import { clamp } from '../math.js';

/** Outlines shared by the sources that draw blocks (strip, context). */

export type Pt = [number, number];

export const EPS = 1e-9;
/** The most a slant may take of the block it sits on, so a short block never folds over itself. */
export const BITE = 0.45;

/** A polygon corner and the radius it is rounded to. */
export interface Corner {
  x: number;
  y: number;
  r: number;
}

/** Merge repeated points and drop points in the middle of a straight edge. */
export function tidy(poly: Corner[]): Corner[] {
  const pts: Corner[] = [];
  for (const c of poly) {
    const p = pts[pts.length - 1];
    if (p && Math.hypot(c.x - p.x, c.y - p.y) < EPS) p.r = Math.max(p.r, c.r);
    else pts.push({ ...c });
  }
  while (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < EPS) {
    pts[0].r = Math.max(pts[0].r, pts[pts.length - 1].r);
    pts.pop();
  }
  const n = pts.length;
  return pts.filter((b, i) => {
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    const [abx, aby, bcx, bcy] = [b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y];
    const straight = Math.abs(abx * bcy - aby * bcx) < 1e-9 * Math.hypot(abx, aby) * Math.hypot(bcx, bcy) && abx * bcx + aby * bcy > 0;
    return !straight;
  });
}

/**
 * Round the corners of a polygon. Each corner takes its own radius, cut back to half of the shorter edge beside it
 * so that neighbouring fillets never overlap. `res` is the number of arc segments in a quarter turn.
 */
export function fillet(poly: Corner[], res: number): Pt[] {
  const n = poly.length;
  const out: Pt[] = [];
  const push = (x: number, y: number) => {
    const p = out[out.length - 1];
    if (!p || Math.hypot(x - p[0], y - p[1]) > EPS) out.push([x, y]);
  };
  for (let i = 0; i < n; i++) {
    const v = poly[i], a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const [ux, uy, wx, wy] = [a.x - v.x, a.y - v.y, b.x - v.x, b.y - v.y];
    const [lu, lw] = [Math.hypot(ux, uy), Math.hypot(wx, wy)];
    // The interior angle at the corner; nearly straight corners are left alone.
    const theta = Math.acos(clamp((ux * wx + uy * wy) / (lu * lw || 1), -1, 1));
    if (!(v.r > 0) || res <= 0 || !(lu > 0 && lw > 0) || Math.PI - theta < 0.06) {
      push(v.x, v.y);
      continue;
    }
    const tn = Math.tan(theta / 2);
    const d = Math.min(v.r / tn, lu / 2, lw / 2), r = d * tn;
    const [dux, duy, dwx, dwy] = [ux / lu, uy / lu, wx / lw, wy / lw];
    const bl = Math.hypot(dux + dwx, duy + dwy) || 1;
    const away = r / Math.sin(theta / 2);
    const [cx, cy] = [v.x + ((dux + dwx) / bl) * away, v.y + ((duy + dwy) / bl) * away];
    const [px, py, qx, qy] = [v.x + dux * d, v.y + duy * d, v.x + dwx * d, v.y + dwy * d];
    const a0 = Math.atan2(py - cy, px - cx);
    let da = Math.atan2(qy - cy, qx - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil((Math.abs(da) / (Math.PI / 2)) * res));
    push(px, py);
    for (let s = 1; s < steps; s++) push(cx + r * Math.cos(a0 + (da * s) / steps), cy + r * Math.sin(a0 + (da * s) / steps));
    push(qx, qy);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= EPS) out.pop();
  return out;
}



export interface SlabOpts {
  /** Tangent of the slant: how far a slanted end's top corner is pulled in, per unit of height (0 = square). */
  lean?: number;
  /** Slant the start (left) end: its top corner is pulled right, so the bottom corner reaches past it. */
  start?: boolean;
  /** Slant the finish (right) end: its top corner is pulled left, so the bottom corner reaches past it. */
  finish?: boolean;
  /** Corner radius, in the same units as the coordinates. Cut back where an edge is too short for it. */
  radius?: number;
  /** Arc segments per quarter turn of a fillet; 0 leaves corners sharp. */
  res?: number;
}

/**
 * The outline of one block from `x0` to `x1` and `y0` to `y1` (either way round), counter-clockwise from the bottom left,
 * with optional forward-slanted ends and rounded corners. A slant never takes more than `BITE` of the block's length.
 */
export function slab(x0: number, x1: number, y0: number, y1: number, o: SlabOpts = {}): Pt[] {
  const [xa, xb] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ya, yb] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const lean = Math.min(Math.max(0, o.lean ?? 0) * (yb - ya), BITE * (xb - xa));
  const r = clamp(o.radius ?? 0, 0, (yb - ya) / 2);
  const corners: Corner[] = [
    { x: xa, y: ya, r },
    { x: xb, y: ya, r },
    { x: o.finish ? xb - lean : xb, y: yb, r },
    { x: o.start ? xa + lean : xa, y: yb, r },
  ];
  return fillet(tidy(corners), o.res ?? 0);
}
