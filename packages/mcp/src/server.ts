import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BLOCK_SOURCES, MAX_OPS, OPERATORS, RECIPES, SHAPE_SOURCES, THEMES, decodeDoc, describeBlocks, docToSVG, serializeDoc, shareURL, type Doc } from '@vectr/core';
import { z } from 'zod';
import { DesignError, DesignStore, type Design } from './designs.js';
import { FileAccessError, Files } from './files.js';
import { BLOCK_KINDS, OP_KINDS, SOURCE_KINDS, blocksMarkdown, summarize, warningsBlock } from './format.js';
import { renderPNG } from './preview.js';

export const SERVER_NAME = 'vectr-mcp-server';
export const SERVER_VERSION = '0.2.0';

/** Inline SVG/JSON above this size must be written to a file instead. */
export const CHARACTER_LIMIT = 60_000;

export interface ServerConfig {
  files: Files;
  /** Base URL of the Vectr app, used for share links. */
  appUrl: string;
}

const INSTRUCTIONS = `Vectr composes generative vector art. Each form is a source (a ready-made shape: ${SHAPE_SOURCES.map((s) => s.kind).join(', ')}; or a bare block: ${BLOCK_SOURCES.map((s) => s.kind).join(', ')}) run through a stack of operators (${OPERATORS.map((o) => o.kind).join(', ')}), then styled: line weight and colour ramp by depth, fading hidden lines, ribbon fills and markers.

Workflow:
1. vectr_list_building_blocks once to learn sources, operators and their params.
2. vectr_create_design, blank or from a recipe, JSON, share link or project file. It returns a design_id and a preview image.
3. vectr_update_design to add or change forms and their operator stacks. Every call returns a fresh preview; look at it and iterate.
4. vectr_mutate_design to explore variations of a form, then apply the one you like.
5. vectr_export_design to deliver. "link" opens the design in the Vectr app for the user to keep editing; "svg", "png" and "json" write files.

Tips: ready-made shapes read best in the plain ink look: style {"color":"solid","taper":"none","hidden":"dotted","markers":"dot","markersByDepth":false} (the "field-study" recipe shows five side by side). A circle or arc revolved makes a sphere or torus (use revolve.offset); a wave repeated in depth with fill "ribbons" makes strata; points connected with k-nearest make constellations; the formula source takes your own x(t), y(t), z(t) or x(u,v)… expressions (maths only: + - * / ^, sin, cos, noise…, variables t or u v, and sliders a b c); hatch fills closed outlines; extrude turns flat outlines into prisms. Place forms with x,y (artboard px) and size them with scale (radius in px). Invalid values are clamped or dropped and listed under "Corrections" rather than failing; read them and fix your input.`;

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
const Params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]));

const StyleInput = z
  .object({
    width: z.number().optional().describe('Line weight in px'),
    taper: z.enum(['none', 'depth', 't']).optional().describe('Thin and lighten lines with depth, or along each line'),
    taperAmount: z.number().optional().describe('0–1'),
    color: z.enum(['ramp', 'solid']).optional(),
    colorBy: z.enum(['depth', 't', 'family']).optional().describe('What the ramp follows: depth, position along each line, or copy/ring index'),
    stroke: z.string().nullable().optional().describe('Solid colour (hex) when color is "solid"; null = last, strongest ramp stop'),
    ramp: z.array(z.string()).nullable().optional().describe('This form\'s own ramp (hex stops); null = document ramp'),
    hidden: z.enum(['fade', 'dotted', 'dashed', 'solid', 'hide']).optional().describe('How lines facing away are drawn'),
    fill: z.enum(['none', 'ribbons']).optional().describe('Translucent bands between neighbouring lines'),
    fillOpacity: z.number().optional(),
    markers: z.enum(['none', 'dot', 'ring', 'cross', 'tick']).optional(),
    markerSize: z.number().optional(),
    markerEvery: z.number().optional(),
    markersByDepth: z.boolean().optional(),
    labels: z.boolean().optional(),
    labelSize: z.number().optional(),
    opacity: z.number().optional(),
  })
  .loose();

const transformFields = {
  name: z.string().max(80).optional().describe('Display name'),
  x: z.number().optional().describe('Centre x in artboard px (default: centre)'),
  y: z.number().optional().describe('Centre y in artboard px (default: centre)'),
  scale: z.number().optional().describe('Radius in px (default: 30% of the shorter side)'),
  rx: z.number().optional().describe('Tilt in degrees (negative tips the top toward you)'),
  ry: z.number().optional().describe('Turn in degrees'),
  rz: z.number().optional().describe('Roll in degrees'),
  perspective: z.number().optional().describe('0 = flat, 1 = strong perspective'),
  spin: z.number().optional().describe('Auto-rotation in the app, degrees/second'),
  visible: z.boolean().optional(),
};

const OpInput = z
  .object({ kind: z.enum(OP_KINDS), params: Params.optional().describe('Operator settings; unspecified ones use defaults'), enabled: z.boolean().optional() })
  .loose();

const FormInput = z
  .object({
    source: z.object({ kind: z.enum(SOURCE_KINDS), params: Params.optional() }).loose().describe('What the form starts from'),
    ops: z.array(OpInput).max(MAX_OPS).optional().describe('Operators, applied top to bottom'),
    style: StyleInput.optional(),
    ...transformFields,
  })
  .loose();

const OpPatch = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), kind: z.enum(OP_KINDS), params: Params.optional(), index: z.number().int().optional().describe('Insert position (default: end)') }),
  z.object({ action: z.literal('update'), index: z.number().int(), params: Params.optional(), enabled: z.boolean().optional() }),
  z.object({ action: z.literal('remove'), index: z.number().int() }),
  z.object({ action: z.literal('move'), index: z.number().int(), to: z.number().int() }),
]);

const FormUpdate = z
  .object({
    id: z.string().describe('Form id from the summary, e.g. "F2"'),
    source_params: Params.optional().describe('Merged into the current source params'),
    source: z.object({ kind: z.enum(SOURCE_KINDS), params: Params.optional() }).optional().describe('Replace the source entirely'),
    ops: z.array(OpInput).max(MAX_OPS).optional().describe('Replace the whole operator stack'),
    ops_patch: z.array(OpPatch).max(24).optional().describe('Edit the stack in place; indexes start at 0 and apply in order'),
    style: StyleInput.optional().describe('Merged into the current style'),
    ...transformFields,
  })
  .loose();

const DocSettings = z
  .object({
    width: z.number().optional().describe('Artboard width in px, 64–8000'),
    height: z.number().optional().describe('Artboard height in px, 64–8000'),
    theme: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]).optional().describe('Sets background and ramp together'),
    background: z.string().optional().describe('Background colour, e.g. "#111214"'),
    ramp: z.array(z.string()).optional().describe('Document colour ramp, 1–6 hex stops, far → near'),
    rough: z.number().optional().describe('Hand-drawn wobble, 0–20'),
  })
  .strict();

const STRENGTH = { subtle: 0.12, medium: 0.3, wild: 0.65 } as const;

// ---------- Server ----------

export function createServer(config: ServerConfig) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const store = new DesignStore();

  const designReply = (d: Design, warnings: string[], lead: string, preview: boolean, width = 640): CallToolResult => {
    const content: CallToolResult['content'] = [text(`${lead}\n\n${summarize(store, d)}${warningsBlock(warnings)}`)];
    if (preview) content.push(image(renderPNG(d.doc, width)));
    return { content, structuredContent: { design_id: d.id, warnings, design: store.compact(d) } };
  };

  server.registerTool(
    'vectr_list_building_blocks',
    {
      title: 'List Vectr building blocks',
      description: `Describe the sources, operators and style options (every param with its range and default), plus themes and recipes.

Call this once before designing. Pass "block" to see one source or operator (or "style").
Params marked "only when" apply only for certain values of another param (e.g. curve "turns" only for shape "spiral").`,
      inputSchema: { block: z.enum(BLOCK_KINDS).optional().describe('Only describe this block'), response_format: ResponseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ block, response_format }) =>
      guard(() => {
        const all = describeBlocks();
        const data = block
          ? { sources: all.sources.filter((s) => s.kind === block), operators: all.operators.filter((o) => o.kind === block), ...(block === 'style' ? { style: all.style } : {}) }
          : all;
        return { content: [text(response_format === 'json' ? JSON.stringify(data, null, 2) : blocksMarkdown(block))], structuredContent: data };
      }),
  );

  server.registerTool(
    'vectr_create_design',
    {
      title: 'Create a Vectr design',
      description: `Start a new design and get its id plus a preview image.

Choose at most one source (omit all for a blank canvas):
  - recipe: a starter (${RECIPES.map((t) => t.id).join(', ')})
  - design: JSON, e.g. { "theme": "ozone", "forms": [{ "source": { "kind": "curve", "params": { "shape": "arc", "start": -90, "sweep": 180 } }, "ops": [{ "kind": "revolve" }], "rx": -20 }] }
  - share_link: a Vectr link or code containing "#d=v2.…" (v1 links work too)
  - file_path: a saved Vectr project (.json) inside the allowed folders; v1 projects are converted
"settings" (theme, size, colours) is applied on top of the source.`,
      inputSchema: {
        name: z.string().max(80).optional().describe('A name for the design'),
        recipe: z.enum(RECIPES.map((t) => t.id) as [string, ...string[]]).optional(),
        design: z.record(z.string(), z.unknown()).optional().describe('A Vectr design object (forms optional)'),
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
        const sources = (['recipe', 'design', 'share_link', 'file_path'] as const).filter((k) => a[k] !== undefined);
        if (sources.length > 1) throw new DesignError(`Pass only one source; got ${sources.join(' and ')}.`);
        let input: unknown = { forms: [] };
        let warnings: string[] = [];
        if (a.recipe) input = RECIPES.find((t) => t.id === a.recipe)!.build();
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
      description: `Change a design in one atomic call and get a fresh preview. Applied in this order:
  1. set: artboard settings (theme, width, height, background, ramp, rough)
  2. remove_form_ids
  3. update_forms: only fields you pass change. source_params and style merge; "ops" replaces the stack; "ops_patch" edits it
     ({ "action": "add", "kind": "warp", "params": {…} } | { "action": "update", "index": 0, "params": {…} } | { "action": "remove", "index": 1 } | { "action": "move", "index": 2, "to": 0 })
  4. add_forms: new forms on top (ids F1, F2… in order). Each needs source.kind
  5. form_order: every form id, bottom → top

Example: { "design_id": "d1", "add_forms": [{ "source": { "kind": "points", "params": { "count": 120 } }, "ops": [{ "kind": "connect", "params": { "k": 3, "bow": 0.5 } }], "style": { "markers": "dot" } }],
           "update_forms": [{ "id": "F1", "ops_patch": [{ "action": "add", "kind": "warp", "params": { "kind": "twist", "amount": 0.8 } }] }] }`,
      inputSchema: {
        design_id: z.string(),
        set: DocSettings.optional(),
        add_forms: z.array(FormInput).max(50).optional(),
        update_forms: z.array(FormUpdate).max(200).optional(),
        remove_form_ids: z.array(z.string()).max(200).optional(),
        form_order: z.array(z.string()).max(200).optional(),
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
    'vectr_mutate_design',
    {
      title: 'Mutate a Vectr form',
      description: `Explore variations of one form: its params are nudged and operators occasionally added, removed or swapped.
Without "apply": returns "count" numbered previews (the rest of the design unchanged) and keeps them.
With "apply": n, the n-th variation from the last call replaces the form. Any other update discards pending variations.`,
      inputSchema: {
        design_id: z.string(),
        form_id: z.string().describe('Form id, e.g. "F1"'),
        count: z.number().int().min(1).max(8).default(4),
        strength: z.enum(['subtle', 'medium', 'wild']).default('medium'),
        seed: z.number().int().min(1).max(1_000_000).optional().describe('Repeat a batch by reusing its seed'),
        apply: z.number().int().min(1).max(8).optional().describe('Apply variation n from the previous call'),
        preview_width: z.number().int().min(128).max(1200).default(360),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      guard(() => {
        if (a.apply !== undefined) {
          const d = store.applyVariation(a.design_id, a.form_id, a.apply);
          return designReply(d, [], `Applied variation ${a.apply} to \`${a.form_id}\`.`, true, 640);
        }
        const seed = a.seed ?? Math.floor(Math.random() * 1_000_000) + 1;
        const { design, forms } = store.mutate(a.design_id, a.form_id, a.count, STRENGTH[a.strength], seed);
        const content: CallToolResult['content'] = [
          text(`${forms.length} variations of \`${a.form_id}\` (seed ${seed}). Apply one with { "apply": n }.`),
        ];
        forms.forEach((f, i) => {
          const doc: Doc = { ...design.doc, forms: design.doc.forms.map((x) => (x.id === a.form_id ? { ...f, id: x.id } : x)) };
          content.push(text(`Variation ${i + 1}: ${f.source.kind} → ${f.ops.filter((o) => o.enabled).map((o) => o.kind).join(' → ') || '(no operators)'}`));
          content.push(image(renderPNG(doc, a.preview_width)));
        });
        return { content, structuredContent: { seed, count: forms.length } };
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
      description: `Describe a design: artboard settings and every form with its id, source, operator stack (with indexes for ops_patch) and non-default style.
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
        const list = store.list().map((d) => ({ design_id: d.id, name: d.name, width: d.doc.width, height: d.doc.height, forms: d.doc.forms.length }));
        const md = list.length
          ? list.map((d) => `- \`${d.design_id}\` ${d.name}: ${d.width}×${d.height}, ${d.forms} form${d.forms === 1 ? '' : 's'}`).join('\n')
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
