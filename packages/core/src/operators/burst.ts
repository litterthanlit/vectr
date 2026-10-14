import { arcLengths } from '../geo.js';
import { TAU, bool, clamp, int, lerp, num, smoothstep, str } from '../math.js';
import { rand } from '../sources/words.js';
import type { GeoLabel, GeoNode, OpDef, Polyline, Vec3 } from '../types.js';

/** Points a burst may produce, leaving the pipeline's budget some room. Shatter backs off before it would pass this. */
const MAX_POINTS = 52_000;
/** In horizontal mode a piece's path tilts at most this much (rise over run) away from level. */
const FAN = 0.3;
/** A piece stretched to `long` times its length is drawn in across to `long` ** -THIN of its width, as dough thins when it is pulled. */
const THIN = 0.3;

/** Streams of random numbers, one per decision, so that no decision shifts another. */
const S = { cut: 21, drop: 22, wobble: 23, reach: 24, stretch: 25, pick: 27, angle: 28, dist: 29, size: 30, ray: 31, near: 33 } as const;

/** A piece of one of the input's lines, with the attributes that interpolate where it is cut. */
interface Frag {
  pts: Vec3[];
  t?: number[];
  normals?: Vec3[];
  closed: boolean;
  src: Polyline;
  /** Two numbers that name the piece for the random streams: its line, and which slice of it. */
  a: number;
  b: number;
}
type Cuttable = Pick<Frag, 'pts' | 't' | 'normals'>;

const mix = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const unit2 = (x: number, y: number): [number, number] => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : v;
};

/**
 * Smooth noise on a circle: `lobes` random values spread round the angle and blended between, so pieces at
 * nearby angles get nearby values and fall into the same ray.
 */
function ring(seed: number, stream: number, angle: number, lobes: number): number {
  const u = (((angle / TAU) % 1) + 1) % 1 * lobes;
  const i = Math.floor(u), f = smoothstep(0, 1, u - i);
  return lerp(rand(seed, stream, i % lobes), rand(seed, stream, (i + 1) % lobes), f);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cutting

/** Keep the part of a polygon on one side of the vertical line x = c (Sutherland–Hodgman). Concave shapes are fine: they are only filled. */
function clip(f: Cuttable, c: number, above: boolean): Cuttable {
  const { pts, t, normals } = f;
  const n = pts.length;
  const side = (i: number) => (pts[i][0] - c) * (above ? 1 : -1);
  const out: Vec3[] = [], ot: number[] = [], on: Vec3[] = [];
  const emit = (i: number, j: number, k: number) => {
    out.push(k === 0 ? pts[i] : mix(pts[i], pts[j], k));
    if (t) ot.push(k === 0 ? t[i] : lerp(t[i], t[j], k));
    if (normals) on.push(k === 0 ? normals[i] : unit(mix(normals[i], normals[j], k)));
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, si = side(i), sj = side(j);
    if (si >= 0) emit(i, j, 0);
    if (si >= 0 !== sj >= 0) emit(i, j, si / (si - sj));
  }
  // Drop repeated points, which the cut leaves where it touches a corner.
  const same = (i: number, j: number) => Math.hypot(out[i][0] - out[j][0], out[i][1] - out[j][1], out[i][2] - out[j][2]) < 1e-9;
  const keep = out.map((_, i) => !(i > 0 && same(i, i - 1)));
  if (out.length > 1 && same(0, out.length - 1)) keep[out.length - 1] = false;
  return { pts: out.filter((_, i) => keep[i]), t: t && ot.filter((_, i) => keep[i]), normals: normals && on.filter((_, i) => keep[i]) };
}

const area = (pts: Vec3[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Where the cuts across a shape fall, as fractions of its extent: evenly spaced, each nudged by up to 35% of a slice. */
const cuts = (seed: number, a: number, k: number) => Array.from({ length: k - 1 }, (_, j) => (j + 1 + (rand(seed, S.cut, a, j) - 0.5) * 0.7) / k);

/** A closed shape as `k` vertical slices (slab by slab). Slices with no area are dropped. */
function slice(f: Frag, k: number, seed: number): Frag[] {
  let lo = Infinity, hi = -Infinity;
  for (const p of f.pts) [lo, hi] = [Math.min(lo, p[0]), Math.max(hi, p[0])];
  if (!(hi - lo > 1e-9) || k < 2) return [f];
  const at = cuts(seed, f.a, k).map((u) => lo + (hi - lo) * u);
  const out: Frag[] = [];
  for (let j = 0; j < k; j++) {
    let piece: Cuttable = f;
    if (j > 0) piece = clip(piece, at[j - 1], true);
    if (piece.pts.length >= 3 && j < k - 1) piece = clip(piece, at[j], false);
    if (piece.pts.length >= 3 && Math.abs(area(piece.pts)) > 1e-10) out.push({ ...f, ...piece, b: j });
  }
  return out.length ? out : [f];
}

/** An open line as `k` runs, each ending where the next begins, cut by arc length. */
function runs(f: Frag, k: number, seed: number): Frag[] {
  const lens = arcLengths(f.pts, false), total = lens[lens.length - 1];
  if (!(total > 1e-9) || k < 2 || f.pts.length < 2) return [f];
  const edges = [0, ...cuts(seed, f.a, k), 1].map((u) => u * total);
  const pointAt = (d: number) => {
    let i = 1;
    while (i < lens.length - 1 && lens[i] < d) i++;
    const w = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    return { p: mix(f.pts[i - 1], f.pts[i], w), t: f.t && lerp(f.t[i - 1], f.t[i], w), n: f.normals && unit(mix(f.normals[i - 1], f.normals[i], w)) };
  };
  const out: Frag[] = [];
  for (let j = 0; j < k; j++) {
    const [d0, d1] = [edges[j], edges[j + 1]];
    const a = pointAt(d0), b = pointAt(d1);
    const inside = f.pts.map((_, i) => i).filter((i) => lens[i] > d0 + 1e-12 && lens[i] < d1 - 1e-12);
    out.push({
      ...f, b: j,
      pts: [a.p, ...inside.map((i) => f.pts[i]), b.p],
      t: f.t && [a.t!, ...inside.map((i) => f.t![i]), b.t!],
      normals: f.normals && [a.n!, ...inside.map((i) => f.normals![i]), b.n!],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pieces

/** Centre of a piece: the area centroid of a shape, else the mean of its points. */
function centroid(f: Frag): [number, number] {
  const { pts } = f;
  const n = pts.length;
  let a = 0, cx = 0, cy = 0;
  if (f.closed && n >= 3) {
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], w = p[0] * q[1] - q[0] * p[1];
      a += w;
      cx += (p[0] + q[0]) * w;
      cy += (p[1] + q[1]) * w;
    }
    if (Math.abs(a) > 1e-12) return [cx / (3 * a), cy / (3 * a)];
  }
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

/** The angle of a piece's long axis, from the spread of its points. */
function axis(f: Frag, c: [number, number]): number {
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of f.pts) {
    const [x, y] = [p[0] - c[0], p[1] - c[1]];
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  return sxx + syy > 1e-18 ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : 0;
}

/** The smallest turn from angle `a` to angle `b`, both directions of an unsigned axis, so within a quarter turn. */
const turn = (a: number, b: number) => {
  let d = (b - a) % Math.PI;
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  return d;
};

/** A piece or point that survived, as the spray needs it: where it ended up, how far it reaches, which way it flew, and what it carries. */
interface Flown {
  x: number;
  y: number;
  ext: number;
  ux: number;
  uy: number;
  e: number;
  t: number;
  family: number;
}

/**
 * Burst: blow a form apart from a centre, like an explosion with a hot core. Each line is a piece (closed shapes are first cut
 * into `shatter` vertical slices, open lines into runs), and each piece moves as a whole about its own centre:
 *
 *   - inside `core` nothing happens, and beyond it the piece is pushed straight out by `strength` × (distance past the core)^`falloff`;
 *   - it is turned toward its flight by `align`, pulled into a streak along it by `stretch` (drawn in across it as it thins),
 *     and dropped with a probability `scatter` that grows with distance;
 *   - `jitter` bends and lengthens whole bundles of neighbouring pieces together (smooth noise round the angle), so the rays are
 *     ragged and some stay short while others fly far, rather than every piece wandering on its own;
 *   - `spray` droplets are thrown by the pieces, the more likely the farther one flew, and land past its tip along its path. They are
 *     points, drawn with markers; the depth of a droplet sets how big the marker is.
 *
 * Shapes stay closed and keep their `t`, `family` and `tone`. Surface normals turn with their piece (about z, so hidden-line
 * styling stays sane); ribbon `band`s are dropped, since neighbouring lines no longer neighbour each other. Every draw is a
 * stateless hash of the seed, a stream and the piece, so changing one setting never reshuffles another.
 */
export const burst: OpDef = {
  kind: 'burst',
  name: 'Burst',
  blurb: 'Blow the form apart from a centre — a dense core, streaks and spray',
  params: [
    {
      key: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'radial', label: 'Radial' }, { value: 'horizontal', label: 'Horizontal' }],
      help: 'Radial: pieces fly out from the centre in every direction. Horizontal: they stay level and fly mostly sideways, like a burst of bars',
    },
    { key: 'cx', label: 'Centre X', kind: 'range', min: -2, max: 2, step: 0.01 },
    { key: 'cy', label: 'Centre Y', kind: 'range', min: -2, max: 2, step: 0.01 },
    { key: 'core', label: 'Core', kind: 'range', min: 0, max: 2, step: 0.01, help: 'Radius around the centre that stays nearly intact' },
    { key: 'strength', label: 'Strength', kind: 'range', min: 0, max: 3, step: 0.01, help: 'How far pieces are pushed out' },
    { key: 'falloff', label: 'Falloff', kind: 'range', min: 0.2, max: 4, step: 0.05, help: 'Below 1, pieces just past the core jump almost as far as those at the edge; above 1, the push builds up towards the edge' },
    { key: 'align', label: 'Align', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'mode', in: ['radial'] }, help: 'Turn each piece toward the direction it flies' },
    { key: 'stretch', label: 'Stretch', kind: 'range', min: 0, max: 4, step: 0.01, help: 'Pull pieces out into streaks along their flight, thinner across it, more the farther they are' },
    { key: 'scatter', label: 'Scatter', kind: 'range', min: 0, max: 1, step: 0.01, help: 'Drop pieces towards the edge, thinning it out' },
    { key: 'jitter', label: 'Jitter', kind: 'range', min: 0, max: 1, step: 0.01, help: 'Make the rays ragged: some directions fly far and keep their pieces, others stay short and bare' },
    { key: 'shatter', label: 'Shatter', kind: 'range', min: 0, max: 24, step: 1, help: 'Cut each closed shape into this many vertical slices first, and each open line into runs. A heavy field gets fewer to stay within the point budget' },
    { key: 'keepPoints', label: 'Keep points', kind: 'toggle', help: 'Keep the form\'s own points, moved with their pieces. Off leaves only the spray, so markers show droplets and do not thicken every piece' },
    { key: 'spray', label: 'Spray', kind: 'range', min: 0, max: 600, step: 1, help: 'Droplets thrown past the pieces, as points. Show them with markers; bigger markers survive the ink finish' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: {
    mode: 'radial', cx: 0, cy: 0, core: 0.3, strength: 0.8, falloff: 1.8, align: 0.35, stretch: 1.2, scatter: 0.35, jitter: 0.8, shatter: 3, keepPoints: false, spray: 300, seed: 5,
  },
  apply(g, p) {
    if (!g.lines.length && !g.nodes.length && !g.labels?.length) return g;
    const horizontal = str(p, 'mode') === 'horizontal';
    const v = (key: string, lo: number, hi: number) => clamp(num(p, key) || 0, lo, hi);
    const seed = int(p, 'seed');
    const [ox, oy] = [v('cx', -2, 2), v('cy', -2, 2)];
    const core = v('core', 0, 2), strength = v('strength', 0, 3), falloff = v('falloff', 0.2, 4);
    const align = horizontal ? 0 : v('align', 0, 1), stretch = v('stretch', 0, 4), scatter = v('scatter', 0, 1), jitter = v('jitter', 0, 1);
    const shatter = Math.round(v('shatter', 0, 24)), spray = Math.round(v('spray', 0, 600));

    // 1. Pieces: each closed shape is cut into slices and each open line into runs, as many as the point budget allows.
    const whole: Frag[] = g.lines.map((src, a) => ({ pts: src.pts, t: src.t, normals: src.normals, closed: !!src.closed && src.pts.length >= 3, src, a, b: 0 }));
    const nShapes = whole.filter((f) => f.closed).length, nOpen = whole.filter((f) => !f.closed && f.pts.length >= 2).length;
    const have = whole.reduce((s, f) => s + f.pts.length, 0);
    // A convex shape gains four points per extra slice, an open line two.
    const room = MAX_POINTS - have - g.nodes.length - spray;
    const k = shatter < 2 ? 1 : clamp(1 + Math.floor(room / Math.max(1, 4 * nShapes + 2 * nOpen)), 1, shatter);
    const frags: Frag[] = [];
    for (const f of whole) {
      if (k < 2 || f.pts.length < 2 || f.pts.some((q) => !q.every(Number.isFinite))) frags.push(f);
      else frags.push(...(f.closed ? slice(f, k, seed) : runs(f, k, seed)));
    }

    // 2. Where a piece or point centred at (x, y) goes: its push direction, how far, its stretch, and whether it survives.
    const place = (x: number, y: number, a: number, b: number) => {
      const [dx, dy] = [x - ox, y - oy];
      const r = Math.hypot(dx, dy);
      const th0 = r > 1e-9 ? Math.atan2(dy, dx) : rand(seed, S.wobble, a, b) * TAU;
      // Rays are noise round the angle (in horizontal mode, down the rows and per side, so bands of rows fly alike).
      const at = horizontal ? dy * 3.2 + (dx < 0 ? 2.3 : 0) : th0;
      const e = Math.max(0, r - core);
      // Neighbours share a direction and a reach, so pieces gather into spikes with gaps between them; a little noise of their
      // own frays the spikes. `jitter` takes the burst from even to spiky.
      const spike = smoothstep(0.5, 0.95, ring(seed, S.reach, at, 9)) * (0.45 + 0.55 * ring(seed, S.reach + 100, at, 23)) + 0.12 * ring(seed, S.reach + 200, at, 5);
      const bend = (ring(seed, S.ray, at, 7) - 0.5) * 0.9 + (ring(seed, S.ray + 100, at, 19) - 0.5) * 0.5 + (rand(seed, S.angle, a, b) - 0.5) * 0.25;
      // Rows far above or below the centre fly less far, so the bars make a lens rather than a block.
      const lens = horizontal ? 1 - 0.6 * smoothstep(0.2, 1.3, Math.abs(dy)) : 1;
      const reach = lens * lerp(1, lerp(0.35, 1.9, spike), jitter) * (1 + 0.5 * jitter * (rand(seed, S.dist, a, b) - 0.5));
      let ux: number, uy: number;
      if (horizontal) {
        // Sideways, with a slight fan: the farther above or below the centre, the more the path tilts away.
        const side = Math.abs(dx) > 0.01 ? Math.sign(dx) : rand(seed, S.wobble, a, b) < 0.5 ? -1 : 1;
        [ux, uy] = unit2(side, FAN * Math.tanh(dy / (0.35 + Math.abs(dx))) + jitter * bend * 0.3);
      } else {
        const th = th0 + jitter * bend;
        [ux, uy] = [Math.cos(th), Math.sin(th)];
      }
      const push = strength * reach * Math.pow(e, falloff) * smoothstep(0, 0.12, e);
      const heat = clamp(e / 1.05, 0, 1);
      const drop = clamp(scatter * Math.pow(heat, 1.2) * lerp(1, 2.6 - 2.4 * spike, jitter), 0, 1) > rand(seed, S.drop, a, b);
      const long = 1 + 6 * stretch * lens * Math.pow(e, 1.2) * (0.35 + 1.3 * Math.pow(rand(seed, S.stretch, a, b), 1.6)) * lerp(1, 0.4 + 1.2 * spike, jitter);
      // Pieces stretch along their flight and are drawn in across it, as dough thins when it is pulled; in horizontal mode they
      // stretch along the bars, which stay level and keep their height.
      const [sx, sy] = horizontal ? [1, 0] : [ux, uy];
      return { ux, uy, sx, sy, push, drop, long, thin: horizontal ? 1 : Math.pow(long, -THIN), gate: smoothstep(0, 0.3, e), e };
    };

    // 3. Move the pieces: turn toward the direction of flight, stretch along it, then push.
    const lines: Polyline[] = [];
    const flown: Flown[] = [];
    for (const f of frags) {
      const { band: _band, ...out } = f.src;
      const c = centroid(f);
      if (!c.every(Number.isFinite)) {
        lines.push({ ...out, pts: f.pts, t: f.t, normals: f.normals });
        continue;
      }
      const m = place(c[0], c[1], f.a, f.b);
      if (m.drop) continue;
      const rot = align * m.gate * turn(axis(f, c), Math.atan2(m.uy, m.ux));
      let { pts, normals } = f;
      // A piece in the core goes nowhere and keeps its shape; it is left exactly as it was.
      if (m.push > 1e-12 || m.long !== 1 || rot !== 0) {
        const [cr, sr] = [Math.cos(rot), Math.sin(rot)];
        pts = f.pts.map((q): Vec3 => {
          const [x, y] = [q[0] - c[0], q[1] - c[1]];
          const [rx, ry] = [x * cr - y * sr, x * sr + y * cr];
          const par = rx * m.sx + ry * m.sy;
          // Pulled out along the flight and drawn in across it, as dough thins when it is stretched.
          const [px, py] = [rx - par * m.sx, ry - par * m.sy];
          const [kl, kp] = [par * (m.long - 1), m.thin - 1];
          return [c[0] + rx + m.sx * kl + px * kp + m.ux * m.push, c[1] + ry + m.sy * kl + py * kp + m.uy * m.push, q[2]];
        });
        // Normals turn with their piece (about z) and are otherwise left as they were.
        normals = f.normals?.map((n): Vec3 => [n[0] * cr - n[1] * sr, n[0] * sr + n[1] * cr, n[2]]);
      }
      lines.push({ ...out, pts, normals, t: f.t });
      const [px, py] = [c[0] + m.ux * m.push, c[1] + m.uy * m.push];
      const t = f.t ? f.t.reduce((s, q) => s + q, 0) / f.t.length : 0.5;
      flown.push({ x: px, y: py, ext: pts.reduce((far, q) => Math.max(far, Math.hypot(q[0] - px, q[1] - py)), 0), ux: m.ux, uy: m.uy, e: m.e, t, family: f.src.family ?? 0 });
    }

    // Points fly like very small pieces of their own. When there is a point for every line (a field of blocks) each rides with its
    // line, so a marker still sits on its streak. They are kept only with `keepPoints`, but always throw spray.
    const nodes: GeoNode[] = [];
    const flownNodes: Flown[] = [];
    const keep = bool(p, 'keepPoints');
    const paired = g.nodes.length === g.lines.length;
    g.nodes.forEach((nd, i) => {
      if (!nd.p.every(Number.isFinite)) return void (keep && nodes.push(nd));
      const c = paired && whole[i].pts.length ? centroid(whole[i]) : [nd.p[0], nd.p[1]];
      const m = c.every(Number.isFinite) ? place(c[0], c[1], paired ? i : -1 - i, 0) : place(nd.p[0], nd.p[1], -1 - i, 0);
      if (m.drop) return;
      const [px, py] = [nd.p[0] + m.ux * m.push, nd.p[1] + m.uy * m.push];
      if (keep) nodes.push({ ...nd, p: [px, py, nd.p[2]] });
      flownNodes.push({ x: px, y: py, ext: 0, ux: m.ux, uy: m.uy, e: m.e, t: nd.t ?? 0.5, family: nd.family ?? 0 });
    });
    const labels: GeoLabel[] | undefined = g.labels?.map((lb) => {
      if (!lb.p.every(Number.isFinite)) return lb;
      const m = place(lb.p[0], lb.p[1], -1_000_001, 0);
      return { ...lb, p: [lb.p[0] + m.ux * m.push, lb.p[1] + m.uy * m.push, lb.p[2]] };
    });

    // 4. Spray: each droplet is thrown by one of the pieces (the more likely the farther it flew) and lands past it, along its path.
    // A form of points alone has no pieces, so its points throw them.
    const sources = flown.length ? flown : flownNodes;
    if (spray && sources.length) {
      const cum: number[] = [];
      let total = 0;
      for (const s of sources) cum.push((total += 0.05 + s.e * s.e));
      for (let i = 0; i < spray; i++) {
        const pick = rand(seed, S.pick, i) * total;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < pick) lo = mid + 1;
          else hi = mid;
        }
        const s = sources[lo];
        const ang = Math.atan2(s.uy, s.ux) + (rand(seed, S.near, i) - 0.5) * 0.12 * (0.4 + jitter);
        // Most droplets fall just past the tip of the piece, a few far out; the farther the piece flew, the farther they travel.
        const far = -Math.log(1 - rand(seed, S.dist + 100, i) * 0.995) * (0.04 + 0.14 * s.e);
        const d = s.ext * 0.9 + far;
        // Big droplets are rare and stay near; the smallest go farthest. Size shows through the depth of the marker.
        const size = Math.pow(rand(seed, S.size, i), 1.7) * (1 - 0.45 * clamp(far / 0.5, 0, 1));
        nodes.push({ p: [s.x + Math.cos(ang) * d, s.y + Math.sin(ang) * d, -0.2 * (1 - size)], t: s.t, family: s.family });
      }
    }
    return { lines, nodes, labels };
  },
};
