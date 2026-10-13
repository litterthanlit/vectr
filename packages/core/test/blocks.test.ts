import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, OPERATORS, POINT_BUDGET, SOURCES, buildForm, createForm, describeBlocks, opFor, parseDoc, renderForm, variations } from '../src/index.js';
import type { Form, GeoLabel, Geometry, Params, Polyline, Vec3 } from '../src/index.js';

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
    expect(SOURCES.map((s) => s.kind)).toEqual(['curve', 'lattice', 'points', 'note', 'orbits', 'card', 'context']);
    expect(OPERATORS[OPERATORS.length - 1].kind).toBe('ticks');
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
