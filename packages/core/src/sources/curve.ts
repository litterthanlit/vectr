import { TAU, clamp, gcd, int, lerp, num, rng, str } from '../math.js';
import type { ParamDef, Params, Polyline, SourceDef, Vec3 } from '../types.js';

type Shape =
  | 'line' | 'arc' | 'circle' | 'rect' | 'polygon' | 'star' | 'squircle' | 'flower' | 'blob'
  | 'spiral' | 'wave' | 'trochoid' | 'lissajous' | 'knot' | 'profile';

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'arc', label: 'Arc' },
  { value: 'line', label: 'Line' },
  { value: 'rect', label: 'Rectangle' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'star', label: 'Star' },
  { value: 'squircle', label: 'Squircle' },
  { value: 'flower', label: 'Flower' },
  { value: 'blob', label: 'Blob' },
  { value: 'spiral', label: 'Spiral / helix' },
  { value: 'wave', label: 'Wave' },
  { value: 'trochoid', label: 'Trochoid' },
  { value: 'lissajous', label: 'Lissajous' },
  { value: 'knot', label: 'Torus knot' },
  { value: 'profile', label: 'Vessel profile' },
];

const PROFILES: Record<string, (h: number, top: number, bottom: number, curve: number) => number> = {
  trumpet: (h, top, bottom, curve) => bottom + (top - bottom) * Math.pow(h, curve),
  cone: (h, top, bottom) => lerp(bottom, top, h),
  hourglass: (h, top, bottom, curve) => bottom + (top - bottom) * Math.pow(Math.abs(2 * h - 1), curve),
  vase: (h, top, bottom, curve) => lerp(bottom, top, h) + 0.35 * Math.sin(Math.PI * Math.pow(h, 1 / curve)),
  bowl: (h, top, bottom, curve) => bottom + (top - bottom) * Math.pow(Math.sin((h * Math.PI) / 2), 1 / curve),
  bulb: (h, top, bottom) => lerp(bottom, top, h) + 0.6 * Math.sin(Math.PI * h) * (1 - h * 0.4),
};

const only = (...shapes: Shape[]) => ({ key: 'shape', in: shapes });

const params: ParamDef[] = [
  { key: 'shape', label: 'Shape', kind: 'select', options: SHAPES },
  { key: 'size', label: 'Size', kind: 'range', min: 0.05, max: 2, step: 0.01 },
  { key: 'sweep', label: 'Sweep', kind: 'range', min: 5, max: 360, step: 1, unit: '°', when: only('arc') },
  { key: 'start', label: 'Start angle', kind: 'range', min: -180, max: 180, step: 1, unit: '°', when: only('arc') },
  { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.2, max: 4, step: 0.01, when: only('rect', 'lissajous') },
  { key: 'sides', label: 'Sides / petals', kind: 'range', min: 3, max: 24, step: 1, when: only('polygon', 'star', 'flower') },
  { key: 'inner', label: 'Inner / depth', kind: 'range', min: 0.05, max: 1, step: 0.01, when: only('star', 'flower', 'blob', 'spiral') },
  { key: 'round', label: 'Roundness', kind: 'range', min: 0, max: 1, step: 0.01, when: only('rect', 'polygon', 'star', 'squircle') },
  { key: 'turns', label: 'Turns', kind: 'range', min: 0.25, max: 16, step: 0.25, when: only('spiral') },
  { key: 'pitch', label: 'Rise', kind: 'range', min: 0, max: 3, step: 0.01, when: only('spiral'), help: 'Above 0 the spiral climbs into a helix' },
  { key: 'cycles', label: 'Cycles', kind: 'range', min: 0.5, max: 24, step: 0.5, when: only('wave') },
  { key: 'amplitude', label: 'Amplitude', kind: 'range', min: 0, max: 1.5, step: 0.01, when: only('wave') },
  { key: 'ring', label: 'Ring teeth', kind: 'range', min: 10, max: 120, step: 1, when: only('trochoid') },
  { key: 'wheel', label: 'Wheel teeth', kind: 'range', min: 3, max: 100, step: 1, when: only('trochoid') },
  { key: 'pen', label: 'Pen offset', kind: 'range', min: 0, max: 1.6, step: 0.01, when: only('trochoid') },
  {
    key: 'outside', label: 'Roll outside', kind: 'toggle', when: only('trochoid'),
  },
  { key: 'fx', label: 'X frequency', kind: 'range', min: 1, max: 12, step: 1, when: only('lissajous') },
  { key: 'fy', label: 'Y frequency', kind: 'range', min: 1, max: 12, step: 1, when: only('lissajous') },
  { key: 'fz', label: 'Z frequency', kind: 'range', min: 0, max: 12, step: 1, when: only('lissajous'), help: 'Above 0 the figure becomes 3D' },
  { key: 'phase', label: 'Phase', kind: 'range', min: 0, max: 360, step: 1, unit: '°', when: only('wave', 'lissajous') },
  { key: 'p', label: 'P winds', kind: 'range', min: 1, max: 9, step: 1, when: only('knot') },
  { key: 'q', label: 'Q winds', kind: 'range', min: 1, max: 12, step: 1, when: only('knot') },
  { key: 'tube', label: 'Loop radius', kind: 'range', min: 0.05, max: 0.8, step: 0.01, when: only('knot') },
  {
    key: 'profile', label: 'Profile', kind: 'select', when: only('profile'),
    options: Object.keys(PROFILES).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
  },
  { key: 'top', label: 'Top width', kind: 'range', min: 0.02, max: 1.2, step: 0.01, when: only('profile') },
  { key: 'bottom', label: 'Bottom width', kind: 'range', min: 0.02, max: 1.2, step: 0.01, when: only('profile') },
  { key: 'curve', label: 'Curvature', kind: 'range', min: 0.3, max: 5, step: 0.05, when: only('profile') },
  { key: 'height', label: 'Height', kind: 'range', min: 0.2, max: 4, step: 0.01, when: only('profile') },
  { key: 'seed', label: 'Seed', kind: 'seed', when: only('blob') },
];

const defaults = {
  shape: 'circle', size: 1, sweep: 180, start: 0, aspect: 1.5, sides: 6, inner: 0.5, round: 0.3,
  turns: 3, pitch: 0, cycles: 3, amplitude: 0.35, ring: 96, wheel: 36, pen: 0.8, outside: false,
  fx: 3, fy: 2, fz: 0, phase: 90, p: 2, q: 5, tube: 0.35, profile: 'trumpet', top: 0.9, bottom: 0.2, curve: 2.2, height: 2, seed: 7,
};

/** Rounded polygon via quadratic corners; `round` 0 keeps sharp corners. */
function rounded(verts: Vec3[], round: number): Vec3[] {
  if (round <= 0) return verts;
  const t = Math.min(0.5, round * 0.5);
  const out: Vec3[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i], a = verts[(i - 1 + verts.length) % verts.length], b = verts[(i + 1) % verts.length];
    const A: Vec3 = [lerp(v[0], a[0], t), lerp(v[1], a[1], t), 0];
    const B: Vec3 = [lerp(v[0], b[0], t), lerp(v[1], b[1], t), 0];
    for (let k = 0; k <= 10; k++) {
      const q = k / 10;
      out.push([(1 - q) ** 2 * A[0] + 2 * (1 - q) * q * v[0] + q * q * B[0], (1 - q) ** 2 * A[1] + 2 * (1 - q) * q * v[1] + q * q * B[1], 0]);
    }
  }
  return out;
}

function polar(n: number, r: (a: number) => number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n;
    const rad = r(a);
    pts.push([rad * Math.cos(a), rad * Math.sin(a), 0]);
  }
  return pts;
}

/** Returns the curve's points and whether it closes on itself. */
function shapePoints(p: Params): { pts: Vec3[]; closed: boolean } {
  const n = (k: string) => Number(p[k]);
  switch (str(p, 'shape') as Shape) {
    case 'line':
      return { pts: Array.from({ length: 33 }, (_, i) => [-1 + i / 16, 0, 0] as Vec3), closed: false };
    case 'arc': {
      const a0 = (n('start') * Math.PI) / 180, sw = (n('sweep') * Math.PI) / 180;
      const count = Math.max(8, Math.round(n('sweep') / 2));
      return { pts: Array.from({ length: count + 1 }, (_, i) => { const a = a0 + (sw * i) / count; return [Math.cos(a), Math.sin(a), 0] as Vec3; }), closed: false };
    }
    case 'circle':
      return { pts: polar(144, () => 1), closed: true };
    case 'rect': {
      const ax = Math.sqrt(n('aspect')), ay = 1 / ax;
      return { pts: rounded([[-ax, -ay, 0], [ax, -ay, 0], [ax, ay, 0], [-ax, ay, 0]], n('round') * 0.6), closed: true };
    }
    case 'polygon':
    case 'star': {
      const star = p.shape === 'star';
      const count = star ? int(p, 'sides') * 2 : int(p, 'sides');
      const verts: Vec3[] = Array.from({ length: count }, (_, i) => {
        const a = -Math.PI / 2 + (TAU * i) / count;
        const rad = star && i % 2 ? n('inner') : 1;
        return [rad * Math.cos(a), rad * Math.sin(a), 0];
      });
      return { pts: rounded(verts, n('round')), closed: true };
    }
    case 'squircle': {
      const e = 2 / (2 + n('round') * 8);
      return {
        pts: Array.from({ length: 180 }, (_, i) => {
          const a = (TAU * i) / 180, c = Math.cos(a), s = Math.sin(a);
          return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e, 0] as Vec3;
        }),
        closed: true,
      };
    }
    case 'flower':
      return { pts: polar(240, (a) => 1 - n('inner') * 0.5 + n('inner') * 0.5 * Math.cos(n('sides') * a)), closed: true };
    case 'blob': {
      const r = rng(int(p, 'seed'));
      const h = [2, 3, 5].map((k) => ({ k, amp: (r() * 0.6 + 0.4) / k, ph: r() * TAU }));
      return { pts: polar(180, (a) => 1 + n('inner') * 0.5 * h.reduce((s, x) => s + x.amp * Math.sin(x.k * a + x.ph), 0)), closed: true };
    }
    case 'spiral': {
      const turns = n('turns'), rise = n('pitch'), r0 = n('inner');
      const count = Math.ceil(96 * turns) + 1;
      return {
        pts: Array.from({ length: count }, (_, i) => {
          const t = i / (count - 1), a = TAU * turns * t, rad = lerp(1, r0, t);
          return rise > 0
            ? ([rad * Math.cos(a), rise / 2 - t * rise, rad * Math.sin(a)] as Vec3)
            : ([rad * Math.cos(a), rad * Math.sin(a), 0] as Vec3);
        }),
        closed: false,
      };
    }
    case 'wave': {
      const cyc = n('cycles'), amp = n('amplitude'), ph = (n('phase') * Math.PI) / 180;
      const count = Math.max(64, Math.round(cyc * 48));
      return { pts: Array.from({ length: count + 1 }, (_, i) => { const x = -1 + (2 * i) / count; return [x, amp * Math.sin(Math.PI * cyc * (x + 1) + ph), 0] as Vec3; }), closed: false };
    }
    case 'trochoid': {
      const R = int(p, 'ring'), r = Math.max(1, int(p, 'wheel')), d = n('pen') * r, epi = Boolean(p.outside);
      const turns = r / gcd(R, r);
      const N = Math.min(6000, Math.max(400, Math.round(turns * 220)));
      const raw: Vec3[] = [];
      let max = 0;
      for (let i = 0; i < N; i++) {
        const t = (TAU * turns * i) / N;
        const x = epi ? (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t) : (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
        const y = epi ? (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t) : (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
        raw.push([x, y, 0]);
        max = Math.max(max, Math.hypot(x, y));
      }
      return { pts: raw.map(([x, y]) => [x / (max || 1), y / (max || 1), 0] as Vec3), closed: true };
    }
    case 'lissajous': {
      const fx = n('fx'), fy = n('fy'), fz = n('fz'), ph = (n('phase') * Math.PI) / 180, ax = Math.sqrt(n('aspect'));
      const N = Math.min(4000, 160 * Math.max(fx, fy, fz, 1));
      return {
        pts: Array.from({ length: N }, (_, i) => {
          const t = (TAU * i) / N;
          return [ax * Math.sin(fx * t + ph), Math.sin(fy * t) / ax, fz ? Math.sin(fz * t + ph / 2) : 0] as Vec3;
        }),
        closed: true,
      };
    }
    case 'knot': {
      const P = int(p, 'p'), Q = int(p, 'q'), rt = n('tube'), R = 1 - rt;
      const N = 240 * Math.max(P, Q);
      return {
        pts: Array.from({ length: N }, (_, i) => {
          const t = (TAU * i) / N, c = R + rt * Math.cos(Q * t);
          return [c * Math.cos(P * t), rt * Math.sin(Q * t), c * Math.sin(P * t)] as Vec3;
        }),
        closed: true,
      };
    }
    case 'profile': {
      const f = PROFILES[str(p, 'profile')] ?? PROFILES.trumpet;
      const top = n('top'), bottom = n('bottom'), curve = n('curve'), H = n('height');
      // Drawn bottom → top so revolve produces outward normals.
      return { pts: Array.from({ length: 49 }, (_, i) => { const h = i / 48; return [Math.max(0.001, f(h, top, bottom, curve)), (h - 0.5) * H, 0] as Vec3; }), closed: false };
    }
  }
  return { pts: polar(144, () => 1), closed: true };
}

export const curve: SourceDef = {
  kind: 'curve',
  name: 'Curve',
  blurb: 'A single line: circles, polygons, spirals, waves, knots, profiles…',
  params,
  defaults,
  build(p) {
    const { pts, closed } = shapePoints(p);
    const s = clamp(num(p, 'size'), 0.01, 10);
    const scaled = pts.map(([x, y, z]) => [x * s, y * s, z * s] as Vec3);
    const n = scaled.length;
    const line: Polyline = { pts: scaled, closed, t: scaled.map((_, i) => (closed ? i / n : i / Math.max(1, n - 1))), family: 0, band: 0 };
    return { lines: [line], nodes: [] };
  },
};
