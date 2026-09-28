import { create } from 'zustand';
import { createLayer, randomParams, uid } from './lib/generators';
import { TEMPLATES } from './lib/templates';
import type { Doc, Layer, LayerStyle, Params } from './lib/types';
import type { VectorPath } from './lib/path';
import { anchorCount } from './lib/path';
import { PATH_TYPE, convertToPaths, recenter } from './lib/vector-layer';

/** move/orbit act on layers; edit moves anchors and handles; pen draws new paths. */
export type Tool = 'move' | 'orbit' | 'edit' | 'pen';

export type AgentStatus = 'off' | 'connecting' | 'live';

interface State {
  doc: Doc;
  selectedId: string | null;
  tool: Tool;
  playing: boolean;
  past: Doc[];
  future: Doc[];
  /** Selected anchors of the selected path layer, as "subpath:index" keys. */
  anchorSel: string[];
  /** Path layer currently being drawn with the pen tool. */
  penLayerId: string | null;
  agent: { status: AgentStatus; activity: string | null; at: number };

  /** Apply a doc change. Changes sharing a `key` within a second merge into one undo step. */
  commit(fn: (d: Doc) => Doc, key?: string): void;
  undo(): void;
  redo(): void;

  select(id: string | null): void;
  setTool(t: Tool): void;
  togglePlay(): void;

  addLayer(type: string): void;
  updateLayer(id: string, patch: Partial<Layer>, key?: string): void;
  updateParams(id: string, patch: Params, key?: string): void;
  updateStyle(id: string, patch: Partial<LayerStyle>, key?: string): void;
  randomize(id: string): void;
  resetLayer(id: string): void;
  removeLayer(id: string): void;
  duplicateLayer(id: string): void;
  moveLayer(id: string, dir: -1 | 1): void;
  loadTemplate(id: string): void;

  setAnchorSel(keys: string[]): void;
  /** Replace a path layer's local geometry. */
  updatePath(id: string, path: VectorPath, key?: string): void;
  replaceLayer(layer: Layer, key?: string): void;
  addLayers(layers: Layer[], select?: boolean): void;
  convertToPath(id: string): void;
  finishPen(): void;
  /** Apply a document pushed by an agent (one undo step, no echo). */
  applyRemote(doc: Doc, activity?: string, layerIds?: string[]): void;
  setAgent(patch: Partial<State['agent']>): void;
}

const STORAGE_KEY = 'vectr:doc:v1';

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Doc;
      if (d && Array.isArray(d.layers)) return d;
    }
  } catch {
    /* storage unavailable or corrupt — fall through to the starter template */
  }
  return TEMPLATES[0].build();
}

let lastKey: string | undefined;
let lastTime = 0;

const mapLayer = (d: Doc, id: string, fn: (l: Layer) => Layer): Doc => ({
  ...d,
  layers: d.layers.map((l) => (l.id === id ? fn(l) : l)),
});

export const useStore = create<State>((set, get) => ({
  doc: loadDoc(),
  selectedId: null,
  tool: 'move',
  playing: false,
  past: [],
  future: [],
  anchorSel: [],
  penLayerId: null,
  agent: { status: 'off', activity: null, at: 0 },

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
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      selectedId: prev.layers.some((l) => l.id === selectedId) ? selectedId : null,
      anchorSel: [],
    });
  },
  redo() {
    const { past, doc, future } = get();
    if (!future.length) return;
    lastKey = undefined;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), anchorSel: [] });
  },

  select: (id) => set((s) => (s.selectedId === id ? {} : { selectedId: id, anchorSel: [] })),
  setTool: (tool) => {
    if (get().tool === 'pen' && tool !== 'pen') get().finishPen();
    set({ tool, anchorSel: tool === 'edit' ? get().anchorSel : [] });
  },
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  addLayer(type) {
    const { doc } = get();
    const n = doc.layers.length;
    const jitter = (n % 5) * 24;
    const layer = createLayer(type, { x: doc.width / 2 + jitter, y: doc.height / 2 + jitter }, {
      scale: Math.round(Math.min(doc.width, doc.height) * 0.28),
    });
    get().commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    set({ selectedId: layer.id });
  },
  updateLayer(id, patch, key) {
    get().commit((d) => mapLayer(d, id, (l) => ({ ...l, ...patch })), key && `${id}:${key}`);
  },
  updateParams(id, patch, key) {
    get().commit((d) => mapLayer(d, id, (l) => ({ ...l, params: { ...l.params, ...patch } })), key && `${id}:p:${key}`);
  },
  updateStyle(id, patch, key) {
    get().commit((d) => mapLayer(d, id, (l) => ({ ...l, style: { ...l.style, ...patch } })), key && `${id}:s:${key}`);
  },
  randomize(id) {
    get().commit((d) => mapLayer(d, id, (l) => (l.type === PATH_TYPE ? l : { ...l, params: randomParams(l.type, l.params) })));
  },
  resetLayer(id) {
    get().commit((d) =>
      mapLayer(d, id, (l) => {
        if (l.type === PATH_TYPE) return l;
        const fresh = createLayer(l.type, { x: l.x, y: l.y }, { scale: l.scale });
        return { ...fresh, id: l.id, name: l.name };
      }),
    );
  },
  removeLayer(id) {
    get().commit((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    if (get().selectedId === id) set({ selectedId: null });
  },
  duplicateLayer(id) {
    const src = get().doc.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: Layer = { ...src, id: uid(), name: `${src.name} copy`, x: src.x + 24, y: src.y + 24 };
    get().commit((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const layers = [...d.layers];
      layers.splice(i + 1, 0, copy);
      return { ...d, layers };
    });
    set({ selectedId: copy.id });
  },
  moveLayer(id, dir) {
    get().commit((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...d, layers };
    });
  },
  loadTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    get().commit(() => t.build());
    set({ selectedId: null, playing: id === 'globe', anchorSel: [], penLayerId: null });
  },

  setAnchorSel: (keys) => set({ anchorSel: keys }),
  updatePath(id, path, key) {
    get().commit((d) => mapLayer(d, id, (l) => ({ ...l, path })), key && `${id}:path:${key}`);
  },
  replaceLayer(layer, key) {
    get().commit((d) => mapLayer(d, layer.id, () => layer), key && `${layer.id}:${key}`);
  },
  addLayers(layers, select = true) {
    if (!layers.length) return;
    get().commit((d) => ({ ...d, layers: [...d.layers, ...layers] }));
    if (select) set({ selectedId: layers[layers.length - 1].id, anchorSel: [] });
  },
  convertToPath(id) {
    const src = get().doc.layers.find((l) => l.id === id);
    if (!src || src.type === PATH_TYPE) return;
    const paths = convertToPaths(src);
    if (!paths.length) return;
    get().commit((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const layers = [...d.layers];
      // Hidden lines sit underneath the main strokes.
      layers.splice(i, 1, ...[...paths].reverse());
      return { ...d, layers };
    });
    set({ selectedId: paths[0].id, anchorSel: [] });
  },
  finishPen() {
    const id = get().penLayerId;
    if (!id) return;
    set({ penLayerId: null });
    const l = get().doc.layers.find((x) => x.id === id);
    if (!l?.path) return;
    if (anchorCount(l.path) < 2) {
      get().commit((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== id) }), `${id}:pen`);
      set({ selectedId: null });
    } else {
      get().commit((d) => mapLayer(d, id, recenter), `${id}:pen`);
    }
  },
  applyRemote(doc, activity, layerIds) {
    remoteApplying = true;
    try {
      lastKey = undefined;
      get().commit(() => doc);
    } finally {
      remoteApplying = false;
    }
    const s = get();
    const valid = (id: string | null) => !!id && doc.layers.some((l) => l.id === id);
    const pick = layerIds?.filter((id) => doc.layers.some((l) => l.id === id)).at(-1);
    set({
      selectedId: pick ?? (valid(s.selectedId) ? s.selectedId : null),
      anchorSel: pick && pick !== s.selectedId ? [] : s.anchorSel,
      penLayerId: valid(s.penLayerId) ? s.penLayerId : null,
      ...(activity && { agent: { ...s.agent, activity, at: Date.now() } }),
    });
  },
  setAgent: (patch) => set((s) => ({ agent: { ...s.agent, ...patch } })),
}));

/** True while a remote (agent) document is being applied, so it is not sent back. */
let remoteApplying = false;
export const isApplyingRemote = () => remoteApplying;

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

export const selectedLayer = (s: State) => s.doc.layers.find((l) => l.id === s.selectedId) ?? null;
