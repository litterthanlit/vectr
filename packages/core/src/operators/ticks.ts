import { arcLengths, sampleLine } from '../geo.js';
import { TAU, bool, clamp, cross, int, lerp, norm, num, rng, str } from '../math.js';
import type { OpDef, Polyline, Vec3 } from '../types.js';

/** Upper bound on ticks per form, so dense stacks stay interactive. */
const MAX_TICKS = 12_000;

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Unit normal of the polygon through the points (Newell's method), or null when they are collinear. */
function planeNormal(pts: Vec3[]): Vec3 | null {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return len(n) > 1e-9 ? norm(n) : null;
}

export const ticks: OpDef = {
  kind: 'ticks',
  name: 'Ticks',
  blurb: 'Hatch marks along every line — dials, rulers, combs',
  params: [
    { key: 'count', label: 'Ticks per line', kind: 'range', min: 2, max: 720, step: 1 },
    { key: 'length', label: 'Length', kind: 'range', min: 0, max: 1.5, step: 0.005 },
    { key: 'side', label: 'Side', kind: 'select', options: [{ value: 'out', label: 'Outside' }, { value: 'in', label: 'Inside' }, { value: 'both', label: 'Both' }] },
    { key: 'majorEvery', label: 'Major every', kind: 'range', min: 0, max: 36, step: 1, help: 'Every Nth tick is longer (0 = none)' },
    { key: 'majorLength', label: 'Major length', kind: 'range', min: 1, max: 4, step: 0.05, help: 'Length multiplier for major ticks' },
    { key: 'vary', label: 'Vary length', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: 'wave', label: 'Wave' }, { value: 'random', label: 'Random' }] },
    { key: 'amount', label: 'Variation', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'vary', in: ['wave', 'random'] } },
    { key: 'cycles', label: 'Cycles', kind: 'range', min: 1, max: 24, step: 1, when: { key: 'vary', in: ['wave'] } },
    {
      key: 'direction', label: 'Direction', kind: 'select',
      options: [{ value: 'flat', label: "In the line's plane" }, { value: 'normal', label: 'Along surface normals' }],
    },
    { key: 'keepLines', label: 'Keep lines', kind: 'toggle' },
    { key: 'seed', label: 'Seed', kind: 'seed', when: { key: 'vary', in: ['random'] } },
  ],
  defaults: {
    count: 120, length: 0.12, side: 'out', majorEvery: 0, majorLength: 2, vary: 'none', amount: 0.5, cycles: 3,
    direction: 'flat', keepLines: true, seed: 9,
  },
  apply(g, p) {
    if (!g.lines.length) return g;
    const side = str(p, 'side'), vary = str(p, 'vary'), alongNormals = str(p, 'direction') === 'normal';
    const length = Math.max(0, num(p, 'length')), major = Math.max(0, int(p, 'majorEvery')), majorLen = Math.max(1, num(p, 'majorLength'));
    const amount = clamp(num(p, 'amount'), 0, 1), cycles = num(p, 'cycles');
    const r = rng(int(p, 'seed'));

    // Lines with at least two distinct points; very large stacks give each line fewer ticks, or skip lines.
    const usable = g.lines
      .map((line) => ({ line, lens: arcLengths(line.pts, line.closed) }))
      .filter(({ line, lens }) => line.pts.length >= 2 && lens[lens.length - 1] > 1e-9);
    const stride = Math.max(1, Math.ceil(usable.length / MAX_TICKS));
    const picked = usable.filter((_, i) => i % stride === 0);
    const count = clamp(int(p, 'count'), 1, Math.max(1, Math.floor(MAX_TICKS / Math.max(1, picked.length))));

    const e = 0.002;
    const out: Polyline[] = [];
    for (const { line, lens } of picked) {
      const closed = !!line.closed;
      const around = planeNormal(line.pts);
      for (let i = 0; i < count; i++) {
        const u = closed ? i / count : count > 1 ? i / (count - 1) : 0.5;
        const s = sampleLine(line, u, lens);
        // Always draw the random number so lengths don't shift when other params change.
        const rand = r();
        const rise = closed ? sampleLine(line, (u + e) % 1, lens).p : sampleLine(line, Math.min(1, u + e), lens).p;
        const fall = closed ? sampleLine(line, (u - e + 1) % 1, lens).p : sampleLine(line, Math.max(0, u - e), lens).p;
        const tangent: Vec3 = [rise[0] - fall[0], rise[1] - fall[1], rise[2] - fall[2]];

        let d: Vec3 | null = null;
        if (alongNormals && s.n && len(s.n) > 1e-9) d = norm(s.n);
        // In the line's plane, perpendicular to the line. Straight or edge-on lines fall back to Z, then Y, then X.
        const tl = len(tangent);
        for (const axis of [around ?? [0, 0, 1], [0, 1, 0], [1, 0, 0]] as Vec3[]) {
          if (d || tl < 1e-12) break;
          const c = cross(tangent, axis);
          if (len(c) > 1e-6 * tl) d = norm(c);
        }
        if (!d) continue;

        const factor = vary === 'wave' ? Math.max(0, 1 + amount * Math.sin(TAU * cycles * u)) : vary === 'random' ? lerp(1 - amount, 1, rand) : 1;
        const L = length * (major > 0 && i % major === 0 ? majorLen : 1) * factor;
        if (L < 1e-9) continue;

        const [from, to] =
          side === 'in' ? [0, -L] : side === 'both' ? [-L / 2, L / 2] : [0, L];
        out.push({
          pts: [
            [s.p[0] + d[0] * from, s.p[1] + d[1] * from, s.p[2] + d[2] * from],
            [s.p[0] + d[0] * to, s.p[1] + d[1] * to, s.p[2] + d[2] * to],
          ],
          normals: s.n ? [s.n, s.n] : undefined,
          t: [s.t, s.t],
          family: line.family,
          tone: line.tone,
        });
      }
    }
    return { lines: bool(p, 'keepLines') ? [...g.lines, ...out] : out, nodes: g.nodes, labels: g.labels };
  },
};
