import type { Params, Vec3 } from './types';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Two unit vectors perpendicular to `n` (and each other). */
export function basis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, helper));
  return [u, cross(n, u)];
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Rotation: yaw (Y), then pitch (X), then roll (Z). Angles in degrees. */
export function rotationMatrix(rx: number, ry: number, rz: number): Mat3 {
  const [a, b, c] = [rx * DEG, ry * DEG, rz * DEG];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // R = Rz * Rx * Ry
  const m00 = cy, m01 = 0, m02 = sy;
  const m10 = sx * sy, m11 = cx, m12 = -sx * cy;
  const m20 = -cx * sy, m21 = sx, m22 = cx * cy;
  return [
    cz * m00 - sz * m10, cz * m01 - sz * m11, cz * m02 - sz * m12,
    sz * m00 + cz * m10, sz * m01 + cz * m11, sz * m02 + cz * m12,
    m20, m21, m22,
  ];
}

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Deterministic PRNG (mulberry32) so seeded shapes are reproducible. */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Typed accessors for loosely-typed generator params. */
export const num = (p: Params, k: string) => Number(p[k] ?? 0);
export const int = (p: Params, k: string) => Math.round(num(p, k));
export const bool = (p: Params, k: string) => Boolean(p[k]);
export const str = (p: Params, k: string) => String(p[k] ?? '');

/** Sample a circle in 3D given centre, in-plane basis and radius. */
export function circle(c: Vec3, u: Vec3, v: Vec3, r: number, n = 96, a0 = 0, a1 = TAU): Vec3[] {
  const pts: Vec3[] = [];
  const full = Math.abs(a1 - a0 - TAU) < 1e-9;
  const count = full ? n : n + 1;
  for (let i = 0; i < count; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    const ct = Math.cos(t) * r, st = Math.sin(t) * r;
    pts.push([c[0] + u[0] * ct + v[0] * st, c[1] + u[1] * ct + v[1] * st, c[2] + u[2] * ct + v[2] * st]);
  }
  return pts;
}
