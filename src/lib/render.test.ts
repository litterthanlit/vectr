import { describe, expect, it } from 'vitest';
import { GENERATORS, createLayer, geometryFor } from './generators';
import { renderLayer } from './render';
import { docToSVG } from './export';
import { TEMPLATES } from './templates';

describe('generators', () => {
  it.each(GENERATORS.map((g) => g.type))('%s builds finite geometry', (type) => {
    const geo = geometryFor(createLayer(type, { x: 0, y: 0 }));
    expect(geo.lines.length).toBeGreaterThan(0);
    for (const l of geo.lines) for (const p of l.pts) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe('renderLayer', () => {
  it('splits a sphere into front and back halves', () => {
    const r = renderLayer(createLayer('sphere', { x: 100, y: 100 }, { rx: 20, ry: 30 }));
    expect(r.front.length).toBeGreaterThan(0);
    expect(r.back.length).toBeGreaterThan(0);
  });

  it('keeps a flat shape facing the viewer entirely in front', () => {
    const r = renderLayer(createLayer('shape', { x: 0, y: 0 }));
    expect(r.back).toBe('');
  });

  it('centres the bbox on the layer position for a symmetric shape', () => {
    const r = renderLayer(createLayer('shape', { x: 200, y: 150 }, { scale: 50, params: { kind: 'circle' } }));
    expect(r.bbox.x + r.bbox.w / 2).toBeCloseTo(200, 0);
    expect(r.bbox.w).toBeCloseTo(100, 0);
  });
});

describe('export', () => {
  it('produces standalone SVG for every template', () => {
    for (const t of TEMPLATES) {
      const svg = docToSVG(t.build());
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toContain('NaN');
    }
  });
});
