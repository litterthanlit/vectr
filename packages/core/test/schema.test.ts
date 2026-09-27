import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GENERATORS, TEMPLATES, compactDoc, decodeDoc, describeGenerators, docToSVG, encodeDoc, parseDoc, serializeDoc,
} from '../src/index.js';

describe('parseDoc', () => {
  it('turns a minimal agent spec into a full design', () => {
    const { doc, warnings } = parseDoc({ theme: 'chalk', layers: [{ type: 'sphere', params: { rings: 3 } }] });
    expect(warnings).toEqual([]);
    expect(doc.background).toBe('#050505');
    expect(doc.layers[0]).toMatchObject({ type: 'sphere', x: 600, y: 450, visible: true });
    expect(doc.layers[0].params).toMatchObject({ rings: 3, meridians: 6 });
  });

  it('accepts JSON strings and the saved-file wrapper', () => {
    const t = TEMPLATES[0].build();
    const { doc } = parseDoc(serializeDoc(t));
    expect(doc.layers.map((l) => l.id)).toEqual(t.layers.map((l) => l.id));
    expect(doc.layers[2].params).toEqual(t.layers[2].params);
  });

  it('corrects bad values and explains what it did', () => {
    const { doc, warnings } = parseDoc({
      width: 1e9,
      layers: [
        { type: 'nope' },
        { type: 'grid', params: { rows: 999, warp: 'melt', bogus: 1 }, style: { back: 'wiggly', width: 'thick' } },
      ],
    });
    expect(doc.width).toBe(8000);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].params.rows).toBe(40);
    expect(doc.layers[0].params.warp).toBe('bend');
    expect(doc.layers[0].style.back).toBe('dotted');
    expect(warnings.join('\n')).toMatch(/unknown type "nope"/);
    expect(warnings.join('\n')).toMatch(/"rows" clamped/);
    expect(warnings.join('\n')).toMatch(/"warp" must be one of/);
    expect(warnings.join('\n')).toMatch(/unknown param "bogus"/);
  });

  it('rejects colours that could inject markup', () => {
    const { doc, warnings } = parseDoc({
      background: '"/><script>alert(1)</script>',
      layers: [{ type: 'shape', style: { stroke: 'red" onload="x' } }],
    });
    expect(doc.background).toBe('#F3F2E9');
    expect(doc.layers[0].style.stroke).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it('throws only for input that cannot be a design', () => {
    expect(() => parseDoc('not json')).toThrow('Not valid JSON');
    expect(() => parseDoc([1, 2])).toThrow('Expected a Vectr design object');
  });

  it('de-duplicates layer ids', () => {
    const { doc } = parseDoc({ layers: [{ type: 'torus', id: 'a' }, { type: 'torus', id: 'a' }] });
    expect(new Set(doc.layers.map((l) => l.id)).size).toBe(2);
  });
});

describe('svg', () => {
  it('escapes label text', () => {
    const { doc } = parseDoc({ layers: [{ type: 'frame', params: { fig: '<img src=x onerror=alert(1)>' } }] });
    const svg = docToSVG(doc);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });
});

describe('compact + share links', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s survives compact → parse unchanged', (id) => {
    const doc = TEMPLATES.find((t) => t.id === id)!.build();
    const { doc: back, warnings } = parseDoc(compactDoc(doc));
    expect(warnings).toEqual([]);
    expect(docToSVG(back)).toBe(docToSVG(doc));
  });

  it('round-trips through an encoded link', async () => {
    const doc = TEMPLATES[0].build();
    const code = await encodeDoc(doc);
    expect(code.startsWith('v1.')).toBe(true);
    expect(code.length).toBeLessThan(1500);
    const { doc: back } = await decodeDoc(`#d=${code}`);
    expect(docToSVG(back)).toBe(docToSVG(doc));
  });

  it('reports corrupted links', async () => {
    await expect(decodeDoc('v1.@@@@')).rejects.toThrow('corrupted');
    await expect(decodeDoc('hello')).rejects.toThrow('Unrecognised');
  });
});

describe('describeGenerators', () => {
  it('lists every generator with typed params and defaults', () => {
    const all = describeGenerators();
    expect(all.map((g) => g.type)).toEqual(GENERATORS.map((g) => g.type));
    for (const g of all) for (const p of g.params) expect(p.default).not.toBeUndefined();
  });
});

describe('cli', () => {
  // Exercise the real publishable build, not the sources.
  let cli = '';
  beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'vectr-dist-'));
    const tsc = join(__dirname, '../../../node_modules/typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-p', join(__dirname, '../tsconfig.build.json'), '--outDir', out]);
    cli = join(out, 'cli.js');
  }, 60_000);
  const run = (args: string[], input?: string) =>
    execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

  it('renders a design from stdin and writes to a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vectr-'));
    const out = join(dir, 'globe.svg');
    run(['render', '-', '-o', out], JSON.stringify({ layers: [{ type: 'sphere' }] }));
    expect(readFileSync(out, 'utf8')).toMatch(/^<svg xmlns/);
  });

  it('prints templates that render back to the same art', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vectr-'));
    const file = join(dir, 'fig.json');
    writeFileSync(file, run(['template', 'figure']));
    expect(run(['render', file]).trim()).toBe(docToSVG(TEMPLATES.find((t) => t.id === 'figure')!.build()));
  });
});
