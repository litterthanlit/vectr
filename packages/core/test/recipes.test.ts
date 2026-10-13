import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/recipes.js';
import { THEMES } from '../src/themes.js';
import { docToSVG } from '../src/svg.js';

describe('recipes', () => {
  it('includes the instrument-plate recipes, ahead of the blank canvas', () => {
    const ids = RECIPES.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['meridian', 'gyroscope', 'orrery', 'sonar']));
    expect(ids[ids.length - 1]).toBe('blank');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds multi-form, named, finite designs in themes that exist', () => {
    for (const id of ['meridian', 'gyroscope', 'orrery', 'sonar']) {
      const doc = RECIPES.find((r) => r.id === id)!.build();
      expect(doc.forms.length).toBeGreaterThan(3);
      expect(doc.forms.every((f) => f.name.trim().length > 0)).toBe(true);
      expect(THEMES.some((t) => t.background === doc.background && t.ramp.join() === doc.ramp.join())).toBe(true);
      expect(docToSVG(doc)).not.toMatch(/NaN|Infinity/);
    }
    expect(RECIPES.find((r) => r.id === 'meridian')!.build().background).toBe(THEMES.find((t) => t.id === 'fog')!.background);
  });

  it('keeps every recipe card flat, so its text stays upright', () => {
    const cards = RECIPES.flatMap((r) => r.build().forms.filter((f) => f.source.kind === 'card'));
    expect(cards.length).toBeGreaterThanOrEqual(4);
    for (const c of cards) expect(c).toMatchObject({ rx: 0, ry: 0, perspective: 0 });
  });

  it('keeps the long-standing recipes first, which other code indexes', () => {
    expect(RECIPES[0].id).toBe('pulse-bloom');
    expect(RECIPES[1].id).toBe('strata');
  });
});
