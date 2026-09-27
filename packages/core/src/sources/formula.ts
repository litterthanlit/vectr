import { ExprError, compile, type Compiled } from '../expr.js';
import { int, num, str } from '../math.js';
import type { Polyline, SourceDef, Vec3 } from '../types.js';
import { surface } from './shapes/util.js';

const CURVE_VARS = ['t', 'a', 'b', 'c'];
const SURFACE_VARS = ['u', 'v', 'a', 'b', 'c'];

/**
 * Compiled formulas, cached by text, so dragging a slider doesn't re-parse. The
 * cache is small and keyed by source, so it can't grow without bound.
 */
const cache = new Map<string, Compiled | ExprError>();
function compiled(src: string, vars: string[]): Compiled {
  const key = `${vars.join()}|${src}`;
  let hit = cache.get(key);
  if (!hit) {
    try {
      hit = compile(src, vars);
    } catch (e) {
      hit = e instanceof ExprError ? e : new ExprError(String(e));
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, hit);
  }
  if (hit instanceof ExprError) throw hit;
  return hit;
}

const finite = (v: number) => (Number.isFinite(v) ? Math.max(-1e3, Math.min(1e3, v)) : 0);

export const formula: SourceDef = {
  kind: 'formula',
  name: 'Formula',
  blurb: 'Your own curve x(t), y(t), z(t) or surface x(u,v), y(u,v), z(u,v), with sliders a, b, c',
  params: [
    { key: 'mode', label: 'Kind', kind: 'select', options: [{ value: 'curve', label: 'Curve (t)' }, { value: 'surface', label: 'Surface (u, v)' }] },
    { key: 'x', label: 'x =', kind: 'text', placeholder: 'e.g. sin(3*t)' },
    { key: 'y', label: 'y =', kind: 'text', placeholder: 'e.g. cos(2*t)' },
    { key: 'z', label: 'z =', kind: 'text', placeholder: 'e.g. 0' },
    { key: 'from', label: 't from', kind: 'range', min: -50, max: 50, step: 0.01, when: { key: 'mode', in: ['curve'] }, help: 'In multiples of π' },
    { key: 'to', label: 't to', kind: 'range', min: -50, max: 50, step: 0.01, when: { key: 'mode', in: ['curve'] }, help: 'In multiples of π' },
    { key: 'samples', label: 'Samples', kind: 'range', min: 16, max: 8000, step: 1, when: { key: 'mode', in: ['curve'] } },
    { key: 'uLines', label: 'Lines along u', kind: 'range', min: 0, max: 64, step: 1, when: { key: 'mode', in: ['surface'] } },
    { key: 'vLines', label: 'Lines along v', kind: 'range', min: 0, max: 64, step: 1, when: { key: 'mode', in: ['surface'] } },
    { key: 'closed', label: 'Wrap around', kind: 'toggle', when: { key: 'mode', in: ['surface'] }, help: 'u and v run 0 to 2π and close up; off: 0 to 1' },
    { key: 'a', label: 'a', kind: 'range', min: -10, max: 10, step: 0.01 },
    { key: 'b', label: 'b', kind: 'range', min: -10, max: 10, step: 0.01 },
    { key: 'c', label: 'c', kind: 'range', min: -10, max: 10, step: 0.01 },
  ],
  defaults: {
    mode: 'curve', x: 'sin(a*t) * cos(t)', y: 'sin(a*t) * sin(t)', z: 'b * cos(c*t) / 3',
    from: 0, to: 2, samples: 800, uLines: 16, vLines: 24, closed: true, a: 5, b: 1, c: 7,
  },
  build(p) {
    const surf = str(p, 'mode') === 'surface';
    const vars = surf ? SURFACE_VARS : CURVE_VARS;
    const fx = compiled(str(p, 'x') || '0', vars), fy = compiled(str(p, 'y') || '0', vars), fz = compiled(str(p, 'z') || '0', vars);
    const scope: Record<string, number> = { a: num(p, 'a'), b: num(p, 'b'), c: num(p, 'c'), t: 0, u: 0, v: 0 };
    const at = (): Vec3 => [finite(fx(scope)), finite(fy(scope)), finite(fz(scope))];
    if (surf) {
      const wrap = Boolean(p.closed);
      const span = wrap ? Math.PI * 2 : 1;
      return surface(
        (u, v) => {
          scope.u = u * span;
          scope.v = v * span;
          return at();
        },
        { uLines: int(p, 'uLines'), vLines: int(p, 'vLines'), uClosed: wrap, vClosed: wrap, samples: 120 },
      );
    }
    const n = int(p, 'samples');
    const t0 = num(p, 'from') * Math.PI, t1 = num(p, 'to') * Math.PI;
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      scope.t = t0 + ((t1 - t0) * i) / n;
      pts.push(at());
    }
    const line: Polyline = { pts };
    return { lines: [line], nodes: [] };
  },
};
