import { STYLE_PARAMS } from '@vectr/core';
import { describe, expect, it } from 'vitest';
import { STYLE_GROUPS } from './styleGroups';

describe('inspector style groups', () => {
  const grouped = STYLE_GROUPS.flatMap((g) => g.keys);

  it('give every style param a control, in exactly one group', () => {
    const missing = STYLE_PARAMS.map((d) => d.key).filter((k) => !grouped.includes(k));
    expect(missing).toEqual([]);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('name only style params that exist', () => {
    const known = STYLE_PARAMS.map((d) => d.key);
    expect(grouped.filter((k) => !known.includes(k))).toEqual([]);
  });

  it('keeps the finish with the fill and markers', () => {
    const group = STYLE_GROUPS.find((g) => g.keys.includes('finish'))!;
    expect(group.title).toBe('Fill, markers & finish');
    expect(group.keys).toEqual(expect.arrayContaining(['fill', 'markers', 'finish', 'finishAmount', 'finishScale', 'finishSeed']));
  });
});
