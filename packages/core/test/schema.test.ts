import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  RECIPES, compactDoc, decodeDoc, describeBlocks, docToSVG, encodeDoc, parseDoc, serializeDoc,
} from '../src/index.js';

describe('parseDoc (v2)', () => {
  it('turns a minimal agent spec into a full design', () => {
    const { doc, warnings } = parseDoc({ theme: 'ozone', forms: [{ source: { kind: 'curve', params: { shape: 'star' } }, ops: ['revolve'] }] });
    expect(warnings).toEqual([]);
    expect(doc.background).toBe('#0b1220');
    expect(doc.forms[0]).toMatchObject({ x: 600, y: 450, visible: true, source: { kind: 'curve', params: { shape: 'star', sides: 6 } } });
    expect(doc.forms[0].ops[0]).toMatchObject({ kind: 'revolve', enabled: true, params: { rings: 9 } });
  });

  it('accepts JSON strings and the saved-file wrapper', () => {
    const t = RECIPES[1].build();
    const { doc, warnings } = parseDoc(serializeDoc(t));
    expect(warnings).toEqual([]);
    expect(doc.forms.map((f) => f.id)).toEqual(t.forms.map((f) => f.id));
    expect(docToSVG(doc)).toBe(docToSVG(t));
  });

  it('corrects bad values and explains what it did', () => {
    const { doc, warnings } = parseDoc({
      width: 1e9,
      forms: [
        { source: { kind: 'nope' } },
        {
          source: { kind: 'lattice', params: { rows: 999, draw: 'melt', bogus: 1 } },
          ops: [{ kind: 'explode' }, { kind: 'warp', params: { amount: 99 } }],
          style: { hidden: 'wiggly', width: 'thick', ramp: ['#fff', 'red'] },
        },
      ],
    });
    const all = warnings.join('\n');
    expect(doc.width).toBe(8000);
    expect(doc.forms).toHaveLength(1);
    const f = doc.forms[0];
    expect(f.source.params.rows).toBe(60);
    expect(f.source.params.draw).toBe('both');
    expect(f.ops).toHaveLength(1);
    expect(f.ops[0].params.amount).toBe(2);
    expect(f.style.hidden).toBe('fade');
    expect(f.style.ramp).toEqual(['#ffffff']);
    expect(all).toMatch(/source.kind must be one of/);
    expect(all).toMatch(/"rows" clamped/);
    expect(all).toMatch(/unknown lattice param "bogus"/);
    expect(all).toMatch(/ops\[0\]: kind must be one of/);
    expect(all).toMatch(/only hex colours/);
  });

  it('rejects colours that could inject markup', () => {
    const { doc, warnings } = parseDoc({
      background: '"/><script>alert(1)</script>',
      forms: [{ source: { kind: 'curve' }, style: { stroke: 'red" onload="x' } }],
    });
    expect(doc.background).toBe('#111214');
    expect(doc.forms[0].style.stroke).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it('throws only for input that cannot be a design', () => {
    expect(() => parseDoc('not json')).toThrow('Not valid JSON');
    expect(() => parseDoc([1, 2])).toThrow('Expected a Vectr design object');
  });

  it('escapes label text', () => {
    const { doc } = parseDoc({ forms: [{ source: { kind: 'note', params: { text: '<img src=x onerror=alert(1)>' } } }] });
    const svg = docToSVG(doc);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });
});

describe('v1 migration', () => {
  const v1 = {
    width: 1600, height: 900, background: '#F3F2E9', ink: '#232323', rough: 0,
    layers: [
      { type: 'sphere', x: 200, y: 450, params: { meridians: 8 } },
      { type: 'revolve', x: 400, y: 450, params: { profile: 'vase' } },
      { type: 'vortex' }, { type: 'torus', params: { twist: 1.5 } }, { type: 'knot' }, { type: 'orbits' },
      { type: 'arches' }, { type: 'grid', params: { warp: 'ripple' } }, { type: 'truchet', params: { mask: 'circle' } },
      { type: 'shape', params: { kind: 'star', echoes: 4 }, style: { stroke: '#ff6a3d', back: 'dashed' } },
      { type: 'spirograph' }, { type: 'frame', params: { fig: 'FIG. 1' } },
    ],
  };

  it('rebuilds every v1 layer type as a stack that renders', () => {
    const { doc, warnings } = parseDoc({ format: 'vectr', version: 1, doc: v1 });
    expect(doc.forms).toHaveLength(12);
    expect(warnings[0]).toMatch(/Converted from a Vectr v1 design/);
    expect(warnings.some((w) => /frame labels/.test(w))).toBe(true);
    // Only informational warnings: nothing was rejected by validation.
    expect(warnings.filter((w) => /forms\[/.test(w))).toEqual([]);
    const f = doc.forms[0];
    expect(f).toMatchObject({ x: 200, y: 450, rx: 12, ry: 18, source: { kind: 'curve' } });
    expect(f.ops[0]).toMatchObject({ kind: 'revolve', params: { spokes: 16 } });
    expect(doc.forms[9].style).toMatchObject({ stroke: '#ff6a3d', hidden: 'dashed', color: 'solid', taper: 'none' });
    for (const form of doc.forms) expect(docToSVG({ ...doc, forms: [form] })).toMatch(/<path d="M/);
    // Dots only where the rebuilt stack still has real nodes (funnel), not on node-less forms (maze).
    expect(doc.forms[1].style.markers).toBe('dot');
    expect(doc.forms[8].style.markers).toBe('none');
  });

  it('opens v1 share links', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(v1));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    const code = 'v1.' + btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { doc } = await decodeDoc(`#d=${code}`);
    expect(doc.forms).toHaveLength(12);
  });
});

describe('compact + share links', () => {
  it.each(RECIPES.map((t) => t.id))('%s survives compact → parse unchanged', (id) => {
    const doc = RECIPES.find((t) => t.id === id)!.build();
    const { doc: back, warnings } = parseDoc(compactDoc(doc));
    expect(warnings).toEqual([]);
    expect(docToSVG(back)).toBe(docToSVG(doc));
  });

  it('round-trips through a v2 link', async () => {
    const doc = RECIPES[0].build();
    const code = await encodeDoc(doc);
    expect(code.startsWith('v2.')).toBe(true);
    expect(code.length).toBeLessThan(800);
    const { doc: back } = await decodeDoc(`#d=${code}`);
    expect(docToSVG(back)).toBe(docToSVG(doc));
  });

  it('reports corrupted links', async () => {
    await expect(decodeDoc('v2.@@@@')).rejects.toThrow('corrupted');
    await expect(decodeDoc('hello')).rejects.toThrow('Unrecognised');
  });
});

describe('describeBlocks', () => {
  it('lists sources, operators and style with typed params and defaults', () => {
    const b = describeBlocks();
    expect(b.sources.map((s) => s.kind)).toEqual(['curve', 'lattice', 'points', 'note']);
    expect(b.operators.map((o) => o.kind)).toContain('revolve');
    for (const block of [...b.sources, ...b.operators]) for (const p of block.params) expect(p.default).not.toBeUndefined();
    expect(b.sources[0].params.find((p) => p.key === 'turns')).toMatchObject({ only_when: { key: 'shape', in: ['spiral'] } });
  });
});

describe('cli', () => {
  let cli = '';
  beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'vectr-dist-'));
    const tsc = join(__dirname, '../../../node_modules/typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-p', join(__dirname, '../tsconfig.build.json'), '--outDir', out]);
    cli = join(out, 'cli.js');
  }, 60_000);
  const run = (args: string[], input?: string) => execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

  it('renders a design from stdin and writes to a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vectr-'));
    const out = join(dir, 'form.svg');
    run(['render', '-', '-o', out], JSON.stringify({ forms: [{ source: { kind: 'curve', params: { shape: 'knot' } } }] }));
    expect(readFileSync(out, 'utf8')).toMatch(/^<svg xmlns/);
  });

  it('prints recipes that render back to the same art', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vectr-'));
    const file = join(dir, 'r.json');
    writeFileSync(file, run(['recipe', 'meander']));
    expect(run(['render', file]).trim()).toBe(docToSVG(RECIPES.find((t) => t.id === 'meander')!.build()));
  });
});
