import { pointCount } from './geo.js';
import { opFor } from './operators/index.js';
import { sourceFor } from './sources/index.js';
import type { Form, Geometry } from './types.js';

export const MAX_OPS = 12;
/** Upper bound on points per form, so any stack stays interactive. */
export const POINT_BUDGET = 60_000;

export interface BuildResult {
  geometry: Geometry;
  warnings: string[];
}

function thin(g: Geometry, budget: number): Geometry {
  const k = Math.ceil(pointCount(g) / budget);
  return {
    lines: g.lines
      .filter((_, i) => g.lines.length < budget / 8 || i % k === 0)
      .map((l) => {
        if (l.pts.length <= 8) return l;
        const idx = l.pts.map((_, i) => i).filter((i) => i % k === 0 || i === l.pts.length - 1);
        return { ...l, pts: idx.map((i) => l.pts[i]), normals: l.normals && idx.map((i) => l.normals![i]), t: l.t && idx.map((i) => l.t![i]) };
      }),
    nodes: g.nodes.filter((_, i) => i % k === 0),
    labels: g.labels,
  };
}

/** Small LRU: geometry depends only on the source and the enabled ops. */
const cache = new Map<string, BuildResult>();
const CACHE_SIZE = 96;

export const formKey = (form: Pick<Form, 'source' | 'ops'>) =>
  JSON.stringify([form.source, form.ops.filter((o) => o.enabled).map((o) => [o.kind, o.params])]);

export function buildForm(form: Pick<Form, 'source' | 'ops'>): BuildResult {
  const key = formKey(form);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const warnings: string[] = [];
  const src = sourceFor(form.source.kind);
  let g: Geometry = { lines: [], nodes: [] };
  if (!src) warnings.push(`unknown source "${form.source.kind}"`);
  else {
    try {
      g = src.build(form.source.params);
    } catch (e) {
      // A bad formula (or any other source failure) leaves an empty form and says why.
      warnings.push(`${src.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (pointCount(g) > POINT_BUDGET) {
      warnings.push(`${src.name} produced more than ${POINT_BUDGET.toLocaleString('en-US')} points; the form was thinned to stay fast`);
      g = thin(g, POINT_BUDGET);
    }
  }
  for (const op of form.ops.slice(0, MAX_OPS)) {
    if (!op.enabled) continue;
    const def = opFor(op.kind);
    if (!def) {
      warnings.push(`unknown operator "${op.kind}" skipped`);
      continue;
    }
    try {
      g = def.apply(g, op.params);
    } catch (e) {
      warnings.push(`${def.name} failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (pointCount(g) > POINT_BUDGET) {
      warnings.push(`${def.name} produced more than ${POINT_BUDGET.toLocaleString('en-US')} points; the form was thinned to stay fast`);
      g = thin(g, POINT_BUDGET);
    }
  }
  const result = { geometry: g, warnings };
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return result;
}
