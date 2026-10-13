import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ELEMENTS, RECIPES, STYLE_PARAMS, decodeDoc, docToSVG, elementDocForms, serializeDoc } from '@vectr/core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DesignError, DesignStore } from '../src/designs.js';
import { Files } from '../src/files.js';
import { createServer } from '../src/server.js';

let client: Client;
let root: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
const textOf = (r: CallToolResult) => r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
const images = (r: CallToolResult) => r.content.filter((c) => c.type === 'image') as { data: string; mimeType: string }[];
const design = (r: CallToolResult) => (r.structuredContent as { design: { forms: Record<string, unknown>[] } }).design;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'vectr-mcp-'));
  const server = createServer({ files: new Files([root]), appUrl: 'https://vectr.example/' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe('tool surface', () => {
  it('exposes prefixed, annotated tools and workflow instructions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'vectr_create_design', 'vectr_delete_design', 'vectr_export_design', 'vectr_get_design',
      'vectr_list_building_blocks', 'vectr_list_designs', 'vectr_mutate_design', 'vectr_render_preview', 'vectr_update_design',
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBeTypeOf('boolean');
      expect(t.description!.length).toBeGreaterThan(40);
    }
    expect(client.getInstructions()).toMatch(/Workflow/);
  });

  it('teaches the new blocks and tips in the instructions, built from the engine', () => {
    const text = client.getInstructions()!;
    for (const kind of ['orbits', 'card', 'ticks', 'resample']) expect(text).toContain(kind);
    expect(text).toMatch(/ALWAYS keep them flat \(rx 0, ry 0, perspective 0\)/);
    expect(text).toMatch(/knockout/);
    expect(text).toMatch(/keepLines/);
    expect(text).toMatch(/add_elements/);
    for (const e of ELEMENTS) expect(text).toContain(e.id);
  });

  it('accepts every engine style option, so none is rejected at the boundary', async () => {
    const { tools } = await client.listTools();
    const update = tools.find((t) => t.name === 'vectr_update_design')!;
    type Schema = { properties?: Record<string, Schema>; items?: Schema; enum?: string[] };
    const style = (update.inputSchema as Schema).properties!.add_forms.items!.properties!.style;
    for (const p of STYLE_PARAMS) {
      if (p.kind !== 'select') continue;
      expect(style.properties![p.key]?.enum, p.key).toEqual(p.options.map((o) => o.value));
    }
    for (const key of ['dash', 'knockout', 'labelFont', 'labelColor']) expect(style.properties![key], key).toBeDefined();
  });

  it('describes building blocks as markdown or json', async () => {
    const md = textOf(await call('vectr_list_building_blocks'));
    expect(md).toMatch(/### revolve — Revolve/);
    expect(md).toMatch(/`turns` \(Turns\): 0.25–16, default 3 _\(only when shape is spiral\)_/);
    const json = JSON.parse(textOf(await call('vectr_list_building_blocks', { block: 'warp', response_format: 'json' })));
    expect(json.operators[0].params.find((p: { key: string }) => p.key === 'kind').options).toContain('noise');
  });

  it('lists the newer sources, operators, style keys, elements and recipes', async () => {
    const md = textOf(await call('vectr_list_building_blocks'));
    expect(md).toMatch(/### orbits — Orbits/);
    expect(md).toMatch(/### card — Card/);
    expect(md).toMatch(/### ticks — Ticks/);
    expect(md).toMatch(/`keepLines` \(Keep lines\)/);
    for (const key of ['dash', 'knockout', 'labelFont', 'labelColor']) expect(md).toContain(`\`${key}\``);
    expect(md).toMatch(/`fill` \(Fill\): none \| ribbons \| shapes/);
    for (const e of ELEMENTS) expect(md).toContain(`\`${e.id}\` ${e.name} (${e.forms.length} form${e.forms.length === 1 ? '' : 's'}): ${e.blurb}`);
    expect(md).toMatch(/add_elements/);
    for (const id of ['meridian', 'gyroscope', 'orrery', 'sonar']) expect(md).toContain(id);
    expect(md).toContain('fog (bg');
    const card = textOf(await call('vectr_list_building_blocks', { block: 'card' }));
    expect(card).toMatch(/^### card — Card/);
    expect(card).not.toMatch(/## Style/);
  });
});

describe('design lifecycle', () => {
  it('creates from a recipe with a PNG preview and short form ids', async () => {
    const r = await call('vectr_create_design', { recipe: 'vessel', name: 'Pot' });
    expect(r.isError).toBeFalsy();
    const png = Buffer.from(images(r)[0].data, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(textOf(r)).toMatch(/\*\*Pot\*\* \(id `d1`\) · 1200×900 · theme signal/);
    expect(textOf(r)).toMatch(/`F1` "Vessel profile"[\s\S]*curve\(shape="profile"[\s\S]*→ \[0\] revolve\(/);
  });

  it('adds forms, patches stacks and reports corrections instead of failing', async () => {
    await call('vectr_create_design', { settings: { theme: 'graphite', width: 1000, height: 1000 }, preview: false });
    const r = await call('vectr_update_design', {
      design_id: 'd1',
      add_forms: [
        { source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180, bogus: 1 } }, ops: [{ kind: 'revolve', params: { rings: 12 } }] },
        { source: { kind: 'points' }, ops: [{ kind: 'connect' }], style: { markers: 'dot' } },
      ],
      preview: false,
    });
    expect(textOf(r)).toMatch(/unknown curve param "bogus"/);
    expect(design(r)).toMatchObject({ background: '#111214', forms: [{ id: 'F1', ops: [{ kind: 'revolve', params: { rings: 12 } }] }, { id: 'F2' }] });

    const r2 = await call('vectr_update_design', {
      design_id: 'd1',
      update_forms: [
        {
          id: 'F1',
          rx: 30,
          source_params: { sweep: 120 },
          ops_patch: [
            { action: 'add', kind: 'warp', params: { kind: 'twist', amount: 9 } },
            { action: 'update', index: 0, params: { spokes: 20 } },
            { action: 'move', index: 1, to: 0 },
            { action: 'remove', index: 7 },
          ],
        },
        { id: 'F9', rx: 1 },
      ],
      remove_form_ids: ['F2'],
      form_order: ['nope'],
      preview: false,
    });
    const t = textOf(r2);
    expect(t).toMatch(/"amount" clamped to -2–2/);
    expect(t).toMatch(/no operator at index 7/);
    expect(t).toMatch(/no form "F9"/);
    expect(t).toMatch(/form_order ignored/);
    const f1 = design(r2).forms[0] as { rx: number; source: { params: Record<string, unknown> }; ops: { kind: string; params: Record<string, unknown> }[] };
    expect(f1.rx).toBe(30);
    expect(f1.source.params).toEqual({ shape: 'arc', start: -90, sweep: 120 });
    expect(f1.ops.map((o) => o.kind)).toEqual(['warp', 'revolve']);
    expect(f1.ops[1].params).toEqual({ rings: 12, spokes: 20 });
    expect(design(r2).forms).toHaveLength(1);
  });

  it('accepts the instrument-plate style keys without corrections', async () => {
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'card' } }] }, preview: false });
    const style = { fill: 'shapes', knockout: true, dash: 'dotted', labelFont: 'sans', labelColor: '#111111' };
    const r = await call('vectr_update_design', { design_id: 'd1', update_forms: [{ id: 'F1', style }], preview: false });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).not.toMatch(/Corrections/);
    expect(design(r).forms[0].style).toMatchObject(style);

    // The same keys on a new form, and a null labelColor clears it again.
    const r2 = await call('vectr_update_design', {
      design_id: 'd1',
      add_forms: [{ source: { kind: 'curve' }, style }],
      update_forms: [{ id: 'F1', style: { labelColor: null } }],
      preview: false,
    });
    expect(textOf(r2)).not.toMatch(/Corrections/);
    expect(design(r2).forms[1].style).toMatchObject(style);
    expect(design(r2).forms[0].style).not.toHaveProperty('labelColor');

    // Bad values are still corrected rather than failing the call.
    const bad = await call('vectr_update_design', { design_id: 'd1', update_forms: [{ id: 'F1', style: { labelColor: 'teal' } }], preview: false });
    expect(bad.isError).toBeFalsy();
    expect(textOf(bad)).toMatch(/Corrections[\s\S]*labelColor/);
  });

  it('shortens long text in summaries and keeps it whole in json', async () => {
    const caption = 'An orbital survey of the inner shell, plotted at one-hundredth scale from the long-baseline data.';
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'card', params: { text: caption } } }] }, preview: false });
    const md = textOf(await call('vectr_get_design', { design_id: 'd1' }));
    expect(md).toMatch(/card\(text="An orbital survey of the inner shell, plotted a…"\)/);
    expect(md).not.toContain('long-baseline');
    const json = textOf(await call('vectr_get_design', { design_id: 'd1', response_format: 'json' }));
    expect(json).toContain(caption);
  });

  it('teaches the context source and focus mode, and takes a long pasted text whole, with a preview', async () => {
    const tips = client.getInstructions()!;
    expect(tips).toMatch(/context source makes a field of token blocks/);
    expect(tips).toMatch(/fill "shapes"/);
    expect(tips).toMatch(/connect mode "focus"/);
    expect(textOf(await call('vectr_list_building_blocks', { block: 'context' }))).toMatch(/^### context — Context/);
    expect(textOf(await call('vectr_list_building_blocks', { block: 'connect' }))).toMatch(/`fy` \(Focus Y\): -3–3, default 1.2 _\(only when mode is focus\)_/);

    const long = Array.from({ length: 560 }, (_, i) => `word${i % 9}`).join(' ');
    expect(long.length).toBeGreaterThan(3000);
    expect(long.length).toBeLessThan(4000);
    const r = await call('vectr_create_design', {
      design: {
        forms: [{
          source: { kind: 'context', params: { text: long, highlight: 'word3', layout: 'burst' } },
          ops: [{ kind: 'connect', params: { mode: 'focus', split: true, which: 'relevant', fy: 1.4 } }],
          style: { fill: 'shapes', colorBy: 'family' },
        }],
      },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).not.toMatch(/Corrections/);
    expect(images(r)).toHaveLength(1);
    const f = design(r).forms[0] as { source: { params: Record<string, unknown> }; ops: { params: Record<string, unknown> }[] };
    expect(f.source.params.text).toBe(long);
    expect(f.ops[0].params).toMatchObject({ mode: 'focus', split: true, which: 'relevant', fy: 1.4 });
  });

  it('teaches the strip source, lists its params, and takes a long text and a pattern whole, with a preview', async () => {
    const tips = client.getInstructions()!;
    expect(tips).toMatch(/strip source draws rows of slabs joined by thinner necks/);
    expect(tips).toMatch(/'#' slab, '-' neck/);
    expect(tips).toMatch(/colorBy "family" with a 2-stop ramp/);
    expect(tips).toMatch(/connect mode "focus" with which "relevant"/);
    const listing = textOf(await call('vectr_list_building_blocks', { block: 'strip' }));
    expect(listing).toMatch(/^### strip — Strip/);
    expect(listing).toMatch(/`ramp` \(Ramp\)/);
    expect(listing).toMatch(/`pattern` \(Pattern\)[^\n]*only when mode is pattern/);

    const long = Array.from({ length: 560 }, (_, i) => `word${i % 9}`).join(' ');
    const pattern = '####--######\n#####-####\n###  #######';
    const r = await call('vectr_create_design', {
      design: {
        forms: [
          { source: { kind: 'strip', params: { mode: 'text', text: long, highlight: 'word3' } }, style: { fill: 'shapes', colorBy: 'family' } },
          { source: { kind: 'strip', params: { pattern, finishEnd: 'round', ramp: 45 } }, style: { fill: 'shapes' } },
        ],
      },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).not.toMatch(/Corrections/);
    expect(images(r)).toHaveLength(1);
    const [a, b] = design(r).forms as { source: { params: Record<string, unknown> } }[];
    expect(a.source.params.text).toBe(long);
    expect(b.source.params).toMatchObject({ pattern, finishEnd: 'round', ramp: 45 });
  });

  it('mutates a form and applies the chosen variation', async () => {
    await call('vectr_create_design', { recipe: 'pulse-bloom', preview: false });
    const before = JSON.stringify(design(await call('vectr_get_design', { design_id: 'd1' })));
    const m = await call('vectr_mutate_design', { design_id: 'd1', form_id: 'F1', count: 3, seed: 42, preview_width: 200 });
    expect(images(m)).toHaveLength(3);
    expect(textOf(m)).toMatch(/3 variations of `F1` \(seed 42\)/);
    const applied = await call('vectr_mutate_design', { design_id: 'd1', form_id: 'F1', apply: 2 });
    expect(textOf(applied)).toMatch(/Applied variation 2/);
    expect(JSON.stringify(design(applied))).not.toBe(before);
    const again = await call('vectr_mutate_design', { design_id: 'd1', form_id: 'F1', apply: 1 });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toMatch(/No variations pending/);
  });

  it('gives actionable errors', async () => {
    const r = await call('vectr_update_design', { design_id: 'd7', set: { theme: 'ozone' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Create one with vectr_create_design/);
    const both = await call('vectr_create_design', { recipe: 'strata', design: {} });
    expect(textOf(both)).toMatch(/only one source/);
  });

  it('lists, inspects and deletes designs', async () => {
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'curve' } }, { source: { kind: 'lattice' } }] }, preview: false });
    expect(textOf(await call('vectr_list_designs'))).toMatch(/`d1` Design 1: 1200×900, 2 forms/);
    const json = JSON.parse(textOf(await call('vectr_get_design', { design_id: 'd1', response_format: 'json' })));
    expect(json.forms).toHaveLength(2);
    await call('vectr_delete_design', { design_id: 'd1' });
    expect(textOf(await call('vectr_list_designs'))).toMatch(/No designs yet/);
  });
});

describe('add_elements', () => {
  const dial = ELEMENTS.find((e) => e.id === 'dial')!;
  // The compact design leaves out defaults, which includes a position at the artboard centre.
  type F = { id: string; name: string; x?: number; y?: number; scale: number; rx?: number; ry?: number; perspective?: number };
  const at = (f: F, cx: number, cy: number) => [f.x ?? cx, f.y ?? cy];

  it('places an element on top of a design and returns a preview', async () => {
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'lattice' } }] }, preview: false });
    const r = await call('vectr_update_design', { design_id: 'd1', add_elements: [{ id: 'dial' }] });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/Added elements: dial \(F2–F4\)/);
    expect(textOf(r)).not.toMatch(/Corrections/);
    expect(Buffer.from(images(r)[0].data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    const forms = design(r).forms as unknown as F[];
    expect(forms).toHaveLength(1 + dial.forms.length);
    expect(forms.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(forms.slice(1).map((f) => f.name)).toEqual(dial.forms.map((f) => f.name));
    expect(r.structuredContent).toMatchObject({ placed: [{ element: 'dial', formIds: ['F2', 'F3', 'F4'] }] });
  });

  it('centres on the artboard and scales with its shorter side, like the app does', async () => {
    await call('vectr_create_design', { settings: { width: 1200, height: 900 }, preview: false });
    const r = await call('vectr_update_design', { design_id: 'd1', add_elements: [{ id: 'dial' }], preview: false });
    const [bezel] = design(r).forms as unknown as F[];
    expect(at(bezel, 600, 450)).toEqual([600, 450]);
    expect(bezel.scale).toBe(Math.round(330 * 0.9));
    // Cards and dials are flat, whatever the artboard.
    expect(bezel.rx ?? 0).toBe(0);
    expect(bezel.perspective ?? 0).toBe(0);
  });

  it('moves and sizes an element with x, y and size', async () => {
    await call('vectr_create_design', { settings: { width: 1000, height: 1000 }, preview: false });
    const r = await call('vectr_update_design', {
      design_id: 'd1',
      add_elements: [{ id: 'dial', x: 300, y: 400, size: 0.5 }, { id: 'gimbal', x: 700, y: 620 }],
      preview: false,
    });
    const forms = design(r).forms as unknown as F[];
    const [d, g] = [forms.slice(0, dial.forms.length), forms.slice(dial.forms.length)];
    expect(d.map((f) => at(f, 500, 500))).toEqual(d.map(() => [300, 400]));
    expect(d.map((f) => f.scale)).toEqual(elementDocForms(dial, 1000, 1000).map((f) => Math.round((f.scale as number) / 2)));
    expect(g.map((f) => at(f, 500, 500))).toEqual(g.map(() => [700, 620]));
    expect(g[0].scale).toBe(360);
  });

  it('keeps card elements flat, with their text scaled by size', async () => {
    await call('vectr_create_design', { settings: { width: 1000, height: 1000 }, preview: false });
    const r = await call('vectr_update_design', { design_id: 'd1', add_elements: [{ id: 'caption', size: 2 }], preview: false });
    const [card] = design(r).forms as unknown as (F & { style: Record<string, unknown> })[];
    expect(card).toMatchObject({ scale: 520, style: { fill: 'shapes', knockout: true, labelFont: 'sans', labelSize: 54 } });
    expect(card.rx ?? 0).toBe(0);
    expect(card.ry ?? 0).toBe(0);
    expect(card.perspective ?? 0).toBe(0);
  });

  it('uses the artboard as set, follows add_forms, and every element renders', async () => {
    await call('vectr_create_design', { preview: false });
    const r = await call('vectr_update_design', {
      design_id: 'd1',
      set: { width: 800, height: 800, theme: 'fog' },
      add_forms: [{ source: { kind: 'points' } }],
      add_elements: ELEMENTS.map((e) => ({ id: e.id })),
      preview: false,
    });
    const total = 1 + ELEMENTS.reduce((n, e) => n + e.forms.length, 0);
    expect(design(r).forms).toHaveLength(total);
    expect(textOf(r)).not.toMatch(/Corrections/);
    expect(at(design(r).forms[1] as unknown as F, 400, 400)).toEqual([400, 400]);
    const png = await call('vectr_render_preview', { design_id: 'd1', width: 300 });
    expect(images(png)).toHaveLength(1);
    await call('vectr_export_design', { design_id: 'd1', format: 'svg', file_path: 'all.svg' });
    expect(readFileSync(join(root, 'all.svg'), 'utf8')).toMatch(/^<svg/);
  });

  it('rejects an unknown element id and bad sizes, changing nothing', async () => {
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'curve' } }] }, preview: false });
    const attempts: [Record<string, unknown>, RegExp][] = [
      [{ id: 'teapot' }, /one of "globe"\|"dial"[\s\S]*add_elements\[0\]\.id/],
      [{ id: 'dial', size: 0 }, /add_elements\[0\]\.size/],
      [{ id: 'dial', size: -1 }, /add_elements\[0\]\.size/],
      [{ id: 'dial', scale: 2 }, /add_elements\[0\]/],
    ];
    for (const [bad, why] of attempts) {
      const r = await call('vectr_update_design', { design_id: 'd1', add_elements: [bad], preview: false });
      expect(r.isError, JSON.stringify(bad)).toBe(true);
      expect(textOf(r)).toMatch(why);
    }
    expect(design(await call('vectr_get_design', { design_id: 'd1', response_format: 'json' })).forms).toHaveLength(1);
  });

  it('names the known elements when the store is called with an unknown id', () => {
    const store = new DesignStore();
    const { design: d } = store.create({ forms: [] });
    expect(() => store.update(d.id, { add_forms: [{ source: { kind: 'curve' } }], add_elements: [{ id: 'teapot' }] })).toThrow(DesignError);
    expect(() => store.update(d.id, { add_elements: [{ id: 'teapot' }] })).toThrow(/Unknown element "teapot". Known: globe, dial/);
    // The failed call spent no form ids and changed nothing.
    expect(store.update(d.id, { add_forms: [{ source: { kind: 'curve' } }] }).design.doc.forms.map((f) => f.id)).toEqual(['F1']);
  });
});

describe('import and export', () => {
  it('round-trips through a share link', async () => {
    await call('vectr_create_design', { recipe: 'meander', preview: false });
    const url = textOf(await call('vectr_export_design', { design_id: 'd1', format: 'link' }));
    expect(url.startsWith('https://vectr.example/#d=v2.')).toBe(true);
    const { doc } = await decodeDoc(url.split('#')[1]);
    expect(docToSVG(doc)).toBe(docToSVG(RECIPES.find((t) => t.id === 'meander')!.build()));
    const reopened = await call('vectr_create_design', { share_link: url, preview: false });
    expect(textOf(reopened)).toMatch(/`d2`[\s\S]*lattice[\s\S]*tile/);
  });

  it('writes files inside the allowed folder and opens projects from it, including v1 ones', async () => {
    await call('vectr_create_design', { recipe: 'constellation', preview: false });
    for (const [format, file] of [['svg', 'out/c.svg'], ['png', 'out/c.png'], ['json', 'out/c.json']]) {
      const r = await call('vectr_export_design', { design_id: 'd1', format, file_path: file, png_scale: 0.5 });
      expect(r.isError).toBeFalsy();
      expect(existsSync(join(root, file))).toBe(true);
    }
    expect(readFileSync(join(root, 'out/c.svg'), 'utf8')).toMatch(/^<svg xmlns/);
    expect(textOf(await call('vectr_create_design', { file_path: 'out/c.json', preview: false }))).toMatch(/`d2`[\s\S]*points/);

    writeFileSync(join(root, 'old.json'), JSON.stringify({ format: 'vectr', version: 1, doc: { layers: [{ type: 'torus' }] } }));
    const v1 = await call('vectr_create_design', { file_path: 'old.json', preview: false });
    expect(textOf(v1)).toMatch(/Converted from a Vectr v1 design/);
    expect(textOf(v1)).toMatch(/curve\(size=0.3\) → \[0\] revolve\(rings=6, spokes=24, offset=0.68\)/);
  });

  it('returns small SVG inline and refuses oversized inline output', async () => {
    await call('vectr_create_design', { design: { forms: [{ source: { kind: 'curve' } }] }, preview: false });
    expect(textOf(await call('vectr_export_design', { design_id: 'd1', format: 'svg' }))).toMatch(/^<svg/);
    await call('vectr_create_design', { recipe: 'vessel', preview: false });
    const big = await call('vectr_export_design', { design_id: 'd2', format: 'svg' });
    expect(big.isError).toBe(true);
    expect(textOf(big)).toMatch(/Pass file_path/);
  });

  it('confines file access to the allowed folders', async () => {
    await call('vectr_create_design', { preview: false });
    const outside = mkdtempSync(join(tmpdir(), 'vectr-outside-'));
    writeFileSync(join(outside, 'secret.json'), serializeDoc(RECIPES[0].build()));
    mkdirSync(join(root, 'sub'));
    symlinkSync(outside, join(root, 'sub/link'));
    const attempts: [string, Record<string, unknown>][] = [
      ['vectr_export_design', { design_id: 'd1', format: 'svg', file_path: '../escape.svg' }],
      ['vectr_export_design', { design_id: 'd1', format: 'svg', file_path: join(outside, 'x.svg') }],
      ['vectr_export_design', { design_id: 'd1', format: 'svg', file_path: 'sub/link/x.svg' }],
      ['vectr_create_design', { file_path: 'sub/link/secret.json' }],
      ['vectr_export_design', { design_id: 'd1', format: 'svg', file_path: 'evil.sh' }],
    ];
    for (const [tool, args] of attempts) {
      const r = await call(tool, args);
      expect(r.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(existsSync(join(outside, 'x.svg'))).toBe(false);
    expect(existsSync(join(root, '..', 'escape.svg'))).toBe(false);
  });
});

describe('stdio binary', () => {
  it('starts from the built package and answers over stdio', async () => {
    const dir = join(__dirname, '..');
    const tsc = join(dir, '../../node_modules/typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-p', join(dir, '../core/tsconfig.build.json')]);
    execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.build.json')]);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(dir, 'dist/index.js')],
      env: { ...process.env, VECTR_ALLOWED_DIRS: root } as Record<string, string>,
      stderr: 'pipe',
    });
    const c = new Client({ name: 'stdio-test', version: '1.0.0' });
    await c.connect(transport);
    const r = (await c.callTool({ name: 'vectr_create_design', arguments: { recipe: 'loom-knot', preview_width: 200 } })) as CallToolResult;
    expect(r.content.some((x) => x.type === 'image')).toBe(true);
    // The built server places elements and reports the package's own version.
    const e = (await c.callTool({ name: 'vectr_update_design', arguments: { design_id: 'd1', add_elements: [{ id: 'gauge', size: 0.5 }], preview_width: 200 } })) as CallToolResult;
    expect(e.isError).toBeFalsy();
    expect(textOf(e)).toMatch(/Added elements: gauge/);
    expect(c.getServerVersion()?.version).toBe(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version);
    await c.close();
  }, 60_000);
});
