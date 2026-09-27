import { ChevronDown, ChevronRight, ChevronUp, Copy, Download, Eye, EyeOff, Lock, Search, Trash2, Unlock, Upload, X } from 'lucide-react';
import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { BLOCK_SOURCES, RECIPES, SHAPE_CATEGORIES, createForm, docToSVG, formToSVG, renderForm, shapeStarter, type FormSpec } from '@vectr/core';
import { download } from '../lib/export';
import { exportPresets, usePresets } from '../presets';
import { useStore } from '../store';
import { IconButton } from './controls';

/** What each source tile adds: the bare source, made visible on its own. */
export const SOURCE_STARTERS: Record<string, FormSpec> = {
  curve: { source: { kind: 'curve', params: { shape: 'circle' } } },
  lattice: { source: { kind: 'lattice' }, transform: { rx: -55, ry: 0, perspective: 0.3 } },
  points: { source: { kind: 'points' }, style: { markers: 'dot', markerSize: 3 } },
  formula: { source: { kind: 'formula' }, transform: { rx: 20, ry: 10 } },
  note: { source: { kind: 'note', params: { text: 'Note' } }, transform: { rx: 0, ry: 0 }, style: { taper: 'none', labelSize: 14 } },
};

const THUMB_RAMP = ['#52525b', '#a1a1aa', '#fafafa'];

const SourceThumb = memo(function SourceThumb({ kind }: { kind: string }) {
  const html = useMemo(() => {
    const form = createForm(SOURCE_STARTERS[kind], { x: 50, y: 50 });
    Object.assign(form, { scale: kind === 'note' ? 34 : 36, x: kind === 'note' ? 30 : 50, y: kind === 'note' ? 66 : 50 });
    form.style = { ...form.style, width: 1, markerSize: 1.3, labelSize: 11 };
    return formToSVG(form, renderForm(form, THUMB_RAMP));
  }, [kind]);
  return <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Framing tweaks so every shape fills its tile about the same. */
const SHAPE_THUMB_SCALE: Record<string, number> = {
  funnel: 30, vortex: 30, orbits: 28, arches: 30, maze: 32, frame: 26, flowfield: 30, saddle: 28, superquadric: 30, mobius: 32, contours: 32, spacefill: 34,
};

/** A small live render of any form spec: a shape, a saved preset. */
const SpecThumb = memo(function SpecThumb({ spec, scale = 36 }: { spec: FormSpec; scale?: number }) {
  const html = useMemo(() => {
    const form = createForm(spec, { x: 50, y: 50 });
    Object.assign(form, { scale, x: 50, y: 50 });
    form.style = { ...form.style, width: Math.min(form.style.width, 1.2) * 0.75, markerSize: Math.min(1.4, form.style.markerSize * 0.4), labels: false };
    return formToSVG(form, renderForm(form, THUMB_RAMP));
  }, [spec, scale]);
  return <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

const shapeSpecs = new Map<string, FormSpec>();
const specFor = (kind: string) => {
  let s = shapeSpecs.get(kind);
  if (!s) shapeSpecs.set(kind, (s = shapeStarter(kind)));
  return s;
};

const RecipeThumb = memo(function RecipeThumb({ id }: { id: string }) {
  const { html, w, h } = useMemo(() => {
    const doc = RECIPES.find((r) => r.id === id)!.build();
    const svg = docToSVG({ ...doc, forms: doc.forms.map((f) => ({ ...f, style: { ...f.style, width: f.style.width * 1.6 } })) });
    return { html: svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''), w: doc.width, h: doc.height };
  }, [id]);
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

const tile =
  'group flex w-full flex-col items-center gap-1 rounded-xl p-1 text-zinc-400 ring-1 ring-transparent transition hover:bg-white/[0.04] hover:text-zinc-100 hover:ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-accent';
const tileArt = 'aspect-square w-full rounded-lg bg-white/[0.025] p-1 transition-transform duration-300 group-hover:scale-[1.04]';

const OPEN_KEY = 'vectr:library:open';
function loadOpen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null');
    if (Array.isArray(raw)) return new Set(raw.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* ignore */
  }
  return new Set(['solids']);
}

function Disclosure({ id, title, count, open, onToggle, children }: { id: string; title: string; count: number; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <section className="mt-3 first:mt-0" aria-labelledby={`lib-${id}`}>
      <h3>
        <button
          id={`lib-${id}`}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`lib-${id}-panel`}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 transition hover:text-zinc-300 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="flex-1">{title}</span>
          <span className="font-mono text-[10px] text-zinc-600">{count}</span>
        </button>
      </h3>
      {open && <div id={`lib-${id}-panel`} className="mt-1.5">{children}</div>}
    </section>
  );
}

function MyShapes({ onAdd }: { onAdd?(): void }) {
  const presets = usePresets((s) => s.presets);
  const { remove, rename, importList } = usePresets.getState();
  const addForm = useStore((s) => s.addForm);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const onFile = async (file: File) => {
    try {
      const n = importList(JSON.parse(await file.text()));
      setNote(n ? `Added ${n} shape${n > 1 ? 's' : ''}` : 'No shapes found in that file');
    } catch {
      setNote('That file is not a Vectr shapes file');
    }
  };
  return (
    <>
      {presets.length === 0 ? (
        <p className="px-1 text-[11px] leading-snug text-zinc-500">Tune any form, then use <span className="text-zinc-300">Save as shape</span> in the right panel to keep it here.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5" aria-label="My shapes">
          {presets.map((p) => (
            <li key={p.id} className="group/tile relative">
              <button type="button" onClick={() => { addForm(p.spec); onAdd?.(); }} title={p.name} aria-label={`Add ${p.name}`} className={tile}>
                <span className={tileArt}><SpecThumb spec={p.spec} /></span>
                <span className="w-full truncate text-center text-[11px]">{p.name}</span>
              </button>
              <div className="absolute top-1.5 right-1.5 hidden gap-0.5 group-focus-within/tile:flex group-hover/tile:flex">
                <button
                  type="button"
                  aria-label={`Rename ${p.name}`}
                  title="Rename"
                  onClick={() => { const n = window.prompt('Rename shape', p.name); if (n) rename(p.id, n); }}
                  className="rounded bg-zinc-900/90 px-1 text-[10px] text-zinc-300 ring-1 ring-white/10 hover:text-white"
                >
                  Aa
                </button>
                <button type="button" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => remove(p.id)} className="rounded bg-zinc-900/90 p-0.5 text-zinc-300 ring-1 ring-white/10 hover:text-white">
                  <X size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
        >
          <Upload size={11} /> Import
        </button>
        {presets.length > 0 && (
          <button
            type="button"
            onClick={() => download(new Blob([exportPresets(presets)], { type: 'application/json' }), 'vectr-shapes.json')}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Download size={11} /> Export
          </button>
        )}
        <span role="status" className="ml-auto truncate text-[11px] text-zinc-500">{note}</span>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      </div>
    </>
  );
}

export function Library({ onAdd }: { onAdd?(): void }) {
  const addForm = useStore((s) => s.addForm);
  const loadRecipe = useStore((s) => s.loadRecipe);
  const presetCount = usePresets((s) => s.presets.length);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(loadOpen);
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
    return next;
  });
  const q = query.trim().toLowerCase();
  const match = (s: { name: string; blurb: string; kind: string }) => !q || `${s.name} ${s.blurb} ${s.kind}`.toLowerCase().includes(q);
  const categories = SHAPE_CATEGORIES.map((c) => ({ ...c, shapes: c.shapes.filter(match) })).filter((c) => c.shapes.length);
  const blocks = BLOCK_SOURCES.filter(match);

  return (
    <div className="px-3 pt-3 pb-2">
      <div className="relative mb-3">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <label htmlFor="shape-search" className="sr-only">Search shapes</label>
        <input
          id="shape-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shapes"
          className="w-full rounded-lg bg-white/[0.04] py-1.5 pr-2 pl-8 text-[12px] text-zinc-200 outline-none ring-1 ring-white/[0.06] placeholder:text-zinc-600 focus:ring-accent/70"
        />
      </div>

      {!q && (
        <Disclosure id="mine" title="My shapes" count={presetCount} open={open.has('mine')} onToggle={() => toggle('mine')}>
          <MyShapes onAdd={onAdd} />
        </Disclosure>
      )}

      {categories.map((c) => (
        <Disclosure key={c.id} id={c.id} title={c.name} count={c.shapes.length} open={Boolean(q) || open.has(c.id)} onToggle={() => toggle(c.id)}>
          <ul className="grid grid-cols-3 gap-1.5" aria-label={c.name}>
            {c.shapes.map((s) => (
              <li key={s.kind}>
                <button
                  type="button"
                  onClick={() => { addForm(specFor(s.kind)); onAdd?.(); }}
                  title={s.blurb}
                  aria-label={`Add ${s.name}: ${s.blurb}`}
                  className={tile}
                >
                  <span className={tileArt}>
                    <SpecThumb spec={specFor(s.kind)} scale={SHAPE_THUMB_SCALE[s.kind] ?? 36} />
                  </span>
                  <span className="w-full truncate text-center text-[11px]">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      ))}

      {blocks.length > 0 && (
        <Disclosure id="blocks" title="Build from scratch" count={blocks.length} open={Boolean(q) || open.has('blocks')} onToggle={() => toggle('blocks')}>
          <ul className="grid grid-cols-5 gap-1" aria-label="Building blocks">
            {blocks.map((s) => (
              <li key={s.kind}>
                <button
                  type="button"
                  onClick={() => { addForm(SOURCE_STARTERS[s.kind]); onAdd?.(); }}
                  title={s.blurb}
                  aria-label={`Add ${s.name}: ${s.blurb}`}
                  className={tile}
                >
                  <span className={tileArt}>
                    <SourceThumb kind={s.kind} />
                  </span>
                  <span className="w-full truncate text-center text-[10px]">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-[11px] leading-snug text-zinc-500">Any shape or block takes operators in the panel on the right. Formula takes your own equations.</p>
        </Disclosure>
      )}

      {q && !categories.length && !blocks.length && <p className="px-1 py-2 text-[12px] text-zinc-500">No shapes match “{query}”.</p>}

      {!q && (
        <Disclosure id="recipes" title="Recipes" count={RECIPES.length - 1} open={open.has('recipes')} onToggle={() => toggle('recipes')}>
          <ul className="grid grid-cols-2 gap-1.5" aria-label="Recipes">
            {RECIPES.filter((r) => r.id !== 'blank').map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { loadRecipe(r.id); onAdd?.(); }}
                  title={r.blurb}
                  aria-label={`Open recipe ${r.name}: ${r.blurb}`}
                  className="group block w-full overflow-hidden rounded-xl text-left ring-1 ring-white/[0.06] transition hover:ring-accent/50 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="block aspect-[4/3] overflow-hidden transition-transform duration-500 group-hover:scale-[1.03]">
                    <RecipeThumb id={r.id} />
                  </span>
                  <span className="block truncate bg-white/[0.02] px-2 py-1.5 text-[11px] text-zinc-300">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

export function Forms() {
  const forms = useStore((s) => s.doc.forms);
  const selectedId = useStore((s) => s.selectedId);
  const { select, updateForm, removeForm, duplicateForm, moveForm } = useStore.getState();
  const ordered = [...forms].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06] lg:max-h-[38%] lg:flex-none">
      <h2 className="px-4 pt-4 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        Forms <span className="ml-1 font-mono text-zinc-600">{forms.length}</span>
      </h2>
      {ordered.length === 0 && <p className="px-4 py-2 text-[13px] leading-relaxed text-zinc-500">Add a shape or open a recipe to begin.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Forms">
        {ordered.map((f) => {
          const active = f.id === selectedId;
          return (
            <li key={f.id}>
              <div className={`group flex items-center gap-1 rounded-lg py-0.5 pr-1 pl-2 transition-colors ${active ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.04]'}`}>
                <button
                  type="button"
                  onClick={() => select(f.id)}
                  aria-current={active}
                  className={`min-w-0 flex-1 truncate py-1.5 text-left text-[13px] ${active ? 'text-white' : f.visible ? 'text-zinc-300' : 'text-zinc-600'}`}
                >
                  {f.name}
                  {f.ops.length > 0 && <span className="ml-1.5 font-mono text-[10px] text-zinc-500">+{f.ops.length}</span>}
                </button>
                <div className="hidden items-center group-hover:flex group-focus-within:flex">
                  <IconButton label="Move up" onClick={() => moveForm(f.id, 1)} className="h-6 min-w-6"><ChevronUp size={14} /></IconButton>
                  <IconButton label="Move down" onClick={() => moveForm(f.id, -1)} className="h-6 min-w-6"><ChevronDown size={14} /></IconButton>
                  <IconButton label="Duplicate" onClick={() => duplicateForm(f.id)} className="h-6 min-w-6"><Copy size={13} /></IconButton>
                  <IconButton label="Delete" onClick={() => removeForm(f.id)} className="h-6 min-w-6"><Trash2 size={13} /></IconButton>
                </div>
                <IconButton label={f.locked ? 'Unlock' : 'Lock'} onClick={() => updateForm(f.id, { locked: !f.locked })} className="h-6 min-w-6">
                  {f.locked ? <Lock size={13} /> : <Unlock size={13} className="opacity-40" />}
                </IconButton>
                <IconButton label={f.visible ? 'Hide' : 'Show'} onClick={() => updateForm(f.id, { visible: !f.visible })} className="h-6 min-w-6">
                  {f.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
