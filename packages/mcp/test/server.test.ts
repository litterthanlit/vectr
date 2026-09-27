import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RECIPES, decodeDoc, docToSVG, serializeDoc } from '@vectr/core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
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

  it('describes building blocks as markdown or json', async () => {
    const md = textOf(await call('vectr_list_building_blocks'));
    expect(md).toMatch(/### revolve — Revolve/);
    expect(md).toMatch(/`turns` \(Turns\): 0.25–16, default 3 _\(only when shape is spiral\)_/);
    const json = JSON.parse(textOf(await call('vectr_list_building_blocks', { block: 'warp', response_format: 'json' })));
    expect(json.operators[0].params.find((p: { key: string }) => p.key === 'kind').options).toContain('noise');
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
    await c.close();
  }, 60_000);
});
