import { createOp } from './forms.js';
import { clamp, rng } from './math.js';
import { opFor } from './operators/index.js';
import { MAX_OPS } from './pipeline.js';
import { sourceFor } from './sources/index.js';
import type { BlockDef, ColorBy, Form, MarkerShape, Params } from './types.js';

/** Operators that are safe to drop into any stack without swamping it. */
const ADDABLE = ['warp', 'repeat', 'jitter', 'mirror', 'warp'];

const active = (block: BlockDef, params: Params) => (key: string) => {
  const def = block.params.find((d) => d.key === key);
  return !def?.when || def.when.in.includes(String(params[def.when.key]));
};

function perturb(block: BlockDef, params: Params, r: () => number, strength: number, allowShape: boolean): Params {
  const out: Params = { ...params };
  const on = active(block, params);
  for (const d of block.params) {
    if (!on(d.key)) continue;
    switch (d.kind) {
      case 'range': {
        if (r() > 0.7) break;
        const span = (d.max - d.min) * strength * (r() * 2 - 1);
        const v = clamp(Number(out[d.key]) + span, d.min, d.max);
        out[d.key] = Math.round(v / d.step) * d.step;
        break;
      }
      case 'seed':
        if (r() < 0.35) out[d.key] = Math.floor(r() * 998) + 1;
        break;
      case 'toggle':
        if (r() < 0.12 * strength * 2) out[d.key] = !out[d.key];
        break;
      case 'select':
        if ((d.key !== 'shape' || allowShape) && r() < 0.1 * strength * 2) out[d.key] = d.options[Math.floor(r() * d.options.length)].value;
        break;
      case 'text':
        break;
    }
  }
  return out;
}

/**
 * A variation of a form: params nudged by `strength` (0–1), and now and then an
 * operator added, removed or toggled, or the colour mapping changed. Deterministic
 * for a given seed.
 */
export function mutate(form: Form, seed: number, strength = 0.3): Form {
  const r = rng(seed);
  const s = clamp(strength, 0.02, 1);
  const src = sourceFor(form.source.kind);
  let ops = form.ops.map((o) => {
    const def = opFor(o.kind);
    return def ? { ...o, params: perturb(def, o.params, r, s, false) } : o;
  });
  const structural = r();
  if (structural < 0.18 * s * 2 && ops.length < MAX_OPS) {
    const kind = ADDABLE[Math.floor(r() * ADDABLE.length)];
    const fresh = createOp(kind);
    fresh.params = perturb(opFor(kind)!, fresh.params, r, 0.4, false);
    ops = [...ops, fresh];
  } else if (structural < 0.28 * s * 2 && ops.length > 1) {
    ops = ops.filter((_, i) => i !== Math.floor(r() * ops.length));
  }
  const style = { ...form.style };
  if (r() < 0.25 * s * 2) style.colorBy = (['depth', 't', 'family'] as ColorBy[])[Math.floor(r() * 3)];
  if (r() < 0.1 * s * 2) style.fill = style.fill === 'none' ? 'ribbons' : 'none';
  if (r() < 0.08 * s * 2) style.markers = (['none', 'dot', 'ring', 'cross'] as MarkerShape[])[Math.floor(r() * 4)];
  return {
    ...form,
    source: { kind: form.source.kind, params: src ? perturb(src, form.source.params, r, s, s > 0.6) : form.source.params },
    ops,
    style,
  };
}

/** `count` distinct variations of a form. */
export function variations(form: Form, count: number, seed: number, strength = 0.3): Form[] {
  return Array.from({ length: count }, (_, i) => mutate(form, seed * 7919 + i * 104729 + 1, strength));
}
