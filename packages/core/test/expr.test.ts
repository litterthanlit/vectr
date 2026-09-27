import { describe, expect, it } from 'vitest';
import { ExprError, compile } from '../src/expr.js';
import { buildForm } from '../src/pipeline.js';
import { createForm } from '../src/forms.js';

describe('expressions', () => {
  const ev = (src: string, vars: Record<string, number> = {}) => compile(src, Object.keys(vars))(vars);

  it('follows the usual precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 ^ 3 ^ 2')).toBe(512); // right-associative
    expect(ev('-2 ^ 2')).toBe(-4);
    expect(ev('10 % 4 - 1')).toBe(1);
    expect(ev('2 × 3 − 1')).toBe(5);
  });

  it('reads variables, constants and functions', () => {
    expect(ev('sin(t) + a', { t: Math.PI / 2, a: 2 })).toBeCloseTo(3);
    expect(ev('max(1, 5, 3) + min(4, 2)')).toBe(7);
    expect(ev('clamp(9, 0, 1) + mod(-1, 3)')).toBe(3);
    expect(ev('tau / pi')).toBe(2);
    expect(Math.abs(ev('noise(0.3, 0.2)'))).toBeLessThanOrEqual(1);
  });

  it('rejects anything that is not maths', () => {
    for (const bad of ['constructor', 'this', 'globalThis.x', 'a.b', 'alert(1)', '"x"', 'x = 1', '[1]', 'sin', '1 +', 'sin(1, 2)', 'x'.repeat(201)]) {
      expect(() => compile(bad, ['t']), bad).toThrow(ExprError);
    }
  });

  it('never exposes the scope object', () => {
    const vars = { t: 1 };
    expect(() => compile('toString', ['t'])).toThrow(/unknown name/);
    expect(compile('t', ['t'])(vars)).toBe(1);
  });
});

describe('formula source', () => {
  it('draws a curve and a surface', () => {
    const c = buildForm(createForm({ source: { kind: 'formula' } }, { x: 0, y: 0 }));
    expect(c.warnings).toEqual([]);
    expect(c.geometry.lines[0].pts.length).toBeGreaterThan(100);
    const s = buildForm(createForm({ source: { kind: 'formula', params: { mode: 'surface', x: 'cos(u)*cos(v)', y: 'sin(v)', z: 'sin(u)*cos(v)' } } }, { x: 0, y: 0 }));
    expect(s.geometry.lines.length).toBeGreaterThan(10);
    expect(s.geometry.lines[0].normals).toBeDefined();
  });

  it('reports a bad formula as a warning and draws nothing', () => {
    const r = buildForm(createForm({ source: { kind: 'formula', params: { x: 'sin(', y: '0', z: '0' } } }, { x: 0, y: 0 }));
    expect(r.geometry.lines).toEqual([]);
    expect(r.warnings[0]).toMatch(/Formula: /);
  });

  it('keeps non-finite values out of the geometry', () => {
    const r = buildForm(createForm({ source: { kind: 'formula', params: { x: '1/(t-t)', y: 'log(-1)', z: 't' } } }, { x: 0, y: 0 }));
    expect(r.geometry.lines[0].pts.flat().every(Number.isFinite)).toBe(true);
  });
});
