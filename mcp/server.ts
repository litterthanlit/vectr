#!/usr/bin/env node
/**
 * Vectr MCP server: lets agents draw and edit vector artwork point by point.
 *
 *   npx tsx mcp/server.ts            (stdio transport)
 *
 * Env: VECTR_FILE  document path (default ~/.vectr/document.json)
 *      VECTR_PORT  live bridge port for the browser app (default 7331, 0 = off)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  applyEdits, cleanLayer, describePath, findLayer, geometryFromInput, summarizeDoc, summarizeLayer, type EditOp, type GeometryInput,
} from '../src/lib/agent-ops';
import { docToSVG } from '../src/lib/export';
import { GENERATORS, createLayer, generatorFor, uid } from '../src/lib/generators';
import {
  anchorCount, ellipsePath, pathBounds, pathStats, polygonPath, rectPath, simplifyPath, starPath, transformPath, cleanupPath,
  type VectorPath,
} from '../src/lib/path';
import { importSVG } from '../src/lib/svg-import';
import { THEMES } from '../src/lib/templates';
import type { Doc, Layer, LayerStyle } from '../src/lib/types';
import { convertToPaths, createPathLayer, isPathLayer } from '../src/lib/vector-layer';
import { startBridge } from './bridge';
import { DocStore } from './doc-store';
import { renderPreview } from './preview';

const FILE = resolve(process.env.VECTR_FILE ?? join(homedir(), '.vectr', 'document.json'));
const PORT = Number(process.env.VECTR_PORT ?? 7331);

const store = new DocStore(FILE);
const bridge = PORT > 0 ? startBridge(store, PORT, (process.env.VECTR_ORIGINS ?? '').split(',').filter(Boolean)) : null;

const INSTRUCTIONS = `Vectr is a vector canvas you draw on with editable Bézier paths.

Coordinates: artboard pixels, origin top-left, y grows downward. Call get_canvas first for the size.
Workflow that produces clean, designer-ready vectors:
1. Plan the composition as a few large shapes, then details. One layer per meaningful part (e.g. "Leaf", "Stem"), named — names become layer names in Figma.
2. Draw with draw_shape (primitives) or draw_path. For organic curves prefer points + smooth:true (a curve passes through each point) over hand-computing handles. Use as few points as the shape needs.
3. Look at your work with render_preview (show_points:true reveals anchors as [subpath:index], squares = corners, circles = smooth).
4. Refine precisely with edit_path (move/set/insert/delete anchors, change corner↔smooth), or clean_path to refit messy geometry into minimal smooth anchors.
5. import_svg brings in SVG from anywhere (another model, QuiverAI, an icon set) as editable paths; follow with clean_path.
A designer may be editing the same canvas live in the Vectr app: re-read with get_canvas/get_path before editing layers you have not just created.`;

const server = new McpServer({ name: 'vectr', version: '0.2.0' }, { instructions: INSTRUCTIONS });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const text = (v: unknown): { content: Content[] } => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }],
});
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true });

/** Wrap a handler so thrown errors become tool errors the agent can read and recover from. */
function safe<A>(fn: (a: A) => Promise<{ content: Content[] }> | { content: Content[] }) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return fail(e);
    }
  };
}

const vec2 = z.array(z.number()).length(2).describe('[x, y] in artboard pixels');
const color = z.string().describe('CSS colour, e.g. "#1f1f1f". Use "ink" for the document ink colour, "none" for no paint.');

const styleShape = {
  fill: color.optional().describe('Fill colour (default "none"). Closed shapes only look filled.'),
  stroke: color.optional().describe('Stroke colour (default "ink").'),
  stroke_width: z.number().min(0).max(200).optional().describe('Stroke width in px (default 2; 0 = no stroke).'),
  opacity: z.number().min(0).max(1).optional(),
};

function styleFrom(a: { fill?: string; stroke?: string; stroke_width?: number; opacity?: number }): Partial<LayerStyle> {
  const s: Partial<LayerStyle> = {};
  if (a.fill !== undefined) s.fill = a.fill === 'none' ? null : a.fill === 'ink' ? store.doc.ink : a.fill;
  if (a.stroke !== undefined) {
    if (a.stroke === 'none') s.width = 0;
    else s.stroke = a.stroke === 'ink' ? null : a.stroke;
  }
  if (a.stroke_width !== undefined) s.width = a.stroke_width;
  if (a.opacity !== undefined) s.opacity = a.opacity;
  return s;
}

const replaceLayer = (d: Doc, l: Layer): Doc => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? l : x)) });
const addLayers = (d: Doc, ls: Layer[]): Doc => ({ ...d, layers: [...d.layers, ...ls] });

function pathResult(layer: Layer, verbose = true) {
  const desc = describePath(layer);
  // Keep responses compact for big paths; the agent can call get_path for everything.
  return verbose && desc.stats.anchors <= 60 ? desc : { id: desc.id, name: desc.name, bbox: desc.bbox, stats: desc.stats, note: 'Call get_path for anchor details.' };
}

function addPath(abs: VectorPath, name: string, style: Partial<LayerStyle>, cleanTolerance?: number) {
  let path = abs;
  if (cleanTolerance && cleanTolerance > 0) path = cleanupPath(simplifyPath(path, { tolerance: cleanTolerance }));
  const layer = createPathLayer(path, { name, style });
  store.mutate((d) => addLayers(d, [layer]), `Drew “${name}”`, [layer.id]);
  return layer;
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

server.registerTool(
  'get_canvas',
  {
    title: 'Get canvas',
    description: 'Artboard size, colours and every layer (id, name, type, bounding box, anchor count). Call this first, and again before editing layers a designer may have touched.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe(() => text({ ...summarizeDoc(store.doc), liveDesigners: bridge?.connected ?? 0 })),
);

server.registerTool(
  'set_canvas',
  {
    title: 'Set canvas',
    description: `Change artboard size or colours. Themes: ${THEMES.map((t) => t.id).join(', ')}.`,
    inputSchema: {
      width: z.number().int().min(16).max(8000).optional(),
      height: z.number().int().min(16).max(8000).optional(),
      background: z.string().optional(),
      ink: z.string().optional().describe('Default stroke colour for layers whose stroke is "ink".'),
      theme: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]).optional(),
      hand_drawn: z.number().min(0).max(8).optional().describe('Hand-drawn wobble amount (0 = crisp).'),
    },
  },
  safe((a) => {
    store.mutate((d) => {
      const t = a.theme ? THEMES.find((x) => x.id === a.theme) : undefined;
      return {
        ...d,
        ...(t && { background: t.background, ink: t.ink, rough: t.rough }),
        ...(a.width && { width: a.width }),
        ...(a.height && { height: a.height }),
        ...(a.background && { background: a.background }),
        ...(a.ink && { ink: a.ink }),
        ...(a.hand_drawn !== undefined && { rough: a.hand_drawn }),
      };
    }, 'Updated the canvas');
    return text(summarizeDoc(store.doc));
  }),
);

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const absAnchor = z.object({
  x: z.number(),
  y: z.number(),
  in: vec2.nullable().optional().describe('Absolute position of the incoming handle (omit/null = none).'),
  out: vec2.nullable().optional().describe('Absolute position of the outgoing handle (omit/null = none).'),
  kind: z.enum(['corner', 'smooth', 'symmetric']).optional(),
});

const geometryShape = {
  d: z.string().optional().describe('SVG path data (any commands, absolute or relative).'),
  points: z.array(vec2).optional().describe('Points to connect. With smooth:true a curve passes through each one.'),
  smooth: z.boolean().optional().describe('Pass a smooth curve through `points` instead of straight lines.'),
  anchors: z.array(absAnchor).optional().describe('Explicit anchors with absolute handle positions.'),
  closed: z.boolean().optional().describe('Close the shape (for points/anchors).'),
};

server.registerTool(
  'draw_path',
  {
    title: 'Draw path',
    description:
      'Create an editable vector path layer. Give exactly one of: `d` (SVG path data), `points` (+ smooth), or `anchors` (with absolute handles). Returns the anchors as [subpath, index] refs for edit_path.',
    inputSchema: {
      name: z.string().optional().describe('Layer name, e.g. "Leaf" (becomes the layer name in Figma).'),
      ...geometryShape,
      fill_rule: z.enum(['nonzero', 'evenodd']).optional().describe('evenodd makes inner subpaths cut holes.'),
      clean: z.number().min(0).max(20).optional().describe('Refit to minimal anchors within this tolerance (px) after drawing.'),
      ...styleShape,
    },
  },
  safe((a) => {
    const abs = geometryFromInput(a as GeometryInput);
    if (a.fill_rule) abs.fillRule = a.fill_rule;
    const layer = addPath(abs, a.name ?? 'Path', styleFrom(a), a.clean);
    return text(pathResult(layer));
  }),
);

server.registerTool(
  'draw_shape',
  {
    title: 'Draw shape',
    description: 'Draw a primitive as an editable path: rect (optional corner radius), ellipse, polygon or star, fitted to a box.',
    inputSchema: {
      shape: z.enum(['rect', 'ellipse', 'polygon', 'star']),
      x: z.number().describe('Left edge of the box.'),
      y: z.number().describe('Top edge of the box.'),
      width: z.number().positive(),
      height: z.number().positive().optional().describe('Defaults to width.'),
      radius: z.number().min(0).optional().describe('rect: corner radius.'),
      sides: z.number().int().min(3).max(64).optional().describe('polygon sides / star points (default 6 / 5).'),
      inner_ratio: z.number().min(0.05).max(0.95).optional().describe('star: inner radius ÷ outer (default 0.5).'),
      rotation: z.number().optional().describe('Degrees, clockwise.'),
      name: z.string().optional(),
      ...styleShape,
    },
  },
  safe((a) => {
    const w = a.width, h = a.height ?? a.width;
    const cx = a.x + w / 2, cy = a.y + h / 2;
    let p: VectorPath;
    switch (a.shape) {
      case 'rect': p = rectPath(a.x, a.y, w, h, a.radius ?? 0); break;
      case 'ellipse': p = ellipsePath(cx, cy, w / 2, h / 2); break;
      case 'polygon': p = polygonPath(0, 0, 1, a.sides ?? 6); break;
      case 'star': p = starPath(0, 0, 1, a.inner_ratio ?? 0.5, a.sides ?? 5); break;
    }
    if (a.shape === 'polygon' || a.shape === 'star') p = transformPath(p, [w / 2, 0, 0, h / 2, cx, cy]);
    if (a.rotation) {
      const t = (a.rotation * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      p = transformPath(p, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
    }
    const name = a.name ?? a.shape[0].toUpperCase() + a.shape.slice(1);
    const style = styleFrom(a);
    const layer = addPath(p, name, style);
    return text(pathResult(layer));
  }),
);

server.registerTool(
  'import_svg',
  {
    title: 'Import SVG',
    description:
      'Import SVG markup (from another model such as QuiverAI, Figma, an icon set…) as editable path layers, one per element. Optionally fit it into a box and refit messy geometry. Text, images and gradients are not imported (gradients become flat colour).',
    inputSchema: {
      svg: z.string().describe('Full <svg> markup.'),
      x: z.number().optional().describe('Fit box left (default: keep original coordinates).'),
      y: z.number().optional(),
      width: z.number().positive().optional().describe('Fit box width; height follows the aspect ratio unless given.'),
      height: z.number().positive().optional(),
      clean: z.number().min(0).max(20).optional().describe('Refit each shape to minimal anchors within this tolerance (px).'),
      name_prefix: z.string().optional(),
    },
  },
  safe((a) => {
    const r = importSVG(a.svg);
    if (!r.shapes.length) throw new Error(`No drawable shapes found. ${r.warnings.join(' ')}`);
    let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    if (a.width || a.height || a.x !== undefined || a.y !== undefined) {
      const src = r.viewBox ?? (() => {
        const all = r.shapes.map((s) => pathBounds(s.path));
        const x0 = Math.min(...all.map((b) => b.x)), y0 = Math.min(...all.map((b) => b.y));
        return { x: x0, y: y0, w: Math.max(...all.map((b) => b.x + b.w)) - x0, h: Math.max(...all.map((b) => b.y + b.h)) - y0 };
      })();
      const k = a.width && a.height ? Math.min(a.width / src.w, a.height / src.h) : a.width ? a.width / src.w : a.height ? a.height / src.h : 1;
      const ox = (a.x ?? src.x) + (a.width && a.height ? (a.width - src.w * k) / 2 : 0);
      const oy = (a.y ?? src.y) + (a.width && a.height ? (a.height - src.h * k) / 2 : 0);
      m = [k, 0, 0, k, ox - src.x * k, oy - src.y * k];
    }
    const k = m[0];
    const layers = r.shapes.map((s) => {
      let p = transformPath(s.path, m);
      const before = anchorCount(p);
      if (a.clean) p = cleanupPath(simplifyPath(p, { tolerance: a.clean }));
      if (a.clean && anchorCount(p) > before) p = transformPath(s.path, m);
      return createPathLayer(p, {
        name: a.name_prefix ? `${a.name_prefix} ${s.name}` : s.name,
        style: {
          fill: s.fill === 'currentColor' ? store.doc.ink : s.fill,
          stroke: s.stroke === 'currentColor' ? null : s.stroke,
          width: s.stroke ? s.strokeWidth * k : 0,
          opacity: s.opacity,
        },
      });
    });
    store.mutate((d) => addLayers(d, layers), `Imported ${layers.length} shape${layers.length === 1 ? '' : 's'}`, layers.map((l) => l.id));
    return text({
      imported: layers.map((l) => ({ id: l.id, name: l.name, anchors: anchorCount(l.path!), bbox: summarizeLayer(l).bbox })),
      warnings: r.warnings,
    });
  }),
);

server.registerTool(
  'list_generators',
  {
    title: 'List generators',
    description: 'Parametric generators (globes, knots, flow grids, mazes, spirographs…) and their params, for add_generator.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe(() =>
    text(GENERATORS.map((g) => ({
      type: g.type, name: g.name, about: g.blurb,
      params: g.params.map((p) => ({ key: p.key, kind: p.kind, ...('min' in p && { min: p.min, max: p.max }), ...('options' in p && { options: p.options.map((o) => o.value) }) })),
      defaults: g.defaults,
    }))),
  ),
);

server.registerTool(
  'add_generator',
  {
    title: 'Add generator',
    description: 'Add a parametric 3D line-art layer (see list_generators). Use convert_to_path afterwards to edit its points.',
    inputSchema: {
      type: z.enum(GENERATORS.map((g) => g.type) as [string, ...string[]]),
      x: z.number().optional().describe('Centre x (default artboard centre).'),
      y: z.number().optional(),
      size: z.number().positive().optional().describe('Radius in px (default ~28% of the artboard).'),
      params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
      tilt_x: z.number().optional(), turn_y: z.number().optional(), rotation: z.number().optional(),
      name: z.string().optional(),
      stroke: color.optional(), stroke_width: z.number().min(0).optional(),
      hidden_lines: z.enum(['dotted', 'dashed', 'solid', 'faded', 'hidden']).optional(),
    },
  },
  safe((a) => {
    const d = store.doc;
    const g = generatorFor(a.type);
    const layer = createLayer(a.type, { x: a.x ?? d.width / 2, y: a.y ?? d.height / 2 }, {
      scale: a.size ?? Math.round(Math.min(d.width, d.height) * 0.28),
      ...(a.name && { name: a.name }),
      ...(a.tilt_x !== undefined && { rx: a.tilt_x }),
      ...(a.turn_y !== undefined && { ry: a.turn_y }),
      ...(a.rotation !== undefined && { rz: a.rotation }),
      params: { ...g.defaults, ...a.params },
      style: {
        ...(a.stroke && a.stroke !== 'ink' && { stroke: a.stroke }),
        ...(a.stroke_width !== undefined && { width: a.stroke_width }),
        ...(a.hidden_lines && { back: a.hidden_lines }),
      } as LayerStyle,
    });
    store.mutate((doc) => addLayers(doc, [layer]), `Added ${g.name}`, [layer.id]);
    return text(summarizeLayer(layer));
  }),
);

// ---------------------------------------------------------------------------
// Point editing
// ---------------------------------------------------------------------------

server.registerTool(
  'get_path',
  {
    title: 'Get path',
    description:
      'Every anchor of a path layer in absolute artboard pixels: ref [subpath, index], position, absolute handle positions (in/out, null = none) and kind (corner | smooth | symmetric).',
    inputSchema: { layer: z.string().describe('Layer id or exact name.') },
    annotations: { readOnlyHint: true },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    if (!isPathLayer(l)) throw new Error(`"${l.name}" is a ${l.type} generator; call convert_to_path first.`);
    return text(describePath(l));
  }),
);

const ref = z.union([z.array(z.number().int()).length(2), z.string().regex(/^\d+:\d+$/)]).describe('[subpath, index] or "subpath:index"');
const refs = z.union([z.array(ref), z.literal('all')]);

const editOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), anchors: refs.optional().describe('Default all.'), dx: z.number(), dy: z.number() })
    .describe('Translate anchors (their handles travel with them).'),
  z.object({
    op: z.literal('set'), at: ref, x: z.number().optional(), y: z.number().optional(),
    in: vec2.nullable().optional().describe('Absolute handle position; null removes it.'),
    out: vec2.nullable().optional(),
    kind: z.enum(['corner', 'smooth', 'symmetric']).optional(),
  }).describe('Set an anchor position and/or its handles exactly.'),
  z.object({ op: z.literal('kind'), anchors: refs, kind: z.enum(['corner', 'smooth', 'symmetric', 'straight']) })
    .describe('smooth/symmetric: align (or auto-create) handles for a flowing curve. straight: remove handles (sharp point). corner: unlink handles.'),
  z.object({ op: z.literal('insert'), subpath: z.number().int(), segment: z.number().int().describe('Segment i runs from anchor i to i+1.'), t: z.number().min(0).max(1).optional() })
    .describe('Add an anchor on a segment without changing the shape.'),
  z.object({ op: z.literal('insert_at'), x: z.number(), y: z.number() }).describe('Add an anchor at the point on the path closest to (x, y).'),
  z.object({ op: z.literal('delete'), anchors: z.array(ref) }),
  z.object({
    op: z.literal('append'), subpath: z.number().int().optional(), x: z.number(), y: z.number(),
    in: vec2.nullable().optional(), out: vec2.nullable().optional(), prepend: z.boolean().optional(),
  }).describe('Extend an open subpath with a new end anchor.'),
  z.object({ op: z.literal('add_subpath'), ...geometryShape }).describe('Add another contour (e.g. a hole with fill_rule evenodd).'),
  z.object({ op: z.literal('remove_subpath'), subpath: z.number().int() }),
  z.object({ op: z.literal('close'), subpath: z.number().int(), closed: z.boolean().optional() }),
  z.object({ op: z.literal('reverse'), subpath: z.number().int() }),
  z.object({ op: z.literal('fill_rule'), rule: z.enum(['nonzero', 'evenodd']) }),
]);

server.registerTool(
  'edit_path',
  {
    title: 'Edit path points',
    description:
      'Edit a path layer point by point. Ops run in order and indices refer to the state after earlier ops (so delete/insert shift later indices). All-or-nothing: if any op is invalid nothing changes. Coordinates are absolute artboard pixels.',
    inputSchema: { layer: z.string().describe('Layer id or exact name.'), ops: z.array(editOp).min(1) },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    const next = applyEdits(l, a.ops as EditOp[]);
    store.mutate((d) => replaceLayer(d, next), `Edited points of “${l.name}”`, [l.id]);
    return text(pathResult(next));
  }),
);

server.registerTool(
  'clean_path',
  {
    title: 'Clean path',
    description:
      'Refit a path to the fewest anchors that stay within `tolerance` px of the original: straight runs become lines, curves become smooth anchors, sharp turns stay corners. Also merges duplicates and rounds coordinates. Reports anchors before → after.',
    inputSchema: {
      layer: z.string(),
      tolerance: z.number().min(0.05).max(20).optional().describe('Max deviation in px (default 1). Higher = fewer points.'),
      corner_angle: z.number().min(5).max(170).optional().describe('Turns sharper than this (degrees) stay corners (default 40).'),
      refit: z.boolean().optional().describe('false = only tidy (never moves the curve).'),
    },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    const r = cleanLayer(l, { tolerance: a.tolerance, cornerAngle: a.corner_angle, refit: a.refit });
    store.mutate((d) => replaceLayer(d, r.layer), `Cleaned “${l.name}”: ${r.before.anchors} → ${r.after.anchors} points`, [l.id]);
    return text({ before: r.before, after: r.after, path: pathResult(r.layer) });
  }),
);

server.registerTool(
  'convert_to_path',
  {
    title: 'Convert to path',
    description: 'Bake a generator layer into editable path layer(s), refitting its dense polylines into clean Béziers. Hidden (back-facing) lines become a separate faded layer.',
    inputSchema: { layer: z.string(), tolerance: z.number().min(0.05).max(20).optional() },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    if (isPathLayer(l)) return text('Already a path.');
    const paths = convertToPaths(l, a.tolerance ?? 0.6);
    if (!paths.length) throw new Error('Nothing visible to convert.');
    store.mutate((d) => {
      const i = d.layers.findIndex((x) => x.id === l.id);
      const layers = [...d.layers];
      layers.splice(i, 1, ...paths.reverse());
      return { ...d, layers };
    }, `Converted “${l.name}” to paths`, paths.map((p) => p.id));
    return text(paths.map((p) => ({ id: p.id, name: p.name, stats: pathStats(p.path!) })));
  }),
);

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

server.registerTool(
  'update_layer',
  {
    title: 'Update layer',
    description: 'Rename, restyle, move, rotate, show/hide, lock or reorder a layer. For generators, `params` tweaks its parameters.',
    inputSchema: {
      layer: z.string(),
      name: z.string().optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      x: z.number().optional().describe('Origin (centre) x.'),
      y: z.number().optional(),
      scale: z.number().positive().optional().describe('Path layers: percent (100 = original). Generators: radius px.'),
      rotation: z.number().optional().describe('Degrees clockwise (roll).'),
      tilt_x: z.number().optional().describe('3D tilt in degrees.'),
      turn_y: z.number().optional().describe('3D turn in degrees.'),
      ...styleShape,
      hidden_lines: z.enum(['dotted', 'dashed', 'solid', 'faded', 'hidden']).optional(),
      params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
      order: z.enum(['front', 'back', 'forward', 'backward']).optional(),
    },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    const next: Layer = {
      ...l,
      ...(a.name !== undefined && { name: a.name }),
      ...(a.visible !== undefined && { visible: a.visible }),
      ...(a.locked !== undefined && { locked: a.locked }),
      ...(a.x !== undefined && { x: a.x }),
      ...(a.y !== undefined && { y: a.y }),
      ...(a.scale !== undefined && { scale: a.scale }),
      ...(a.rotation !== undefined && { rz: -a.rotation }),
      ...(a.tilt_x !== undefined && { rx: a.tilt_x }),
      ...(a.turn_y !== undefined && { ry: a.turn_y }),
      style: { ...l.style, ...styleFrom(a), ...(a.hidden_lines && { back: a.hidden_lines }) },
      params: a.params ? { ...l.params, ...a.params } : l.params,
    };
    store.mutate((d) => {
      let layers = d.layers.map((x) => (x.id === l.id ? next : x));
      if (a.order) {
        const i = layers.findIndex((x) => x.id === l.id);
        const [it] = layers.splice(i, 1);
        const j = a.order === 'front' ? layers.length : a.order === 'back' ? 0 : a.order === 'forward' ? Math.min(layers.length, i + 1) : Math.max(0, i - 1);
        layers = [...layers.slice(0, j), it, ...layers.slice(j)];
      }
      return { ...d, layers };
    }, `Updated “${next.name}”`, [l.id]);
    return text(summarizeLayer(next));
  }),
);

server.registerTool(
  'duplicate_layer',
  {
    title: 'Duplicate layer',
    description: 'Copy a layer, offset by (dx, dy).',
    inputSchema: { layer: z.string(), dx: z.number().optional(), dy: z.number().optional(), name: z.string().optional() },
  },
  safe((a) => {
    const l = findLayer(store.doc, a.layer);
    const copy: Layer = { ...l, id: uid(), name: a.name ?? `${l.name} copy`, x: l.x + (a.dx ?? 24), y: l.y + (a.dy ?? 24) };
    store.mutate((d) => {
      const i = d.layers.findIndex((x) => x.id === l.id);
      const layers = [...d.layers];
      layers.splice(i + 1, 0, copy);
      return { ...d, layers };
    }, `Duplicated “${l.name}”`, [copy.id]);
    return text(summarizeLayer(copy));
  }),
);

server.registerTool(
  'delete_layers',
  {
    title: 'Delete layers',
    description: 'Remove layers by id or name.',
    inputSchema: { layers: z.array(z.string()).min(1) },
    annotations: { destructiveHint: true },
  },
  safe((a) => {
    const ids = new Set(a.layers.map((r) => findLayer(store.doc, r).id));
    store.mutate((d) => ({ ...d, layers: d.layers.filter((l) => !ids.has(l.id)) }), `Deleted ${ids.size} layer${ids.size === 1 ? '' : 's'}`);
    return text(`Deleted ${ids.size}. ${store.doc.layers.length} layers remain.`);
  }),
);

server.registerTool(
  'undo',
  {
    title: 'Undo',
    description: 'Revert the last change made through this MCP server.',
    inputSchema: {},
  },
  safe(() => text(store.undo() ? summarizeDoc(store.doc) : 'Nothing to undo.')),
);

// ---------------------------------------------------------------------------
// Seeing and exporting
// ---------------------------------------------------------------------------

server.registerTool(
  'render_preview',
  {
    title: 'Render preview',
    description:
      'Look at the canvas as a PNG. `focus` crops to one layer; `show_points` overlays anchors ([subpath:index] labels, squares = corners, circles = smooth) and handles (blue) for path layers — use it to check point placement before edit_path.',
    inputSchema: {
      focus: z.string().optional().describe('Layer id or name to crop to.'),
      show_points: z.union([z.boolean(), z.array(z.string())]).optional().describe('true = focused layer (or all paths); or a list of layers.'),
      width: z.number().int().min(64).max(2048).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  safe((a) => {
    const d = store.doc;
    const focus = a.focus ? findLayer(d, a.focus) : undefined;
    const points = Array.isArray(a.show_points)
      ? a.show_points.map((r) => findLayer(d, r))
      : a.show_points ? (focus ? [focus] : d.layers.filter(isPathLayer)) : [];
    const { png, viewBox } = renderPreview(d, { focus, points, width: a.width });
    return {
      content: [
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `viewBox ${viewBox.map((v) => Math.round(v)).join(' ')} (artboard ${d.width}×${d.height}, ${d.layers.length} layers)` },
      ],
    };
  }),
);

server.registerTool(
  'export_svg',
  {
    title: 'Export SVG',
    description: 'The clean SVG for the whole canvas (one named <g>/<path> per layer, Figma friendly). Optionally write it to a file.',
    inputSchema: { file: z.string().optional().describe('Absolute path to write, e.g. /tmp/logo.svg') },
    annotations: { readOnlyHint: true },
  },
  safe((a) => {
    const svg = docToSVG(store.doc);
    if (a.file) {
      writeFileSync(a.file, svg);
      return text(`Wrote ${svg.length} bytes to ${a.file}`);
    }
    return text(svg);
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[vectr] MCP ready · document ${FILE}\n`);
