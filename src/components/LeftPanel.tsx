import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { memo, useMemo } from 'react';
import { RECIPES, SOURCES, createForm, docToSVG, formToSVG, renderForm, type FormSpec } from '@vectr/core';
import { useStore } from '../store';
import { IconButton } from './controls';

/** What each source tile adds: the bare source, made visible on its own. */
export const SOURCE_STARTERS: Record<string, FormSpec> = {
  curve: { source: { kind: 'curve', params: { shape: 'circle' } } },
  lattice: { source: { kind: 'lattice' }, transform: { rx: -55, ry: 0, perspective: 0.3 } },
  points: { source: { kind: 'points' }, style: { markers: 'dot', markerSize: 3 } },
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

const RecipeThumb = memo(function RecipeThumb({ id }: { id: string }) {
  const { html, w, h } = useMemo(() => {
    const doc = RECIPES.find((r) => r.id === id)!.build();
    const svg = docToSVG({ ...doc, forms: doc.forms.map((f) => ({ ...f, style: { ...f.style, width: f.style.width * 1.6 } })) });
    return { html: svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''), w: doc.width, h: doc.height };
  }, [id]);
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

const heading = 'mb-2.5 px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500';

export function Library({ onAdd }: { onAdd?(): void }) {
  const addForm = useStore((s) => s.addForm);
  const loadRecipe = useStore((s) => s.loadRecipe);
  return (
    <div className="px-3 pt-4 pb-2">
      <h2 className={heading}>Sources</h2>
      <ul className="grid grid-cols-4 gap-1.5">
        {SOURCES.map((s) => (
          <li key={s.kind}>
            <button
              type="button"
              onClick={() => { addForm(SOURCE_STARTERS[s.kind]); onAdd?.(); }}
              title={s.blurb}
              aria-label={`Add ${s.name}: ${s.blurb}`}
              className="group flex w-full flex-col items-center gap-1 rounded-xl p-1 text-zinc-400 ring-1 ring-transparent transition hover:bg-white/[0.04] hover:text-zinc-100 hover:ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="aspect-square w-full rounded-lg bg-white/[0.025] p-1 transition-transform duration-300 group-hover:scale-[1.04]">
                <SourceThumb kind={s.kind} />
              </span>
              <span className="truncate text-[11px]">{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[11px] leading-snug text-zinc-500">Then stack operators on it in the panel on the right.</p>

      <h2 className={`${heading} mt-5`}>Recipes</h2>
      <ul className="grid grid-cols-2 gap-1.5">
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
    </div>
  );
}

export function Forms() {
  const forms = useStore((s) => s.doc.forms);
  const selectedId = useStore((s) => s.selectedId);
  const { select, updateForm, removeForm, duplicateForm, moveForm } = useStore.getState();
  const ordered = [...forms].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06]">
      <h2 className="px-4 pt-4 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        Forms <span className="ml-1 font-mono text-zinc-600">{forms.length}</span>
      </h2>
      {ordered.length === 0 && <p className="px-4 py-2 text-[13px] leading-relaxed text-zinc-500">Add a source or open a recipe to begin.</p>}
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
