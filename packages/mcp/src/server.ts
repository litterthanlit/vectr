import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ELEMENTS, MAX_OPS, RECIPES, STYLE_PARAMS, THEMES, decodeDoc, describeBlocks, docToSVG, serializeDoc, shareURL, type Doc } from '@vectr/core';
import { z } from 'zod';
import { DesignError, DesignStore, type Design } from './designs.js';
import { FileAccessError, Files } from './files.js';
import { BLOCK_KINDS, OP_KINDS, SOURCE_KINDS, blocksMarkdown, summarize, warningsBlock } from './format.js';
import { renderPNG } from './preview.js';

export const SERVER_NAME = 'vectr-mcp-server';
export const SERVER_VERSION = '0.3.0';

/** Inline SVG/JSON above this size must be written to a file instead. */
export const CHARACTER_LIMIT = 60_000;

export interface ServerConfig {
  files: Files;
  /** Base URL of the Vectr app, used for share links. */
  appUrl: string;
}

const oneOf = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs.join(''));
const ELEMENT_IDS = ELEMENTS.map((e) => e.id) as [string, ...string[]];

const INSTRUCTIONS = `Vectr composes generative vector art. Each form is a source (${oneOf(SOURCE_KINDS)}) run through a stack of operators (${OP_KINDS.join(', ')}), then styled: line weight and colour ramp by depth, fading hidden lines, solid, dotted or dashed lines, ribbon or closed-shape fills (which can knock out what is behind), markers and labels.

Workflow:
1. vectr_list_building_blocks once to learn sources, operators, elements and their params.
2. vectr_create_design, blank or from a recipe, JSON, share link or project file. It returns a design_id and a preview image.
3. vectr_update_design to add or change forms and their operator stacks, or to drop in ready-made elements with add_elements. Every call returns a fresh preview; look at it and iterate.
4. vectr_mutate_design to explore variations of a form, then apply the one you like.
5. vectr_export_design to deliver. "link" opens the design in the Vectr app for the user to keep editing; "svg", "png" and "json" write files.

Tips:
- A circle or arc revolved makes a sphere or torus (use revolve.offset); a wave repeated in depth with fill "ribbons" makes strata; points connected with k-nearest make constellations.
- Beaded globe: curve arc (start -90, sweep 180) → revolve → resample (mode dots, keepLines true), style markers "dot".
- Dials and rulers: a circle or line → ticks (majorEvery for long marks, vary "wave" for rhythm), flat (rx 0, ry 0, perspective 0).
- Use the orbits source for orbital shells and gimbals, and the card source for captions (multi-line text that wraps to the card).
- Context (what an agent sees): the context source makes a field of token blocks, from pasted text (each word a block, highlight words relevant) or generated (layout window, burst or radial). Blocks need style fill "shapes"; colorBy "family" with a 2-stop ramp, grey then an accent, lights up the relevant tokens. Attention is connect mode "focus" (threads from the tokens to fx, fy, fz; split gives fans above and below, which "relevant" threads only the relevant tokens). Tilt with ry and perspective for a stream.
- Strips (context as hyphenated ribbons): the strip source draws rows of slabs joined by thinner necks, from a pattern (mode "pattern": '#' slab, '-' neck, space or '.' gap, a new line a new row), generated rows (mode "generate") or pasted text (mode "text": a word is a slab, a space a neck, a sentence end a gap). Use style fill "shapes"; colorBy "family" with a 2-stop ramp, grey then an accent, colours the relevant slabs. For attention add connect mode "focus" with which "relevant". ramp, neckAlign, startEnd and finishEnd (square, slant, round) shape the joints and ends.
- Cards: ALWAYS keep them flat (rx 0, ry 0, perspective 0), set style fill "shapes" with knockout true to hide the lines behind, and labelFont "sans". labelColor sets the colour of text and card icons.
- Line weight is per form, so layer several forms for hierarchy: a thick limb or bezel with a hairline grid, graduations or dotted rings on top.
- Elements (${ELEMENT_IDS.join(', ')}) are ready-made multi-form pieces: add_elements: [{ "id": "dial", "x": 400, "y": 450, "size": 0.6 }] places one scaled to the artboard (size multiplies it, default 1; centred unless x, y are given). Then refine its forms with update_forms.
- Place forms with x,y (artboard px) and size them with scale (radius in px). Invalid values are clamped or dropped and listed under "Corrections" rather than failing; read them and fix your input.`;

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

/** The values of a select style option, straight from the engine, so a new option is never rejected here. */
function styleOptions(key: string): [string, ...string[]] {
  const def = STYLE_PARAMS.find((p) => p.key === key);
  if (def?.kind !== 'select') throw new Error(`Style option "${key}" is not a select`);
  return def.options.map((o) => o.value) as [string, ...string[]];
}
const styleEnum = (key: string) => z.enum(styleOptions(key));

const StyleInput = z
  .object({
    width: z.number().optional().describe('Line weight in px. One weight per form: layer forms for thick and thin'),
    dash: styleEnum('dash').optional().describe('Line pattern on lines facing you: solid, dotted or dashed'),
    taper: styleEnum('taper').optional().describe('Thin and lighten lines with depth, or along each line'),
    taperAmount: z.number().optional().describe('0–1'),
    color: styleEnum('color').optional(),
    colorBy: styleEnum('colorBy').optional().describe('What the ramp follows: depth, position along each line, or copy/ring index'),
    stroke: z.string().nullable().optional().describe('Solid colour (hex) when color is "solid"; null = first ramp stop'),
    ramp: z.array(z.string()).nullable().optional().describe('This form\'s own ramp (hex stops); null = document ramp'),
    hidden: styleEnum('hidden').optional().describe('How lines facing away are drawn'),
    fill: styleEnum('fill').optional().describe('"ribbons": translucent bands between neighbouring lines. "shapes": fills closed shapes (circles, cards)'),
    fillOpacity: z.number().optional(),
    knockout: z.boolean().optional().describe('With a fill: paint the background under it so forms beneath are hidden'),
    markers: styleEnum('markers').optional(),
    markerSize: z.number().optional(),
    markerEvery: z.number().optional(),
    markersByDepth: z.boolean().optional(),
    labels: z.boolean().optional(),
    labelSize: z.number().optional(),
    labelFont: styleEnum('labelFont').optional().describe('Label typeface: mono, sans or serif'),
    labelColor: z.string().nullable().optional().describe('Colour (hex) of labels and card icons; null = colour of the nearest lines'),
    opacity: z.number().optional(),
    finish: styleEnum('finish').optional().describe('A material for the whole form: ink fuses nearby pieces into solid ink with torn edges and spatter, grain speckles it like dry brush or print, rough wobbles the edges. Default clean'),
    finishAmount: z.number().optional().describe('0–1, how strongly the finish works'),
    finishScale: z.number().optional().describe('0.2–4, the size of the finish features; 1 suits an artboard 1000 to 1600 px wide'),
    finishSeed: z.number().optional().describe('1–999'),
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

const ElementInput = z
  .object({
    id: z.enum(ELEMENT_IDS).describe('Which element (see vectr_list_building_blocks)'),
    x: z.number().optional().describe('Centre x in artboard px (default: centre)'),
    y: z.number().optional().describe('Centre y in artboard px (default: centre)'),
    size: z.number().min(0.05).max(10).optional().describe('Multiplier on the element\'s size, spacing and label size (default 1; 0.5 = half)'),
  })
  .strict();

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
      description: `Describe the sources, operators and style options (every param with its range and default), plus themes, recipes and elements (ready-made multi-form pieces for vectr_update_design → add_elements).

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
  5. add_elements: ready-made multi-form pieces (${ELEMENT_IDS.join(', ')}) on top of those, with the next ids in order. Each is { "id", "x"?, "y"?, "size"? }:
     centred on the artboard unless x, y are given, scaled to the artboard, and "size" multiplies it (default 1). The reply lists the ids it created; refine them with update_forms
  6. form_order: every form id, bottom → top

Example: { "design_id": "d1", "add_forms": [{ "source": { "kind": "points", "params": { "count": 120 } }, "ops": [{ "kind": "connect", "params": { "k": 3, "bow": 0.5 } }], "style": { "markers": "dot" } }],
           "add_elements": [{ "id": "dial", "x": 300, "y": 450, "size": 0.5 }],
           "update_forms": [{ "id": "F1", "ops_patch": [{ "action": "add", "kind": "warp", "params": { "kind": "twist", "amount": 0.8 } }] }] }`,
      inputSchema: {
        design_id: z.string(),
        set: DocSettings.optional(),
        add_forms: z.array(FormInput).max(50).optional(),
        add_elements: z.array(ElementInput).max(20).optional().describe('Ready-made pieces to place on top (each adds several forms)'),
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
        const { design, warnings, placed } = store.update(a.design_id, a);
        const added = placed.map((p) => `${p.element} (${p.formIds.length > 1 ? `${p.formIds[0]}–${p.formIds[p.formIds.length - 1]}` : p.formIds[0]})`);
        const lead = `Updated design \`${design.id}\`.${added.length ? ` Added elements: ${added.join(', ')}.` : ''}`;
        const r = designReply(design, warnings, lead, a.preview, a.preview_width);
        return { ...r, structuredContent: { ...r.structuredContent, ...(placed.length ? { placed } : {}) } };
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
Long text (a card's caption) is shortened in the summary. response_format "json" returns the compact design JSON (defaults omitted, text whole), which can be passed back to vectr_create_design.`,
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
