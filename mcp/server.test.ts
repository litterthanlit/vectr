/**
 * End-to-end: spawn the MCP server over stdio exactly as an agent host would,
 * draw and edit through tools, and check the live bridge relays to a browser.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const dir = mkdtempSync(join(tmpdir(), 'vectr-mcp-'));
const port = 20000 + Math.floor(Math.random() * 20000);
let client: Client;

type ToolResult = { content: { type: string; text?: string; data?: string }[]; isError?: boolean };
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  const t = r.content.find((c) => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(t);
  try {
    return { json: JSON.parse(t), raw: r };
  } catch {
    return { json: t, raw: r };
  }
}

beforeAll(async () => {
  client = new Client({ name: 'vectr-test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(__dirname, 'server.ts')],
    env: { ...process.env, VECTR_FILE: join(dir, 'doc.json'), VECTR_PORT: String(port) } as Record<string, string>,
    stderr: 'ignore',
  }));
}, 30000);

afterAll(async () => {
  await client?.close();
});

describe('vectr mcp', () => {
  it('exposes the drawing and editing tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['get_canvas', 'draw_path', 'draw_shape', 'import_svg', 'get_path', 'edit_path', 'clean_path', 'render_preview', 'export_svg']) {
      expect(names).toContain(n);
    }
  });

  it('draws, edits point by point and cleans', async () => {
    const { json: leaf } = await call('draw_path', {
      name: 'Leaf',
      points: [[400, 300], [520, 220], [640, 300], [520, 380]],
      smooth: true,
      closed: true,
      fill: '#1FA37A',
      stroke: 'none',
    });
    expect(leaf.name).toBe('Leaf');
    expect(leaf.stats.anchors).toBe(4);
    const tip = leaf.subpaths[0].anchors[2];
    expect(tip.x).toBeCloseTo(640);
    expect(tip.kind).toBe('symmetric');

    // Make the tip sharp, pull it out, add a point on the underside.
    const { json: edited } = await call('edit_path', {
      layer: 'Leaf',
      ops: [
        { op: 'kind', anchors: [[0, 2]], kind: 'straight' },
        { op: 'set', at: '0:2', x: 680 },
        { op: 'insert', subpath: 0, segment: 2, t: 0.5 },
      ],
    });
    expect(edited.stats.anchors).toBe(5);
    expect(edited.subpaths[0].anchors[2]).toMatchObject({ x: 680, y: 300, in: null, out: null, kind: 'corner' });

    // Invalid ops are atomic and explain themselves.
    await expect(call('edit_path', { layer: 'Leaf', ops: [{ op: 'move', dx: 5, dy: 0 }, { op: 'delete', anchors: [[0, 99]] }] }))
      .rejects.toThrow(/Op #1 \(delete\).*does not exist/);
    const { json: still } = await call('get_path', { layer: 'Leaf' });
    expect(still.subpaths[0].anchors[2].x).toBe(680);
  });

  it('imports SVG and refits messy geometry', async () => {
    const pts = Array.from({ length: 120 }, (_, i) => {
      const t = (i / 120) * Math.PI * 2;
      return `${(100 + Math.cos(t) * 60).toFixed(2)},${(100 + Math.sin(t) * 60).toFixed(2)}`;
    }).join(' ');
    const { json } = await call('import_svg', {
      svg: `<svg viewBox="0 0 200 200"><polygon id="Blob" points="${pts}" fill="#ff6a3d"/></svg>`,
      x: 100, y: 100, width: 400,
    });
    expect(json.imported).toHaveLength(1);
    expect(json.imported[0].anchors).toBe(120);
    const { json: cleaned } = await call('clean_path', { layer: 'Blob', tolerance: 1 });
    expect(cleaned.after.anchors).toBeLessThanOrEqual(8);
    expect(cleaned.after.corners).toBe(0);
  });

  it('draws primitives and converts generators to paths', async () => {
    const { json: star } = await call('draw_shape', { shape: 'star', x: 50, y: 50, width: 100, sides: 5 });
    expect(star.stats.anchors).toBe(10);
    const { json: gen } = await call('add_generator', { type: 'shape', params: { kind: 'flower' } });
    const { json: conv } = await call('convert_to_path', { layer: gen.id });
    expect(conv[0].stats.anchors).toBeLessThan(80);
  });

  it('renders a preview image with point overlay', async () => {
    const { raw } = await call('render_preview', { focus: 'Leaf', show_points: true, width: 400 });
    const img = raw.content.find((c) => c.type === 'image')!;
    const png = Buffer.from(img.data!, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('exports clean named SVG and persists the document', async () => {
    const { json: svg } = await call('export_svg');
    expect(svg).toContain('<g opacity="1" id="leaf">');
    expect(svg).toMatch(/<path d="M[\d. ]+C/);
    await new Promise((r) => setTimeout(r, 400));
    const saved = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf8'));
    expect(saved.layers.some((l: { name: string }) => l.name === 'Leaf')).toBe(true);
  });

  it('syncs live with the browser app in both directions', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: 'http://localhost:5173' } });
    const frames: { type: string; doc: { layers: { name: string }[] }; activity?: string }[] = [];
    ws.on('message', (m) => frames.push(JSON.parse(String(m))));
    await new Promise((r) => ws.once('open', r));
    await new Promise((r) => setTimeout(r, 100));
    expect(frames[0].type).toBe('hello');

    await call('draw_shape', { shape: 'ellipse', x: 0, y: 0, width: 40, name: 'Dot' });
    await new Promise((r) => setTimeout(r, 100));
    const last = frames[frames.length - 1];
    expect(last.activity).toBe('Drew “Dot”');
    expect(last.doc.layers.some((l) => l.name === 'Dot')).toBe(true);

    // Designer renames a layer in the app; the agent sees it.
    const doc = structuredClone(last.doc);
    doc.layers.find((l) => l.name === 'Dot')!.name = 'Moon';
    ws.send(JSON.stringify({ type: 'doc', doc }));
    await new Promise((r) => setTimeout(r, 100));
    const { json: canvas } = await call('get_canvas');
    expect(canvas.layers.some((l: { name: string }) => l.name === 'Moon')).toBe(true);
    ws.close();
  });

  it('rejects bridge connections from foreign web origins', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: 'https://evil.example' } });
    const outcome = await new Promise((r) => {
      ws.once('open', () => r('open'));
      ws.once('error', () => r('rejected'));
    });
    expect(outcome).toBe('rejected');
  });
});
