import { describe, expect, it } from 'vitest';
import { buildForm, POINT_BUDGET } from '../src/pipeline.js';
import { createForm } from '../src/forms.js';
import { OPERATORS } from '../src/operators/index.js';
import { SOURCES } from '../src/sources/index.js';
import { COLOR_LEVELS, TAPER_LEVELS, renderForm } from '../src/render.js';
import { docToSVG } from '../src/svg.js';
import { RECIPES } from '../src/recipes.js';
import { ELEMENTS, elementDocForms, placeElement } from '../src/elements.js';
import { describeBlocks, parseDoc } from '../src/schema.js';
import { THEMES } from '../src/themes.js';
import { mutate, variations } from '../src/mutate.js';
import { sampleRamp } from '../src/color.js';
import type { Form, Geometry } from '../src/types.js';

const RAMP = ['#222222', '#ffffff'];
const DEFAULT_CARD_VIEW = { rx: -20, ry: 25, perspective: 0 };
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

describe('elements', () => {
  const ids = ELEMENTS.map((e) => e.id);
  const DOC = { version: 2 as const, width: 1000, height: 1000, background: '#f6f6f7', ramp: ['#cfcfd4', '#9a9aa3', '#2c2c32'], rough: 0 };

  it('ships the instrument set, each with a name, a blurb and forms', () => {
    expect(ids).toEqual(expect.arrayContaining(['globe', 'dial', 'orbit-shell', 'ruler', 'caption', 'gimbal']));
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ELEMENTS) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.blurb.length).toBeGreaterThan(10);
      expect(e.forms.length).toBeGreaterThan(0);
    }
  });

  it.each(ids)('%s parses without warnings and renders finite SVG', (id) => {
    const element = ELEMENTS.find((e) => e.id === id)!;
    const { doc, warnings } = parseDoc({ forms: elementDocForms(element) });
    expect(warnings).toEqual([]);
    expect(doc.forms).toHaveLength(element.forms.length);
    const svg = docToSVG({ ...doc, ...DOC, forms: doc.forms });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg.length).toBeLessThan(400_000);
    for (const f of doc.forms) expect(buildForm(f).warnings).toEqual([]);
  });

  it('names no colours, so every element follows the document theme', () => {
    for (const e of ELEMENTS) for (const f of e.forms) {
      expect(f.style?.stroke ?? null).toBeNull();
      expect(f.style?.ramp ?? null).toBeNull();
      expect(f.style?.labelColor ?? null).toBeNull();
    }
  });

  it('places forms on the artboard centre, scaling size, offsets and label size with the document', () => {
    for (const [w, h, k] of [[1000, 1000, 1], [1200, 900, 0.9], [1600, 900, 0.9], [500, 800, 0.5]] as const) {
      for (const element of ELEMENTS) {
        const placed = placeElement(element, w, h);
        expect(placed).toHaveLength(element.forms.length);
        placed.forEach((form, i) => {
          const spec = element.forms[i];
          expect(form.x).toBeCloseTo(w / 2 + (spec.offset?.x ?? 0) * k, 6);
          expect(form.y).toBeCloseTo(h / 2 + (spec.offset?.y ?? 0) * k, 6);
          expect(form.scale).toBeCloseTo((spec.transform?.scale ?? 240) * k, 6);
          if (spec.style?.labelSize !== undefined) expect(form.style.labelSize).toBeCloseTo(spec.style.labelSize * k, 6);
          else expect(form.style.labelSize).toBe(12);
          expect(form.name).toBe(spec.name ?? form.name);
        });
        expect(new Set(placed.map((f) => f.id)).size).toBe(placed.length);
      }
    }
  });

  it('does not mutate the element when placing it', () => {
    const before = JSON.stringify(ELEMENTS);
    placeElement(ELEMENTS[0], 1600, 900);
    elementDocForms(ELEMENTS[0], 1600, 900);
    expect(JSON.stringify(ELEMENTS)).toBe(before);
  });

  it('is described to agents with forms they can paste into a design', () => {
    const described = describeBlocks().elements;
    expect(described.map((e) => e.id)).toEqual(ids);
    for (const e of described) {
      expect(e.description).toBeTruthy();
      const { doc, warnings } = parseDoc({ width: 1000, height: 1000, forms: e.forms });
      expect(warnings).toEqual([]);
      expect(doc.forms.length).toBe(e.forms.length);
    }
    expect(describeBlocks().elementsNote).toMatch(/1000/);
  });

  it('ships the context window: a flat burst of solid blocks coloured by relevance', () => {
    const element = ELEMENTS.find((e) => e.id === 'context-window')!;
    expect(element.forms).toHaveLength(1);
    const [form] = placeElement(element, 1000, 1000);
    expect(form.source).toMatchObject({ kind: 'context', params: { layout: 'burst', mark: 'block' } });
    expect(form.style).toMatchObject({ fill: 'shapes', fillOpacity: 1, colorBy: 'family', color: 'ramp' });
    expect(form).toMatchObject({ rx: 0, ry: 0, perspective: 0 });
    const g = buildForm(form).geometry;
    expect(g.lines.length).toBeGreaterThan(400);
    expect(g.nodes.some((n) => n.family === 1) && g.nodes.some((n) => n.family === 0)).toBe(true);
    // Solid blocks: both colour families of fill show up when rendered.
    expect(renderForm(form, DOC.ramp).fills).toHaveLength(2);
  });

  it('ships attention: one token field as dots, threads from the same field to two foci, and a ring at each', () => {
    const element = ELEMENTS.find((e) => e.id === 'attention')!;
    const forms = placeElement(element, 1000, 1000);
    const [field, threads, ...rings] = forms;
    expect(field.source.kind).toBe('context');
    expect(field.source.params.mark).toBe('dot');
    expect(field.style.markers).toBe('dot');
    // The threads leave from the very same dots, so both forms share the source and the placement.
    expect(threads.source).toEqual(field.source);
    expect([threads.x, threads.y, threads.scale]).toEqual([field.x, field.y, field.scale]);
    expect(threads.ops).toHaveLength(1);
    expect(threads.ops[0]).toMatchObject({ kind: 'connect', params: { mode: 'focus', split: true, which: 'relevant', keepLines: false } });
    expect(threads.style).toMatchObject({ dash: 'dotted', colorBy: 'family' });
    expect(threads.style.width).toBeLessThan(2);
    // Every thread ends at one of the two foci, above and below the field.
    const fy = Number(threads.ops[0].params.fy);
    const ends = new Set(buildForm(threads).geometry.lines.map((l) => l.pts[l.pts.length - 1].join(',')));
    expect(ends).toEqual(new Set([`0,${fy},0`, `0,${-fy},0`]));
    // The rings sit exactly on the foci, in artboard pixels (y runs down).
    expect(rings).toHaveLength(2);
    expect(rings.map((r) => r.y).sort((a, b) => a - b)).toEqual([field.y - fy * field.scale, field.y + fy * field.scale]);
    for (const r of rings) {
      expect(r.x).toBe(field.x);
      expect(r.style.markers).toBe('ring');
      expect(buildForm(r).geometry.nodes).toHaveLength(1);
    }
    for (const f of forms) expect(f).toMatchObject({ rx: 0, ry: 0, perspective: 0 });
  });

  it('keeps every card flat, in elements and in recipes', () => {
    const cards = [
      ...ELEMENTS.flatMap((e) => e.forms.filter((f) => f.source.kind === 'card').map((f) => ({ ...DEFAULT_CARD_VIEW, ...f.transform }))),
      ...RECIPES.flatMap((r) => r.build().forms.filter((f) => f.source.kind === 'card')),
    ];
    expect(cards.length).toBeGreaterThanOrEqual(1);
    for (const c of cards) expect(c).toMatchObject({ rx: 0, ry: 0, perspective: 0 });
  });
});

describe('themes', () => {
  it('has fog: a neutral near-white paper with a cool grey ramp from light to dark', () => {
    const fog = THEMES.find((t) => t.id === 'fog')!;
    expect(fog).toBeTruthy();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fog.background.slice(i, i + 2), 16));
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(6);
    expect(fog.background.toLowerCase()).not.toBe('#f3f2e9');
    const lum = (c: string) => [1, 3, 5].reduce((a, i) => a + parseInt(c.slice(i, i + 2), 16), 0);
    expect(fog.ramp.map(lum)).toEqual([...fog.ramp.map(lum)].sort((a, b) => b - a));
  });
});

describe('originality', () => {
  // Strings and colours from the reference images v1 was modelled on. v2 must not ship them.
  const DENY = [
    '#F3F2E9', 'SQNESM', 'LATENT DIM', 'ANGULAR DIST', 'FIG. 062', 'Specimen', 'Chalk', 'Figure plate',
    // The tagline of the image that inspired the instrument-plate elements and recipes.
    'arrives before its interface', 'before its interface', 'close the gap', 'we close',
  ];
  it('recipes, elements, source defaults and themes contain none of the reference material', () => {
    const blob = JSON.stringify([
      RECIPES.map((r) => [r.id, r.name, r.blurb, r.build()]),
      ELEMENTS,
      SOURCES.map((s) => [s.kind, s.name, s.blurb, s.defaults, s.params]),
      THEMES,
    ]).toLowerCase();
    for (const s of DENY) expect(blob).not.toContain(s.toLowerCase());
  });
});
