import { DEFAULT_STYLE, GENERATORS, createLayer, generatorFor, uid } from './generators/index.js';
import { clamp } from './math.js';
import { THEMES } from './templates.js';
import type { BackStyle, Doc, Layer, LayerStyle, ParamDef, Params } from './types.js';

/**
 * Turning untrusted input (a saved file, a share link, an agent's JSON) into a
 * valid Doc. Input may be partial: any missing field falls back to its default,
 * so `{ layers: [{ type: "sphere" }] }` is a complete design.
 */

export const FORMAT = 'vectr';
export const FORMAT_VERSION = 1;

export const LIMITS = {
  minSize: 64,
  maxSize: 8000,
  maxLayers: 200,
  maxText: 200,
  maxName: 80,
} as const;

export interface ParseResult {
  doc: Doc;
  /** Human-readable notes on anything that was dropped or corrected. */
  warnings: string[];
}

const BACK_STYLES: BackStyle[] = ['dotted', 'dashed', 'solid', 'faded', 'hidden'];
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%/+-]{1,60}\))$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isColor = (v: unknown): v is string => typeof v === 'string' && COLOR.test(v.trim());

function sanitizeParam(def: ParamDef, v: unknown, fallback: Params[string], warn: (m: string) => void): Params[string] {
  switch (def.kind) {
    case 'range':
      if (!finite(v)) return (warn(`"${def.key}" should be a number`), fallback);
      if (v < def.min || v > def.max) warn(`"${def.key}" clamped to ${def.min}–${def.max}`);
      return clamp(v, def.min, def.max);
    case 'seed':
      return finite(v) ? clamp(Math.round(v), 1, 999) : (warn(`"${def.key}" should be a number`), fallback);
    case 'toggle':
      return typeof v === 'boolean' ? v : (warn(`"${def.key}" should be true or false`), fallback);
    case 'select':
      if (def.options.some((o) => o.value === v)) return v as string;
      warn(`"${def.key}" must be one of: ${def.options.map((o) => o.value).join(', ')}`);
      return fallback;
    case 'text':
      return typeof v === 'string' ? v.slice(0, LIMITS.maxText) : (warn(`"${def.key}" should be text`), fallback);
  }
}

function sanitizeStyle(input: unknown, warn: (m: string) => void): Partial<LayerStyle> {
  if (input === undefined) return {};
  if (!isObj(input)) return (warn('style should be an object'), {});
  const out: Partial<LayerStyle> = {};
  const numField = (k: 'width' | 'nodeSize' | 'labelSize' | 'opacity', lo: number, hi: number) => {
    if (input[k] === undefined) return;
    if (finite(input[k])) out[k] = clamp(input[k] as number, lo, hi);
    else warn(`style.${k} should be a number`);
  };
  numField('width', 0.1, 40);
  numField('nodeSize', 0, 40);
  numField('labelSize', 4, 96);
  numField('opacity', 0, 1);
  for (const k of ['nodes', 'backNodes', 'labels'] as const) {
    if (input[k] === undefined) continue;
    if (typeof input[k] === 'boolean') out[k] = input[k] as boolean;
    else warn(`style.${k} should be true or false`);
  }
  if (input.back !== undefined) {
    if (BACK_STYLES.includes(input.back as BackStyle)) out.back = input.back as BackStyle;
    else warn(`style.back must be one of: ${BACK_STYLES.join(', ')}`);
  }
  if (input.stroke !== undefined) {
    if (input.stroke === null) out.stroke = null;
    else if (isColor(input.stroke)) out.stroke = input.stroke.trim();
    else warn('style.stroke is not a valid colour');
  }
  for (const k of Object.keys(input)) if (!(k in DEFAULT_STYLE)) warn(`unknown style field "${k}" ignored`);
  return out;
}

const TRANSFORM_RANGES = {
  x: [-100000, 100000],
  y: [-100000, 100000],
  scale: [1, 20000],
  rx: [-360, 360],
  ry: [-100000, 100000],
  rz: [-360, 360],
  perspective: [0, 1],
  spin: [-720, 720],
} as const;

const LAYER_KEYS = new Set(['id', 'type', 'name', 'visible', 'locked', 'params', 'style', ...Object.keys(TRANSFORM_RANGES)]);

function parseLayer(input: unknown, index: number, doc: Pick<Doc, 'width' | 'height'>, ids: Set<string>, warnings: string[]): Layer | null {
  const where = `layers[${index}]`;
  if (!isObj(input)) return (warnings.push(`${where}: not an object, skipped`), null);
  const type = input.type;
  if (typeof type !== 'string' || !GENERATORS.some((g) => g.type === type)) {
    warnings.push(`${where}: unknown type ${JSON.stringify(type)}, skipped. Known: ${GENERATORS.map((g) => g.type).join(', ')}`);
    return null;
  }
  const warn = (m: string) => warnings.push(`${where} (${type}): ${m}`);
  const g = generatorFor(type);

  const overrides: Partial<Layer> = {};
  for (const [k, [lo, hi]] of Object.entries(TRANSFORM_RANGES)) {
    const v = input[k];
    if (v === undefined) continue;
    if (finite(v)) (overrides as Record<string, number>)[k] = clamp(v, lo, hi);
    else warn(`"${k}" should be a number`);
  }
  if (overrides.scale === undefined) overrides.scale = Math.round(Math.min(doc.width, doc.height) * 0.28);

  const params: Params = {};
  if (input.params !== undefined && !isObj(input.params)) warn('params should be an object');
  const rawParams = isObj(input.params) ? input.params : {};
  for (const def of g.params) {
    if (rawParams[def.key] !== undefined) params[def.key] = sanitizeParam(def, rawParams[def.key], g.defaults[def.key], warn);
  }
  for (const k of Object.keys(rawParams)) if (!g.params.some((d) => d.key === k)) warn(`unknown param "${k}" ignored`);
  for (const k of Object.keys(input)) if (!LAYER_KEYS.has(k)) warn(`unknown field "${k}" ignored`);

  const layer = createLayer(type, { x: doc.width / 2, y: doc.height / 2 }, {
    ...overrides,
    params,
    style: sanitizeStyle(input.style, warn) as LayerStyle,
  });
  if (typeof input.name === 'string' && input.name.trim()) layer.name = input.name.trim().slice(0, LIMITS.maxName);
  if (typeof input.visible === 'boolean') layer.visible = input.visible;
  if (typeof input.locked === 'boolean') layer.locked = input.locked;
  if (typeof input.id === 'string' && /^[\w-]{1,64}$/.test(input.id) && !ids.has(input.id)) layer.id = input.id;
  else if (layer.id === '' || ids.has(layer.id)) layer.id = uid();
  ids.add(layer.id);
  return layer;
}

/**
 * Parse anything that might be a Vectr design: a saved file (`{format, version, doc}`),
 * a bare Doc, or a partial spec written by hand or by an agent. Throws only when the
 * input can't be a design at all; everything else is corrected and reported in `warnings`.
 */
export function parseDoc(input: unknown): ParseResult {
  const warnings: string[] = [];
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('Not valid JSON');
    }
  }
  if (isObj(raw) && raw.format === FORMAT) {
    if (typeof raw.version === 'number' && raw.version > FORMAT_VERSION) {
      warnings.push(`file is format version ${raw.version}; this build reads version ${FORMAT_VERSION}, some features may be lost`);
    }
    raw = raw.doc;
  }
  if (!isObj(raw)) throw new Error('Expected a Vectr design object');

  const theme = typeof raw.theme === 'string' ? THEMES.find((t) => t.id === raw.theme) : undefined;
  if (raw.theme !== undefined && !theme) warnings.push(`unknown theme ${JSON.stringify(raw.theme)}. Known: ${THEMES.map((t) => t.id).join(', ')}`);
  const base = theme ?? THEMES[0];

  const size = (k: 'width' | 'height', d: number) => {
    const v = raw[k];
    if (v === undefined) return d;
    if (!finite(v)) return (warnings.push(`${k} should be a number`), d);
    return Math.round(clamp(v, LIMITS.minSize, LIMITS.maxSize));
  };
  const color = (k: 'background' | 'ink', d: string) => {
    const v = raw[k];
    if (v === undefined) return d;
    if (isColor(v)) return v.trim();
    warnings.push(`${k} is not a valid colour`);
    return d;
  };

  const doc: Doc = {
    width: size('width', 1200),
    height: size('height', 900),
    background: color('background', base.background),
    ink: color('ink', base.ink),
    rough: finite(raw.rough) ? clamp(raw.rough, 0, 20) : base.rough,
    layers: [],
  };

  if (raw.layers !== undefined && !Array.isArray(raw.layers)) warnings.push('layers should be an array');
  const list = Array.isArray(raw.layers) ? raw.layers : [];
  if (list.length > LIMITS.maxLayers) warnings.push(`only the first ${LIMITS.maxLayers} layers were kept`);
  const ids = new Set<string>();
  list.slice(0, LIMITS.maxLayers).forEach((l, i) => {
    const layer = parseLayer(l, i, doc, ids, warnings);
    if (layer) doc.layers.push(layer);
  });
  return { doc, warnings };
}

/** The on-disk project format. */
export function serializeDoc(doc: Doc): string {
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, doc }, null, 2);
}

/**
 * Remove every value that equals its default. `parseDoc` restores them, so this is
 * the smallest faithful form, used by share links and handy for agents to read.
 */
export function compactDoc(doc: Doc): Record<string, unknown> {
  return {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    ink: doc.ink,
    rough: doc.rough,
    layers: doc.layers.map((l) => {
      const fresh = createLayer(l.type, { x: doc.width / 2, y: doc.height / 2 }, { scale: Math.round(Math.min(doc.width, doc.height) * 0.28) });
      const out: Record<string, unknown> = { type: l.type };
      for (const k of ['name', 'visible', 'locked', ...Object.keys(TRANSFORM_RANGES)] as (keyof Layer)[]) {
        if (l[k] !== fresh[k]) out[k] = l[k];
      }
      const params = Object.fromEntries(Object.entries(l.params).filter(([k, v]) => fresh.params[k] !== v));
      const style = Object.fromEntries(Object.entries(l.style).filter(([k, v]) => fresh.style[k as keyof LayerStyle] !== v));
      if (Object.keys(params).length) out.params = params;
      if (Object.keys(style).length) out.style = style;
      return out;
    }),
  };
}

/** A machine-readable catalogue of generators and their parameters, for agents and tools. */
export function describeGenerators() {
  return GENERATORS.map((g) => ({
    type: g.type,
    name: g.name,
    description: g.blurb,
    params: g.params.map((d) => {
      const base = { key: d.key, label: d.label, default: g.defaults[d.key] };
      switch (d.kind) {
        case 'range':
          return { ...base, type: 'number', min: d.min, max: d.max, step: d.step };
        case 'seed':
          return { ...base, type: 'integer', min: 1, max: 999, note: 'random seed' };
        case 'toggle':
          return { ...base, type: 'boolean' };
        case 'select':
          return { ...base, type: 'enum', options: d.options.map((o) => o.value) };
        case 'text':
          return { ...base, type: 'string', maxLength: LIMITS.maxText };
      }
    }),
    defaultTransform: { ...g.transform },
    defaultStyle: { ...DEFAULT_STYLE, ...g.style },
  }));
}
