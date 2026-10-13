import { DEG, TAU, clamp, int, lerp, norm, num, rng, smoothstep, str } from '../math.js';
import type { Polyline, SourceDef, Vec3 } from '../types.js';

type Arrangement = 'random' | 'fan' | 'nested';

/**
 * One ring: inclined by `tilt` from the horizontal about a horizontal axis (the line of
 * nodes) at longitude `node`. `u` runs along the line of nodes, `w` is the in-plane
 * direction that climbs with the tilt — tilt 90° puts the ring through both poles.
 */
function ring(tilt: number, node: number, r: number, aspect: number, a0: number, sweep: number, family: number): Polyline {
  const [cn, sn, ct, st] = [Math.cos(node), Math.sin(node), Math.cos(tilt), Math.sin(tilt)];
  const u: Vec3 = [cn, 0, sn];
  const w: Vec3 = [sn * ct, st, -cn * ct];
  const full = sweep >= TAU - 1e-9;
  const count = Math.max(24, Math.round((160 * sweep) / TAU));
  const steps = full ? count : count + 1;
  const pts: Vec3[] = [], normals: Vec3[] = [], t: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = a0 + (sweep * i) / count;
    const c = Math.cos(a) * r, s = Math.sin(a) * r * aspect;
    const q: Vec3 = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
    pts.push(q);
    normals.push(norm(q));
    t.push(i / count);
  }
  return { pts, normals, t, closed: full, family };
}

export const orbits: SourceDef = {
  kind: 'orbits',
  name: 'Orbits',
  blurb: 'Rings on a shell at many tilts — orbits, gimbals, atom diagrams',
  params: [
    {
      key: 'arrangement', label: 'Arrangement', kind: 'select',
      options: [{ value: 'random', label: 'Scattered' }, { value: 'fan', label: 'Fan' }, { value: 'nested', label: 'Gimbal' }],
    },
    { key: 'count', label: 'Rings', kind: 'range', min: 1, max: 48, step: 1 },
    { key: 'radius', label: 'Radius', kind: 'range', min: 0.2, max: 3, step: 0.01 },
    { key: 'spread', label: 'Radius spread', kind: 'range', min: 0, max: 1, step: 0.01, help: '0 puts every ring on one shell' },
    {
      key: 'tilt', label: 'Tilt', kind: 'range', min: 0, max: 90, step: 1, unit: '°',
      help: 'Scattered: widest inclination. Fan: inclination of every ring. Gimbal: turn between successive vertical rings',
    },
    { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.1, max: 1, step: 0.01, help: 'Squashes each ring into an ellipse' },
    { key: 'sweep', label: 'Arc', kind: 'range', min: 10, max: 360, step: 1, unit: '°', help: 'Below 360° the rings become open arcs' },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: { arrangement: 'random', count: 6, radius: 1, spread: 0.25, tilt: 70, aspect: 1, sweep: 360, seed: 4 },
  build(p) {
    const mode = str(p, 'arrangement') as Arrangement;
    const n = clamp(int(p, 'count'), 1, 48);
    const radius = clamp(num(p, 'radius'), 0.01, 10);
    const spread = clamp(num(p, 'spread'), 0, 1);
    const tilt = clamp(num(p, 'tilt'), 0, 90) * DEG;
    const aspect = clamp(num(p, 'aspect'), 0.05, 1);
    const sweepDeg = clamp(num(p, 'sweep'), 10, 360);
    const sweep = sweepDeg * DEG;
    const r = rng(int(p, 'seed'));
    // Fan: rings tilted alike get near-duplicates when the planes reach the poles, so the fan narrows to half a turn there.
    const fanSpan = TAU - Math.PI * smoothstep(50, 90, tilt / DEG);
    const lines: Polyline[] = [];
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      // Draw the random numbers unconditionally so changing one param doesn't reshuffle the rest.
      const [rIncl, rNode, rRad, rStart] = [r(), r(), r(), r()];
      let incl: number, node: number, rad: number, a0 = 0;
      if (mode === 'fan') {
        incl = tilt;
        node = (fanSpan * i) / n;
        rad = radius * lerp(1, 1 - spread, f);
      } else if (mode === 'nested') {
        // Alternate vertical and horizontal rings; each vertical ring is turned a further `tilt` about the vertical axis.
        incl = i % 2 === 0 ? Math.PI / 2 : 0;
        node = tilt * Math.floor(i / 2);
        rad = radius * lerp(1, 1 - spread, f);
      } else {
        incl = Math.acos(lerp(1, Math.cos(tilt), rIncl));
        node = rNode * TAU;
        rad = radius * lerp(1 - spread, 1, rRad);
        a0 = rStart * TAU;
      }
      lines.push(ring(incl, node, Math.max(0.005, rad), aspect, sweep < TAU ? a0 : 0, sweep, i));
    }
    return { lines, nodes: [] };
  },
};
