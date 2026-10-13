import { MAX_OPS, THEMES, compactDoc, parseDoc, variations, type Doc, type Form } from '@vectr/core';

/**
 * In-memory design sessions. Every mutation goes through `parseDoc`, so the store
 * can only ever hold valid documents, and every correction the validator makes is
 * surfaced to the agent as a warning it can act on.
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
  ramp?: string[];
  rough?: number;
}

type Raw = Record<string, unknown>;
export type FormInput = Raw & { source: Raw };
export type OpPatch =
  | { action: 'add'; kind: string; params?: Raw; index?: number }
  | { action: 'update'; index: number; params?: Raw; enabled?: boolean }
  | { action: 'remove'; index: number }
  | { action: 'move'; index: number; to: number };
export type FormUpdate = Raw & { id: string; source_params?: Raw; ops?: Raw[]; ops_patch?: OpPatch[]; style?: Raw };

export interface DesignUpdate {
  set?: DocSettings;
  add_forms?: FormInput[];
  update_forms?: FormUpdate[];
  remove_form_ids?: string[];
  form_order?: string[];
}

export class DesignError extends Error {}

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function applySettings(raw: Raw, set: DocSettings, warnings: string[]) {
  if (set.theme !== undefined) {
    const t = THEMES.find((x) => x.id === set.theme);
    if (t) Object.assign(raw, { background: t.background, ramp: [...t.ramp] });
    else warnings.push(`unknown theme "${set.theme}". Known: ${THEMES.map((x) => x.id).join(', ')}`);
  }
  for (const k of ['width', 'height', 'background', 'ramp', 'rough'] as const) if (set[k] !== undefined) raw[k] = set[k];
}

function patchOps(ops: Raw[], patches: OpPatch[], where: string, warnings: string[]): Raw[] {
  const out = [...ops];
  const bad = (i: number) => {
    const ok = Number.isInteger(i) && i >= 0 && i < out.length;
    if (!ok) warnings.push(`${where}: no operator at index ${i} (the stack has ${out.length}; indexes start at 0)`);
    return !ok;
  };
  for (const p of patches) {
    switch (p.action) {
      case 'add': {
        if (out.length >= MAX_OPS) {
          warnings.push(`${where}: stack is full (${MAX_OPS} operators)`);
          break;
        }
        const at = p.index === undefined ? out.length : Math.max(0, Math.min(out.length, p.index));
        out.splice(at, 0, { kind: p.kind, params: p.params ?? {} });
        break;
      }
      case 'update':
        if (bad(p.index)) break;
        out[p.index] = {
          ...out[p.index],
          params: { ...(isObj(out[p.index].params) ? (out[p.index].params as Raw) : {}), ...p.params },
          ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
        };
        break;
      case 'remove':
        if (!bad(p.index)) out.splice(p.index, 1);
        break;
      case 'move': {
        if (bad(p.index)) break;
        const [op] = out.splice(p.index, 1);
        out.splice(Math.max(0, Math.min(out.length, p.to)), 0, op);
        break;
      }
    }
  }
  return out;
}

export class DesignStore {
  private designs = new Map<string, Design>();
  private seq = 0;
  private formSeq = new Map<string, number>();
  /** Last batch of variations per design+form, so an agent can apply one by number. */
  private candidates = new Map<string, Form[]>();

  list(): Design[] {
    return [...this.designs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Design {
    const d = this.designs.get(id);
    if (!d) {
      const known = [...this.designs.keys()];
      throw new DesignError(`No design "${id}". ${known.length ? `Open designs: ${known.join(', ')}.` : 'Create one with vectr_create_design first.'}`);
    }
    return d;
  }

  create(input: unknown, name?: string): { design: Design; warnings: string[] } {
    const { doc, warnings } = parseDoc(input);
    const id = `d${++this.seq}`;
    this.formSeq.set(id, 0);
    const design: Design = {
      id,
      name: name?.trim() || `Design ${this.seq}`,
      doc: { ...doc, forms: doc.forms.map((f) => ({ ...f, id: this.nextFormId(id) })) },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.designs.set(id, design);
    this.evict();
    return { design, warnings };
  }

  update(id: string, u: DesignUpdate): { design: Design; warnings: string[] } {
    const design = this.get(id);
    const warnings: string[] = [];
    const raw = structuredClone(design.doc) as unknown as Raw & { forms: Raw[] };

    if (u.set) applySettings(raw, u.set, warnings);

    for (const fid of u.remove_form_ids ?? []) {
      const i = raw.forms.findIndex((f) => f.id === fid);
      if (i < 0) warnings.push(`remove: no form "${fid}"`);
      else raw.forms.splice(i, 1);
    }

    for (const upd of u.update_forms ?? []) {
      const form = raw.forms.find((f) => f.id === upd.id);
      if (!form) {
        warnings.push(`update: no form "${upd.id}". Form ids: ${raw.forms.map((f) => f.id).join(', ') || '(none)'}`);
        continue;
      }
      const where = `update ${upd.id}`;
      for (const [k, v] of Object.entries(upd)) {
        if (k === 'id' || k === 'ops_patch') continue;
        if (k === 'source_params' && isObj(v)) {
          const src = form.source as Raw;
          form.source = { ...src, params: { ...(isObj(src.params) ? src.params : {}), ...v } };
        } else if (k === 'source') {
          form.source = v; // a new source replaces the old one entirely
        } else if (k === 'style' && isObj(v)) {
          form.style = { ...(form.style as Raw), ...v };
        } else {
          form[k] = v;
        }
      }
      if (upd.ops_patch) form.ops = patchOps(form.ops as Raw[], upd.ops_patch, where, warnings);
    }

    for (const f of u.add_forms ?? []) raw.forms.push({ ...f, id: this.nextFormId(id) });

    if (u.form_order) {
      const ids = raw.forms.map((f) => f.id as string);
      const order = u.form_order;
      const valid = order.length === ids.length && new Set(order).size === order.length && order.every((x) => ids.includes(x));
      if (valid) raw.forms.sort((a, b) => order.indexOf(a.id as string) - order.indexOf(b.id as string));
      else warnings.push(`form_order ignored: it must list every current form id exactly once (${ids.join(', ')})`);
    }

    const parsed = parseDoc(raw);
    design.doc = parsed.doc;
    design.updatedAt = Date.now();
    this.candidates.clear();
    return { design, warnings: [...warnings, ...parsed.warnings] };
  }

  /** Generate variations of one form; they are kept so `applyVariation` can pick one. */
  mutate(designId: string, formId: string, count: number, strength: number, seed: number): { design: Design; forms: Form[] } {
    const design = this.get(designId);
    const form = design.doc.forms.find((f) => f.id === formId);
    if (!form) throw new DesignError(`No form "${formId}" in ${designId}. Form ids: ${design.doc.forms.map((f) => f.id).join(', ') || '(none)'}`);
    const forms = variations(form, count, seed, strength);
    this.candidates.set(`${designId}/${formId}`, forms);
    return { design, forms };
  }

  applyVariation(designId: string, formId: string, n: number): Design {
    const design = this.get(designId);
    const list = this.candidates.get(`${designId}/${formId}`);
    if (!list) throw new DesignError(`No variations pending for ${formId}. Call vectr_mutate_design without "apply" first.`);
    const pick = list[n - 1];
    if (!pick) throw new DesignError(`Pick a variation between 1 and ${list.length}.`);
    design.doc = { ...design.doc, forms: design.doc.forms.map((f) => (f.id === formId ? { ...pick, id: formId } : f)) };
    design.updatedAt = Date.now();
    this.candidates.delete(`${designId}/${formId}`);
    return design;
  }

  delete(id: string) {
    this.get(id);
    this.designs.delete(id);
    this.formSeq.delete(id);
  }

  /** The smallest faithful JSON for a design (defaults omitted, ids kept). */
  compact(design: Design) {
    const c = compactDoc(design.doc);
    (c.forms as Raw[]).forEach((f, i) => (f.id = design.doc.forms[i].id));
    return c;
  }

  private nextFormId(designId: string) {
    const n = (this.formSeq.get(designId) ?? 0) + 1;
    this.formSeq.set(designId, n);
    return `F${n}`;
  }

  private evict() {
    while (this.designs.size > MAX_DESIGNS) {
      const oldest = [...this.designs.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      this.designs.delete(oldest.id);
      this.formSeq.delete(oldest.id);
    }
  }
}
