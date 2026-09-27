import { opFor } from './operators/index.js';
import { sourceFor } from './sources/index.js';
import { DEFAULT_STYLE } from './style.js';
import type { Form, Op, Params, Style, Transform } from './types.js';

let counter = 0;
export const uid = (prefix = 'f') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 240, rx: -20, ry: 25, rz: 0, perspective: 0 };

export function createOp(kind: string, params: Params = {}, enabled = true): Op {
  const def = opFor(kind);
  if (!def) throw new Error(`Unknown operator "${kind}"`);
  return { id: uid('o'), kind, enabled, params: { ...def.defaults, ...params } };
}

export interface FormSpec {
  name?: string;
  source: { kind: string; params?: Params };
  ops?: { kind: string; params?: Params; enabled?: boolean }[];
  style?: Partial<Style>;
  transform?: Partial<Transform>;
  spin?: number;
}

/** Display name: the curve shape if it has one, else the source name. */
export function defaultName(source: { kind: string; params: Params }): string {
  const def = sourceFor(source.kind);
  if (source.kind === 'curve') {
    const shape = def?.params.find((d) => d.key === 'shape');
    const opt = shape && 'options' in shape ? shape.options.find((o) => o.value === source.params.shape) : undefined;
    if (opt) return opt.label;
  }
  return def?.name ?? 'Form';
}

export function createForm(spec: FormSpec, at: { x: number; y: number }): Form {
  const def = sourceFor(spec.source.kind);
  if (!def) throw new Error(`Unknown source "${spec.source.kind}"`);
  const source = { kind: def.kind, params: { ...def.defaults, ...spec.source.params } };
  return {
    id: uid('f'),
    name: spec.name ?? defaultName(source),
    visible: true,
    locked: false,
    spin: spec.spin ?? 0,
    ...DEFAULT_TRANSFORM,
    x: at.x,
    y: at.y,
    ...spec.transform,
    source,
    ops: (spec.ops ?? []).map((o) => createOp(o.kind, o.params, o.enabled ?? true)),
    style: { ...DEFAULT_STYLE, ...spec.style },
  };
}
