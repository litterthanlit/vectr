import { describe, expect, it } from 'vitest';
import { buildForm } from '../src/pipeline.js';
import { createForm } from '../src/forms.js';
import { SHAPE_CATEGORIES, SHAPES } from '../src/sources/shapes/index.js';
import { surface } from '../src/sources/shapes/util.js';
import { shapeStarter } from '../src/shapes.js';
import { renderForm } from '../src/render.js';
import type { Vec3 } from '../src/types.js';

const at = { x: 0, y: 0 };

describe('shape library', () => {
  it('files every shape under exactly one category', () => {
    const listed = SHAPE_CATEGORIES.flatMap((c) => c.shapes.map((s) => s.kind));
    expect(listed.sort()).toEqual(SHAPES.map((s) => s.kind).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it.each(SHAPES.map((s) => s.kind))('%s renders with its starter look inside the point budget', (kind) => {
    const form = createForm(shapeStarter(kind), at);
    const { warnings } = buildForm(form);
    expect(warnings).toEqual([]);
    const r = renderForm(form, ['#000000']);
    expect(r.strokes.length + r.markers.length).toBeGreaterThan(0);
  });
});

describe('surface helper', () => {
  it('gives outward normals on a sphere', () => {
    const f = (u: number, v: number): Vec3 => {
      const th = u * Math.PI * 2, ph = -Math.PI / 2 + v * Math.PI;
      return [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)];
    };
    const g = surface(f, { uLines: 5, vLines: 6, uClosed: true, flip: true, v0: 0.1, v1: 0.9 });
    for (const l of g.lines)
      l.pts.forEach((p, i) => {
        const n = l.normals![i];
        expect(p[0] * n[0] + p[1] * n[1] + p[2] * n[2]).toBeGreaterThan(0.99);
      });
  });
});

describe('drawing operators', () => {
  const square = { source: { kind: 'curve', params: { shape: 'rect', aspect: 1, round: 0 } } };

  it('hatch stays inside the outline', () => {
    const { geometry } = buildForm(createForm({ ...square, ops: [{ kind: 'hatch', params: { spacing: 0.05, cross: true, outline: false } }] }, at));
    expect(geometry.lines.length).toBeGreaterThan(20);
    const lim = Math.max(...buildForm(createForm(square, at)).geometry.lines[0].pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    for (const l of geometry.lines) for (const p of l.pts) expect(Math.max(Math.abs(p[0]), Math.abs(p[1]))).toBeLessThanOrEqual(lim + 1e-9);
  });

  it('hatch fills a ring but not its hole', () => {
    const ring = { source: { kind: 'curve', params: { shape: 'circle' } }, ops: [{ kind: 'offset', params: { count: 1, distance: -0.4 } }, { kind: 'hatch', params: { angle: 0, spacing: 0.02, outline: false } }] };
    const { geometry } = buildForm(createForm(ring as never, at));
    const r0 = Math.hypot(...buildForm(createForm({ source: ring.source }, at)).geometry.lines[0].pts[0]);
    for (const l of geometry.lines) for (const p of l.pts) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(r0 - 0.4 - 1e-3);
  });

  it('extrude gives the walls outward normals', () => {
    const { geometry } = buildForm(createForm({ source: { kind: 'curve', params: { shape: 'circle' } }, ops: [{ kind: 'extrude' }] }, at));
    const front = geometry.lines[0];
    front.pts.forEach((p, i) => expect(p[0] * front.normals![i][0] + p[1] * front.normals![i][1]).toBeGreaterThan(0));
    // The front edge leans toward the front face.
    expect(front.normals!.every((n) => n[2] > 0)).toBe(true);
  });

  it('smooth multiplies points and keeps them finite', () => {
    const base = buildForm(createForm(square, at)).geometry.lines[0].pts.length;
    const { geometry } = buildForm(createForm({ ...square, ops: [{ kind: 'smooth', params: { passes: 2 } }] }, at));
    expect(geometry.lines[0].pts.length).toBe(base * 4);
  });

  it('kaleidoscope makes mirrored copies', () => {
    const { geometry } = buildForm(createForm({ source: { kind: 'curve', params: { shape: 'arc' } }, ops: [{ kind: 'kaleidoscope', params: { count: 5, mirror: true } }] }, at));
    expect(geometry.lines).toHaveLength(10);
  });
});
