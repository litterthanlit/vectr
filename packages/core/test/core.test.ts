import { describe, expect, it } from 'vitest';
import { buildForm, POINT_BUDGET } from '../src/pipeline.js';
import { createForm } from '../src/forms.js';
import { OPERATORS } from '../src/operators/index.js';
import { SOURCES } from '../src/sources/index.js';
import { COLOR_LEVELS, TAPER_LEVELS, renderForm } from '../src/render.js';
import { docToSVG } from '../src/svg.js';
import { RECIPES } from '../src/recipes.js';
import { THEMES } from '../src/themes.js';
import { mutate, variations } from '../src/mutate.js';
import { sampleRamp } from '../src/color.js';
import type { Form, Geometry } from '../src/types.js';

const RAMP = ['#222222', '#ffffff'];
const at = { x: 500, y: 500 };
/** Build a stack with defaults filled in, the way the app and parser do. */
const stack = (source: { kind: string; params?: Record<string, unknown> }, ops: { kind: string; params?: Record<string, unknown> }[] = []) =>
  buildForm(createForm({ source: source as never, ops: ops as never }, at));
const finite = (g: Geometry) => [...g.lines.flatMap((l) => l.pts), ...g.nodes.map((n) => n.p)].every((p) => p.every(Number.isFinite));

describe('sources', () => {
  for (const src of SOURCES) {
    const shapes = src.kind === 'curve' ? (src.params.find((d) => d.key === 'shape') as { options: { value: string }[] }).options.map((o) => o.value) : [undefined];
    it.each(shapes)(`${src.kind} %s builds finite geometry`, (shape) => {
      const { geometry } = buildForm(createForm({ source: { kind: src.kind, params: shape ? { shape } : {} } }, at));
      expect(geometry.lines.length + geometry.nodes.length).toBeGreaterThan(0);
      expect(finite(geometry)).toBe(true);
    });
  }
});

describe('operators', () => {
  it.each(OPERATORS.map((o) => o.kind))('%s works on a curve and on points', (kind) => {
    for (const source of [{ kind: 'curve' }, { kind: 'points', params: { count: 40 } }]) {
      const { geometry, warnings } = buildForm(createForm({ source, ops: [{ kind }] }, at));
      expect(warnings).toEqual([]);
      expect(finite(geometry)).toBe(true);
    }
  });

  it('revolve makes rings × spokes, skipping degenerate rings at the axis', () => {
    const { geometry } = stack({ kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } }, [{ kind: 'revolve', params: { rings: 9, spokes: 12 } }]);
    const rings = geometry.lines.filter((l) => l.band === undefined);
    const spokes = geometry.lines.filter((l) => l.band === 1);
    expect(spokes).toHaveLength(12);
    expect(rings).toHaveLength(7); // the two poles have zero radius
    expect(geometry.nodes).toHaveLength(7 * 12);
    // Outward normals on a sphere point the same way as the position.
    const l = spokes[0];
    const i = Math.floor(l.pts.length / 2);
    const dot = l.pts[i][0] * l.normals![i][0] + l.pts[i][1] * l.normals![i][1] + l.pts[i][2] * l.normals![i][2];
    expect(dot).toBeGreaterThan(0.99);
  });

  it('mirror twice across the same axis is its own inverse', () => {
    const base = stack({ kind: 'curve', params: { shape: 'star' } }).geometry;
    const once = stack({ kind: 'curve', params: { shape: 'star' } }, [{ kind: 'mirror', params: { x: true } }]).geometry;
    expect(once.lines).toHaveLength(2);
    expect(once.lines[1].pts).toEqual(base.lines[0].pts.map(([x, y, z]) => [-x, y, z]));
  });

  it('repeat produces n copies with the copy index as family', () => {
    const { geometry } = stack({ kind: 'curve' }, [{ kind: 'repeat', params: { count: 7 } }]);
    expect(geometry.lines).toHaveLength(7);
    expect(geometry.lines.map((l) => l.family)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('warps carry normals so hidden-line styling survives', () => {
    const { geometry } = stack({ kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } }, [{ kind: 'revolve' }, { kind: 'warp', params: { kind: 'twist', amount: 1 } }]);
    expect(geometry.lines.every((l) => l.normals?.every((n) => Math.abs(Math.hypot(...n) - 1) < 1e-6))).toBe(true);
  });

  it('keeps any stack under the point budget', () => {
    const { geometry, warnings } = stack({ kind: 'lattice', params: { cols: 60, rows: 60 } }, [{ kind: 'repeat', params: { count: 64 } }, { kind: 'sweep', params: { copies: 120 } }]);
    const pts = geometry.lines.reduce((a, l) => a + l.pts.length, 0) + geometry.nodes.length;
    expect(pts).toBeLessThanOrEqual(POINT_BUDGET * 1.1);
    expect(warnings.join()).toMatch(/thinned/);
  });
});

describe('renderer', () => {
  it('emits at most one path per style bucket', () => {
    for (const r of RECIPES) {
      const doc = r.build();
      for (const f of doc.forms) {
        const out = renderForm(f, doc.ramp);
        expect(out.strokes.length).toBeLessThanOrEqual(2 * TAPER_LEVELS * COLOR_LEVELS);
        expect(out.fills.length).toBeLessThanOrEqual(2 * COLOR_LEVELS);
      }
    }
  });

  it('keeps every recipe light and free of NaN', () => {
    for (const r of RECIPES) {
      const svg = docToSVG(r.build());
      expect(svg).not.toContain('NaN');
      expect(svg.length).toBeLessThan(400_000);
    }
  });

  it('splits a sphere into visible and hidden strokes, and hides them on request', () => {
    const form = createForm({ source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } }, ops: [{ kind: 'revolve' }] }, at);
    const r = renderForm(form, RAMP);
    expect(r.strokes.some((s) => s.hidden)).toBe(true);
    expect(r.strokes.some((s) => !s.hidden)).toBe(true);
    const hidden = renderForm({ ...form, style: { ...form.style, hidden: 'hide' } }, RAMP);
    expect(hidden.strokes.some((s) => s.hidden)).toBe(false);
  });

  it('tapers weight with depth by default and not when turned off', () => {
    const form = createForm({ source: { kind: 'curve', params: { shape: 'knot' } } }, at);
    const widths = new Set(renderForm(form, RAMP).strokes.map((s) => s.width));
    expect(widths.size).toBeGreaterThan(1);
    const flat = renderForm({ ...form, style: { ...form.style, taper: 'none' } }, RAMP);
    expect(new Set(flat.strokes.map((s) => s.width)).size).toBe(1);
  });

  it('interpolates ramps in OKLab', () => {
    expect(sampleRamp(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(sampleRamp(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(sampleRamp(['#ff0000', '#0000ff'], 0.5)).not.toBe('#800080'); // not a naive sRGB mix
  });
});

describe('mutate', () => {
  const base: Form = RECIPES[0].build().forms[0];
  it('is deterministic per seed and differs across seeds', () => {
    expect(mutate(base, 5)).toEqual(mutate(base, 5));
    const vs = variations(base, 6, 1).map((f) => JSON.stringify([f.source, f.ops.map((o) => o.params)]));
    expect(new Set(vs).size).toBe(6);
  });
  it('only produces valid params', () => {
    for (const v of variations(base, 30, 3, 1)) {
      expect(finite(buildForm(v).geometry)).toBe(true);
    }
  });
});

describe('originality', () => {
  // Strings and colours from the reference images v1 was modelled on. v2 must not ship them.
  const DENY = ['#F3F2E9', 'SQNESM', 'LATENT DIM', 'ANGULAR DIST', 'FIG. 062', 'Specimen', 'Chalk', 'Figure plate'];
  it('recipes and themes contain none of the reference material', () => {
    const blob = JSON.stringify([RECIPES.map((r) => [r.id, r.name, r.blurb, r.build()]), THEMES]).toLowerCase();
    for (const s of DENY) expect(blob).not.toContain(s.toLowerCase());
  });
});
