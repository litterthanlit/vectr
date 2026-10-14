import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, OPERATORS, POINT_BUDGET, SOURCES, buildForm, createForm, describeBlocks, opFor, parseDoc, renderForm, variations } from '../src/index.js';
import type { Form, GeoLabel, Geometry, Params, Polyline, Vec3 } from '../src/index.js';
import { slab } from '../src/sources/shapes.js';

const at = { x: 0, y: 0 };
/** Build a stack with defaults filled in, the way the app and parser do. */
const make = (source: { kind: string; params?: Record<string, unknown> }, ops: { kind: string; params?: Record<string, unknown> }[] = []) =>
  createForm({ source: source as never, ops: ops as never }, at);
const stack = (source: { kind: string; params?: Record<string, unknown> }, ops: { kind: string; params?: Record<string, unknown> }[] = []) =>
  buildForm(make(source, ops)).geometry;
const finite = (g: Geometry) => [...g.lines.flatMap((l) => l.pts), ...g.nodes.map((n) => n.p)].every((p) => p.every(Number.isFinite));
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('registration', () => {
  it('lists the new blocks in order', () => {
    expect(SOURCES.map((s) => s.kind)).toEqual(['curve', 'lattice', 'points', 'note', 'orbits', 'card', 'context', 'strip']);
    expect(OPERATORS[OPERATORS.length - 1].kind).toBe('burst');
  });
});

describe('slab', () => {
  it('is a counter-clockwise rectangle from the bottom left, whichever way round the bounds are given', () => {
    expect(slab(0, 4, 0, 1)).toEqual([[0, 0], [4, 0], [4, 1], [0, 1]]);
    expect(slab(4, 0, 1, 0)).toEqual(slab(0, 4, 0, 1));
  });

  it('pulls the top corner of a slanted end in, so the bottom corner reaches past it', () => {
    expect(slab(0, 4, 0, 1, { lean: 0.5, finish: true })).toEqual([[0, 0], [4, 0], [3.5, 1], [0, 1]]);
    expect(slab(0, 4, 0, 1, { lean: 0.5, start: true })).toEqual([[0, 0], [4, 0], [4, 1], [0.5, 1]]);
    expect(slab(0, 4, 0, 1, { lean: 0.5, start: true, finish: true })).toEqual([[0, 0], [4, 0], [3.5, 1], [0.5, 1]]);
    expect(slab(0, 4, 0, 1, { lean: 0, finish: true })).toEqual(slab(0, 4, 0, 1));
    expect(slab(0, 4, 0, 1, { lean: 0.5 })).toEqual(slab(0, 4, 0, 1));
  });

  it('takes at most 45% of the length for a slant, so a short block never folds over', () => {
    const [, , c, d] = slab(0, 1, 0, 10, { lean: 5, start: true, finish: true });
    expect(c[0]).toBeCloseTo(0.55, 12);
    expect(d[0]).toBeCloseTo(0.45, 12);
    expect(c[0]).toBeGreaterThan(d[0]);
  });

  it('rounds corners with an absolute radius, never wider than half the height or an edge', () => {
    const r = slab(0, 10, 0, 2, { radius: 0.5, res: 4 });
    expect(r.length).toBeGreaterThan(12);
    for (const [x, y] of r) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(10 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(2 + 1e-9);
    }
    // The sharp corner (0, 0) is cut off, and the flat of the bottom edge starts at x = radius.
    expect(r.some(([x, y]) => x === 0 && y === 0)).toBe(false);
    expect(r.some(([x, y]) => Math.abs(x - 0.5) < 1e-9 && Math.abs(y) < 1e-9)).toBe(true);
    // A radius bigger than the block is cut back to a semicircle's worth rather than overshooting.
    for (const [x, y] of slab(0, 10, 0, 2, { radius: 99, res: 4 })) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(slab(0, 10, 0, 2, { radius: 0.5, res: 0 })).toEqual(slab(0, 10, 0, 2));
  });

  it('never throws on empty or odd input', () => {
    for (const args of [[0, 0, 0, 0], [1, 1, 0, 1], [0, 1, 1, 1], [NaN, 1, 0, 1], [0, Infinity, 0, 1]] as const) {
      expect(() => slab(args[0], args[1], args[2], args[3], { lean: 9, start: true, finish: true, radius: 1, res: 3 })).not.toThrow();
    }
  });
});

describe('orbits', () => {
  const ARRANGEMENTS = ['random', 'fan', 'nested'];
  const orbits = (params: Record<string, unknown> = {}) => stack({ kind: 'orbits', params });

  it.each(ARRANGEMENTS)('%s makes one ring per orbit', (arrangement) => {
    for (const count of [1, 2, 6, 48]) {
      const g = orbits({ arrangement, count });
      expect(g.lines).toHaveLength(count);
      expect(g.lines.map((l) => l.family)).toEqual(Array.from({ length: count }, (_, i) => i));
      expect(g.nodes).toEqual([]);
    }
  });

  it.each(ARRANGEMENTS)('%s with spread 0 puts every ring on one shell', (arrangement) => {
    const g = orbits({ arrangement, spread: 0, radius: 1.3 });
    for (const l of g.lines) for (const q of l.pts) expect(len(q)).toBeCloseTo(1.3, 9);
  });

  it('spread varies radii, and aspect squashes rings into ellipses', () => {
    const wide = orbits({ arrangement: 'fan', spread: 0.5, count: 5 });
    const radii = wide.lines.map((l) => Math.max(...l.pts.map(len)));
    expect(radii[0]).toBeCloseTo(1, 6);
    expect(radii[4]).toBeCloseTo(0.5, 6);
    const flat = orbits({ aspect: 0.4, spread: 0, count: 3 });
    for (const l of flat.lines) {
      const ls = l.pts.map(len);
      expect(Math.max(...ls)).toBeCloseTo(1, 6);
      expect(Math.min(...ls)).toBeCloseTo(0.4, 2);
    }
  });

  it('a fan at tilt 90 passes through both poles like meridians', () => {
    const g = orbits({ arrangement: 'fan', tilt: 90, count: 7, spread: 0 });
    for (const l of g.lines) {
      expect(Math.max(...l.pts.map((q) => q[1]))).toBeCloseTo(1, 2);
      expect(Math.min(...l.pts.map((q) => q[1]))).toBeCloseTo(-1, 2);
      expect(l.pts.some((q) => Math.hypot(q[0], q[2]) < 0.03 && q[1] > 0.99)).toBe(true);
      expect(l.pts.some((q) => Math.hypot(q[0], q[2]) < 0.03 && q[1] < -0.99)).toBe(true);
    }
    // ...and the meridians are distinct planes, not duplicates.
    const planes = g.lines.map((l) => {
      const q = l.pts.find((r) => Math.abs(r[1]) < 0.02)!;
      return Math.round((((Math.atan2(q[2], q[0]) % Math.PI) + Math.PI) % Math.PI) * 25);
    });
    expect(new Set(planes).size).toBe(7);
  });

  it('a gimbal alternates vertical and horizontal rings, turning the vertical ones by tilt', () => {
    const g = orbits({ arrangement: 'nested', count: 6, tilt: 40, spread: 0.5 });
    const radius = (l: Polyline) => Math.max(...l.pts.map(len));
    g.lines.forEach((l, i) => {
      if (i % 2) for (const q of l.pts) expect(q[1]).toBeCloseTo(0, 9);
      else expect(Math.max(...l.pts.map((q) => q[1]))).toBeCloseTo(radius(l), 2);
      expect(radius(l)).toBeCloseTo(1 - (0.5 * i) / 5, 6); // concentric, shrinking evenly
    });
    const turns = [0, 2, 4].map((i) => (Math.atan2(g.lines[i].pts[0][2], g.lines[i].pts[0][0]) * 180) / Math.PI);
    expect(turns[1] - turns[0]).toBeCloseTo(40, 6);
    expect(turns[2] - turns[1]).toBeCloseTo(40, 6);
  });

  it('a fan at tilt 0 lies flat', () => {
    for (const l of orbits({ arrangement: 'fan', tilt: 0 }).lines) for (const q of l.pts) expect(q[1]).toBeCloseTo(0, 9);
  });

  it('scattered rings stay within the tilt of the horizontal', () => {
    // Ring normal = axis perpendicular to the plane; its angle from +Y never exceeds `tilt`.
    const g = orbits({ arrangement: 'random', tilt: 30, count: 24, spread: 0 });
    for (const l of g.lines) {
      const a = l.pts[0], b = l.pts[Math.floor(l.pts.length / 4)];
      const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const angle = Math.acos(Math.min(1, Math.abs(n[1]) / len(n))) * (180 / Math.PI);
      expect(angle).toBeLessThanOrEqual(30 + 1e-6);
    }
  });

  it('sweep below 360 gives open arcs, 360 gives closed rings', () => {
    for (const arrangement of ARRANGEMENTS) {
      for (const l of orbits({ arrangement, sweep: 200 }).lines) {
        expect(l.closed).toBe(false);
        expect(len(sub(l.pts[0], l.pts[l.pts.length - 1]))).toBeGreaterThan(0.1);
      }
      for (const l of orbits({ arrangement, sweep: 360 }).lines) expect(l.closed).toBe(true);
    }
    // A shorter arc spans less of the ring: 90° of a unit ring has a 2·sin(45°) chord.
    const quarter = orbits({ arrangement: 'fan', sweep: 90, spread: 0, count: 1 }).lines[0];
    expect(len(sub(quarter.pts[0], quarter.pts[quarter.pts.length - 1]))).toBeCloseTo(Math.SQRT2, 6);
  });

  it('is deterministic per seed and differs across seeds', () => {
    expect(orbits({ seed: 3 })).toEqual(orbits({ seed: 3 }));
    expect(orbits({ seed: 3 })).not.toEqual(orbits({ seed: 4 }));
  });

  it('builds finite geometry across the whole parameter range', () => {
    for (const arrangement of ARRANGEMENTS) {
      for (const params of [
        {}, { count: 48, aspect: 0.1, sweep: 10, tilt: 90 }, { count: 1, radius: 0.2, spread: 1, tilt: 0 }, { radius: 3, spread: 1, sweep: 359 },
        { count: 0, radius: -4, spread: 9, tilt: 400, aspect: 0, sweep: 0 },
      ]) {
        const g = orbits({ arrangement, ...params });
        expect(g.lines.length).toBeGreaterThan(0);
        expect(finite(g)).toBe(true);
        for (const l of g.lines) expect(l.normals!.every((n) => n.every(Number.isFinite))).toBe(true);
      }
    }
  });

  it('carries unit normals along the position, so the far half draws hidden', () => {
    for (const arrangement of ARRANGEMENTS) {
      for (const l of orbits({ arrangement, aspect: 0.6 }).lines) {
        expect(l.normals).toHaveLength(l.pts.length);
        expect(l.t).toHaveLength(l.pts.length);
        l.pts.forEach((q, i) => {
          expect(len(l.normals![i])).toBeCloseTo(1, 9);
          expect(dot(l.normals![i], q) / len(q)).toBeCloseTo(1, 9);
        });
        expect(Math.min(...l.t!)).toBe(0);
        expect(Math.max(...l.t!)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('card', () => {
  const ICONS = ['globe', 'orbit', 'dial', 'crosshair', 'spiral'];
  const card = (params: Record<string, unknown> = {}) => stack({ kind: 'card', params });
  const labels = (g: Geometry): GeoLabel[] => g.labels ?? [];
  const closedLines = (g: Geometry) => g.lines.filter((l) => l.closed);

  it('draws one closed frame, the rectangle of the requested size', () => {
    const g = card({ width: 2, height: 1, icon: 'none' });
    expect(g.lines).toHaveLength(1);
    const [frame] = closedLines(g);
    expect(frame.family).toBe(0);
    expect(frame.pts).toEqual([[-1, -0.5, 0], [1, -0.5, 0], [1, 0.5, 0], [-1, 0.5, 0]]);
    expect(g.nodes).toEqual([]);
  });

  it.each(ICONS)('%s is drawn from open polylines inside the padding, so a shapes fill only fills the frame', (icon) => {
    const w = 1.6, h = 0.9, pad = 0.1, size = 0.3;
    const g = card({ icon, width: w, height: h, padding: pad, iconSize: size });
    expect(closedLines(g)).toHaveLength(1);
    const glyph = g.lines.filter((l) => l.family === 1);
    expect(glyph.length).toBeGreaterThan(0);
    for (const l of glyph) {
      expect(l.closed).toBe(false);
      expect(l.pts.length).toBeGreaterThanOrEqual(2);
      for (const q of l.pts) {
        expect(q[0]).toBeGreaterThanOrEqual(-w / 2 + pad - 1e-9);
        expect(q[0]).toBeLessThanOrEqual(-w / 2 + pad + size + 1e-9);
        expect(q[1]).toBeLessThanOrEqual(h / 2 - pad + 1e-9);
        expect(q[1]).toBeGreaterThanOrEqual(h / 2 - pad - size - 1e-9);
      }
    }
    // Loops repeat their first point instead of using `closed`.
    if (icon !== 'spiral') expect(glyph.some((l) => l.pts[0].every((v, k) => v === l.pts[l.pts.length - 1][k]))).toBe(true);
  });

  it('has no icon strokes for icon "none"', () => {
    expect(card({ icon: 'none' }).lines).toHaveLength(1);
  });

  it('forces every line visible', () => {
    for (const icon of ['none', ...ICONS]) expect(card({ icon }).lines.every((l) => l.tone === 'front')).toBe(true);
  });

  it('rounds the frame corners and keeps it inside the panel', () => {
    const sharp = closedLines(card({ corner: 0 }))[0];
    const soft = closedLines(card({ corner: 0.3 }))[0];
    expect(sharp.pts).toHaveLength(4);
    expect(soft.pts.length).toBeGreaterThan(20);
    for (const q of soft.pts) {
      expect(Math.abs(q[0])).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(Math.abs(q[1])).toBeLessThanOrEqual(0.45 + 1e-9);
    }
  });

  it('wraps the caption to the width inside the padding', () => {
    const [text] = labels(card({ width: 2.2, padding: 0.15 }));
    expect(text.text).toContain('\n');
    expect(text.wrap).toBeCloseTo(2.2 - 0.3, 9);
    expect(text).toMatchObject({ anchor: 'start', valign: 'bottom' });
    expect(text.p[0]).toBeCloseTo(-1.1 + 0.15, 9);
    expect(text.p[1]).toBeCloseTo(-0.45 + 0.15, 9);
  });

  it('places the caption at the top below the icon, or in the middle', () => {
    const [top] = labels(card({ align: 'top', icon: 'globe', iconSize: 0.2, padding: 0.1 }));
    expect(top.valign).toBe('top');
    expect(top.p[1]).toBeCloseTo(0.45 - 0.1 - (0.2 + 0.05), 9);
    const [bare] = labels(card({ align: 'top', icon: 'none', padding: 0.1 }));
    expect(bare.p[1]).toBeCloseTo(0.45 - 0.1, 9);
    const [mid] = labels(card({ align: 'middle' }));
    expect(mid).toMatchObject({ valign: 'middle' });
    expect(mid.p[1]).toBe(0);
  });

  it('puts the meta line in the top-right corner in small mono', () => {
    const g = card({ meta: 'No. 7', width: 2, height: 1, padding: 0.1 });
    expect(labels(g)).toHaveLength(2);
    const meta = labels(g)[1];
    expect(meta).toMatchObject({ text: 'No. 7', anchor: 'end', valign: 'top', size: 0.75, font: 'mono' });
    expect(meta.p[0]).toBeCloseTo(0.9, 9);
    expect(meta.p[1]).toBeCloseTo(0.4, 9);
    expect(labels(card({ meta: '' }))).toHaveLength(1);
    expect(labels(card({ meta: '   ' }))).toHaveLength(1);
  });

  it('omits the frame, or the caption, when asked', () => {
    expect(closedLines(card({ frame: false }))).toHaveLength(0);
    expect(card({ frame: false }).lines.length).toBeGreaterThan(0); // the icon remains
    expect(labels(card({ text: '' }))).toHaveLength(0);
    expect(labels(card({ text: ' \n  ' }))).toHaveLength(0);
    const empty = card({ text: '', frame: false, icon: 'none' });
    expect(empty).toEqual({ lines: [], nodes: [], labels: [] });
  });

  it('survives extreme sizes', () => {
    for (const params of [{ width: 0.3, height: 0.2, padding: 0.5, iconSize: 0.6, corner: 0.5 }, { width: 4, height: 3, padding: 0, iconSize: 0.05 }, { width: -1, height: 0, padding: -2, iconSize: 0 }]) {
      for (const icon of ['none', ...ICONS]) for (const align of ['top', 'middle', 'bottom']) {
        const g = card({ ...params, icon, align, meta: 'x' });
        expect(finite(g)).toBe(true);
        for (const lb of labels(g)) expect(lb.p.every(Number.isFinite) && (lb.wrap === undefined || lb.wrap > 0)).toBe(true);
      }
    }
  });

  it('keeps line breaks through parsing, and is not mutated into other shapes', () => {
    const { doc } = parseDoc({ forms: [{ source: { kind: 'card', params: { text: 'one\ntwo' } } }] });
    expect(doc.forms[0].source.params.text).toBe('one\ntwo');
    const base: Form = make({ kind: 'card' });
    for (const v of variations(base, 12, 5, 1)) {
      expect(v.source.params.text).toBe(base.source.params.text);
      expect(finite(buildForm(v).geometry)).toBe(true);
    }
  });
});

describe('ticks', () => {
  const ticksOp = opFor('ticks')!;
  const run = (g: Geometry, params: Params = {}) => ticksOp.apply(g, { ...ticksOp.defaults, ...params });
  const circle = (n = 96, ccw = true, extra: Partial<Polyline> = {}): Polyline => {
    const pts: Vec3[] = Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n), 0]);
    return { pts: ccw ? pts : pts.reverse(), closed: true, family: 2, ...extra };
  };
  const geo = (...lines: Polyline[]): Geometry => ({ lines, nodes: [] });
  const tickLines = (g: Geometry, kept = 1) => g.lines.slice(kept);
  const tickLen = (l: Polyline) => len(sub(l.pts[1], l.pts[0]));

  it('puts ticks on a circle, keeping the circle', () => {
    const g = stack({ kind: 'curve', params: { shape: 'circle' } }, [{ kind: 'ticks', params: { count: 60 } }]);
    expect(g.lines).toHaveLength(61);
    expect(g.lines[0].pts.length).toBeGreaterThan(2);
    for (const l of tickLines(g)) {
      expect(l.pts).toHaveLength(2);
      expect(tickLen(l)).toBeCloseTo(0.12, 9);
    }
    expect(finite(g)).toBe(true);
  });

  it('points flat ticks outward on counter-clockwise and clockwise circles alike', () => {
    for (const ccw of [true, false]) {
      const out = tickLines(run(geo(circle(96, ccw)), { count: 60 }));
      expect(out).toHaveLength(60);
      for (const l of out) {
        expect(dot(sub(l.pts[1], l.pts[0]), l.pts[0])).toBeGreaterThan(0.11);
        expect(len(l.pts[0])).toBeCloseTo(1, 2);
      }
    }
  });

  it('points them outward whatever plane the circle lies in', () => {
    const tilted = circle(96, true);
    tilted.pts = tilted.pts.map(([x, y]): Vec3 => [x, y * 0.6, y * 0.8]);
    const flipped = { ...tilted, pts: [...tilted.pts].reverse() };
    for (const line of [tilted, flipped]) {
      for (const l of tickLines(run(geo(line), { count: 40 }))) expect(dot(sub(l.pts[1], l.pts[0]), l.pts[0])).toBeGreaterThan(0.11);
    }
  });

  it('draws ticks inward, or on both sides', () => {
    for (const l of tickLines(run(geo(circle()), { count: 40, side: 'in' }))) {
      expect(dot(sub(l.pts[1], l.pts[0]), l.pts[0])).toBeLessThan(-0.11);
      expect(len(l.pts[0])).toBeCloseTo(1, 2);
    }
    for (const l of tickLines(run(geo(circle()), { count: 40, side: 'both', length: 0.2 }))) {
      expect(len(l.pts[0])).toBeCloseTo(0.9, 2);
      expect(len(l.pts[1])).toBeCloseTo(1.1, 2);
    }
  });

  it('makes every Nth tick a major tick', () => {
    const out = tickLines(run(geo(circle()), { count: 60, majorEvery: 5, majorLength: 2.5, length: 0.1 }));
    out.forEach((l, i) => expect(tickLen(l)).toBeCloseTo(i % 5 === 0 ? 0.25 : 0.1, 9));
    const none = tickLines(run(geo(circle()), { count: 60, majorEvery: 0, majorLength: 2.5, length: 0.1 }));
    expect(new Set(none.map((l) => tickLen(l).toFixed(9))).size).toBe(1);
  });

  it('includes both endpoints of an open line', () => {
    const line: Polyline = { pts: [[-1, 0, 0], [0, 0.5, 0], [1, 0, 0]], closed: false, family: 0 };
    const out = tickLines(run(geo(line), { count: 11 }));
    expect(out).toHaveLength(11);
    expect(out[0].pts[0].every((v, k) => Math.abs(v - line.pts[0][k]) < 1e-9)).toBe(true);
    expect(out[10].pts[0].every((v, k) => Math.abs(v - line.pts[2][k]) < 1e-9)).toBe(true);
  });

  it('sets straight lines with ticks at right angles', () => {
    const straight = stack({ kind: 'curve', params: { shape: 'line' } }, [{ kind: 'ticks', params: { count: 9, length: 0.3 } }]);
    const out = tickLines(straight);
    expect(out).toHaveLength(9);
    for (const l of out) {
      const d = sub(l.pts[1], l.pts[0]);
      expect(Math.abs(d[0])).toBeLessThan(1e-9);
      expect(len(d)).toBeCloseTo(0.3, 9);
    }
    // A single tick sits mid-line.
    expect(tickLines(run(geo({ pts: [[0, 0, 0], [2, 0, 0]] }), { count: 1 }))[0].pts[0][0]).toBeCloseTo(1, 9);
  });

  it('inherits family, tone and t from the line, and the surface normal', () => {
    const line = circle(96, true, { tone: 'front', family: 3, t: Array.from({ length: 96 }, (_, i) => i / 96) });
    const out = tickLines(run(geo(line), { count: 20 }));
    expect(out.every((l) => l.family === 3 && l.tone === 'front' && l.normals === undefined)).toBe(true);
    out.forEach((l, i) => {
      expect(l.t![0]).toBeCloseTo(i / 20, 2);
      expect(l.t![1]).toBe(l.t![0]);
    });
    const withNormals = circle(96, true, { normals: circle(96, true).pts });
    expect(tickLines(run(geo(withNormals), { count: 5 })).every((l) => l.normals!.length === 2)).toBe(true);
  });

  it('varies tick length by wave or at random, deterministically', () => {
    const lengths = (params: Record<string, unknown>) => tickLines(run(geo(circle()), { count: 80, length: 0.2, ...params })).map(tickLen);
    const wave = lengths({ vary: 'wave', amount: 0.5, cycles: 4 });
    expect(Math.max(...wave)).toBeGreaterThan(0.28);
    expect(Math.min(...wave)).toBeLessThan(0.12);
    expect(Math.max(...wave)).toBeLessThanOrEqual(0.3 + 1e-9);
    const random = lengths({ vary: 'random', amount: 0.6, seed: 5 });
    for (const x of random) {
      expect(x).toBeGreaterThanOrEqual(0.2 * 0.4 - 1e-9);
      expect(x).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    expect(new Set(random.map((x) => x.toFixed(6))).size).toBeGreaterThan(20);
    expect(lengths({ vary: 'random', amount: 0.6, seed: 5 })).toEqual(random);
    expect(lengths({ vary: 'random', amount: 0.6, seed: 6 })).not.toEqual(random);
    // Full-depth waves drop to nothing rather than going negative.
    expect(Math.min(...lengths({ vary: 'wave', amount: 1, cycles: 2 }))).toBeGreaterThanOrEqual(0);
  });

  it('can drop the original lines', () => {
    const out = run(geo(circle()), { count: 30, keepLines: false });
    expect(out.lines).toHaveLength(30);
    expect(out.lines.every((l) => l.pts.length === 2)).toBe(true);
  });

  it('passes geometry without lines through unchanged', () => {
    const points = { lines: [], nodes: [{ p: [0, 0, 0] as Vec3 }, { p: [1, 0, 0] as Vec3 }], labels: [{ p: [0, 0, 0] as Vec3, text: 'x' }] };
    expect(run(points)).toEqual(points);
    const built = stack({ kind: 'points', params: { count: 30 } }, [{ kind: 'ticks' }]);
    expect(built.lines).toEqual([]);
    expect(built.nodes).toHaveLength(30);
  });

  it('carries nodes and labels through', () => {
    const g: Geometry = { lines: [circle()], nodes: [{ p: [0, 0, 0] }], labels: [{ p: [0, 0, 0], text: 'x' }] };
    const out = run(g);
    expect(out.nodes).toEqual(g.nodes);
    expect(out.labels).toEqual(g.labels);
  });

  it('skips lines that have no length', () => {
    const out = run(geo({ pts: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], closed: true }, { pts: [[0, 0, 0]] }, { pts: [] }, circle()), { count: 10 });
    expect(out.lines).toHaveLength(4 + 10);
    expect(finite(out)).toBe(true);
    expect(out.lines.flatMap((l) => l.pts).every((q) => q.every(Number.isFinite))).toBe(true);
  });

  it('puts ticks along surface normals on a revolved sphere', () => {
    const arc = { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } };
    const sphere = stack(arc, [{ kind: 'revolve', params: { rings: 5, spokes: 8 } }]);
    const g = stack(arc, [{ kind: 'revolve', params: { rings: 5, spokes: 8 } }, { kind: 'ticks', params: { count: 20, direction: 'normal', length: 0.15 } }]);
    const out = g.lines.slice(sphere.lines.length);
    expect(out.length).toBeGreaterThan(100);
    for (const l of out) {
      expect(l.normals).toHaveLength(2);
      const d = sub(l.pts[1], l.pts[0]);
      expect(len(d)).toBeCloseTo(0.15, 6);
      // Along the unit surface normal, which on a unit sphere is the position.
      expect(dot(d, l.normals![0]) / len(d)).toBeGreaterThan(0.999);
      expect(len(l.pts[1])).toBeGreaterThan(len(l.pts[0]));
    }
    // Flat ticks keep the normals too, so hidden-line fading still applies.
    const flat = stack(arc, [{ kind: 'revolve', params: { rings: 5, spokes: 8 } }, { kind: 'ticks', params: { count: 20 } }]);
    expect(flat.lines.slice(sphere.lines.length).every((l) => l.normals?.length === 2)).toBe(true);
  });

  it('falls back to flat ticks for "normal" on lines without normals', () => {
    const flat = tickLines(run(geo(circle()), { count: 20, direction: 'flat' }));
    const fallback = tickLines(run(geo(circle()), { count: 20, direction: 'normal' }));
    expect(fallback).toEqual(flat);
  });

  it('caps the total number of ticks', () => {
    const lattice = stack({ kind: 'lattice', params: { cols: 60, rows: 60 } }, [{ kind: 'ticks', params: { count: 720 } }]);
    const base = stack({ kind: 'lattice', params: { cols: 60, rows: 60 } });
    const added = lattice.lines.length - base.lines.length;
    expect(added).toBeGreaterThan(5000);
    expect(added).toBeLessThanOrEqual(12_000);

    const many = Array.from({ length: 15_000 }, (_, i): Polyline => ({ pts: [[i, 0, 0], [i, 1, 0]], family: i }));
    const out = run(geo(...many), { count: 720, keepLines: false });
    expect(out.lines.length).toBeGreaterThan(0);
    expect(out.lines.length).toBeLessThanOrEqual(12_000);
    expect(out.lines.flatMap((l) => l.pts).every((q) => q.every(Number.isFinite))).toBe(true);
  });

  it('builds finite geometry across its parameter range', () => {
    for (const source of [{ kind: 'curve', params: { shape: 'knot' } }, { kind: 'curve', params: { shape: 'star' } }, { kind: 'orbits' }, { kind: 'card' }]) {
      for (const params of [{}, { count: 2, length: 1.5, side: 'both', majorEvery: 36, majorLength: 4, vary: 'wave', amount: 1, cycles: 24 }, { count: 720, vary: 'random', direction: 'normal' }, { count: 0, length: -1, majorEvery: -3, amount: 9 }]) {
        const g = stack(source, [{ kind: 'ticks', params }]);
        expect(finite(g)).toBe(true);
      }
    }
  });
});

describe('resample keepLines', () => {
  const dots = (keepLines: boolean) =>
    stack({ kind: 'curve', params: { shape: 'circle' } }, [{ kind: 'resample', params: { mode: 'dots', spacing: 0.1, keepLines } }]);

  it('puts beads on the lines when asked', () => {
    const base = stack({ kind: 'curve', params: { shape: 'circle' } });
    const beads = dots(true);
    expect(beads.lines).toEqual(base.lines);
    expect(beads.nodes.length).toBeGreaterThan(50);
  });

  it('replaces the lines with dots by default', () => {
    const plain = dots(false);
    expect(plain.lines).toEqual([]);
    expect(plain.nodes).toHaveLength(dots(true).nodes.length);
    const unset = stack({ kind: 'curve' }, [{ kind: 'resample', params: { mode: 'dots', spacing: 0.1 } }]);
    expect(unset.lines).toEqual([]);
    expect(opFor('resample')!.defaults.keepLines).toBe(false);
  });

  it('leaves dashes alone', () => {
    const dashes = stack({ kind: 'curve' }, [{ kind: 'resample', params: { mode: 'dashes', keepLines: true } }]);
    expect(dashes.lines.length).toBeGreaterThan(1);
    expect(dashes.lines.every((l) => l.pts.length === 3)).toBe(true);
  });
});

describe('context', () => {
  const LAYOUTS = ['window', 'burst', 'radial'];
  const context = (params: Record<string, unknown> = {}, ops: { kind: string; params?: Record<string, unknown> }[] = []) =>
    stack({ kind: 'context', params }, ops);
  const centre = (l: Polyline): Vec3 => [l.pts.reduce((a, q) => a + q[0], 0) / l.pts.length, l.pts.reduce((a, q) => a + q[1], 0) / l.pts.length, l.pts[0][2]];
  const PARAGRAPH = 'The model reads every token in its window. Attention, though, is not spread evenly: a few passages matter most! Retrieval puts them there; context decides.';
  const words = (t: string) => t.split(/\s+/).filter(Boolean);

  it.each(LAYOUTS)('%s keeps generated tokens within the budget, and fills most of it', (layout) => {
    for (const tokens of [20, 150, 600, 3000]) {
      const g = context({ layout, tokens, rows: 40, density: 1, falloff: 0 });
      expect(g.nodes.length).toBeGreaterThan(0);
      expect(g.nodes.length).toBeLessThanOrEqual(tokens);
      expect(g.lines).toHaveLength(g.nodes.length);
    }
    expect(context({ layout, tokens: 3000, rows: 100, density: 1, falloff: 0 }).nodes.length).toBeGreaterThan(1500);
    // The most that can be asked for still fits the pipeline's point budget untouched.
    const heavy = buildForm(make({ kind: 'context', params: { layout, tokens: 3000, rows: 160, density: 1, falloff: 0 } }));
    expect(heavy.warnings).toEqual([]);
    expect(heavy.geometry.lines.length * 4 + heavy.geometry.nodes.length).toBeLessThan(POINT_BUDGET);
  });

  it('draws a block as a closed four-point rectangle with a node at its centre, and nothing that can be hidden', () => {
    for (const layout of LAYOUTS) {
      const g = context({ layout });
      for (const [i, l] of g.lines.entries()) {
        expect(l.closed).toBe(true);
        expect(l.pts).toHaveLength(4);
        expect(l.normals).toBeUndefined();
        expect(l.t).toHaveLength(4);
        expect(new Set(l.t).size).toBe(1);
        expect([0, 1]).toContain(l.family);
        expect(g.nodes[i].t).toBe(l.t![0]);
        expect(g.nodes[i].family).toBe(l.family);
        const c = centre(l);
        g.nodes[i].p.forEach((v, k) => expect(v).toBeCloseTo(c[k], 9));
        // A rectangle: opposite sides are equal and the corners are square.
        const [a, b, c2, d] = l.pts;
        expect(len(sub(a, b))).toBeCloseTo(len(sub(d, c2)), 9);
        expect(dot(sub(b, a), sub(d, a))).toBeCloseTo(0, 9);
      }
    }
  });

  it('draws a line as a two-point bar, and a dot as only a node', () => {
    const blocks = context({ mark: 'block' });
    const bars = context({ mark: 'line' });
    expect(bars.nodes).toEqual(blocks.nodes);
    expect(bars.lines).toHaveLength(blocks.lines.length);
    bars.lines.forEach((l, i) => {
      expect(l.pts).toHaveLength(2);
      expect(l.closed).toBeFalsy();
      expect(l.t).toHaveLength(2);
      expect(l.family).toBe(blocks.lines[i].family);
      // The bar runs along the block's length, through its centre.
      const [a, b] = blocks.lines[i].pts;
      expect(len(sub(l.pts[1], l.pts[0]))).toBeCloseTo(len(sub(b, a)), 9);
    });
    const dots = context({ mark: 'dot' });
    expect(dots.lines).toEqual([]);
    expect(dots.nodes).toEqual(blocks.nodes);
  });

  describe('cut', () => {
    const sq = (params: Record<string, unknown> = {}) => context({ cut: 'square', ...params });
    const slant = (params: Record<string, unknown> = {}) => context({ cut: 'slant', ...params });

    it('square is the default, and leaves the plain rectangles untouched', () => {
      expect(context()).toEqual(context({ cut: 'square' }));
      expect(context({ cut: 'square', cutAngle: 50 })).toEqual(context());
      expect(context().lines.every((l) => l.pts.length === 4)).toBe(true);
    });

    it.each(LAYOUTS)('%s: slanted blocks end in a forward cut, the bottom corner reaching past the top', (layout) => {
      const flat = sq({ layout }), cut = slant({ layout, cutAngle: 30 });
      expect(cut.lines).toHaveLength(flat.lines.length);
      expect(cut.nodes).toEqual(flat.nodes);
      cut.lines.forEach((l, i) => {
        // The same four corners, with only the top finish corner (the fourth-from-start one) pulled back along the block.
        const [a, b, c, d] = flat.lines[i].pts, [a2, b2, c2, d2] = l.pts;
        expect(l.pts).toHaveLength(4);
        expect(l.closed).toBe(true);
        expect([a2, b2, d2]).toEqual([a, b, d]);
        const along = sub(b, a), length = len(along);
        const pulled = sub(c, c2);
        // c2 sits on the top edge, pulled toward the start by thick × tan(30°), unless the block is too short.
        const thick = len(sub(d, a));
        const expected = Math.min(thick * Math.tan(Math.PI / 6), 0.45 * length);
        expect(len(pulled)).toBeCloseTo(expected, 9);
        expect(dot(pulled, along) / (len(pulled) * length || 1)).toBeCloseTo(1, 6);
        // So the bottom edge is longer than the top.
        expect(len(sub(b2, a2))).toBeGreaterThan(len(sub(c2, d2)) - 1e-12);
      });
    });

    it('angle 0 is square, and a steeper angle bites deeper', () => {
      expect(slant({ cutAngle: 0 }).lines).toEqual(sq().lines);
      const bite = (angle: number) => slant({ layout: 'window', cutAngle: angle, tokens: 40, rows: 8 }).lines.reduce((s, l) => s + len(sub(l.pts[1], l.pts[2])), 0);
      expect(bite(10)).toBeLessThan(bite(30));
      expect(bite(30)).toBeLessThan(bite(60));
    });

    it('never folds a short block over itself', () => {
      for (const params of [{ cutAngle: 60, length: 0.2, variance: 1, height: 1 }, { cutAngle: 60, tokens: 3000, rows: 160, length: 0.2 }]) {
        for (const l of slant(params).lines) {
          const [a, b, c, d] = l.pts;
          // Top edge keeps its direction: the top finish corner stays right of the top start corner.
          expect(dot(sub(c, d), sub(b, a))).toBeGreaterThan(0);
        }
      }
    });

    it('is cut the same way in pasted text, and does not touch lines, dots or nodes', () => {
      const words = { text: PARAGRAPH, highlight: 'model', cut: 'slant' };
      const g = context(words), flat = context({ ...words, cut: 'square' });
      expect(g.lines).toHaveLength(flat.lines.length);
      expect(g.nodes).toEqual(flat.nodes);
      expect(g.lines.some((l, i) => len(sub(l.pts[2], flat.lines[i].pts[2])) > 1e-6)).toBe(true);
      for (const mark of ['line', 'dot']) expect(slant({ mark })).toEqual(sq({ mark }));
    });

    it('stays finite and within the point budget at its heaviest', () => {
      const heavy = buildForm(make({ kind: 'context', params: { layout: 'burst', tokens: 3000, rows: 160, density: 1, falloff: 0, cut: 'slant', cutAngle: 60, corner: 0.5 } }));
      expect(heavy.warnings).toEqual([]);
      expect(finite(heavy.geometry)).toBe(true);
    });

    it('rounds corners with the corner param, as a share of the block height', () => {
      const round = context({ layout: 'window', corner: 0.3, tokens: 60, rows: 12 });
      const sharp = context({ layout: 'window', corner: 0, tokens: 60, rows: 12 });
      expect(round.lines).toHaveLength(sharp.lines.length);
      for (const [i, l] of round.lines.entries()) {
        expect(l.pts.length).toBeGreaterThan(4);
        expect(l.t).toHaveLength(l.pts.length);
        // Rounding stays inside the sharp block.
        const [a, , c] = sharp.lines[i].pts;
        for (const q of l.pts) {
          expect(q[0]).toBeGreaterThanOrEqual(a[0] - 1e-9);
          expect(q[0]).toBeLessThanOrEqual(c[0] + 1e-9);
          expect(q[1]).toBeGreaterThanOrEqual(a[1] - 1e-9);
          expect(q[1]).toBeLessThanOrEqual(c[1] + 1e-9);
        }
      }
    });
  });

  it('numbers tokens in reading order with t from 0 to 1', () => {
    for (const layout of LAYOUTS) {
      const g = context({ layout });
      const ts = g.nodes.map((n) => n.t!);
      expect(ts[0]).toBe(0);
      expect(ts[ts.length - 1]).toBe(1);
      for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
    // In a window that is row by row, top to bottom, left to right.
    const w = context({ layout: 'window' }).nodes;
    for (let i = 1; i < w.length; i++) expect(w[i].p[1] < w[i - 1].p[1] - 1e-9 || (Math.abs(w[i].p[1] - w[i - 1].p[1]) < 1e-9 && w[i].p[0] > w[i - 1].p[0])).toBe(true);
    expect(buildForm(make({ kind: 'context', params: { text: 'one' } })).geometry.nodes[0].t).toBe(0);
  });

  it('spans a field whose shape follows aspect, like the lattice', () => {
    for (const aspect of [0.25, 1, 1.6, 4]) {
      const ax = Math.sqrt(aspect), ay = 1 / ax;
      for (const layout of ['window', 'burst']) {
        const pts = context({ layout, aspect, density: 1, falloff: 0, tokens: 1500 }).lines.flatMap((l) => l.pts);
        expect(Math.max(...pts.map((q) => q[0]))).toBeGreaterThan(ax * 0.9);
        expect(Math.min(...pts.map((q) => q[0]))).toBeGreaterThanOrEqual(-ax - 1e-9);
        expect(Math.max(...pts.map((q) => q[0]))).toBeLessThanOrEqual(ax + 1e-9);
        expect(Math.max(...pts.map((q) => Math.abs(q[1])))).toBeLessThanOrEqual(ay + 1e-9);
        expect(Math.max(...pts.map((q) => Math.abs(q[1])))).toBeGreaterThan(ay * 0.9);
      }
    }
  });

  it('is left-aligned and flat in a window, with ragged right edges and gaps between paragraphs', () => {
    const g = context({ layout: 'window', rows: 40, tokens: 700 });
    expect(g.lines.every((l) => l.pts.every((q) => q[2] === 0))).toBe(true);
    const rows = new Map<string, Vec3[]>();
    for (const n of g.nodes) rows.set(n.p[1].toFixed(6), [...(rows.get(n.p[1].toFixed(6)) ?? []), n.p]);
    expect(rows.size).toBeGreaterThan(20);
    // Every row starts at the left edge...
    for (const r of rows.values()) expect(Math.min(...r.map((q) => q[0]))).toBeLessThan(-1 + 0.3);
    // ...and ends in different places.
    expect(new Set([...rows.values()].map((r) => Math.round(Math.max(...r.map((q) => q[0])) * 20))).size).toBeGreaterThan(4);
    // Fewer than all rows are used: paragraph breaks leave blank lines.
    expect(rows.size).toBeLessThan(40);
  });

  it('gives burst and radial a small seeded depth per row, and every token of a row the same one', () => {
    for (const layout of ['burst', 'radial']) {
      const g = context({ layout, tokens: 1200 });
      const zs = g.lines.map((l) => l.pts[0][2]);
      expect(zs.every((z) => Math.abs(z) <= 0.05 + 1e-9)).toBe(true);
      expect(new Set(zs.map((z) => z.toFixed(6))).size).toBeGreaterThan(5);
      expect(g.lines.every((l) => l.pts.every((q) => q[2] === l.pts[0][2]))).toBe(true);
    }
  });

  it('respects the relevant share for a given seed, as family 1', () => {
    const share = (params: Record<string, unknown>) => {
      const g = context({ layout: 'window', tokens: 3000, rows: 100, density: 1, ...params });
      return g.nodes.filter((n) => n.family === 1).length / g.nodes.length;
    };
    expect(share({ relevant: 0 })).toBe(0);
    expect(share({ relevant: 1 })).toBe(1);
    for (const relevant of [0.08, 0.3]) for (const seed of [1, 2, 3]) expect(Math.abs(share({ relevant, seed }) - relevant)).toBeLessThan(0.03);
  });

  it('is denser, and its blocks longer, near the core of a burst than at its edge', () => {
    const g = context({ layout: 'burst', tokens: 2400, rows: 100, density: 0.8, falloff: 0.6 });
    const r = (p: Vec3) => Math.hypot(p[0], p[1]);
    const inside = g.nodes.filter((n) => r(n.p) < 0.4), outside = g.nodes.filter((n) => r(n.p) > 0.75);
    // Per unit area, the core holds several times more tokens than the rim (the field is the square [-1, 1]²).
    const [coreArea, rimArea] = [Math.PI * 0.4 ** 2, 4 - Math.PI * 0.75 ** 2];
    expect(inside.length / coreArea).toBeGreaterThan(4 * (outside.length / rimArea));
    const length = (n: (typeof g.nodes)[number]) => {
      const l = g.lines[g.nodes.indexOf(n)];
      return len(sub(l.pts[1], l.pts[0]));
    };
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean(inside.map(length))).toBeGreaterThan(1.5 * mean(outside.map(length)));
  });

  it('thins faster with a higher falloff', () => {
    const spread = (falloff: number) => {
      const g = context({ layout: 'burst', tokens: 2400, rows: 100, density: 1, falloff });
      return g.nodes.filter((n) => Math.hypot(n.p[0], n.p[1]) > 0.7).length / g.nodes.length;
    };
    expect(spread(0.9)).toBeLessThan(spread(0.5));
    expect(spread(0.5)).toBeLessThan(spread(0.1));
  });

  it('puts radial tokens on rays from the centre, oriented along them, thinning outward', () => {
    const g = context({ layout: 'radial', tokens: 1500, rows: 60, falloff: 0.5 });
    expect(g.lines.length).toBeGreaterThan(200);
    for (const l of g.lines) {
      const c = centre(l);
      const along = sub(l.pts[1], l.pts[0]);
      const radial = [c[0], c[1], 0] as Vec3;
      // The block's long side points away from the centre (or at it).
      expect(Math.abs(dot(along, radial)) / (len(along) * len(radial))).toBeGreaterThan(0.999);
    }
    const r = (p: Vec3) => Math.hypot(p[0], p[1]);
    const disc = (x: number) => Math.PI * x * x;
    const near = g.nodes.filter((n) => r(n.p) < 0.4).length / disc(0.4), far = g.nodes.filter((n) => r(n.p) > 0.8).length / (disc(1) - disc(0.8));
    expect(near).toBeGreaterThan(3 * far);
  });

  it('leaves positions alone when relevance, or block height, changes', () => {
    for (const layout of LAYOUTS) {
      const a = context({ layout, relevant: 0.1 }), b = context({ layout, relevant: 0.5 });
      expect(b.nodes.map((n) => n.p)).toEqual(a.nodes.map((n) => n.p));
      expect(b.nodes.map((n) => n.family)).not.toEqual(a.nodes.map((n) => n.family));
      expect(context({ layout, height: 0.9 }).nodes.map((n) => n.p)).toEqual(context({ layout }).nodes.map((n) => n.p));
    }
  });

  it('is deterministic per seed and differs across seeds', () => {
    for (const layout of LAYOUTS) {
      expect(context({ layout, seed: 3 })).toEqual(context({ layout, seed: 3 }));
      expect(context({ layout, seed: 3 })).not.toEqual(context({ layout, seed: 4 }));
    }
  });

  describe('pasted text', () => {
    const text = (params: Record<string, unknown> = {}, source = PARAGRAPH) => context({ text: source, relevant: 0, ...params });

    it('makes one token per word, in reading order, with lengths that follow the word', () => {
      const g = text();
      expect(g.nodes).toHaveLength(words(PARAGRAPH).length);
      expect(g.lines).toHaveLength(g.nodes.length);
      const block = (i: number) => len(sub(g.lines[i].pts[1], g.lines[i].pts[0]));
      const w = words(PARAGRAPH);
      // Same character count, same length; more characters, longer.
      const unit = block(w.findIndex((x) => x === 'every')) / 'every'.length;
      w.forEach((word, i) => expect(block(i)).toBeCloseTo(unit * [...word].length, 6));
      expect(g.nodes[0].t).toBe(0);
      expect(g.nodes[g.nodes.length - 1].t).toBe(1);
    });

    it('wraps to the field width and fits its height, starting at the top', () => {
      const long = PARAGRAPH.repeat(6);
      for (const aspect of [0.5, 1, 2]) {
        const ax = Math.sqrt(aspect), ay = 1 / ax;
        const g = text({ aspect }, long);
        expect(g.nodes).toHaveLength(words(long).length);
        const pts = g.lines.flatMap((l) => l.pts);
        expect(Math.min(...pts.map((q) => q[0]))).toBeGreaterThanOrEqual(-ax - 1e-9);
        expect(Math.max(...pts.map((q) => q[0]))).toBeLessThanOrEqual(ax + 1e-9);
        expect(Math.max(...pts.map((q) => q[1]))).toBeLessThanOrEqual(ay + 1e-9);
        expect(Math.min(...pts.map((q) => q[1]))).toBeGreaterThanOrEqual(-ay - 1e-9);
        expect(Math.max(...pts.map((q) => q[1]))).toBeGreaterThan(ay - 0.1);
      }
      // A longer text is set smaller, so it still fits.
      const size = (source: string) => len(sub(text({}, source).lines[0].pts[1], text({}, source).lines[0].pts[0]));
      expect(size('wide ' + PARAGRAPH.repeat(10))).toBeLessThan(size('wide ' + PARAGRAPH));
    });

    it('starts a new row at each line break and keeps one blank row for a paragraph break', () => {
      const ys = (source: string) => [...new Set(text({}, source).nodes.map((n) => n.p[1]))].sort((a, b) => b - a);
      expect(ys('a b c d')).toHaveLength(1);
      expect(ys('a b\nc d')).toHaveLength(2);
      const [y1, y2, y3] = ys('a b\nc d\n\ne f');
      expect((y1 - y3) / (y1 - y2)).toBeCloseTo(3, 6); // one blank row between the last two
      expect(ys('a b\n\n\n\nc d').map((y) => y - ys('a b\n\n\n\nc d')[0])).toEqual(ys('a b\n\nc d').map((y) => y - ys('a b\n\nc d')[0]));
      // Leading and trailing blank lines leave no gap.
      expect(text({}, '\n\nhello world\n\n').nodes.map((n) => n.p)).toEqual(text({}, 'hello world').nodes.map((n) => n.p));
    });

    it('marks highlighted words as family 1, whatever their case or punctuation', () => {
      const g = text({ highlight: 'attention, DECIDES, window' });
      const marked = new Set(['window.', 'Attention,', 'decides.']);
      words(PARAGRAPH).forEach((w, i) => expect(g.nodes[i].family).toBe(marked.has(w) ? 1 : 0));
      expect(g.nodes.filter((n) => n.family === 1)).toHaveLength(3);
      // A highlight list overrides the relevant share, and a word matches whole (not as part of a longer one).
      expect(text({ highlight: 'zzz', relevant: 1 }).nodes.every((n) => n.family === 0)).toBe(true);
      expect(text({ highlight: 'the' }, 'the theme then the').nodes.map((n) => n.family)).toEqual([1, 0, 0, 1]);
    });

    it('falls back to the seeded relevant share when nothing is highlighted', () => {
      const long = PARAGRAPH.repeat(40);
      const share = (params: Record<string, unknown>) => {
        const g = text(params, long);
        return g.nodes.filter((n) => n.family === 1).length / g.nodes.length;
      };
      expect(share({ relevant: 0 })).toBe(0);
      expect(share({ relevant: 1 })).toBe(1);
      expect(Math.abs(share({ relevant: 0.25 }) - 0.25)).toBeLessThan(0.06);
      expect(share({ relevant: 0.25, seed: 9 })).not.toBe(share({ relevant: 0.25, seed: 10 }));
    });

    it('is arranged by the layout too, keeping every highlighted word', () => {
      const long = PARAGRAPH.repeat(5);
      const flat = text({ highlight: 'attention' }, long);
      for (const layout of ['burst', 'radial']) {
        const g = text({ highlight: 'attention', layout, rows: 24 }, long);
        expect(finite(g)).toBe(true);
        expect(g.nodes.length).toBeGreaterThan(0);
        expect(g.nodes.length).toBeLessThanOrEqual(flat.nodes.length);
        expect(g.nodes.filter((n) => n.family === 1)).toHaveLength(flat.nodes.filter((n) => n.family === 1).length);
        expect(g.nodes.map((n) => n.p)).not.toEqual(flat.nodes.map((n) => n.p));
      }
    });

    it('ignores a text that is only whitespace, and caps the words', () => {
      expect(text({}, '  \n \t ')).toEqual(context({ relevant: 0 }));
      const many = Array.from({ length: 2000 }, () => 'a').join(' ');
      for (const layout of LAYOUTS) {
        const g = text({ layout }, many);
        expect(g.nodes.length).toBeLessThanOrEqual(3000);
        expect(g.nodes.length).toBeGreaterThan(500);
        expect(finite(g)).toBe(true);
      }
    });
  });

  it('survives odd and extreme input', () => {
    const odd = [
      {}, { tokens: 0, rows: 0 }, { tokens: 1e9, rows: 1e9 }, { tokens: -5, rows: -5, aspect: -1 }, { aspect: 0, length: 0, height: 0, density: -1, falloff: 9 },
      { aspect: 1e6, variance: 5 }, { text: 'x', rows: 0 }, { text: '‮\u0000 😀 \n\n é', length: 99 }, { text: 'supercalifragilisticexpialidocious'.repeat(8), aspect: 4 },
      { tokens: Number.NaN, rows: Number.NaN, seed: Number.NaN }, { layout: 'nope', mark: 'nope' },
    ];
    for (const layout of LAYOUTS) for (const params of odd) {
      const g = context({ layout, ...params });
      expect(finite(g)).toBe(true);
      expect(g.nodes.length).toBeLessThanOrEqual(3000);
      for (const l of g.lines) expect(l.t!.every(Number.isFinite)).toBe(true);
    }
  });

  it('renders as solid blocks with a shapes fill, and only outlines without', () => {
    const form = make({ kind: 'context', params: { layout: 'burst' } });
    const outlines = renderForm(form, ['#111', '#eee']);
    expect(outlines.fills).toEqual([]);
    expect(outlines.strokes.length).toBeGreaterThan(0);
    const solid = renderForm({ ...form, style: { ...DEFAULT_STYLE, fill: 'shapes', fillOpacity: 1, colorBy: 'family' } }, ['#111', '#eee']);
    // One closed sub-path per block, split into a bucket per family.
    expect(solid.fills.length).toBe(2);
    expect(solid.fills.reduce((n, f) => n + (f.d.match(/M/g)?.length ?? 0), 0)).toBeGreaterThan(buildForm(form).geometry.lines.length * 0.95);
    expect(solid.fills.every((f) => f.opacity === 1)).toBe(true);
    expect(solid.warnings).toEqual([]);
  });

  it('is varied by Mutate without touching its text', () => {
    const base: Form = make({ kind: 'context', params: { text: PARAGRAPH, highlight: 'attention' } });
    for (const v of variations(base, 12, 5, 1)) {
      expect(v.source.params.text).toBe(PARAGRAPH);
      expect(v.source.params.highlight).toBe('attention');
      expect(finite(buildForm(v).geometry)).toBe(true);
    }
  });

  it('describes its params to agents, with a 4000-character text and a layout-only falloff', () => {
    const block = describeBlocks().sources.find((s) => s.kind === 'context')!;
    const param = (key: string) => block.params.find((q) => q.key === key)!;
    expect(param('text')).toMatchObject({ type: 'string', maxLength: 4000, multiline: true });
    expect(param('highlight')).toMatchObject({ type: 'string', maxLength: 200 });
    expect(param('layout')).toMatchObject({ type: 'enum', options: LAYOUTS });
    expect(param('mark')).toMatchObject({ type: 'enum', options: ['block', 'line', 'dot'] });
    expect(param('tokens')).toMatchObject({ min: 20, max: 3000, default: 600 });
    expect(param('falloff')).toMatchObject({ only_when: { key: 'layout', in: ['burst', 'radial'] } });
    expect(describeBlocks().sources.find((s) => s.kind === 'card')!.params.find((q) => q.key === 'text')).toMatchObject({ maxLength: 200 });
  });

  it('keeps 4000 characters of text through parseDoc, while other text still stops at 200', () => {
    const long = 'word '.repeat(900);
    const { doc, warnings } = parseDoc({
      forms: [
        { source: { kind: 'context', params: { text: long, highlight: long } } },
        { source: { kind: 'card', params: { text: long, meta: long } } },
        { source: { kind: 'note', params: { text: long } } },
      ],
    });
    expect(warnings).toEqual([]);
    const [ctx, card, note] = doc.forms.map((f) => f.source.params);
    expect(String(ctx.text)).toHaveLength(4000);
    expect(String(ctx.highlight)).toHaveLength(200);
    expect(String(card.text)).toHaveLength(200);
    expect(String(card.meta)).toHaveLength(200);
    expect(String(note.text)).toHaveLength(200);
    expect(buildForm(doc.forms[0]).geometry.nodes.length).toBe(words(long.slice(0, 4000)).length);
  });
});

describe('connect focus', () => {
  const connect = opFor('connect')!;
  const threads = (source: { kind: string; params?: Record<string, unknown> }, params: Record<string, unknown> = {}) =>
    stack(source, [{ kind: 'connect', params: { mode: 'focus', keepLines: false, ...params } }]);
  const cloud = { kind: 'points', params: { count: 80, spread: 'ball', seed: 2 } };
  const field = (params: Record<string, unknown> = {}) => ({ kind: 'context', params: { mark: 'dot', tokens: 600, rows: 40, relevant: 0.2, ...params } });
  const last = (l: Polyline) => l.pts[l.pts.length - 1];

  it('offers "To a point", with its params shown only for that mode and the old defaults untouched', () => {
    expect(connect.params.find((p) => p.key === 'mode')).toMatchObject({ options: expect.arrayContaining([{ value: 'focus', label: 'To a point' }]) });
    for (const key of ['fx', 'fy', 'fz', 'split', 'which', 'share', 'seed']) {
      expect(connect.params.find((p) => p.key === key)!.when).toEqual({ key: 'mode', in: ['focus'] });
    }
    expect(connect.params.find((p) => p.key === 'fx')).toMatchObject({ min: -3, max: 3 });
    expect(connect.params.find((p) => p.key === 'which')).toMatchObject({ options: ['all', 'relevant', 'share'].map((value) => expect.objectContaining({ value })) });
    expect(connect.defaults).toMatchObject({ mode: 'nearest', k: 3, distance: 0.4, bow: 0, keepLines: true, maxLinks: 1500, fx: 0, fy: 1.2, fz: 0, split: false, which: 'all', share: 1 });
  });

  it('ends every thread exactly at the focus, from the point, with t running 0 to 1 and the point family', () => {
    const g = threads(field(), { fx: 0.7, fy: -1.3, fz: 2 });
    const nodes = stack(field()).nodes;
    expect(g.lines).toHaveLength(nodes.length);
    g.lines.forEach((l, i) => {
      expect(l.pts).toHaveLength(2);
      expect(l.pts[0]).toEqual(nodes[i].p);
      expect(last(l)).toEqual([0.7, -1.3, 2]);
      expect(l.t).toEqual([0, 1]);
      expect(l.family).toBe(nodes[i].family);
    });
    // Without any params the focus is above the centre.
    for (const l of threads(cloud).lines) expect(last(l)).toEqual([0, 1.2, 0]);
  });

  it('still ends at the focus when bowed, with t rising along every segment', () => {
    for (const bow of [-0.6, 0.4, 1]) {
      const g = threads(field(), { fx: 1, fy: 1.5, fz: 0, bow });
      expect(g.lines.length).toBeGreaterThan(100);
      for (const l of g.lines) {
        expect(last(l)).toEqual([1, 1.5, 0]);
        expect(l.pts.length).toBeGreaterThan(2);
        expect(l.t).toHaveLength(l.pts.length);
        expect(l.t![0]).toBe(0);
        expect(l.t![l.t!.length - 1]).toBe(1);
        expect(l.t!.every((t, i) => i === 0 || t > l.t![i - 1])).toBe(true);
      }
    }
  });

  it('sends points below the middle to the mirrored focus when split, and all to one focus otherwise', () => {
    const nodes = stack(field()).nodes;
    expect(nodes.some((n) => n.p[1] < 0) && nodes.some((n) => n.p[1] > 0)).toBe(true);
    const params = { fx: 0.5, fy: 1.4, fz: 0.25 };
    threads(field(), { ...params, split: true }).lines.forEach((l, i) => expect(last(l)).toEqual([0.5, nodes[i].p[1] < 0 ? -1.4 : 1.4, 0.25]));
    for (const l of threads(field(), { ...params, split: false }).lines) expect(last(l)).toEqual([0.5, 1.4, 0.25]);
  });

  it('threads only family-1 nodes for "relevant"', () => {
    const nodes = stack(field()).nodes;
    const relevant = nodes.filter((n) => n.family === 1);
    expect(relevant.length).toBeGreaterThan(40);
    expect(relevant.length).toBeLessThan(nodes.length);
    const g = threads(field(), { which: 'relevant' });
    expect(g.lines).toHaveLength(relevant.length);
    g.lines.forEach((l, i) => {
      expect(l.family).toBe(1);
      expect(l.pts[0]).toEqual(relevant[i].p);
    });
    expect(threads(field({ relevant: 0 }), { which: 'relevant' }).lines).toEqual([]);
    // A point cloud has only family 0, so nothing is relevant there.
    expect(threads(cloud, { which: 'relevant' }).lines).toEqual([]);
  });

  it('threads a seeded share of the points for "share", and ignores share otherwise', () => {
    const big = { kind: 'context', params: { mark: 'dot', tokens: 1400, rows: 60, density: 1, falloff: 0, layout: 'window' } };
    const n = stack(big).nodes.length;
    expect(n).toBeGreaterThan(1000);
    const count = (params: Record<string, unknown>) => threads(big, { which: 'share', ...params }).lines.length;
    expect(count({ share: 0 })).toBe(0);
    expect(count({ share: 1 })).toBe(n);
    for (const share of [0.2, 0.5]) expect(Math.abs(count({ share }) / n - share)).toBeLessThan(0.05);
    const starts = (seed: number) => threads(big, { which: 'share', share: 0.3, seed }).lines.map((l) => l.pts[0]);
    expect(starts(4)).toEqual(starts(4));
    expect(starts(4)).not.toEqual(starts(5));
    expect(threads(cloud, { which: 'all', share: 0.1 }).lines).toHaveLength(80);
  });

  it('respects maxLinks, thinning evenly rather than keeping the first points', () => {
    const g = threads(field({ tokens: 1500, rows: 60 }), { maxLinks: 100 });
    expect(g.lines).toHaveLength(100);
    const ys = g.lines.map((l) => l.pts[0][1]);
    expect(Math.max(...ys)).toBeGreaterThan(0.5);
    expect(Math.min(...ys)).toBeLessThan(-0.5);
    expect(threads(cloud, { maxLinks: 10 }).lines).toHaveLength(10);
  });

  it('keeps the original lines, or not', () => {
    const blocks = stack({ kind: 'context', params: { tokens: 200, rows: 20 } });
    const kept = stack({ kind: 'context', params: { tokens: 200, rows: 20 } }, [{ kind: 'connect', params: { mode: 'focus', keepLines: true } }]);
    expect(kept.lines.slice(0, blocks.lines.length)).toEqual(blocks.lines);
    expect(kept.lines).toHaveLength(blocks.lines.length + blocks.nodes.length);
    expect(threads({ kind: 'context', params: { tokens: 200, rows: 20 } }).lines).toHaveLength(blocks.nodes.length);
    expect(kept.nodes).toEqual(blocks.nodes);
  });

  it('takes its points from the lines when there are no nodes', () => {
    const g = threads({ kind: 'curve', params: { shape: 'circle' } }, { fx: 0, fy: 0, fz: 0 });
    expect(g.lines.length).toBeGreaterThan(5);
    for (const l of g.lines) expect(last(l)).toEqual([0, 0, 0]);
  });

  it('survives extreme values and an empty source', () => {
    for (const params of [{ fx: 99, fy: -99, fz: Number.NaN }, { share: -4, which: 'share' }, { maxLinks: 0 }, { which: 'nope' }, { bow: 1, fx: 0, fy: 0, fz: 0 }]) {
      expect(finite(threads(field(), params))).toBe(true);
      expect(finite(threads(cloud, params))).toBe(true);
    }
    expect(connect.apply({ lines: [], nodes: [] }, { ...connect.defaults, mode: 'focus' })).toEqual({ lines: [], nodes: [], labels: undefined });
  });

  it('keeps the other modes exactly as they were, whatever the focus params say', () => {
    const noise = { fx: 2, fy: -2, fz: 1, split: true, which: 'relevant', share: 0.1, seed: 9 };
    for (const mode of ['nearest', 'within', 'sequence', 'hub']) {
      const base = stack(cloud, [{ kind: 'connect', params: { mode } }]);
      expect(stack(cloud, [{ kind: 'connect', params: { mode, ...noise } }])).toEqual(base);
      expect(base.lines.length).toBeGreaterThan(0);
    }
    // Nearest neighbours: three links per point at most, each a straight two-point line from a point.
    const near = stack(cloud, [{ kind: 'connect', params: {} }]);
    expect(near.lines.every((l) => l.pts.length === 2)).toBe(true);
    expect(near.lines.length).toBeGreaterThanOrEqual(80 * 3 / 2);
    expect(near.lines.length).toBeLessThanOrEqual(80 * 3);
    // The hub still converges on the centroid of the points.
    const nodes = stack(cloud).nodes;
    const centroid = [0, 1, 2].map((k) => nodes.reduce((s, n) => s + n.p[k], 0) / nodes.length);
    const hub = stack(cloud, [{ kind: 'connect', params: { mode: 'hub', keepLines: false } }]);
    expect(hub.lines).toHaveLength(80);
    hub.lines.forEach((l, i) => {
      l.pts[0].forEach((v, k) => expect(v).toBeCloseTo(centroid[k], 9));
      expect(last(l)).toEqual(nodes[i].p);
    });
  });

  it('is validated by parseDoc: focus is a mode, and the focus clamps to ±3', () => {
    const { doc, warnings } = parseDoc({ forms: [{ source: { kind: 'points' }, ops: [{ kind: 'connect', params: { mode: 'focus', fy: 9, which: 'relevant', split: true } }] }] });
    expect(warnings).toEqual([expect.stringMatching(/"fy" clamped to -3–3/)]);
    expect(doc.forms[0].ops[0].params).toMatchObject({ mode: 'focus', fy: 3, which: 'relevant', split: true, fx: 0, fz: 0, share: 1 });
  });
});

describe('strip', () => {
  const strip = (params: Record<string, unknown> = {}, ops: { kind: string; params?: Record<string, unknown> }[] = []) => stack({ kind: 'strip', params }, ops);
  const outlines = (g: Geometry) => g.lines.filter((l) => l.family === 0);
  const overlays = (g: Geometry) => g.lines.filter((l) => l.family === 1);
  const xs = (l: Polyline) => l.pts.map((q) => q[0]);
  const ys = (l: Polyline) => l.pts.map((q) => q[1]);
  const lo = (a: number[]) => Math.min(...a);
  const hi = (a: number[]) => Math.max(...a);
  /** The y of each row that has a slab, top to bottom. */
  const rowsOf = (g: Geometry) => {
    const out: number[] = [];
    for (const y of g.nodes.map((n) => n.p[1]).sort((a, b) => b - a)) if (!out.length || out[out.length - 1] - y > 1e-9) out.push(y);
    return out;
  };
  const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
  /** Sharp, square and simple: the outline is its corners, so measurements can be read straight off it. */
  const SHARP = { corner: 0, startEnd: 'square', finishEnd: 'square' };

  /** Whether two segments properly cross. */
  const cross = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    const side = (p: Vec3, q: Vec3, r: Vec3) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  /** Distance from a point to a segment. */
  const near = (p: Vec3, a: Vec3, b: Vec3) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const u = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
  };
  /** A polygon is simple when no two edges cross, and no corner lies on an edge that is not its own. */
  const simple = (pts: Vec3[]) => {
    const n = pts.length;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % n]];
      if (len(sub(a, b)) < 1e-12) return false;
      for (let j = i + 1; j < n; j++) {
        const [c, d] = [pts[j], pts[(j + 1) % n]];
        if (!(j === i + 1 || (i === 0 && j === n - 1)) && cross(a, b, c, d)) return false;
        for (const k of [j, (j + 1) % n]) if (k !== i && k !== (i + 1) % n && near(pts[k], a, b) < 1e-9) return false;
        for (const k of [i, (i + 1) % n]) if (k !== j && k !== (j + 1) % n && near(pts[k], c, d) < 1e-9) return false;
      }
    }
    return true;
  };
  /** The bottom and top of a polygon along the vertical line x. */
  const extent = (pts: Vec3[], x: number): [number, number] => {
    const found: number[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) found.push(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
    });
    return [lo(found), hi(found)];
  };
  /** The edges of a polygon, as pairs of points. */
  const edges = (pts: Vec3[]) => pts.map((a, i) => [a, pts[(i + 1) % pts.length]] as const);

  it('draws the default as one hyphenated mark: a closed outline and a node for each of its two slabs', () => {
    const g = strip();
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0]).toMatchObject({ closed: true, tone: 'front', family: 0 });
    expect(g.lines[0].normals).toBeUndefined();
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.map((n) => n.family)).toEqual([0, 0]);
    expect(g.nodes[1].p[0]).toBeGreaterThan(g.nodes[0].p[0]);
    // The field is centred on the origin, flat.
    const c = strip(SHARP).lines[0];
    expect(lo(xs(c)) + hi(xs(c))).toBeCloseTo(0, 9);
    expect(lo(ys(c)) + hi(ys(c))).toBeCloseTo(0, 9);
    expect(g.lines[0].pts.every((q) => q[2] === 0)).toBe(true);
  });

  it('reads a pattern: # a slab, - a neck, a space or . a gap, a new line a new row', () => {
    const one = strip({ pattern: '###---####' });
    expect(one.lines).toHaveLength(1);
    expect(one.lines[0].closed).toBe(true);
    expect(one.nodes).toHaveLength(2);
    for (const pattern of ['## ##', '##.##', '##  ##']) {
      const g = strip({ pattern });
      expect(g.lines).toHaveLength(2);
      expect(g.nodes).toHaveLength(2);
    }
    expect(strip({ pattern: '##-##' }).lines).toHaveLength(1);
    const rows = strip({ pattern: '###-###\n#####\n##' });
    expect(rows.lines).toHaveLength(3);
    expect(rowsOf(rows)).toHaveLength(3);
    // Rows stack top to bottom at an even pitch, and the whole field is centred.
    const [a, b, c] = rowsOf(rows);
    expect(a - b).toBeCloseTo(b - c, 9);
    expect(a + c).toBeCloseTo(0, 9);
    const gaps = strip({ pattern: '## ## ##' }).nodes.map((n) => n.p[0]);
    expect(gaps).toEqual([...gaps].sort((x, y) => x - y));
  });

  it('turns unknown characters into gaps, and survives empty, blank and odd patterns', () => {
    expect(strip({ pattern: '##x##' }).lines).toHaveLength(2);
    for (const pattern of ['', ' ', '\n\n', '...', '\t', '-', '---', '#', '- -', 'abc', '#\n\n#', '\r\n#-#\r\n', '#'.repeat(4000), '#-'.repeat(2000), '\n'.repeat(4000) + '#']) {
      const g = strip({ pattern });
      expect(finite(g)).toBe(true);
      expect(g.lines.every((l) => l.closed && l.pts.length >= 3)).toBe(true);
    }
    expect(strip({ pattern: '' }).lines).toEqual([]);
    // A neck on its own is a bar with no slab to mark.
    const neck = strip({ pattern: '---' });
    expect(neck.lines).toHaveLength(1);
    expect(neck.nodes).toEqual([]);
    // Leading gaps indent a row; trailing ones change nothing.
    expect(strip({ pattern: '##   ' })).toEqual(strip({ pattern: '##' }));
    expect(strip({ pattern: '  ##\n######' }).nodes[0].p[0]).toBeGreaterThan(strip({ pattern: '##\n######' }).nodes[0].p[0]);
  });

  const MATRIX = {
    ramp: [0, 1, 30, 75],
    rampEdge: ['both', 'top', 'bottom'],
    neckAlign: ['center', 'top', 'bottom'],
    corner: [0, 0.08, 0.5],
    startEnd: ['square', 'slant', 'round'],
    finishEnd: ['square', 'slant', 'round'],
  } as const;

  it('draws every outline as a simple polygon, across ramps, neck positions, corners and ends', () => {
    // Chains of every shape: a lone slab, short slabs between necks, a neck at either end, several rows.
    const patterns = ['###--######', '#-#-#-#', '##-#', '#', '-#-', '#---#---#', '##\n#-##- #\n###'];
    // Each param over its whole range against a busy base, the extremes of the rest, and random mixes of everything.
    const base = { ramp: 30, rampEdge: 'both', neckAlign: 'center', corner: 0.08, startEnd: 'slant', finishEnd: 'round', neck: 0.5, slant: 30, height: 0.9 };
    const cases: Record<string, unknown>[] = [{}];
    for (const [key, values] of Object.entries(MATRIX)) for (const value of values) cases.push({ [key]: value });
    for (const [key, values] of Object.entries({ neck: [0.1, 0.9], slant: [0, 60], height: [0.1, 1], gap: [0.05, 3], aspect: [0.25, 4] })) for (const value of values) cases.push({ [key]: value });
    let seed = 7;
    const pick = <T,>(a: readonly T[]) => a[(seed = (seed * 1103515245 + 12345) % 2147483648) % a.length];
    for (let i = 0; i < 30; i++) cases.push(Object.fromEntries(Object.entries(MATRIX).map(([k, v]) => [k, pick(v as readonly unknown[])])));
    let checked = 0;
    for (const extra of cases) {
      for (const pattern of patterns) {
        for (const l of strip({ ...base, ...extra, pattern }).lines) {
          expect(simple(l.pts), JSON.stringify({ ...extra, pattern })).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    // The overlays of relevant slabs are polygons too.
    for (const extra of cases.slice(0, 30)) {
      const g = strip({ ...base, ...extra, mode: 'generate', rows: 6, segments: 7, relevant: 0.6, necks: 0.6 });
      expect(overlays(g).length).toBeGreaterThan(5);
      for (const l of g.lines) expect(simple(l.pts), JSON.stringify(extra)).toBe(true);
    }
  });

  it('makes the neck neck × the slab height tall, in every position', () => {
    for (const neckAlign of ['center', 'top', 'bottom']) {
      for (const neck of [0.2, 0.5, 0.8]) {
        const g = strip({ pattern: '#####----#####', neck, neckAlign });
        const pts = g.lines[0].pts;
        const slab = extent(pts, g.nodes[0].p[0]);
        const h = slab[1] - slab[0];
        // The middle of the neck is halfway between the two slab centres.
        const [b, t] = extent(pts, (g.nodes[0].p[0] + g.nodes[1].p[0]) / 2);
        expect(t - b).toBeCloseTo(neck * h, 9);
        const flush = neckAlign === 'top' ? slab[1] - t : neckAlign === 'bottom' ? b - slab[0] : slab[1] - t - (b - slab[0]);
        expect(flush).toBeCloseTo(0, 9);
      }
    }
  });

  it('steps one edge of a joint and ramps the other, at the ramp angle, the ramp lying on the slab', () => {
    const joint = (params: Record<string, unknown>) => strip({ pattern: '#####----#####', ...SHARP, ...params }).lines[0].pts;
    const slopes = (pts: Vec3[]) => edges(pts).filter(([a, b]) => Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9);
    const uprights = (pts: Vec3[]) => edges(pts).filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9);
    const angle = ([a, b]: readonly [Vec3, Vec3]) => ((Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI);

    // Ramp on the bottom: a step on top at each side of the neck, a 30° slope below it, and the two ends of the chain.
    const pts = joint({ ramp: 30, rampEdge: 'bottom' });
    expect(slopes(pts)).toHaveLength(2);
    expect(uprights(pts)).toHaveLength(2 + 2);
    const h = hi(pts.map((q) => q[1])) - lo(pts.map((q) => q[1]));
    for (const e of slopes(pts)) {
      expect(angle(e)).toBeCloseTo(30, 9);
      // The neck drops a quarter of the slab's height at each edge, so the ramp runs that far over tan 30°.
      expect(Math.abs(e[1][0] - e[0][0])).toBeCloseTo((h * 0.25) / tan(30), 9);
      expect(Math.abs(e[1][1] - e[0][1])).toBeCloseTo(h * 0.25, 9);
    }
    // The same on the top edge when the ramp is there, with the steps below.
    const top = joint({ ramp: 30, rampEdge: 'top' });
    expect(slopes(top)).toHaveLength(2);
    expect(slopes(top).every(([a, b]) => a[1] > 0 && b[1] > 0)).toBe(true);
    expect(slopes(pts).every(([a, b]) => a[1] < 0 && b[1] < 0)).toBe(true);
    // Both edges ramp, or neither: ramp 0 is a vertical step, and the outline is all right angles.
    expect(slopes(joint({ ramp: 45, rampEdge: 'both' }))).toHaveLength(4);
    expect(uprights(joint({ ramp: 45, rampEdge: 'both' }))).toHaveLength(2);
    const flat = joint({ ramp: 0, rampEdge: 'both' });
    expect(flat).toHaveLength(12);
    expect(slopes(flat)).toHaveLength(0);
    // The neck is exactly as many units long as it was asked, because the ramps sit on the slabs.
    for (const ramp of [0, 30, 75]) {
      const g = strip({ pattern: '###-----###', ...SHARP, ramp, rampEdge: 'both' }).lines[0].pts;
      const [y0, y1] = [lo(g.map((q) => q[1])), hi(g.map((q) => q[1]))];
      const unit = (hi(g.map((q) => q[0])) - lo(g.map((q) => q[0]))) / 11;
      const necks = g.filter((q) => q[1] > y0 + 1e-9 && q[1] < y1 - 1e-9).map((q) => q[0]);
      expect(hi(necks) - lo(necks)).toBeCloseTo(5 * unit, 9);
    }
  });

  it('keeps a ramp from eating more than 45% of the slab it sits on', () => {
    // A 3° ramp would run for many slab lengths, so it is cut short and steepened.
    const g = strip({ pattern: '##-######', ...SHARP, ramp: 3, rampEdge: 'bottom' });
    const pts = g.lines[0].pts;
    const [x0, x1] = [lo(pts.map((q) => q[0])), hi(pts.map((q) => q[0]))];
    const unit = (x1 - x0) / 9;
    expect(simple(pts)).toBe(true);
    const floor = lo(pts.map((q) => q[1]));
    // The first slab's bottom edge runs flat for 55% of its two units, and the ramp covers the other 45%.
    const flat = pts.filter((q) => Math.abs(q[1] - floor) < 1e-9).map((q) => q[0]).sort((a, b) => a - b);
    expect(flat[1] - x0).toBeCloseTo(2 * unit * 0.55, 9);
    // The slab after the neck loses 45% of its six units.
    expect(flat[flat.length - 2] - (x0 + 3 * unit)).toBeCloseTo(6 * unit * 0.45, 9);
    // Steep ramps are left as they are.
    expect(simple(strip({ pattern: '#-#-#', ...SHARP, ramp: 75, rampEdge: 'both' }).lines[0].pts)).toBe(true);
  });

  it('cuts the finish end on the slant, the bottom corner reaching further right than the top, and the start end the other way', () => {
    for (const slant of [10, 18, 45]) {
      const g = strip({ pattern: '#####--#######', ...SHARP, finishEnd: 'slant', slant });
      const pts = g.lines[0].pts;
      const [y0, y1] = [lo(ys(g.lines[0])), hi(ys(g.lines[0]))];
      const right = (y: number) => hi(pts.filter((q) => Math.abs(q[1] - y) < 1e-9).map((q) => q[0]));
      const left = (y: number) => lo(pts.filter((q) => Math.abs(q[1] - y) < 1e-9).map((q) => q[0]));
      expect(right(y0) - right(y1)).toBeCloseTo((y1 - y0) * tan(slant), 9);
      // The bottom corner is the far right of the outline, and the start stays square.
      expect(right(y0)).toBe(hi(xs(g.lines[0])));
      expect(left(y0)).toBeCloseTo(left(y1), 9);
    }
    const start = strip({ pattern: '#####--#######', ...SHARP, startEnd: 'slant', slant: 18 });
    const [y0, y1] = [lo(ys(start.lines[0])), hi(ys(start.lines[0]))];
    const left = (y: number) => lo(start.lines[0].pts.filter((q) => Math.abs(q[1] - y) < 1e-9).map((q) => q[0]));
    expect(left(y1) - left(y0)).toBeCloseTo((y1 - y0) * tan(18), 9);
    // Slanting is a lean from vertical, so 0° is square; and with rounded corners the corners still reach out, just rounder.
    expect(strip({ pattern: '#####--#######', ...SHARP, finishEnd: 'slant', slant: 0 }).lines[0].pts).toEqual(strip({ pattern: '#####--#######', ...SHARP }).lines[0].pts);
    const rounded = strip({ pattern: '#####--#######', finishEnd: 'slant', slant: 30 }).lines[0];
    expect(hi(xs(rounded)) - hi(rounded.pts.filter((q) => q[1] > 0).map((q) => q[0]))).toBeGreaterThan(0);
    // A short slab with a steep slant is cut back rather than crossing itself.
    expect(simple(strip({ pattern: '#', ...SHARP, startEnd: 'slant', finishEnd: 'slant', slant: 60 }).lines[0].pts)).toBe(true);
  });

  it('cuts a round end as a semicircle of half the slab height', () => {
    const g = strip({ pattern: '#####', corner: 0.08, startEnd: 'round', finishEnd: 'round' });
    const pts = g.lines[0].pts;
    const [y0, y1] = [lo(ys(g.lines[0])), hi(ys(g.lines[0]))];
    const r = (y1 - y0) / 2;
    const [x0, x1] = [lo(xs(g.lines[0])), hi(xs(g.lines[0]))];
    for (const [cx, side] of [[x0 + r, -1], [x1 - r, 1]] as const) {
      const arc = pts.filter((q) => side * (q[0] - cx) > 1e-9);
      expect(arc.length).toBeGreaterThan(8);
      for (const q of arc) expect(Math.hypot(q[0] - cx, q[1] - (y0 + y1) / 2)).toBeCloseTo(r, 9);
    }
    // A slab shorter than its own height is cut back to what fits.
    expect(simple(strip({ pattern: '#', corner: 0.5, startEnd: 'round', finishEnd: 'round' }).lines[0].pts)).toBe(true);
  });

  it('rounds corners with an absolute radius, never more than half the shorter edge beside them', () => {
    const slab = (params: Record<string, unknown>) => strip({ pattern: '#####', startEnd: 'square', finishEnd: 'square', height: 0.5, ...params }).lines[0];
    const [sharp, soft] = [slab({ corner: 0 }), slab({ corner: 0.2 })];
    expect(sharp.pts).toHaveLength(4);
    const [y0, y1] = [lo(ys(sharp)), hi(ys(sharp))];
    const h = y1 - y0;
    // The footprint is unchanged, and the straight top edge stops one radius short of each end.
    for (const f of [xs, ys]) {
      expect(lo(f(soft))).toBeCloseTo(lo(f(sharp)), 9);
      expect(hi(f(soft))).toBeCloseTo(hi(f(sharp)), 9);
    }
    const top = soft.pts.filter((q) => Math.abs(q[1] - y1) < 1e-9).map((q) => q[0]);
    expect(lo(top) - lo(xs(sharp))).toBeCloseTo(0.2 * h, 9);
    expect(hi(xs(sharp)) - hi(top)).toBeCloseTo(0.2 * h, 9);
    // Radius is absolute: as a share of the slab height it does not depend on the slab's length.
    const long = strip({ pattern: '#########', startEnd: 'square', finishEnd: 'square', height: 0.5, corner: 0.2 }).lines[0];
    const lt = long.pts.filter((q) => Math.abs(q[1] - hi(ys(long))) < 1e-9).map((q) => q[0]);
    expect((lo(lt) - lo(xs(long))) / (hi(ys(long)) - lo(ys(long)))).toBeCloseTo(0.2, 9);
    // At a step shorter than twice the radius the corners are cut back to half of it, and the neck keeps its height.
    const step = strip({ pattern: '###-###', corner: 0.5, neck: 0.8, ramp: 0, startEnd: 'square', finishEnd: 'square' });
    expect(simple(step.lines[0].pts)).toBe(true);
    const [b, t] = extent(step.lines[0].pts, 0);
    const [sb, st] = extent(step.lines[0].pts, step.nodes[0].p[0]);
    expect(t - b).toBeCloseTo(0.8 * (st - sb), 9);
  });

  it('sets the gap in slab heights, and the slab height as a share of the row spacing', () => {
    for (const gap of [0.4, 1, 2.5]) {
      const [a, b] = strip({ pattern: '## ##', ...SHARP, gap }).lines;
      expect(lo(xs(b)) - hi(xs(a))).toBeCloseTo(gap * (hi(ys(a)) - lo(ys(a))), 9);
    }
    // Each gap character is one gap, so two make a gap of two.
    const [one, two, three] = strip({ pattern: '#  #  #', ...SHARP, gap: 1 }).lines;
    expect(lo(xs(two)) - hi(xs(one))).toBeCloseTo(lo(xs(three)) - hi(xs(two)), 9);
    const [x, y] = strip({ pattern: '## ##', ...SHARP, gap: 1 }).lines, [x2, y2] = strip({ pattern: '##  ##', ...SHARP, gap: 1 }).lines;
    expect((lo(xs(y2)) - hi(xs(x2))) / (hi(ys(x2)) - lo(ys(x2)))).toBeCloseTo(2, 9);
    expect((lo(xs(y)) - hi(xs(x))) / (hi(ys(x)) - lo(ys(x)))).toBeCloseTo(1, 9);
    for (const height of [0.3, 0.7, 1]) {
      const g = strip({ pattern: '#####\n#####', ...SHARP, height, aspect: 0.25 });
      const [a, b] = g.lines;
      const h = hi(ys(a)) - lo(ys(a));
      expect(h / (g.nodes[0].p[1] - g.nodes[1].p[1])).toBeCloseTo(height, 9);
      expect(hi(ys(b)) - lo(ys(b))).toBeCloseTo(h, 9);
    }
  });

  it('fits the field to the aspect like the lattice, and the widest row spans it', () => {
    for (const aspect of [0.25, 1, 1.6, 4]) {
      const ax = Math.sqrt(aspect), ay = 1 / ax;
      for (const params of [{}, { mode: 'generate' }, { mode: 'text', columns: 20 }, { pattern: '#-#\n###########\n##' }]) {
        const g = strip({ aspect, ...params });
        const all = g.lines.flatMap((l) => l.pts);
        expect(lo(all.map((v) => v[0]))).toBeGreaterThanOrEqual(-ax - 1e-9);
        expect(hi(all.map((v) => v[0]))).toBeLessThanOrEqual(ax + 1e-9);
        expect(lo(all.map((v) => v[1]))).toBeGreaterThanOrEqual(-ay - 1e-9);
        expect(hi(all.map((v) => v[1]))).toBeLessThanOrEqual(ay + 1e-9);
      }
      const wide = strip({ aspect, pattern: '#####-#####', ...SHARP }).lines[0];
      expect(lo(xs(wide))).toBeCloseTo(-ax, 9);
      expect(hi(xs(wide))).toBeCloseTo(ax, 9);
    }
    // Generated rows fill the field's height, from the top row to the bottom one, about its middle.
    const rows = strip({ mode: 'generate', rows: 24, aspect: 1, ...SHARP, height: 1 }).lines.flatMap(ys);
    expect(hi(rows)).toBeGreaterThan(0.9);
    expect(hi(rows) + lo(rows)).toBeCloseTo(0, 9);
  });

  it('keeps a few rows no taller than a line of text, centred in the field', () => {
    // One short pattern row in a wide, tall field is not blown up to fill it: it keeps the proportions of a bar.
    const g = strip({ pattern: '#####-#####', ...SHARP, aspect: 1 }).lines[0];
    expect((hi(xs(g)) - lo(xs(g))) / (hi(ys(g)) - lo(ys(g)))).toBeGreaterThan(5);
    expect(lo(ys(g)) + hi(ys(g))).toBeCloseTo(0, 9);
  });

  it('aligns ragged rows to the left, or centres each of them', () => {
    const pattern = '#########\n####\n######';
    const left = strip({ pattern, ...SHARP });
    for (const l of left.lines) expect(lo(xs(l))).toBeCloseTo(lo(xs(left.lines[0])), 9);
    const mid = strip({ pattern, ...SHARP, align: 'center' });
    for (const l of mid.lines) expect(lo(xs(l)) + hi(xs(l))).toBeCloseTo(0, 9);
    expect(lo(xs(mid.lines[1]))).toBeGreaterThan(lo(xs(mid.lines[0])));
    // Gaps count towards a row's length.
    const gappy = strip({ pattern: '## ##\n#####', ...SHARP, align: 'center' });
    for (const l of gappy.lines.slice(0, 2)) expect(l.pts.length).toBeGreaterThan(3);
    expect(lo(gappy.lines.flatMap(xs)) + hi(gappy.lines.flatMap(xs))).toBeCloseTo(0, 9);
  });

  it('gives t as the position along each row: 0 at its first mark, 1 at its last, rising with x', () => {
    const g = strip({ pattern: '###-####\n##', ...SHARP });
    for (const l of g.lines) expect(l.t).toHaveLength(l.pts.length);
    for (const l of g.lines) {
      expect(lo(l.t!)).toBeCloseTo(0, 9);
      expect(hi(l.t!)).toBeCloseTo(1, 9);
      l.pts.forEach((q, i) => expect(l.t![i]).toBeCloseTo((q[0] - lo(xs(l))) / (hi(xs(l)) - lo(xs(l))), 9));
    }
    // The nodes sit at the centres of their slabs, so their t falls between 0 and 1 and grows along the row.
    expect(g.nodes[0].t).toBeGreaterThan(0);
    expect(g.nodes[1].t).toBeGreaterThan(g.nodes[0].t!);
    expect(g.nodes[1].t).toBeLessThan(1);
    // Slants and round corners leave the ends of every row inside 0–1.
    for (const l of strip({ mode: 'text', relevant: 0.4, startEnd: 'slant', finishEnd: 'round' }).lines) {
      expect(lo(l.t!)).toBeGreaterThanOrEqual(0);
      expect(hi(l.t!)).toBeLessThanOrEqual(1);
    }
  });

  describe('generated rows', () => {
    const gen = (params: Record<string, unknown> = {}) => strip({ mode: 'generate', ...params });
    const family0 = (g: Geometry) => JSON.stringify([outlines(g), g.nodes.map((n) => n.p)]);

    it('makes `rows` rows of `segments` slabs, left to right, top to bottom', () => {
      for (const [rows, segments] of [[1, 2], [12, 9], [5, 40], [80, 3]]) {
        const g = gen({ rows, segments });
        expect(rowsOf(g)).toHaveLength(rows);
        expect(g.nodes).toHaveLength(rows * segments);
        for (const y of rowsOf(g)) {
          const row = g.nodes.filter((n) => Math.abs(n.p[1] - y) < 1e-9).map((n) => n.p[0]);
          expect(row).toHaveLength(segments);
          expect(row).toEqual([...row].sort((a, b) => a - b));
        }
      }
    });

    it('is deterministic per seed and differs across seeds', () => {
      expect(gen({ seed: 3 })).toEqual(gen({ seed: 3 }));
      expect(JSON.stringify(gen({ seed: 3 }))).not.toBe(JSON.stringify(gen({ seed: 4 })));
    });

    it('moves no outline when `relevant` changes: only which slabs get an overlay', () => {
      const none = gen({ relevant: 0 }), some = gen({ relevant: 0.3 }), all = gen({ relevant: 1 });
      expect(overlays(none)).toHaveLength(0);
      expect(family0(some)).toBe(family0(none));
      expect(family0(all)).toBe(family0(none));
      expect(overlays(some).length).toBeGreaterThan(5);
      expect(overlays(some).length).toBeLessThan(overlays(all).length);
      expect(overlays(all)).toHaveLength(all.nodes.length);
      expect(some.nodes.filter((n) => n.family === 1)).toHaveLength(overlays(some).length);
      // A smaller share keeps its slabs: they are a subset of a larger share's.
      const marked = (g: Geometry) => g.nodes.map((n, i) => (n.family ? i : -1)).filter((i) => i >= 0);
      expect(marked(gen({ relevant: 0.1 })).every((i) => marked(some).includes(i))).toBe(true);
    });

    it('does not reshuffle one decision when another param changes', () => {
      // The draws are stateless: more rows add rows below, and the neck share moves joints but never which slabs are relevant.
      const small = gen({ rows: 6, segments: 6, relevant: 0.3 }), tall = gen({ rows: 9, segments: 6, relevant: 0.3 });
      expect(tall.nodes.slice(0, 36).map((n) => n.family)).toEqual(small.nodes.slice(0, 36).map((n) => n.family));
      expect(gen({ necks: 0.2, relevant: 0.3 }).nodes.map((n) => n.family)).toEqual(gen({ necks: 0.8, relevant: 0.3 }).nodes.map((n) => n.family));
      expect(gen({ variance: 0.1, relevant: 0.3 }).nodes.map((n) => n.family)).toEqual(gen({ variance: 0.9, relevant: 0.3 }).nodes.map((n) => n.family));
    });

    it('spreads slab lengths with `variance`, and chains them by the share of `necks`', () => {
      const widths = (g: Geometry) => outlines(g).map((l) => hi(xs(l)) - lo(xs(l)));
      const sd = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + (v - a.reduce((p, q) => p + q, 0) / a.length) ** 2, 0) / a.length);
      const even = widths(gen({ variance: 0, necks: 0, ...SHARP }));
      expect(sd(even)).toBeLessThan(sd(widths(gen({ variance: 1, necks: 0, ...SHARP }))));
      // With no variance every slab has the same length, to a unit of rounding.
      expect(sd(even) / (even.reduce((a, b) => a + b, 0) / even.length)).toBeLessThan(0.05);
      expect(outlines(gen({ necks: 0, rows: 5, segments: 6 }))).toHaveLength(30);
      expect(outlines(gen({ necks: 1, rows: 5, segments: 6 }))).toHaveLength(5);
      const chains = (necks: number) => outlines(gen({ necks, rows: 40, segments: 10 })).length;
      expect(chains(0.2)).toBeGreaterThan(chains(0.5));
      expect(chains(0.5)).toBeGreaterThan(chains(0.8));
    });

    it('stays within the point budget at the largest settings, and builds quickly', () => {
      const t = performance.now();
      for (const params of [{ rows: 80, segments: 40, relevant: 1, necks: 1 }, { rows: 80, segments: 40, relevant: 0.1 }, { rows: 40, segments: 40, necks: 1, relevant: 0.5, corner: 0.5, ramp: 75 }]) {
        const r = buildForm(make({ kind: 'strip', params: { mode: 'generate', ...params } }));
        expect(r.warnings).toEqual([]);
        expect(finite(r.geometry)).toBe(true);
        expect(r.geometry.lines.reduce((n, l) => n + l.pts.length, 0) + r.geometry.nodes.length).toBeLessThan(POINT_BUDGET);
      }
      // With the default share of relevant slabs the largest field stays near 30k points.
      const typical = stack({ kind: 'strip', params: { mode: 'generate', rows: 80, segments: 40 } });
      expect(typical.lines.reduce((n, l) => n + l.pts.length, 0) + typical.nodes.length).toBeLessThan(35_000);
      expect(performance.now() - t).toBeLessThan(5000);
    });
  });

  describe('pasted text', () => {
    const text = (t: string, params: Record<string, unknown> = {}) => strip({ mode: 'text', text: t, ...params });
    const PARAGRAPH = 'The model reads every token in its window. Attention, though, is not spread evenly: a few passages matter most! Retrieval puts them there; context decides.';
    const words = (t: string) => t.split(/\s+/).filter(Boolean);

    it('makes one slab per word, in reading order, wrapping at `columns`', () => {
      const g = text(PARAGRAPH, { columns: 120 });
      expect(g.nodes).toHaveLength(words(PARAGRAPH).length);
      const wrapped = text(PARAGRAPH, { columns: 24 });
      expect(wrapped.nodes).toHaveLength(words(PARAGRAPH).length);
      expect(rowsOf(wrapped).length).toBeGreaterThan(rowsOf(g).length);
      const n = wrapped.nodes;
      for (let i = 1; i < n.length; i++) expect(n[i].p[1] < n[i - 1].p[1] - 1e-9 || (Math.abs(n[i].p[1] - n[i - 1].p[1]) < 1e-9 && n[i].p[0] > n[i - 1].p[0])).toBe(true);
      // No row holds more characters than the columns (a neck counts as one).
      const row = (y: number) => wrapped.nodes.filter((q) => Math.abs(q.p[1] - y) < 1e-9).length;
      expect(Math.max(...rowsOf(wrapped).map(row))).toBeLessThan(24);
    });

    it('sizes a slab by the letters of its word, whatever the punctuation', () => {
      const g = text('aa. bbbb! (cccccc)', { ...SHARP, columns: 120 });
      expect(g.lines).toHaveLength(3);
      const w = outlines(g).map((l) => hi(xs(l)) - lo(xs(l)));
      expect(w[1] / w[0]).toBeCloseTo(2, 9);
      expect(w[2] / w[0]).toBeCloseTo(3, 9);
      // A slab is at most 24 letters long, however long the word.
      const capped = outlines(text(`${'x'.repeat(40)}. ${'y'.repeat(24)}`, { ...SHARP, columns: 120 })).map((l) => hi(xs(l)) - lo(xs(l)));
      expect(capped).toHaveLength(2);
      expect(capped[0]).toBeCloseTo(capped[1], 9);
    });

    it('joins words with necks, and breaks the chain after a sentence end, at a double space or a tab', () => {
      const run = (t: string) => text(t, { columns: 120 }).lines.length;
      expect(run('aa bbbb cc dd')).toBe(1);
      expect(run('aa bbbb. cc dd')).toBe(2);
      expect(run('aa bbbb.  cc dd')).toBe(2);
      expect(run('aa bbbb? cc! dd')).toBe(3);
      expect(run('aa  bb')).toBe(2);
      expect(run('aa\tbb')).toBe(2);
      expect(run('"Done." Next')).toBe(2);
      expect(run('Wait... what')).toBe(2);
      // An abbreviation or a number with a point inside is not a sentence end.
      expect(run('about 3.5 times')).toBe(1);
    });

    it('starts a new row at a new line, and shows a run of blank lines as one empty row', () => {
      const g = text('one two\nthree\n\n\n\nfour five');
      const [r0, r1, r2] = rowsOf(g);
      expect(rowsOf(g)).toHaveLength(3);
      expect(r1 - r2).toBeCloseTo(2 * (r0 - r1), 9);
      // A blank line takes the place of a row: the same three rows, with the middle one empty.
      const [a0, a1] = rowsOf(text('one\n\ntwo')), [b0, b1] = rowsOf(text('one\ntwo\nsix'));
      expect(a0 - a1).toBeCloseTo(2 * (b0 - b1), 9);
      // Blank lines at either end are dropped, leaving one centred row.
      const lone = text('\n\none\n\n');
      expect(lone.nodes).toHaveLength(1);
      expect(lone.nodes[0].p[1]).toBeCloseTo(0, 9);
    });

    it('marks highlighted words relevant: an overlay and a family-1 node each, ignoring case and punctuation', () => {
      const g = text(PARAGRAPH, { highlight: 'attention, CONTEXT', columns: 120 });
      expect(g.nodes.map((n, i) => (n.family === 1 ? words(PARAGRAPH)[i] : null)).filter(Boolean)).toEqual(['Attention,', 'context']);
      expect(overlays(g)).toHaveLength(2);
      // The share is ignored while there is a list, and used when there is none.
      expect(text(PARAGRAPH, { highlight: 'attention', relevant: 1 }).nodes.filter((n) => n.family === 1)).toHaveLength(1);
      expect(text(PARAGRAPH, { relevant: 0.5, seed: 9 }).nodes.filter((n) => n.family === 1).length).toBeGreaterThan(3);
      expect(text(PARAGRAPH, { relevant: 0 }).lines.every((l) => l.family === 0)).toBe(true);
      // Highlighting moves nothing.
      expect(JSON.stringify(outlines(g))).toBe(JSON.stringify(outlines(text(PARAGRAPH, { columns: 120 }))));
    });

    it('agrees with the context source about which words are relevant', () => {
      const ctx = stack({ kind: 'context', params: { text: PARAGRAPH, highlight: 'attention, matter', layout: 'window' } });
      expect(text(PARAGRAPH, { highlight: 'attention, matter', columns: 120 }).nodes.map((n) => n.family)).toEqual(ctx.nodes.map((n) => n.family));
      // With no list the seeded roll is the same draw, too.
      const seeded = stack({ kind: 'context', params: { text: PARAGRAPH, relevant: 0.3, seed: 11 } });
      expect(text(PARAGRAPH, { relevant: 0.3, seed: 11 }).nodes.map((n) => n.family)).toEqual(seeded.nodes.map((n) => n.family));
    });

    it('keeps 4000 characters of text through parseDoc, and of a pattern too', () => {
      const long = 'word '.repeat(900);
      const { doc, warnings } = parseDoc({
        forms: [
          { source: { kind: 'strip', params: { mode: 'text', text: long, highlight: long } } },
          { source: { kind: 'strip', params: { pattern: '#-'.repeat(2000) } } },
        ],
      });
      expect(warnings).toEqual([]);
      expect(String(doc.forms[0].source.params.text)).toHaveLength(4000);
      expect(String(doc.forms[0].source.params.highlight)).toHaveLength(200);
      expect(String(doc.forms[1].source.params.pattern)).toHaveLength(4000);
      const g = buildForm(doc.forms[0]);
      expect(g.warnings).toEqual([]);
      expect(g.geometry.nodes).toHaveLength(words(long.slice(0, 4000)).length);
      expect(finite(g.geometry)).toBe(true);
      expect(buildForm(doc.forms[1]).warnings).toEqual([]);
    });

    it('survives words made only of symbols, huge words, and thousands of words', () => {
      expect(text('— – … ---').lines).toEqual([]);
      expect(text('a — b').nodes).toHaveLength(2);
      const huge = text('x'.repeat(500) + ' y', { columns: 8 });
      expect(finite(huge)).toBe(true);
      expect(huge.nodes).toHaveLength(2);
      const many = text('lorem ipsum dolor sit amet '.repeat(150), { columns: 60 });
      expect(finite(many)).toBe(true);
      expect(many.nodes).toHaveLength(750);
    });
  });

  it('draws the relevant slabs after every other outline, in family 1, inside the outline they paint', () => {
    for (const params of [{ mode: 'generate', relevant: 0.3 }, { mode: 'text', relevant: 0.3 }]) {
      const g = strip(params);
      const first = g.lines.findIndex((l) => l.family === 1);
      expect(first).toBeGreaterThan(0);
      expect(g.lines.slice(0, first).every((l) => l.family === 0)).toBe(true);
      expect(g.lines.slice(first).every((l) => l.family === 1 && l.closed && l.tone === 'front')).toBe(true);
      expect(g.lines.slice(first)).toHaveLength(g.nodes.filter((n) => n.family === 1).length);
      // Each overlay is centred on its slab's node, and lies within the outline it paints.
      const marked = g.nodes.filter((n) => n.family === 1);
      g.lines.slice(first).forEach((o, i) => {
        const base = outlines(g).find((b) => lo(xs(b)) <= marked[i].p[0] && hi(xs(b)) >= marked[i].p[0] && lo(ys(b)) <= marked[i].p[1] && hi(ys(b)) >= marked[i].p[1])!;
        expect(base).toBeTruthy();
        expect(lo(xs(o))).toBeGreaterThanOrEqual(lo(xs(base)) - 1e-9);
        expect(hi(xs(o))).toBeLessThanOrEqual(hi(xs(base)) + 1e-9);
        expect(lo(ys(o))).toBeGreaterThanOrEqual(lo(ys(base)) - 1e-9);
        expect(hi(ys(o))).toBeLessThanOrEqual(hi(ys(base)) + 1e-9);
        expect(o.t).toHaveLength(o.pts.length);
      });
    }
    // A lone slab's overlay is its outline: the same footprint and the same corner radius.
    const solo = strip({ mode: 'generate', rows: 1, segments: 2, necks: 0, relevant: 1, variance: 0 });
    expect(solo.lines).toHaveLength(4);
    solo.lines.slice(0, 2).forEach((base, i) => expect(solo.lines[i + 2].pts).toEqual(base.pts));
  });

  it('paints a relevant slab the way it is cut: its ramps and slanted end, without the neck', () => {
    const chain = (highlight: string, params: Record<string, unknown> = {}) =>
      strip({ mode: 'text', text: 'aaaa bbbbbb cccc', highlight, columns: 40, corner: 0, startEnd: 'square', finishEnd: 'slant', slant: 18, ramp: 30, ...params });
    const g = chain('bbbbbb');
    expect(outlines(g)).toHaveLength(1);
    const [o] = overlays(g);
    // A middle slab is a rectangle with a chamfer under each neck: a vertical side, then the 30° ramp, on both sides.
    const slopes = edges(o.pts).filter(([a, b]) => Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9);
    expect(slopes).toHaveLength(2);
    for (const [a, b] of slopes) expect((Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI).toBeCloseTo(30, 9);
    const [x0, x1] = [lo(xs(o)), hi(xs(o))];
    // Where the overlay's sides meet a neck they run the full height, straight.
    expect(edges(o.pts).filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[0] - x0) < 1e-9 && Math.abs(a[1] - b[1]) > 0)).toHaveLength(1);
    expect(edges(o.pts).filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[0] - x1) < 1e-9 && Math.abs(a[1] - b[1]) > 0)).toHaveLength(1);
    // Nothing of an overlay hangs outside the outline it paints.
    for (const highlight of ['aaaa', 'bbbbbb', 'cccc']) {
      for (const params of [{}, { rampEdge: 'both' }, { finishEnd: 'round', startEnd: 'slant' }, { neckAlign: 'top' }]) {
        const h = chain(highlight, params);
        for (const [a, b] of edges(overlays(h)[0].pts)) {
          const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const [bottom, top] = extent(outlines(h)[0].pts, m[0]);
          expect(m[1]).toBeGreaterThanOrEqual(bottom - 1e-9);
          expect(m[1]).toBeLessThanOrEqual(top + 1e-9);
        }
      }
    }
    // The last slab keeps the slant of the chain's end.
    const l = overlays(chain('cccc'))[0];
    const [yb, yt] = [lo(ys(l)), hi(ys(l))];
    const right = (y: number) => hi(l.pts.filter((q) => Math.abs(q[1] - y) < 1e-9).map((q) => q[0]));
    expect(right(yb) - right(yt)).toBeCloseTo((yt - yb) * tan(18), 9);
  });

  it('draws solid shapes with a fill: one colour per family, the relevant slabs painted last', () => {
    const form = make({ kind: 'strip', params: { mode: 'generate', relevant: 0.2 } });
    form.style = { ...form.style, fill: 'shapes', fillOpacity: 1, colorBy: 'family', color: 'ramp', taper: 'none' };
    const r = renderForm(form, ['#223344', '#ddeeff']);
    expect(r.fills).toHaveLength(2);
    expect(r.fills.every((f) => f.opacity === 1 && f.d.length > 0)).toBe(true);
    expect(r.fills[0].color).toBe('#223344');
    expect(r.fills[1].color).toBe('#ddeeff');
    const geo = buildForm(form).geometry;
    expect(r.fills[0].d.match(/M/g)).toHaveLength(outlines(geo).length);
    expect(r.fills[1].d.match(/M/g)).toHaveLength(overlays(geo).length);
    expect(r.fills.every((f) => !/NaN|Infinity/.test(f.d))).toBe(true);
    expect(r.warnings).toEqual([]);
    // Without a fill it is an outline.
    const outline = renderForm(make({ kind: 'strip' }), ['#223344', '#ddeeff']);
    expect(outline.fills).toEqual([]);
    expect(outline.strokes.length).toBeGreaterThan(0);
    // The default pattern, filled, is one solid mark.
    const mark = make({ kind: 'strip' });
    mark.style = { ...mark.style, fill: 'shapes', fillOpacity: 1 };
    expect(renderForm(mark, ['#223344', '#ddeeff']).fills).toHaveLength(1);
  });

  it('feeds connect focus and markers: attention leaves the relevant slabs, and dots sit on slab centres', () => {
    const params = { mode: 'generate', rows: 8, segments: 5, relevant: 0.3 };
    const g = stack({ kind: 'strip', params }, [{ kind: 'connect', params: { mode: 'focus', which: 'relevant', fx: 1.8, fy: 0, keepLines: false } }]);
    const marked = stack({ kind: 'strip', params }).nodes.filter((n) => n.family === 1);
    expect(marked.length).toBeGreaterThan(3);
    expect(g.lines).toHaveLength(marked.length);
    g.lines.forEach((l, i) => {
      expect(l.pts[0]).toEqual(marked[i].p);
      expect(l.pts[l.pts.length - 1]).toEqual([1.8, 0, 0]);
      expect(l.family).toBe(1);
    });
    const dots = make({ kind: 'strip', params: { mode: 'generate' } });
    dots.style = { ...dots.style, markers: 'dot' };
    expect(renderForm(dots, ['#222222', '#ffffff']).markers.length).toBeGreaterThan(0);
  });

  it('describes its params to agents, each shown only in the mode that uses it', () => {
    const block = describeBlocks().sources.find((s) => s.kind === 'strip')!;
    const param = (key: string) => block.params.find((q) => q.key === key)!;
    expect(block.name).toBe('Strip');
    expect(block.description).toMatch(/slab/i);
    expect(param('mode')).toMatchObject({ type: 'enum', options: ['pattern', 'generate', 'text'], default: 'pattern' });
    expect(param('pattern')).toMatchObject({ type: 'string', multiline: true, maxLength: 4000, only_when: { key: 'mode', in: ['pattern'] } });
    expect(param('text')).toMatchObject({ type: 'string', multiline: true, maxLength: 4000, only_when: { key: 'mode', in: ['text'] } });
    expect(param('highlight')).toMatchObject({ only_when: { key: 'mode', in: ['text'] } });
    expect(param('columns')).toMatchObject({ min: 8, max: 120, only_when: { key: 'mode', in: ['text'] } });
    for (const key of ['rows', 'segments', 'variance', 'necks']) expect(param(key)).toMatchObject({ only_when: { key: 'mode', in: ['generate'] } });
    for (const key of ['relevant', 'seed']) expect(param(key)).toMatchObject({ only_when: { key: 'mode', in: ['generate', 'text'] } });
    expect(param('rows')).toMatchObject({ min: 1, max: 80, default: 12 });
    expect(param('segments')).toMatchObject({ min: 2, max: 40, default: 9 });
    expect(param('ramp')).toMatchObject({ min: 0, max: 75, default: 30 });
    expect(param('slant')).toMatchObject({ min: 0, max: 60, default: 18 });
    expect(param('height')).toMatchObject({ min: 0.1, max: 1, default: 0.7 });
    expect(param('neck')).toMatchObject({ min: 0.1, max: 0.9, default: 0.5 });
    expect(param('corner')).toMatchObject({ min: 0, max: 0.5, default: 0.08 });
    expect(param('gap')).toMatchObject({ min: 0.05, max: 3, default: 0.4 });
    expect(param('aspect')).toMatchObject({ min: 0.25, max: 4, default: 1.6 });
    expect(param('neckAlign')).toMatchObject({ options: ['center', 'top', 'bottom'], default: 'center' });
    expect(param('rampEdge')).toMatchObject({ options: ['both', 'top', 'bottom'], default: 'bottom' });
    expect(param('startEnd')).toMatchObject({ options: ['square', 'slant', 'round'], default: 'square' });
    expect(param('finishEnd')).toMatchObject({ options: ['square', 'slant', 'round'], default: 'slant' });
    expect(param('align')).toMatchObject({ options: ['left', 'center'], default: 'left' });
  });

  it('is validated by parseDoc: ranges clamp, unknown values fall back, and the defaults need no corrections', () => {
    expect(parseDoc({ forms: [{ source: { kind: 'strip' } }] }).warnings).toEqual([]);
    const { doc, warnings } = parseDoc({ forms: [{ source: { kind: 'strip', params: { ramp: 90, slant: -4, rows: 200, finishEnd: 'point', mode: 'poem' } } }] });
    expect(warnings).toHaveLength(5);
    expect(doc.forms[0].source.params).toMatchObject({ ramp: 75, slant: 0, rows: 80, finishEnd: 'slant', mode: 'pattern' });
    expect(finite(buildForm(doc.forms[0]).geometry)).toBe(true);
  });

  it('never throws, whatever it is given', () => {
    const odd = { height: 99, neck: -3, ramp: 500, slant: 500, corner: 9, gap: 0, aspect: 0, rows: 0, segments: 0, columns: 0, variance: 9, necks: -1, relevant: 9, seed: -4 };
    for (const mode of ['pattern', 'generate', 'text']) {
      for (const params of [odd, {}, { pattern: '#-# #\n', text: '', rows: 1, segments: 1 }, { height: 0, neck: 0, gap: 0 }, { height: NaN, neck: Infinity, slant: NaN }]) {
        const g = strip({ mode, text: 'one two. three', ...params });
        expect(finite(g)).toBe(true);
        for (const l of g.lines) expect(l.pts.length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(finite(strip({ mode: 'text', text: 'a '.repeat(3000) }))).toBe(true);
  });

  it('is varied by Mutate without touching its pattern or text', () => {
    const base: Form = make({ kind: 'strip', params: { pattern: '##-##\n###', text: 'some words here' } });
    for (const v of variations(base, 12, 5, 1)) {
      expect(v.source.params.pattern).toBe('##-##\n###');
      expect(v.source.params.text).toBe('some words here');
      expect(finite(buildForm(v).geometry)).toBe(true);
    }
    for (const v of variations(make({ kind: 'strip', params: { mode: 'generate' } }), 12, 5, 1)) expect(finite(buildForm(v).geometry)).toBe(true);
  });
});

describe('burst', () => {
  /** A full, dense field of square-ended blocks, so every piece of it is a plain rectangle. */
  const FIELD = { layout: 'window', tokens: 700, rows: 30, density: 1, height: 0.8, cut: 'square', seed: 4 };
  /** Burst settings that move pieces by the push alone: no cutting, thinning, ragged rays, turning or stretching. */
  const PLAIN = { shatter: 0, spray: 0, scatter: 0, jitter: 0, stretch: 0, align: 0 };
  const burstOf = (burst: Record<string, unknown> = {}, ctx: Record<string, unknown> = FIELD) => stack({ kind: 'context', params: ctx }, [{ kind: 'burst', params: burst }]);
  const original = (ctx: Record<string, unknown> = FIELD) => stack({ kind: 'context', params: ctx });
  const mid = (l: Polyline): [number, number] => [l.pts.reduce((s, q) => s + q[0], 0) / l.pts.length, l.pts.reduce((s, q) => s + q[1], 0) / l.pts.length];
  const radius = (l: Polyline) => Math.hypot(...mid(l));
  const extent = (l: Polyline) => {
    const xs = l.pts.map((q) => q[0]), ys = l.pts.map((q) => q[1]);
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  const area = (l: Polyline) => Math.abs(l.pts.reduce((s, q, i) => s + q[0] * l.pts[(i + 1) % l.pts.length][1] - l.pts[(i + 1) % l.pts.length][0] * q[1], 0)) / 2;
  const total = (g: Geometry) => g.lines.reduce((s, l) => s + area(l), 0);
  const points = (g: Geometry) => g.lines.reduce((s, l) => s + l.pts.length, 0) + g.nodes.length;
  const key = (l: Polyline) => JSON.stringify(l.pts);

  it('is registered last, with a name, a blurb and every param in range', () => {
    const def = opFor('burst')!;
    expect(def.name).toBe('Burst');
    expect(def.blurb).toMatch(/dense core/);
    expect(OPERATORS[OPERATORS.length - 1]).toBe(def);
    for (const d of def.params) {
      const v = def.defaults[d.key];
      expect(v, d.key).toBeDefined();
      if (d.kind === 'range') {
        expect(v as number, d.key).toBeGreaterThanOrEqual(d.min);
        expect(v as number, d.key).toBeLessThanOrEqual(d.max);
      }
    }
    expect(def.params.find((d) => d.key === 'shatter')).toMatchObject({ min: 0, max: 24, step: 1 });
    expect(def.params.find((d) => d.key === 'spray')).toMatchObject({ min: 0, max: 600, step: 1 });
    expect(def.params.find((d) => d.key === 'align')!.when).toEqual({ key: 'mode', in: ['radial'] });
    expect(describeBlocks().operators.find((o) => o.kind === 'burst')!.params.map((p) => p.key)).toEqual(def.params.map((d) => d.key));
  });

  it('leaves everything inside the core exactly where it was, and pushes what is outside it away', () => {
    const before = original(), after = burstOf({ ...PLAIN, core: 0.45, strength: 1.5 });
    expect(after.lines).toHaveLength(before.lines.length);
    let inside = 0, outside = 0;
    before.lines.forEach((l, i) => {
      const r = radius(l);
      if (r < 0.44) {
        inside++;
        expect(after.lines[i].pts).toEqual(l.pts);
      } else if (r > 0.75) {
        outside++;
        expect(radius(after.lines[i])).toBeGreaterThan(r + 0.05);
        // Straight out from the centre: the piece keeps its direction.
        const [a, b] = [mid(l), mid(after.lines[i])];
        expect(Math.abs(a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b))).toBeLessThan(1e-9);
      }
    });
    expect(inside).toBeGreaterThan(20);
    expect(outside).toBeGreaterThan(100);
  });

  it('barely moves what is just outside the core, and moves the edge much more (the push builds with falloff)', () => {
    const before = original(), after = burstOf({ ...PLAIN, core: 0.4, strength: 1, falloff: 2 });
    const shift = (i: number) => Math.hypot(...(mid(after.lines[i]).map((v, k) => v - mid(before.lines[i])[k]) as [number, number]));
    const near = before.lines.map((l, i) => [radius(l), i] as const).filter(([r]) => r > 0.4 && r < 0.46).map(([, i]) => shift(i));
    const far = before.lines.map((l, i) => [radius(l), i] as const).filter(([r]) => r > 1.1).map(([, i]) => shift(i));
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(Math.max(...near)).toBeLessThan(0.02);
    expect(Math.min(...far)).toBeGreaterThan(0.2);
  });

  it('pushes more with strength, and not at all with strength 0', () => {
    const before = original();
    expect(burstOf({ ...PLAIN, strength: 0 }).lines.map((l) => l.pts)).toEqual(before.lines.map((l) => l.pts));
    const sum = (g: Geometry) => g.lines.reduce((s, l) => s + radius(l), 0);
    expect(sum(burstOf({ ...PLAIN, strength: 0.5 }))).toBeGreaterThan(sum(before));
    expect(sum(burstOf({ ...PLAIN, strength: 1.5 }))).toBeGreaterThan(sum(burstOf({ ...PLAIN, strength: 0.5 })));
  });

  it('stretches pieces along their flight, more the farther out they are', () => {
    const before = original(), flat = burstOf({ ...PLAIN, strength: 0.4 }), long = burstOf({ ...PLAIN, strength: 0.4, stretch: 2 });
    let near = 0, far = 0;
    before.lines.forEach((l, i) => {
      const r = radius(l);
      expect(extent(flat.lines[i])).toBeCloseTo(extent(l), 9);
      if (r < 0.3) expect(extent(long.lines[i])).toBeCloseTo(extent(l), 9);
      else if (r > 0.9) {
        far++;
        expect(extent(long.lines[i])).toBeGreaterThan(extent(l) * 1.5);
      } else if (r > 0.5) near++;
    });
    expect(far).toBeGreaterThan(20);
    expect(near).toBeGreaterThan(20);
    const grown = (lo: number, hi: number) => {
      const k = before.lines.map((l, i) => [radius(l), extent(long.lines[i]) / extent(l)] as const).filter(([r]) => r > lo && r < hi).map(([, f]) => f);
      return k.reduce((s, f) => s + f, 0) / k.length;
    };
    expect(grown(0.9, 1.5)).toBeGreaterThan(grown(0.5, 0.7));
  });

  it('turns pieces toward their flight with align, and not at all without it', () => {
    const level = (g: Geometry) => g.lines.filter((l) => l.pts.length === 4 && Math.abs(l.pts[0][1] - l.pts[1][1]) < 1e-9).length;
    expect(level(burstOf({ ...PLAIN, strength: 1 }))).toBe(original().lines.length);
    const turned = burstOf({ ...PLAIN, strength: 1, align: 1 });
    expect(level(turned)).toBeLessThan(original().lines.length * 0.5);
    // Fully aligned pieces lie along the line from the centre: the long edge points where the piece flew.
    let checked = 0;
    for (const l of turned.lines) {
      if (radius(l) < 1.2) continue;
      // The longer of the two edges that meet at the first corner.
      const [a, b, d] = [l.pts[0], l.pts[1], l.pts[3]], c = mid(l);
      const edge = len(sub(b, a)) >= len(sub(d, a)) ? sub(b, a) : sub(d, a);
      const along = Math.abs(edge[0] * c[0] + edge[1] * c[1]) / (len(edge) * Math.hypot(...c));
      expect(along).toBeGreaterThan(0.97);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('thins the edge with scatter and leaves the core whole', () => {
    const before = original(), after = burstOf({ ...PLAIN, scatter: 0.8, core: 0.5, strength: 0 });
    expect(after.lines.length).toBeLessThan(before.lines.length);
    expect(after.lines.length).toBeGreaterThan(before.lines.length * 0.3);
    const inner = (g: Geometry) => g.lines.filter((l) => radius(l) < 0.45).length;
    expect(inner(after)).toBe(inner(before));
    // The farther out, the fewer survive.
    const share = (lo: number, hi: number) => after.lines.filter((l) => { const r = radius(l); return r >= lo && r < hi; }).length / Math.max(1, before.lines.filter((l) => { const r = radius(l); return r >= lo && r < hi; }).length);
    expect(share(0.4, 0.8)).toBeGreaterThan(share(1, 1.6));
    expect(burstOf({ ...PLAIN, scatter: 0 }).lines).toHaveLength(before.lines.length);
  });

  describe('shatter', () => {
    it('cuts closed shapes into slices that stay closed, tile the shape, and keep t and family', () => {
      const before = original(), after = burstOf({ ...PLAIN, strength: 0, shatter: 4 });
      expect(after.lines.length).toBeGreaterThan(before.lines.length * 2);
      expect(after.lines.length).toBeLessThanOrEqual(before.lines.length * 4);
      for (const l of after.lines) {
        expect(l.closed).toBe(true);
        expect(l.pts.length).toBeGreaterThanOrEqual(3);
        expect(area(l)).toBeGreaterThan(0);
        expect(l.t).toHaveLength(l.pts.length);
        expect([0, 1]).toContain(l.family);
        expect(l.band).toBeUndefined();
      }
      expect(total(after)).toBeCloseTo(total(before), 9);
      // Each block's slices carry the block's t, in order.
      const ts = new Set(before.lines.map((l) => l.t![0]));
      for (const l of after.lines) expect(ts.has(l.t![0])).toBe(true);
    });

    it('cuts concave shapes too, without losing any area', () => {
      const strip = { mode: 'pattern', pattern: '####--######\n##--##--###', corner: 0, ramp: 40 };
      const before = stack({ kind: 'strip', params: strip }), after = stack({ kind: 'strip', params: strip }, [{ kind: 'burst', params: { ...PLAIN, strength: 0, shatter: 7 } }]);
      expect(after.lines.length).toBeGreaterThan(before.lines.length * 3);
      for (const l of after.lines) {
        expect(l.closed).toBe(true);
        expect(l.pts.length).toBeGreaterThanOrEqual(3);
        expect(finite({ lines: [l], nodes: [] })).toBe(true);
      }
      expect(total(after)).toBeCloseTo(total(before), 9);
    });

    it('cuts open lines into runs by arc length, end to end', () => {
      const line = { kind: 'curve', params: { shape: 'line' } };
      const before = stack(line), after = stack(line, [{ kind: 'burst', params: { ...PLAIN, strength: 0, shatter: 5 } }]);
      expect(before.lines).toHaveLength(1);
      expect(after.lines).toHaveLength(5);
      const run = (l: Polyline) => l.pts.reduce((s, q, i) => (i ? s + len(sub(q, l.pts[i - 1])) : 0), 0);
      for (let i = 0; i < 5; i++) {
        expect(after.lines[i].closed).toBeFalsy();
        if (i) expect(after.lines[i].pts[0]).toEqual(after.lines[i - 1].pts[after.lines[i - 1].pts.length - 1]);
      }
      expect(after.lines.reduce((s, l) => s + run(l), 0)).toBeCloseTo(run(before.lines[0]), 9);
      expect(after.lines[0].pts[0]).toEqual(before.lines[0].pts[0]);
    });

    it('lets the slices of one block fly apart: gaps open between slices that sat edge to edge', () => {
      const before = original(), after = burstOf({ ...PLAIN, strength: 1.2, shatter: 3 });
      // Slices of a block are consecutive and share its t.
      const groups = new Map<number, Polyline[]>();
      for (const l of after.lines) groups.set(l.t![0], [...(groups.get(l.t![0]) ?? []), l]);
      let apart = 0, sideways = 0;
      for (const l of before.lines) {
        const [x, y] = mid(l);
        if (Math.hypot(x, y) < 0.9 || Math.abs(y) > 0.5 * Math.abs(x)) continue;
        sideways++;
        const slices = (groups.get(l.t![0]) ?? []).sort((a, b) => Math.min(...a.pts.map((q) => q[0])) - Math.min(...b.pts.map((q) => q[0])));
        const gap = slices.slice(1).some((s, i) => Math.min(...s.pts.map((q) => q[0])) - Math.max(...slices[i].pts.map((q) => q[0])) > 1e-6);
        if (slices.length > 1 && gap) apart++;
      }
      expect(sideways).toBeGreaterThan(8);
      expect(apart).toBeGreaterThan(sideways * 0.8);
      expect(total(after)).toBeCloseTo(total(burstOf({ ...PLAIN, strength: 1.2, shatter: 0 })), 6);
    });

    it('is capped by the point budget, however many slices are asked for', () => {
      const heavy = { kind: 'context', params: { layout: 'window', tokens: 3000, rows: 160, density: 1, falloff: 0, cut: 'square' } };
      const built = buildForm(make(heavy, [{ kind: 'burst', params: { shatter: 24, spray: 600 } }]));
      expect(built.warnings).toEqual([]);
      expect(points(built.geometry)).toBeLessThan(POINT_BUDGET);
      expect(built.geometry.lines.length).toBeGreaterThan(3000);
      expect(finite(built.geometry)).toBe(true);
      // Open lines are budgeted too.
      const bars = buildForm(make({ ...heavy, params: { ...heavy.params, mark: 'line' } }, [{ kind: 'burst', params: { shatter: 24, spray: 600 } }]));
      expect(bars.warnings).toEqual([]);
      expect(points(bars.geometry)).toBeLessThan(POINT_BUDGET);
    });
  });

  describe('spray', () => {
    it('adds exactly the number of droplets asked for, and only nodes', () => {
      const still = { scatter: 0, shatter: 0 };
      for (const keepPoints of [true, false]) {
        const base = burstOf({ ...still, spray: 0, keepPoints });
        expect(base.nodes.length).toBe(keepPoints ? original().nodes.length : 0);
        for (const n of [1, 37, 300, 600]) {
          const g = burstOf({ ...still, spray: n, keepPoints });
          expect(g.nodes.length - base.nodes.length).toBe(n);
          expect(g.lines).toEqual(base.lines);
          expect(finite(g)).toBe(true);
        }
      }
      // With the defaults too, thinning and cutting included.
      expect(burstOf({ spray: 25 }).nodes).toHaveLength(25);
      expect(burstOf({ spray: 25, keepPoints: true }).nodes.length).toBeGreaterThan(25);
    });

    it('throws droplets past the pieces, carrying the t and family of the piece that threw them', () => {
      const none = burstOf({ spray: 0, keepPoints: false }), g = burstOf({ spray: 400, keepPoints: false, relevant: 0.3 }, { ...FIELD, relevant: 0.3 });
      expect(g.nodes).toHaveLength(400);
      const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      expect(median(g.nodes.map((n) => Math.hypot(n.p[0], n.p[1])))).toBeGreaterThan(median(none.lines.map(radius)));
      for (const n of g.nodes) {
        expect(n.t).toBeGreaterThanOrEqual(0);
        expect(n.t).toBeLessThanOrEqual(1);
        expect([0, 1]).toContain(n.family);
        // Size comes through depth: droplets sit at or behind the plane of the pieces.
        expect(n.p[2]).toBeLessThanOrEqual(0);
        expect(n.p[2]).toBeGreaterThanOrEqual(-0.2 - 1e-12);
      }
      expect(new Set(g.nodes.map((n) => n.family))).toEqual(new Set([0, 1]));
      expect(new Set(g.nodes.map((n) => n.p[2])).size).toBeGreaterThan(100);
      // The families thrown follow the pieces that fly: relevant pieces make relevant droplets.
      const noRelevant = burstOf({ spray: 100, keepPoints: false }, { ...FIELD, relevant: 0 });
      expect(noRelevant.nodes.every((n) => n.family === 0)).toBe(true);
    });

    it('is thrown by the points alone when a form has no lines', () => {
      const pts = stack({ kind: 'points', params: { count: 60 } });
      expect(pts.lines).toEqual([]);
      const out = stack({ kind: 'points', params: { count: 60 } }, [{ kind: 'burst', params: { spray: 50, scatter: 0, keepPoints: true } }]);
      expect(out.lines).toEqual([]);
      expect(out.nodes).toHaveLength(60 + 50);
      expect(stack({ kind: 'points', params: { count: 60 } }, [{ kind: 'burst', params: { spray: 50, scatter: 0 } }]).nodes).toHaveLength(50);
      expect(finite(out)).toBe(true);
    });

    it('is stable: more spray only adds droplets, and a change to spray never moves a piece', () => {
      const a = burstOf({ spray: 120, keepPoints: false }), b = burstOf({ spray: 240, keepPoints: false }), c = burstOf({ spray: 0, keepPoints: false });
      expect(b.nodes.slice(0, 120)).toEqual(a.nodes);
      expect(a.lines).toEqual(c.lines);
      expect(b.lines).toEqual(c.lines);
    });
  });

  describe('horizontal mode', () => {
    it('keeps every piece level and flies mostly sideways', () => {
      const before = original(), after = burstOf({ ...PLAIN, mode: 'horizontal', strength: 1.2, stretch: 2 });
      expect(after.lines).toHaveLength(before.lines.length);
      let dx = 0, dy = 0;
      before.lines.forEach((l, i) => {
        const o = after.lines[i];
        expect(o.pts).toHaveLength(4);
        // Bottom and top edges stay level, and the sides stay upright: a rectangle stays a rectangle.
        expect(o.pts[0][1]).toBeCloseTo(o.pts[1][1], 9);
        expect(o.pts[2][1]).toBeCloseTo(o.pts[3][1], 9);
        expect(o.pts[0][0]).toBeCloseTo(o.pts[3][0], 9);
        expect(o.pts[1][0]).toBeCloseTo(o.pts[2][0], 9);
        const [a, b] = [mid(l), mid(o)];
        dx += Math.abs(b[0] - a[0]);
        dy += Math.abs(b[1] - a[1]);
      });
      expect(dx).toBeGreaterThan(dy * 1.6);
      // Heights are untouched: only the length grows.
      before.lines.forEach((l, i) => expect(after.lines[i].pts[3][1] - after.lines[i].pts[0][1]).toBeCloseTo(l.pts[3][1] - l.pts[0][1], 9));
      expect(after.lines.some((l, i) => l.pts[1][0] - l.pts[0][0] > (before.lines[i].pts[1][0] - before.lines[i].pts[0][0]) * 2)).toBe(true);
    });

    it('ignores align, and differs from radial', () => {
      expect(burstOf({ ...PLAIN, mode: 'horizontal', align: 1, strength: 1 })).toEqual(burstOf({ ...PLAIN, mode: 'horizontal', align: 0, strength: 1 }));
      expect(burstOf({ ...PLAIN, mode: 'horizontal', strength: 1 })).not.toEqual(burstOf({ ...PLAIN, mode: 'radial', strength: 1 }));
    });
  });

  it('bursts from the centre it is given: what is around it stays, what was around the old centre flies', () => {
    const base = original(), at = (cx: number, cy: number) => burstOf({ ...PLAIN, core: 0.3, strength: 1, cx, cy });
    const moved = at(0.6, -0.5), home = at(0, 0);
    let kept = 0, freed = 0;
    base.lines.forEach((l, i) => {
      const [x, y] = mid(l);
      if (Math.hypot(x - 0.6, y + 0.5) < 0.29) {
        kept++;
        expect(moved.lines[i].pts).toEqual(l.pts);
      }
      if (Math.hypot(x, y) < 0.25 && Math.hypot(x - 0.6, y + 0.5) > 0.6) {
        freed++;
        // Inside the old core, outside the new one: it now flies, away from the new centre.
        expect(home.lines[i].pts).toEqual(l.pts);
        expect(Math.hypot(...(mid(moved.lines[i]).map((v, k) => v - [0.6, -0.5][k]) as [number, number]))).toBeGreaterThan(Math.hypot(x - 0.6, y + 0.5));
      }
    });
    expect(kept).toBeGreaterThan(5);
    expect(freed).toBeGreaterThan(5);
  });

  it('carries points with their pieces, drops them with keepPoints off, and leaves t and family alone', () => {
    const before = original(), after = burstOf({ ...PLAIN, strength: 1.2, keepPoints: true });
    expect(burstOf({ ...PLAIN, strength: 1.2 }).nodes).toEqual([]);
    expect(after.nodes).toHaveLength(before.nodes.length);
    after.nodes.forEach((n, i) => {
      expect(n.t).toBe(before.nodes[i].t);
      expect(n.family).toBe(before.nodes[i].family);
      // Each point rides with its block: it stays at the block's centre.
      const c = mid(after.lines[i]);
      expect(n.p[0]).toBeCloseTo(c[0], 9);
      expect(n.p[1]).toBeCloseTo(c[1], 9);
      expect(n.p[2]).toBe(before.nodes[i].p[2]);
    });
    expect(burstOf({ ...PLAIN, keepPoints: false }).nodes).toEqual([]);
    // Scatter thins points together with their blocks.
    const thin = burstOf({ ...PLAIN, scatter: 0.9, strength: 1, keepPoints: true });
    expect(thin.nodes.length).toBe(thin.lines.length);
  });

  it('is deterministic per seed, and each seed rays differently', () => {
    const run = (seed: number) => burstOf({ seed });
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('never reshuffles when one setting changes: a piece that survives thinning is where it always was', () => {
    const base = { strength: 1, shatter: 2, spray: 0 };
    const keep = new Set(burstOf({ ...base, scatter: 0.2 }).lines.map(key));
    const more = burstOf({ ...base, scatter: 0.7 });
    expect(more.lines.length).toBeLessThan(burstOf({ ...base, scatter: 0.2 }).lines.length);
    for (const l of more.lines) expect(keep.has(key(l))).toBe(true);
  });

  it('makes jitter rays ragged and shared by neighbours: jitter 0 is straight out, more is spikier', () => {
    const straight = burstOf({ ...PLAIN, strength: 1 });
    const cross = (l: Polyline, i: number) => {
      const [a, b] = [mid(original().lines[i]), mid(l)];
      return Math.abs(a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
    };
    expect(Math.max(...straight.lines.map(cross))).toBeLessThan(1e-9);
    const rough = burstOf({ ...PLAIN, strength: 1, jitter: 1 });
    expect(Math.max(...rough.lines.map(cross))).toBeGreaterThan(0.05);
    const spread = (g: Geometry) => {
      const r = g.lines.map(radius).filter((x) => x > 1);
      const m = r.reduce((s, x) => s + x, 0) / r.length;
      return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length);
    };
    expect(spread(rough)).toBeGreaterThan(spread(straight));
  });

  it('passes empty geometry through untouched, and never throws on odd input', () => {
    const op = opFor('burst')!;
    const empty: Geometry = { lines: [], nodes: [] };
    expect(op.apply(empty, op.defaults)).toBe(empty);
    const odd: Geometry = {
      lines: [
        { pts: [], closed: true }, { pts: [[0, 0, 0]] }, { pts: [[NaN, 1, 0], [1, Infinity, 0], [2, 2, 0]], closed: true },
        { pts: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], closed: true }, { pts: [[1, 1, 0], [1, 1, 0]] }, { pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], closed: true, family: 2 },
      ],
      nodes: [{ p: [NaN, 0, 0] }, { p: [0, 0, 0] }, { p: [3, 3, 0], family: 1, t: 0.2 }],
      labels: [{ p: [1, 1, 0], text: 'x' }, { p: [NaN, 1, 0], text: 'y' }],
    };
    for (const params of [{}, { shatter: 24, spray: 600, jitter: 1, stretch: 4, scatter: 0, strength: 3, falloff: 0.2, core: 0 }, { mode: 'horizontal', cx: 2, cy: -2 }, { strength: NaN, core: Infinity, seed: -3, spray: 5 }]) {
      const out = op.apply(odd, { ...op.defaults, ...params } as Params);
      expect(out.lines.every((l) => l.pts.every((q) => q.length === 3))).toBe(true);
      expect(out.nodes.length + out.lines.length).toBeGreaterThan(0);
    }
    const out = op.apply({ lines: [], nodes: [{ p: [1, 0, 0] }] }, { ...op.defaults, scatter: 0, keepPoints: true });
    expect(out.nodes.length).toBe(1 + 300);
    // Whatever it is given, a built form is finite.
    for (const params of [{ strength: 3, stretch: 4, shatter: 24, jitter: 1, core: 0, falloff: 0.2 }, { strength: 0, stretch: 0 }, { core: 2 }]) {
      expect(finite(burstOf(params))).toBe(true);
    }
  });

  it('carries normals along, turned with their piece, and drops ribbon bands', () => {
    const sphere = { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } };
    const ring = stack(sphere, [{ kind: 'revolve', params: { rings: 6, spokes: 8 } }]);
    const out = stack(sphere, [{ kind: 'revolve', params: { rings: 6, spokes: 8 } }, { kind: 'burst', params: { shatter: 3, core: 0.2, align: 0 } }]);
    expect(ring.lines.some((l) => l.band !== undefined)).toBe(true);
    expect(out.lines.every((l) => l.band === undefined)).toBe(true);
    expect(out.lines.length).toBeGreaterThan(0);
    for (const l of out.lines) {
      expect(l.normals).toHaveLength(l.pts.length);
      expect(l.normals!.every((n) => Math.abs(len(n) - 1) < 1e-6)).toBe(true);
    }
    expect(finite(out)).toBe(true);
  });

  it('works on every layout, a strip and pasted text, and renders', () => {
    for (const source of [
      { kind: 'context', params: { layout: 'burst' } }, { kind: 'context', params: { layout: 'radial' } }, { kind: 'context', params: { mark: 'line' } },
      { kind: 'context', params: { mark: 'dot' } }, { kind: 'context', params: { text: 'The model reads every token in its window. Attention is not spread evenly.' } },
      { kind: 'strip', params: { mode: 'generate' } }, { kind: 'card', params: {} },
    ]) {
      const form = make(source, [{ kind: 'burst', params: {} }]);
      const built = buildForm(form);
      expect(built.warnings, source.kind).toEqual([]);
      expect(finite(built.geometry)).toBe(true);
      expect(renderForm({ ...form, style: { ...form.style, fill: 'shapes', markers: 'dot' } }, ['#222', '#fff']).warnings).toEqual([]);
    }
  });

  it('is part of a parsed design, with out-of-range values corrected', () => {
    const { doc, warnings } = parseDoc({ forms: [{ source: { kind: 'context' }, ops: [{ kind: 'burst', params: { shatter: 99, spray: -5, mode: 'sideways', stretch: 9 } }] }] });
    expect(warnings).toHaveLength(4);
    expect(doc.forms[0].ops[0].params).toMatchObject({ shatter: 24, spray: 0, mode: 'radial', stretch: 4 });
    expect(parseDoc({ forms: [{ source: { kind: 'context' }, ops: [{ kind: 'burst' }] }] }).warnings).toEqual([]);
  });
});
