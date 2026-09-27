import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TEMPLATES, THEMES, decodeDoc, docToSVG, describeGenerators, parseDoc, serializeDoc, shareURL } from '@vectr/core';
import { z } from 'zod';
import { DesignError, DesignStore, type Design } from './designs.js';
import { FileAccessError, Files } from './files.js';
import { GENERATOR_TYPES, generatorsMarkdown, summarize, warningsBlock } from './format.js';
import { renderPNG } from './preview.js';

export const SERVER_NAME = 'vectr-mcp-server';
export const SERVER_VERSION = '0.1.0';

/** Inline SVG/JSON above this size must be written to a file instead. */
export const CHARACTER_LIMIT = 60_000;

export interface ServerConfig {
  files: Files;
  /** Base URL of the Vectr app, used for share links. */
  appUrl: string;
}

const INSTRUCTIONS = `Vectr makes generative vector illustrations: wireframe globes, funnels, helices, tori, knots, orbit diagrams, arches, warped grids, Truchet mazes, rounded icon shapes, spirographs and figure frames. Shapes are 3D; lines facing away from the viewer are drawn dotted/dashed/faded.

Workflow:
1. vectr_list_generators to learn the shape types and their params (once per session).
2. vectr_create_design (optionally from a template, JSON, share link or project file). It returns a design_id and a preview image.
3. vectr_update_design to add/modify/remove layers. Every call returns a fresh preview; look at it and iterate.
4. vectr_export_design to deliver: "link" opens the design in the Vectr app for the user to keep editing; "svg"/"png"/"json" write files.

Tips: position with x,y in artboard pixels (layer centre), size with scale (radius in px). rx tilts toward/away, ry turns left/right. Invalid values are clamped or dropped and reported under "Corrections" rather than failing; read them and fix your input.`;

const text = (t: string) => ({ type: 'text' as const, text: t });
const image = (png: Buffer) => ({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' });

function failure(e: unknown): CallToolResult {
  const known = e instanceof DesignError || e instanceof FileAccessError || (e instanceof Error && /JSON|design|share|large|corrupt/i.test(e.message));
  const msg = known ? (e as Error).message : 'Unexpected error while processing the design.';
  if (!known) console.error(`[${SERVER_NAME}]`, e);
  return { isError: true, content: [text(`Error: ${msg}`)] };
}

async function guard(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return failure(e);
  }
}

// ---------- Schemas ----------

const ResponseFormat = z.enum(['markdown', 'json']).default('markdown').describe("'markdown' for a readable summary, 'json' for structured data");

const PreviewWidth = z.number().int().min(128).max(2000).default(640).describe('Preview PNG width in pixels (default 640)');

const StyleInput = z
  .object({
    stroke: z.string().nullable().optional().describe('Line colour, e.g. "#ff6a3d". null = use the document ink'),
    width: z.number().optional().describe('Stroke width in px, 0.1–40'),
    back: z.enum(['dotted', 'dashed', 'solid', 'faded', 'hidden']).optional().describe('How lines facing away from the viewer are drawn'),
    nodes: z.boolean().optional().describe('Draw dots at nodes/intersections'),
    nodeSize: z.number().optional().describe('Node dot radius, 0–40'),
    backNodes: z.boolean().optional().describe('Also draw nodes on the far side'),
    labels: z.boolean().optional().describe('Draw text labels (orbits, frame)'),
    labelSize: z.number().optional().describe('Label font size, 4–96'),
    opacity: z.number().optional().describe('0–1'),
  })
  .loose();

const layerFields = {
  name: z.string().max(80).optional().describe('Display name'),
  x: z.number().optional().describe('Centre x in artboard pixels (default: artboard centre)'),
  y: z.number().optional().describe('Centre y in artboard pixels (default: artboard centre)'),
  scale: z.number().optional().describe('Radius in pixels (default: 28% of the shorter artboard side)'),
  rx: z.number().optional().describe('Tilt in degrees, -360–360 (positive tips the top away)'),
  ry: z.number().optional().describe('Turn in degrees'),
  rz: z.number().optional().describe('Roll in degrees, -360–360'),
  perspective: z.number().optional().describe('0 = flat/orthographic, 1 = strong perspective'),
  spin: z.number().optional().describe('Auto-rotation speed in the app (degrees/second)'),
  visible: z.boolean().optional(),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .describe('Generator settings (see vectr_list_generators). Unspecified params keep their defaults'),
  style: StyleInput.optional(),
};

const LayerInput = z.object({ type: z.enum(GENERATOR_TYPES).describe('Generator type'), ...layerFields }).loose();
const LayerUpdate = z
  .object({ id: z.string().describe('Layer id from the design summary, e.g. "L2"'), ...layerFields })
  .loose()
  .describe('Only the fields you pass change; params and style are merged into the existing ones');

const DocSettings = z
  .object({
    width: z.number().optional().describe('Artboard width in px, 64–8000'),
    height: z.number().optional().describe('Artboard height in px, 64–8000'),
    theme: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]).optional().describe('Sets background, ink and roughness together'),
    background: z.string().optional().describe('Background colour, e.g. "#050505"'),
    ink: z.string().optional().describe('Default line colour'),
    rough: z.number().optional().describe('Hand-drawn wobble, 0 (crisp) – 20'),
  })
  .strict();

// ---------- Server ----------

export function createServer(config: ServerConfig) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const store = new DesignStore();

  /** Standard reply for anything that changes a design: summary, corrections, preview. */
  const designReply = (d: Design, warnings: string[], lead: string, preview: boolean, width = 640): CallToolResult => {
    const content: CallToolResult['content'] = [text(`${lead}\n\n${summarize(store, d)}${warningsBlock(warnings)}`)];
    if (preview) content.push(image(renderPNG(d.doc, width)));
    return { content, structuredContent: { design_id: d.id, warnings, design: store.compact(d) } };
  };

  server.registerTool(
    'vectr_list_generators',
    {
      title: 'List Vectr generators',
      description: `List the shape generators, their params (with ranges and defaults), the style options, themes and templates.

Call this once before designing. Pass "type" to see a single generator.

Returns markdown by default, or JSON (response_format="json") with one entry per generator:
{ type, name, description, params: [{ key, label, type, min?, max?, options?, default }], defaultTransform, defaultStyle }`,
      inputSchema: {
        type: z.enum(GENERATOR_TYPES).optional().describe('Only describe this generator'),
        response_format: ResponseFormat,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ type, response_format }) =>
      guard(() => {
        const data = describeGenerators().filter((g) => !type || g.type === type);
        return {
          content: [text(response_format === 'json' ? JSON.stringify(data, null, 2) : generatorsMarkdown(type))],
          structuredContent: { generators: data },
        };
      }),
  );

  server.registerTool(
    'vectr_create_design',
    {
      title: 'Create a Vectr design',
      description: `Start a new design and get its id plus a preview image.

Choose at most one source (omit all for a blank canvas):
  - template: a starter composition (${TEMPLATES.map((t) => t.id).join(', ')})
  - design: a JSON design, e.g. { "theme": "chalk", "width": 1000, "height": 1000, "layers": [{ "type": "sphere", "rx": 15 }] }
  - share_link: a Vectr link or code containing "#d=v1.…"
  - file_path: a saved Vectr project (.json) inside the allowed folders
"settings" (theme, size, colours) is applied on top of the source.

Invalid values are corrected and listed under "Corrections"; the call still succeeds.`,
      inputSchema: {
        name: z.string().max(80).optional().describe('A name for the design'),
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional(),
        design: z.record(z.string(), z.unknown()).optional().describe('A Vectr design object (layers optional)'),
        share_link: z.string().max(200_000).optional(),
        file_path: z.string().optional(),
        settings: DocSettings.optional(),
        preview: z.boolean().default(true).describe('Include a PNG preview'),
        preview_width: PreviewWidth,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      guard(async () => {
        const sources = (['template', 'design', 'share_link', 'file_path'] as const).filter((k) => a[k] !== undefined);
        if (sources.length > 1) throw new DesignError(`Pass only one source; got ${sources.join(' and ')}.`);
        let input: unknown = { layers: [] };
        let warnings: string[] = [];
        if (a.template) input = TEMPLATES.find((t) => t.id === a.template)!.build();
        else if (a.design) input = a.design;
        else if (a.share_link) ({ doc: input, warnings } = await decodeDoc(a.share_link.slice(a.share_link.indexOf('#') + 1)));
        else if (a.file_path) input = await config.files.read(a.file_path, ['.json']);

        const created = store.create(input, a.name);
        let d = created.design;
        warnings = [...warnings, ...created.warnings];
        if (a.settings) {
          const r = store.update(d.id, { set: a.settings });
          d = r.design;
          warnings.push(...r.warnings);
        }
        return designReply(d, warnings, `Created design \`${d.id}\`.`, a.preview, a.preview_width);
      }),
  );

  server.registerTool(
    'vectr_update_design',
    {
      title: 'Update a Vectr design',
      description: `Change a design in one atomic call and get a fresh preview. Operations are applied in this order:
  1. set: artboard settings (theme, width, height, background, ink, rough)
  2. remove_layer_ids: delete layers
  3. update_layers: change existing layers; only the fields you pass change, and params/style are merged
  4. add_layers: new layers on top (each needs "type"; everything else is optional). New ids are L1, L2… in order
  5. layer_order: every layer id, bottom → top

Example: { "design_id": "d1", "add_layers": [{ "type": "torus", "x": 300, "y": 300, "scale": 150, "rx": -60, "style": { "back": "dashed" } }],
           "update_layers": [{ "id": "L1", "params": { "rings": 4 } }] }

Corrections for invalid values are listed in the reply; the design is always left valid.`,
      inputSchema: {
        design_id: z.string(),
        set: DocSettings.optional(),
        add_layers: z.array(LayerInput).max(50).optional(),
        update_layers: z.array(LayerUpdate).max(200).optional(),
        remove_layer_ids: z.array(z.string()).max(200).optional(),
        layer_order: z.array(z.string()).max(200).optional(),
        preview: z.boolean().default(true).describe('Include a PNG preview'),
        preview_width: PreviewWidth,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      guard(() => {
        const { design, warnings } = store.update(a.design_id, a);
        return designReply(design, warnings, `Updated design \`${design.id}\`.`, a.preview, a.preview_width);
      }),
  );

  server.registerTool(
    'vectr_render_preview',
    {
      title: 'Preview a Vectr design',
      description: 'Render a design to a PNG image so you can see it. Use a larger width to inspect detail.',
      inputSchema: { design_id: z.string(), width: PreviewWidth },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ design_id, width }) =>
      guard(() => {
        const d = store.get(design_id);
        return { content: [image(renderPNG(d.doc, width)), text(`${d.name} (${d.id}), ${d.doc.width}×${d.doc.height}`)] };
      }),
  );

  server.registerTool(
    'vectr_get_design',
    {
      title: 'Get a Vectr design',
      description: `Describe a design: artboard settings and every layer with its id, position, rotation and non-default params.
response_format "json" returns the compact design JSON (defaults omitted), which can be passed back to vectr_create_design.`,
      inputSchema: { design_id: z.string(), response_format: ResponseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ design_id, response_format }) =>
      guard(() => {
        const d = store.get(design_id);
        const compact = store.compact(d);
        return {
          content: [text(response_format === 'json' ? JSON.stringify(compact, null, 2) : summarize(store, d))],
          structuredContent: { design_id: d.id, name: d.name, design: compact },
        };
      }),
  );

  server.registerTool(
    'vectr_list_designs',
    {
      title: 'List Vectr designs',
      description: 'List the designs open in this session, most recently changed first. Designs live in memory until the server stops; export anything worth keeping.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () =>
      guard(() => {
        const list = store.list().map((d) => ({ design_id: d.id, name: d.name, width: d.doc.width, height: d.doc.height, layers: d.doc.layers.length }));
        const md = list.length
          ? list.map((d) => `- \`${d.design_id}\` ${d.name}: ${d.width}×${d.height}, ${d.layers} layer${d.layers === 1 ? '' : 's'}`).join('\n')
          : 'No designs yet. Create one with vectr_create_design.';
        return { content: [text(md)], structuredContent: { designs: list } };
      }),
  );

  server.registerTool(
    'vectr_export_design',
    {
      title: 'Export a Vectr design',
      description: `Export a design.
  - "link": a URL that opens the design in the Vectr app, where the user can keep editing it. Best for handing work to a person.
  - "svg": vector file. Returned inline, or written to file_path (required above ${CHARACTER_LIMIT.toLocaleString('en-US')} characters)
  - "png": raster image written to file_path (png_scale × artboard size)
  - "json": Vectr project file (opens via File → Open in the app). Returned inline or written to file_path
file_path must be inside the allowed folders: ${config.files.describe()}`,
      inputSchema: {
        design_id: z.string(),
        format: z.enum(['link', 'svg', 'png', 'json']),
        file_path: z.string().optional().describe('Where to write the file (.svg, .png or .json)'),
        png_scale: z.number().min(0.25).max(4).default(2).describe('PNG resolution multiplier'),
        base_url: z.string().url().optional().describe(`Vectr app URL for links (default ${config.appUrl})`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      guard(async () => {
        const d = store.get(a.design_id);
        const write = async (data: string | Uint8Array, ext: string) => {
          const p = await config.files.write(a.file_path!, data, [ext]);
          return { content: [text(`Wrote ${p}`)], structuredContent: { path: p } };
        };
        switch (a.format) {
          case 'link': {
            const base = a.base_url ?? config.appUrl;
            if (!/^https?:\/\//i.test(base)) throw new DesignError('base_url must be an http(s) URL');
            const url = await shareURL(d.doc, base);
            return { content: [text(url)], structuredContent: { url } };
          }
          case 'png': {
            if (!a.file_path) throw new DesignError('format "png" needs a file_path. To just look at the design, use vectr_render_preview.');
            return write(renderPNG(d.doc, d.doc.width * a.png_scale), '.png');
          }
          case 'svg':
          case 'json': {
            const body = a.format === 'svg' ? docToSVG(d.doc) : serializeDoc(d.doc);
            if (a.file_path) return write(body, `.${a.format}`);
            if (body.length > CHARACTER_LIMIT) {
              throw new DesignError(`The ${a.format.toUpperCase()} is ${body.length.toLocaleString('en-US')} characters, too large to return inline. Pass file_path to write it to disk.`);
            }
            return { content: [text(body)] };
          }
        }
      }),
  );

  server.registerTool(
    'vectr_delete_design',
    {
      title: 'Delete a Vectr design',
      description: 'Discard a design from this session. This cannot be undone; export it first if it might be needed.',
      inputSchema: { design_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ design_id }) =>
      guard(() => {
        store.delete(design_id);
        return { content: [text(`Deleted design ${design_id}.`)] };
      }),
  );

  return server;
}

/** Validate a design without storing it (used by tests and handy for scripting). */
export const validate = (input: unknown) => parseDoc(input);
