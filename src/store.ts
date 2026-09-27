import { create } from 'zustand';
import {
  RECIPES, createForm, createOp, opFor, parseDoc, sourceFor, uid,
  type Doc, type Form, type FormSpec, type Op, type Params, type Style,
} from '@vectr/core';

export type Tool = 'move' | 'orbit';

interface State {
  doc: Doc;
  selectedId: string | null;
  tool: Tool;
  playing: boolean;
  mutateOpen: boolean;
  past: Doc[];
  future: Doc[];

  /** Apply a doc change. Changes sharing a `key` within a second merge into one undo step. */
  commit(fn: (d: Doc) => Doc, key?: string): void;
  undo(): void;
  redo(): void;

  select(id: string | null): void;
  setTool(t: Tool): void;
  togglePlay(): void;
  setMutateOpen(open: boolean): void;

  addForm(spec: FormSpec): void;
  updateForm(id: string, patch: Partial<Form>, key?: string): void;
  updateSource(id: string, patch: Params, key?: string): void;
  updateStyle(id: string, patch: Partial<Style>, key?: string): void;
  replaceForm(id: string, form: Form): void;
  removeForm(id: string): void;
  duplicateForm(id: string): void;
  moveForm(id: string, dir: -1 | 1): void;

  addOp(formId: string, kind: string): void;
  updateOp(formId: string, opId: string, patch: Partial<Op> & { params?: Params }, key?: string): void;
  moveOp(formId: string, opId: string, dir: -1 | 1): void;
  removeOp(formId: string, opId: string): void;
  duplicateOp(formId: string, opId: string): void;

  loadRecipe(id: string): void;
  /** Replace the document (undoable). Input is validated; returns warnings. */
  importDoc(input: unknown): string[];
}

const STORAGE_KEY = 'vectr:doc:v2';
const LEGACY_KEY = 'vectr:doc:v1';

function loadDoc(): Doc {
  try {
    // Saved data goes through the same validator as imports; v1 saves are migrated.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) return parseDoc(raw).doc;
  } catch {
    /* storage unavailable or corrupt — fall through to the first recipe */
  }
  return RECIPES[0].build();
}

let lastKey: string | undefined;
let lastTime = 0;

const mapForm = (d: Doc, id: string, fn: (f: Form) => Form): Doc => ({ ...d, forms: d.forms.map((f) => (f.id === id ? fn(f) : f)) });
const mapOps = (d: Doc, id: string, fn: (ops: Op[]) => Op[]) => mapForm(d, id, (f) => ({ ...f, ops: fn(f.ops) }));
const swap = <T,>(list: T[], i: number, j: number) => {
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export const useStore = create<State>((set, get) => ({
  doc: loadDoc(),
  selectedId: null,
  tool: 'move',
  playing: false,
  mutateOpen: false,
  past: [],
  future: [],

  commit(fn, key) {
    const { doc, past } = get();
    const next = fn(doc);
    if (next === doc) return;
    const now = Date.now();
    const merge = key !== undefined && key === lastKey && now - lastTime < 1000;
    lastKey = key;
    lastTime = now;
    set({ doc: next, past: merge ? past : [...past.slice(-99), doc], future: [] });
  },
  undo() {
    const { past, doc, future, selectedId } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    lastKey = undefined;
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], selectedId: prev.forms.some((f) => f.id === selectedId) ? selectedId : null });
  },
  redo() {
    const { past, doc, future } = get();
    if (!future.length) return;
    lastKey = undefined;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1) });
  },

  select: (id) => set({ selectedId: id, mutateOpen: id ? get().mutateOpen : false }),
  setTool: (tool) => set({ tool }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setMutateOpen: (mutateOpen) => set({ mutateOpen: mutateOpen && get().selectedId !== null }),

  addForm(spec) {
    const { doc } = get();
    const jitter = (doc.forms.length % 5) * 24;
    const form = createForm(
      { ...spec, transform: { scale: Math.round(Math.min(doc.width, doc.height) * 0.3), ...spec.transform } },
      { x: doc.width / 2 + jitter, y: doc.height / 2 + jitter },
    );
    get().commit((d) => ({ ...d, forms: [...d.forms, form] }));
    set({ selectedId: form.id });
  },
  updateForm(id, patch, key) {
    get().commit((d) => mapForm(d, id, (f) => ({ ...f, ...patch })), key && `${id}:${key}`);
  },
  updateSource(id, patch, key) {
    get().commit((d) => mapForm(d, id, (f) => ({ ...f, source: { ...f.source, params: { ...f.source.params, ...patch } } })), key && `${id}:src:${key}`);
  },
  updateStyle(id, patch, key) {
    get().commit((d) => mapForm(d, id, (f) => ({ ...f, style: { ...f.style, ...patch } })), key && `${id}:st:${key}`);
  },
  replaceForm(id, form) {
    get().commit((d) => mapForm(d, id, () => ({ ...form, id })));
  },
  removeForm(id) {
    get().commit((d) => ({ ...d, forms: d.forms.filter((f) => f.id !== id) }));
    if (get().selectedId === id) set({ selectedId: null, mutateOpen: false });
  },
  duplicateForm(id) {
    const src = get().doc.forms.find((f) => f.id === id);
    if (!src) return;
    const copy: Form = { ...src, id: uid('f'), name: `${src.name} copy`, x: src.x + 24, y: src.y + 24, ops: src.ops.map((o) => ({ ...o, id: uid('o') })) };
    get().commit((d) => {
      const i = d.forms.findIndex((f) => f.id === id);
      const forms = [...d.forms];
      forms.splice(i + 1, 0, copy);
      return { ...d, forms };
    });
    set({ selectedId: copy.id });
  },
  moveForm(id, dir) {
    get().commit((d) => {
      const i = d.forms.findIndex((f) => f.id === id);
      const forms = swap(d.forms, i, i + dir);
      return forms === d.forms ? d : { ...d, forms };
    });
  },

  addOp(formId, kind) {
    if (!opFor(kind)) return;
    get().commit((d) => mapOps(d, formId, (ops) => [...ops, createOp(kind)]));
  },
  updateOp(formId, opId, patch, key) {
    get().commit(
      (d) => mapOps(d, formId, (ops) => ops.map((o) => (o.id === opId ? { ...o, ...patch, params: { ...o.params, ...patch.params } } : o))),
      key && `${formId}:${opId}:${key}`,
    );
  },
  moveOp(formId, opId, dir) {
    get().commit((d) => mapOps(d, formId, (ops) => {
      const i = ops.findIndex((o) => o.id === opId);
      return swap(ops, i, i + dir);
    }));
  },
  removeOp(formId, opId) {
    get().commit((d) => mapOps(d, formId, (ops) => ops.filter((o) => o.id !== opId)));
  },
  duplicateOp(formId, opId) {
    get().commit((d) => mapOps(d, formId, (ops) => {
      const i = ops.findIndex((o) => o.id === opId);
      if (i < 0) return ops;
      const out = [...ops];
      out.splice(i + 1, 0, { ...ops[i], id: uid('o') });
      return out;
    }));
  },

  loadRecipe(id) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return;
    const doc = r.build();
    get().commit(() => doc);
    set({ selectedId: null, mutateOpen: false, playing: doc.forms.some((f) => f.spin !== 0) });
  },
  importDoc(input) {
    const { doc, warnings } = parseDoc(input);
    get().commit(() => doc);
    set({ selectedId: null, mutateOpen: false, playing: doc.forms.some((f) => f.spin !== 0) });
    return warnings;
  },
}));

// Autosave (debounced). Storage failures are non-fatal.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.doc));
    } catch {
      /* ignore */
    }
  }, 400);
});

export const selectedForm = (s: State) => s.doc.forms.find((f) => f.id === s.selectedId) ?? null;
export const sourceName = (f: Form) => sourceFor(f.source.kind)?.name ?? f.source.kind;
