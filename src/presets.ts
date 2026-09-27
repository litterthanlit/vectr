import { create } from 'zustand';
import { parseDoc, uid, type Form, type FormSpec } from '@vectr/core';

/** A form the user saved to reuse: its source, operators, style and camera. */
export interface Preset {
  id: string;
  name: string;
  spec: FormSpec;
}

const KEY = 'vectr:presets:v1';
const MAX_PRESETS = 60;

export function specOf(f: Form): FormSpec {
  return {
    name: f.name,
    source: { kind: f.source.kind, params: { ...f.source.params } },
    ops: f.ops.map((o) => ({ kind: o.kind, params: { ...o.params }, enabled: o.enabled })),
    style: { ...f.style },
    transform: { scale: f.scale, rx: f.rx, ry: f.ry, rz: f.rz, perspective: f.perspective },
    spin: f.spin,
  };
}

/**
 * Run untrusted presets (storage, imported files) through the document validator,
 * so a bad entry is repaired or dropped instead of breaking the library.
 */
export function cleanPresets(input: unknown): Preset[] {
  if (!Array.isArray(input)) return [];
  const out: Preset[] = [];
  for (const raw of input.slice(0, MAX_PRESETS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { name, spec } = raw as { name?: unknown; spec?: FormSpec };
    if (!spec || typeof spec !== 'object') continue;
    const { transform, ...rest } = spec;
    const { doc } = parseDoc({ version: 2, forms: [{ ...rest, ...(transform ?? {}), spin: spec.spin ?? 0 }] });
    const f = doc.forms[0];
    if (!f) continue;
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : f.name;
    out.push({ id: uid('p'), name: label, spec: { ...specOf(f), name: label } });
  }
  return out;
}

function load(): Preset[] {
  try {
    return cleanPresets(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

interface PresetState {
  presets: Preset[];
  save(form: Form, name: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  /** Add presets from an exported file; returns how many were added. */
  importList(input: unknown): number;
}

export const usePresets = create<PresetState>((set, get) => ({
  presets: load(),
  save(form, name) {
    const label = name.trim().slice(0, 60) || form.name;
    set({ presets: [...get().presets, { id: uid('p'), name: label, spec: { ...specOf(form), name: label } }].slice(-MAX_PRESETS) });
  },
  remove(id) {
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },
  rename(id, name) {
    const label = name.trim().slice(0, 60);
    if (!label) return;
    set({ presets: get().presets.map((p) => (p.id === id ? { ...p, name: label, spec: { ...p.spec, name: label } } : p)) });
  },
  importList(input) {
    const list = cleanPresets(Array.isArray(input) ? input : (input as { presets?: unknown })?.presets);
    set({ presets: [...get().presets, ...list].slice(-MAX_PRESETS) });
    return list.length;
  },
}));

usePresets.subscribe((s, prev) => {
  if (s.presets === prev.presets) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s.presets.map(({ name, spec }) => ({ name, spec }))));
  } catch {
    /* storage full or blocked: presets stay for this session */
  }
});

export function exportPresets(presets: Preset[]): string {
  return JSON.stringify({ format: 'vectr-shapes', version: 1, presets: presets.map(({ name, spec }) => ({ name, spec })) }, null, 2);
}
