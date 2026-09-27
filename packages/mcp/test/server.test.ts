import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TEMPLATES, decodeDoc, docToSVG, serializeDoc } from '@vectr/core';
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
const imageOf = (r: CallToolResult) => r.content.find((c) => c.type === 'image') as { data: string; mimeType: string } | undefined;

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
      'vectr_list_designs', 'vectr_list_generators', 'vectr_render_preview', 'vectr_update_design',
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBeTypeOf('boolean');
      expect(t.description!.length).toBeGreaterThan(40);
    }
    expect(client.getInstructions()).toMatch(/Workflow/);
  });

  it('describes generators as markdown or json', async () => {
    expect(textOf(await call('vectr_list_generators'))).toMatch(/## sphere \(Globe\)[\s\S]*`meridians`/);
    const json = await call('vectr_list_generators', { type: 'grid', response_format: 'json' });
    expect(JSON.parse(textOf(json))[0].params.find((p: { key: string }) => p.key === 'warp').options).toContain('twist');
  });
});

describe('design lifecycle', () => {
  it('creates from a template with a PNG preview and short layer ids', async () => {
    const r = await call('vectr_create_design', { template: 'starter', name: 'Row' });
    expect(r.isError).toBeFalsy();
    const png = Buffer.from(imageOf(r)!.data, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(textOf(r)).toMatch(/\*\*Row\*\* \(id `d1`\) · 1200×900 · theme ozone/);
    expect(textOf(r)).toMatch(/`L1` \*\*torus\*\*/);
  });

  it('applies an atomic update and reports corrections instead of failing', async () => {
    await call('vectr_create_design', { settings: { theme: 'graphite', width: 1000, height: 1000 }, preview: false });
    const r = await call('vectr_update_design', {
      design_id: 'd1',
      add_layers: [
        { type: 'sphere', params: { meridians: 9, rigns: 3 } },
        { type: 'torus', x: 200, y: 200, scale: 90, style: { back: 'dashed' } },
      ],
      preview: false,
    });
    expect(textOf(r)).toMatch(/unknown param "rigns"/);
    expect(r.structuredContent).toMatchObject({ design_id: 'd1', design: { background: '#111214', layers: [{ id: 'L1', params: { meridians: 9 } }, { id: 'L2' }] } });

    const r2 = await call('vectr_update_design', {
      design_id: 'd1',
      update_layers: [{ id: 'L1', rx: 30, params: { rings: 20 } }, { id: 'L9', rx: 1 }],
      remove_layer_ids: ['L2'],
      layer_order: ['nope'],
      preview: false,
    });
    const t = textOf(r2);
    expect(t).toMatch(/"rings" clamped to 0–8/);
    expect(t).toMatch(/no layer "L9"/);
    expect(t).toMatch(/layer_order ignored/);
    // params merge rather than replace
    expect((r2.structuredContent as { design: { layers: { params: object }[] } }).design.layers).toEqual([
      expect.objectContaining({ id: 'L1', rx: 30, params: { meridians: 9, rings: 8 } }),
    ]);
  });

  it('gives actionable errors', async () => {
    const r = await call('vectr_update_design', { design_id: 'd7', set: { theme: 'graphite' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Create one with vectr_create_design/);
    const both = await call('vectr_create_design', { template: 'starter', design: {} });
    expect(textOf(both)).toMatch(/only one source/);
  });

  it('lists, inspects and deletes designs', async () => {
    await call('vectr_create_design', { design: { layers: [{ type: 'shape' }, { type: 'knot' }] }, preview: false });
    expect(textOf(await call('vectr_list_designs'))).toMatch(/`d1` Design 1: 1200×900, 2 layers/);
    const json = JSON.parse(textOf(await call('vectr_get_design', { design_id: 'd1', response_format: 'json' })));
    expect(json.layers).toHaveLength(2);
    await call('vectr_delete_design', { design_id: 'd1' });
    expect(textOf(await call('vectr_list_designs'))).toMatch(/No designs yet/);
  });
});

describe('import and export', () => {
  it('round-trips through a share link', async () => {
    await call('vectr_create_design', { template: 'starter', preview: false });
    const url = textOf(await call('vectr_export_design', { design_id: 'd1', format: 'link' }));
    expect(url.startsWith('https://vectr.example/#d=v1.')).toBe(true);
    const { doc } = await decodeDoc(url.split('#')[1]);
    expect(docToSVG(doc)).toBe(docToSVG(TEMPLATES.find((t) => t.id === 'starter')!.build()));

    const reopened = await call('vectr_create_design', { share_link: url, preview: false });
    expect(textOf(reopened)).toMatch(/`d2`[\s\S]*\*\*torus\*\*/);
  });

  it('writes files inside the allowed folder and opens projects from it', async () => {
    await call('vectr_create_design', { template: 'starter', preview: false });
    for (const [format, file] of [['svg', 'out/globe.svg'], ['png', 'out/globe.png'], ['json', 'out/globe.json']]) {
      const r = await call('vectr_export_design', { design_id: 'd1', format, file_path: file, png_scale: 0.5 });
      expect(r.isError).toBeFalsy();
      expect(existsSync(join(root, file))).toBe(true);
    }
    expect(readFileSync(join(root, 'out/globe.svg'), 'utf8')).toMatch(/^<svg xmlns/);
    const r = await call('vectr_create_design', { file_path: 'out/globe.json', preview: false });
    expect(textOf(r)).toMatch(/`d2`[\s\S]*\*\*torus\*\*/);
  });

  it('returns small SVG inline and refuses oversized inline output', async () => {
    await call('vectr_create_design', { design: { layers: [{ type: 'shape' }] }, preview: false });
    expect(textOf(await call('vectr_export_design', { design_id: 'd1', format: 'svg' }))).toMatch(/^<svg/);
    await call('vectr_create_design', { design: { layers: [{ type: 'torus', params: { tubes: 48, loops: 24 } }, { type: 'grid', params: { rows: 40, cols: 40 } }, { type: 'sphere', params: { meridians: 24, parallels: 24 } }] }, preview: false });
    const big = await call('vectr_export_design', { design_id: 'd2', format: 'svg' });
    expect(big.isError).toBe(true);
    expect(textOf(big)).toMatch(/Pass file_path/);
  });

  it('confines file access to the allowed folders', async () => {
    await call('vectr_create_design', { preview: false });
    const outside = mkdtempSync(join(tmpdir(), 'vectr-outside-'));
    writeFileSync(join(outside, 'secret.json'), serializeDoc(TEMPLATES[0].build()));
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
    const r = (await c.callTool({ name: 'vectr_create_design', arguments: { template: 'starter', preview_width: 200 } })) as CallToolResult;
    expect(r.content.some((x) => x.type === 'image')).toBe(true);
    await c.close();
  }, 60_000);
});
