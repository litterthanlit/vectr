import { THEMES, compactDoc, parseDoc, type Doc } from '@vectr/core';

/**
 * In-memory design sessions. Every mutation goes through `parseDoc`, so the
 * store can only ever hold valid documents, and every correction the validator
 * makes is surfaced to the agent as a warning it can act on.
 */

export const MAX_DESIGNS = 50;

export interface Design {
  id: string;
  name: string;
  doc: Doc;
  createdAt: number;
  updatedAt: number;
}

export interface DocSettings {
  width?: number;
  height?: number;
  theme?: string;
  background?: string;
  ink?: string;
  rough?: number;
}

export type LayerInput = Record<string, unknown> & { type: string };
export type LayerUpdate = Record<string, unknown> & { id: string };

export interface DesignUpdate {
  set?: DocSettings;
  add_layers?: LayerInput[];
  update_layers?: LayerUpdate[];
  remove_layer_ids?: string[];
  layer_order?: string[];
}

export class DesignError extends Error {}

type Raw = Record<string, unknown> & { layers: Record<string, unknown>[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Doc-level settings, resolving `theme` into colours unless they're given explicitly. */
function applySettings(raw: Raw, set: DocSettings, warnings: string[]) {
  if (set.theme !== undefined) {
    const t = THEMES.find((x) => x.id === set.theme);
    if (t) Object.assign(raw, { background: t.background, ink: t.ink, rough: t.rough });
    else warnings.push(`unknown theme "${set.theme}". Known: ${THEMES.map((x) => x.id).join(', ')}`);
  }
  for (const k of ['width', 'height', 'background', 'ink', 'rough'] as const) {
    if (set[k] !== undefined) raw[k] = set[k];
  }
}

export class DesignStore {
  private designs = new Map<string, Design>();
  private seq = 0;
  private layerSeq = new Map<string, number>();

  list(): Design[] {
    return [...this.designs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Design {
    const d = this.designs.get(id);
    if (!d) {
      const known = [...this.designs.keys()];
      throw new DesignError(
        `No design "${id}". ${known.length ? `Open designs: ${known.join(', ')}.` : 'Create one with vectr_create_design first.'}`,
      );
    }
    return d;
  }

  /** Create from any parseable input (bare doc, saved file, partial spec). */
  create(input: unknown, name?: string): { design: Design; warnings: string[] } {
    const { doc, warnings } = parseDoc(input);
    const id = `d${++this.seq}`;
    this.layerSeq.set(id, 0);
    const design: Design = { id, name: name?.trim() || `Design ${this.seq}`, doc: this.shortIds(id, doc), createdAt: Date.now(), updatedAt: Date.now() };
    this.designs.set(id, design);
    this.evict();
    return { design, warnings };
  }

  update(id: string, u: DesignUpdate): { design: Design; warnings: string[] } {
    const design = this.get(id);
    const warnings: string[] = [];
    const raw = structuredClone(design.doc) as unknown as Raw;

    if (u.set) applySettings(raw, u.set, warnings);

    for (const rid of u.remove_layer_ids ?? []) {
      const i = raw.layers.findIndex((l) => l.id === rid);
      if (i < 0) warnings.push(`remove: no layer "${rid}"`);
      else raw.layers.splice(i, 1);
    }

    for (const upd of u.update_layers ?? []) {
      const layer = raw.layers.find((l) => l.id === upd.id);
      if (!layer) {
        warnings.push(`update: no layer "${upd.id}". Layer ids: ${raw.layers.map((l) => l.id).join(', ') || '(none)'}`);
        continue;
      }
      for (const [k, v] of Object.entries(upd)) {
        if (k === 'id') continue;
        if (k === 'type') {
          if (v !== layer.type) warnings.push(`update ${upd.id}: "type" can't change; remove the layer and add a new one`);
        } else if ((k === 'params' || k === 'style') && isObj(v)) {
          layer[k] = { ...(isObj(layer[k]) ? layer[k] : {}), ...v };
        } else {
          layer[k] = v;
        }
      }
    }

    for (const l of u.add_layers ?? []) raw.layers.push({ ...l, id: this.nextLayerId(id) });

    if (u.layer_order) {
      const ids = raw.layers.map((l) => l.id as string);
      const order = u.layer_order;
      const valid = order.length === ids.length && new Set(order).size === order.length && order.every((x) => ids.includes(x));
      if (valid) raw.layers.sort((a, b) => order.indexOf(a.id as string) - order.indexOf(b.id as string));
      else warnings.push(`layer_order ignored: it must list every current layer id exactly once (${ids.join(', ')})`);
    }

    const parsed = parseDoc(raw);
    design.doc = parsed.doc;
    design.updatedAt = Date.now();
    return { design, warnings: [...warnings, ...parsed.warnings] };
  }

  delete(id: string) {
    this.get(id);
    this.designs.delete(id);
    this.layerSeq.delete(id);
  }

  /** The smallest faithful JSON for a design (defaults omitted, ids kept). */
  compact(design: Design) {
    const c = compactDoc(design.doc);
    (c.layers as Record<string, unknown>[]).forEach((l, i) => (l.id = design.doc.layers[i].id));
    return c;
  }

  private nextLayerId(designId: string) {
    const n = (this.layerSeq.get(designId) ?? 0) + 1;
    this.layerSeq.set(designId, n);
    return `L${n}`;
  }

  /** Short, readable layer ids (L1, L2…) are easier for agents to reference than random ones. */
  private shortIds(designId: string, doc: Doc): Doc {
    return { ...doc, layers: doc.layers.map((l) => ({ ...l, id: this.nextLayerId(designId) })) };
  }

  private evict() {
    while (this.designs.size > MAX_DESIGNS) {
      const oldest = [...this.designs.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      this.designs.delete(oldest.id);
      this.layerSeq.delete(oldest.id);
    }
  }
}
