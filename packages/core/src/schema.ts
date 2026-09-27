import { isHex, normalizeHex } from './color.js';
import { DEFAULT_TRANSFORM, createForm, defaultName, uid } from './forms.js';
import { clamp } from './math.js';
import { migrateV1 } from './migrate.js';
import { OPERATORS, opFor } from './operators/index.js';
import { MAX_OPS } from './pipeline.js';
import { RECIPES } from './recipes.js';
import { SOURCES, sourceFor } from './sources/index.js';
import { DEFAULT_STYLE, STYLE_PARAMS } from './style.js';
import { THEMES } from './themes.js';
import type { BlockDef, Doc, Form, ParamDef, Params, Style } from './types.js';

/**
 * Turning untrusted input (a saved file, a share link, an agent's JSON) into a
 * valid Doc. Input may be partial: `{ forms: [{ source: { kind: "curve" } }] }` is
 * a complete design. Vectr v1 files are migrated. Nothing is fatal except input that
 * cannot be a design at all; every correction is reported as a warning.
 */

export const FORMAT = 'vectr';
export const FORMAT_VERSION = 2;

export const LIMITS = {
  minSize: 64,
  maxSize: 8000,
  maxForms: 200,
  maxText: 200,
  maxName: 80,
  maxRamp: 6,
} as const;

export interface ParseResult {
  doc: Doc;
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Colours are hex only in v2 (#rgb or #rrggbb). */
export const isColor = isHex;

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

/** Validate params against a block's schema; unknown keys are dropped with a warning. */
function sanitizeParams(block: BlockDef, input: unknown, warn: (m: string) => void): Params {
  if (input === undefined) return {};
  if (!isObj(input)) return (warn('params should be an object'), {});
  const out: Params = {};
  for (const def of block.params) {
    if (input[def.key] !== undefined) out[def.key] = sanitizeParam(def, input[def.key], block.defaults[def.key], warn);
  }
  for (const k of Object.keys(input)) {
    if (!block.params.some((d) => d.key === k)) warn(`unknown ${block.name.toLowerCase()} param "${k}" ignored. Known: ${block.params.map((d) => d.key).join(', ')}`);
  }
  return out;
}

function sanitizeRamp(v: unknown, warn: (m: string) => void, what: string): string[] | undefined {
  if (!Array.isArray(v)) return (warn(`${what} should be an array of hex colours`), undefined);
  const ok = v.filter(isHex).map(normalizeHex).slice(0, LIMITS.maxRamp);
  if (ok.length !== v.length) warn(`${what}: only hex colours (#rgb or #rrggbb) are kept, up to ${LIMITS.maxRamp}`);
  return ok.length ? ok : undefined;
}

const STYLE_BLOCK: BlockDef = {
  kind: 'style', name: 'Style', blurb: '', params: STYLE_PARAMS,
  defaults: DEFAULT_STYLE as unknown as Params,
};

function sanitizeStyle(input: unknown, warn: (m: string) => void): Partial<Style> {
  if (input === undefined) return {};
  if (!isObj(input)) return (warn('style should be an object'), {});
  const { stroke, ramp, ...rest } = input;
  const out = sanitizeParams(STYLE_BLOCK, rest, (m) => warn(`style: ${m.replace(' style param', '')}`)) as Partial<Style>;
  if (stroke !== undefined) {
    if (stroke === null) out.stroke = null;
    else if (isHex(stroke)) out.stroke = normalizeHex(stroke);
    else warn('style.stroke must be a hex colour or null');
  }
  if (ramp !== undefined) out.ramp = ramp === null ? null : sanitizeRamp(ramp, warn, 'style.ramp') ?? null;
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

const FORM_KEYS = new Set(['id', 'name', 'visible', 'locked', 'source', 'ops', 'style', ...Object.keys(TRANSFORM_RANGES)]);

function parseForm(input: unknown, index: number, doc: Pick<Doc, 'width' | 'height'>, ids: Set<string>, warnings: string[]): Form | null {
  const where = `forms[${index}]`;
  if (!isObj(input)) return (warnings.push(`${where}: not an object, skipped`), null);
  const rawSource = typeof input.source === 'string' ? { kind: input.source } : input.source;
  const kind = isObj(rawSource) ? rawSource.kind : undefined;
  const src = typeof kind === 'string' ? sourceFor(kind) : undefined;
  if (!src || !isObj(rawSource)) {
    warnings.push(`${where}: source.kind must be one of ${SOURCES.map((s) => s.kind).join(', ')}; got ${JSON.stringify(kind)}. Skipped`);
    return null;
  }
  const warn = (m: string) => warnings.push(`${where} (${src.kind}): ${m}`);
  const sourceParams = sanitizeParams(src, rawSource.params, warn);

  const ops: { kind: string; params: Params; enabled: boolean; id?: string }[] = [];
  if (input.ops !== undefined && !Array.isArray(input.ops)) warn('ops should be an array');
  const rawOps = Array.isArray(input.ops) ? input.ops : [];
  if (rawOps.length > MAX_OPS) warn(`only the first ${MAX_OPS} operators were kept`);
  rawOps.slice(0, MAX_OPS).forEach((o, i) => {
    const oKind = isObj(o) ? o.kind : typeof o === 'string' ? o : undefined;
    const def = typeof oKind === 'string' ? opFor(oKind) : undefined;
    if (!def) {
      warn(`ops[${i}]: kind must be one of ${OPERATORS.map((x) => x.kind).join(', ')}; got ${JSON.stringify(oKind)}. Skipped`);
      return;
    }
    const obj = isObj(o) ? o : {};
    ops.push({
      kind: def.kind,
      params: sanitizeParams(def, obj.params, (m) => warn(`ops[${i}] ${def.kind}: ${m}`)),
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
      id: typeof obj.id === 'string' && /^[\w-]{1,64}$/.test(obj.id) ? obj.id : undefined,
    });
  });

  const transform: Record<string, number> = {};
  for (const [k, [lo, hi]] of Object.entries(TRANSFORM_RANGES)) {
    const v = input[k];
    if (v === undefined) continue;
    if (finite(v)) transform[k] = clamp(v, lo, hi);
    else warn(`"${k}" should be a number`);
  }
  for (const k of Object.keys(input)) if (!FORM_KEYS.has(k)) warn(`unknown field "${k}" ignored`);

  const { spin, ...tr } = transform;
  const form = createForm(
    {
      source: { kind: src.kind, params: sourceParams },
      ops: ops.map(({ kind: k, params, enabled }) => ({ kind: k, params, enabled })),
      style: sanitizeStyle(input.style, warn),
      transform: { scale: Math.round(Math.min(doc.width, doc.height) * 0.3), ...tr },
      spin,
    },
    { x: doc.width / 2, y: doc.height / 2 },
  );
  ops.forEach((o, i) => {
    if (o.id) form.ops[i].id = o.id;
  });
  if (typeof input.name === 'string' && input.name.trim()) form.name = input.name.trim().slice(0, LIMITS.maxName);
  if (typeof input.visible === 'boolean') form.visible = input.visible;
  if (typeof input.locked === 'boolean') form.locked = input.locked;
  if (typeof input.id === 'string' && /^[\w-]{1,64}$/.test(input.id) && !ids.has(input.id)) form.id = input.id;
  else if (ids.has(form.id)) form.id = uid('f');
  ids.add(form.id);
  return form;
}

/**
 * Parse anything that might be a Vectr design: a saved file (`{format, version, doc}`),
 * a bare Doc, a partial spec, or a Vectr v1 document (migrated).
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
  if (!Array.isArray(raw.forms) && raw.version !== 2 && (Array.isArray(raw.layers) || typeof raw.ink === 'string')) {
    raw = migrateV1(raw, warnings);
  }
  const r = raw as Record<string, unknown>;

  const theme = typeof r.theme === 'string' ? THEMES.find((t) => t.id === r.theme) : undefined;
  if (r.theme !== undefined && !theme) warnings.push(`unknown theme ${JSON.stringify(r.theme)}. Known: ${THEMES.map((t) => t.id).join(', ')}`);
  const base = theme ?? THEMES[0];

  const size = (k: 'width' | 'height', d: number) => {
    const v = r[k];
    if (v === undefined) return d;
    if (!finite(v)) return (warnings.push(`${k} should be a number`), d);
    return Math.round(clamp(v, LIMITS.minSize, LIMITS.maxSize));
  };
  let background = base.background;
  if (r.background !== undefined) {
    if (isHex(r.background)) background = normalizeHex(r.background);
    else warnings.push('background must be a hex colour');
  }
  const ramp = r.ramp !== undefined ? sanitizeRamp(r.ramp, (m) => warnings.push(m), 'ramp') ?? [...base.ramp] : [...base.ramp];

  const doc: Doc = {
    version: 2,
    width: size('width', 1200),
    height: size('height', 900),
    background,
    ramp,
    rough: finite(r.rough) ? clamp(r.rough, 0, 20) : 0,
    forms: [],
  };

  if (r.forms !== undefined && !Array.isArray(r.forms)) warnings.push('forms should be an array');
  const list = Array.isArray(r.forms) ? r.forms : [];
  if (list.length > LIMITS.maxForms) warnings.push(`only the first ${LIMITS.maxForms} forms were kept`);
  const ids = new Set<string>();
  list.slice(0, LIMITS.maxForms).forEach((f, i) => {
    const form = parseForm(f, i, doc, ids, warnings);
    if (form) doc.forms.push(form);
  });
  return { doc, warnings };
}

/** The on-disk project format. */
export function serializeDoc(doc: Doc): string {
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, doc }, null, 2);
}

const diff = (value: Params, defaults: Params) =>
  Object.fromEntries(Object.entries(value).filter(([k, v]) => JSON.stringify(defaults[k]) !== JSON.stringify(v)));

/**
 * Remove every value that equals its default. `parseDoc` restores them, so this is
 * the smallest faithful form, used by share links and handy for agents to read.
 */
export function compactDoc(doc: Doc): Record<string, unknown> {
  const defaultScale = Math.round(Math.min(doc.width, doc.height) * 0.3);
  return {
    version: 2,
    width: doc.width,
    height: doc.height,
    background: doc.background,
    ramp: doc.ramp,
    ...(doc.rough ? { rough: doc.rough } : {}),
    forms: doc.forms.map((f) => {
      const src = sourceFor(f.source.kind)!;
      const out: Record<string, unknown> = { source: { kind: f.source.kind } };
      const sp = diff(f.source.params, src.defaults);
      if (Object.keys(sp).length) (out.source as Record<string, unknown>).params = sp;
      if (f.ops.length) {
        out.ops = f.ops.map((o) => {
          const op: Record<string, unknown> = { kind: o.kind };
          const p = diff(o.params, opFor(o.kind)?.defaults ?? {});
          if (Object.keys(p).length) op.params = p;
          if (!o.enabled) op.enabled = false;
          return op;
        });
      }
      const st = diff(f.style as unknown as Params, DEFAULT_STYLE as unknown as Params);
      if (Object.keys(st).length) out.style = st;
      if (f.name !== defaultName(f.source)) out.name = f.name;
      if (!f.visible) out.visible = false;
      if (f.locked) out.locked = true;
      const tdef: Record<string, number> = { ...DEFAULT_TRANSFORM, x: doc.width / 2, y: doc.height / 2, scale: defaultScale, spin: 0 };
      for (const k of Object.keys(TRANSFORM_RANGES)) {
        const v = (f as unknown as Record<string, number>)[k];
        if (v !== tdef[k]) out[k] = v;
      }
      return out;
    }),
  };
}

/** A machine-readable catalogue of every building block, for agents and tools. */
export function describeBlocks() {
  const params = (defs: ParamDef[], defaults: Params) =>
    defs.map((d) => {
      const base = { key: d.key, label: d.label, default: defaults[d.key], ...(d.when ? { only_when: d.when } : {}), ...(d.help ? { help: d.help } : {}) };
      switch (d.kind) {
        case 'range':
          return { ...base, type: 'number', min: d.min, max: d.max, step: d.step };
        case 'seed':
          return { ...base, type: 'integer', min: 1, max: 999 };
        case 'toggle':
          return { ...base, type: 'boolean' };
        case 'select':
          return { ...base, type: 'enum', options: d.options.map((o) => o.value) };
        case 'text':
          return { ...base, type: 'string', maxLength: LIMITS.maxText };
      }
    });
  return {
    sources: SOURCES.map((s) => ({ kind: s.kind, group: s.group ?? 'block', ...(s.category ? { category: s.category } : {}), name: s.name, description: s.blurb, params: params(s.params, s.defaults) })),
    operators: OPERATORS.map((o) => ({ kind: o.kind, name: o.name, description: o.blurb, params: params(o.params, o.defaults) })),
    style: {
      params: params(STYLE_PARAMS, DEFAULT_STYLE as unknown as Params),
      stroke: 'hex colour or null (null = last, strongest ramp stop)',
      ramp: `array of 1–${LIMITS.maxRamp} hex colours, or null to use the document ramp`,
    },
    themes: THEMES,
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, description: r.blurb })),
    limits: { maxOps: MAX_OPS, ...LIMITS },
  };
}
