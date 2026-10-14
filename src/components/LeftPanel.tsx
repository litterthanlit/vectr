import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';
import { ELEMENTS, ELEMENT_ARTBOARD, RECIPES, SOURCES, createForm, docToSVG, formToSVG, placeElement, renderForm, type FormSpec, type Params, type Style } from '@vectr/core';
import { useStore } from '../store';
import { IconButton } from './controls';

/** What each source tile adds: the bare source, made visible on its own. */
export const SOURCE_STARTERS: Record<string, FormSpec> = {
  curve: { source: { kind: 'curve', params: { shape: 'circle' } } },
  lattice: { source: { kind: 'lattice' }, transform: { rx: -55, ry: 0, perspective: 0.3 } },
  points: { source: { kind: 'points' }, style: { markers: 'dot', markerSize: 3 } },
  note: { source: { kind: 'note', params: { text: 'Note' } }, transform: { rx: 0, ry: 0 }, style: { taper: 'none', labelSize: 14 } },
  orbits: { source: { kind: 'orbits' } },
  // Cards are always flat: their text stays upright, so a tilted frame would look broken.
  card: {
    source: { kind: 'card' },
    transform: { rx: 0, ry: 0, perspective: 0 },
    style: { taper: 'none', color: 'solid', fill: 'shapes', fillOpacity: 0.12, knockout: true, labelFont: 'sans', labelSize: 18, width: 1 },
  },
  // Blocks are flat (there is no surface to hide), solid, and coloured by relevance so the few that matter stand out.
  context: {
    source: { kind: 'context', params: { layout: 'burst' } },
    transform: { rx: 0, ry: 0, perspective: 0 },
    style: { fill: 'shapes', fillOpacity: 1, color: 'ramp', colorBy: 'family', taper: 'none', width: 0.6 },
  },
  // Like blocks, a strip is flat and solid. The default pattern is a single hyphenated bar, ready to be scaled up as a mark.
  strip: {
    source: { kind: 'strip' },
    transform: { rx: 0, ry: 0, perspective: 0 },
    style: { fill: 'shapes', fillOpacity: 1, color: 'ramp', colorBy: 'family', taper: 'none', width: 0.6 },
  },
};

/** A source added without a starter of its own still gets a tile, rather than crashing the panel. */
const starterFor = (kind: string): FormSpec => SOURCE_STARTERS[kind] ?? { source: { kind } };

const THUMB_RAMP = ['#52525b', '#a1a1aa', '#fafafa'];
/** The 100×100 box every tile draws into, which is what a finish's filter is cut to. */
const THUMB_VIEW = { x: 0, y: 0, w: 100, h: 100 };
/** The smallest finish scale a tile draws: a tenth of an artboard-sized finish is under a pixel on screen. */
const FINISH_FLOOR = 0.3;

/**
 * Where each source sits in its 100×100 thumbnail. A note's text starts at its origin; a card is centred and small enough to fit;
 * a context field is hundreds of small blocks, so its outlines are thinned or they would swallow the gaps between them.
 * A strip is drawn from a few short rows, so the tile shows steps, ramps and slanted ends rather than one thin bar, in the same mid grey as the other tiles.
 */
interface Thumb {
  scale: number;
  x: number;
  y: number;
  labelSize: number;
  width?: number;
  /** Source params and style the tile uses in place of the starter's. */
  params?: Params;
  style?: Partial<Style>;
}
const THUMB_LAYOUT: Record<string, Thumb> = {
  note: { scale: 34, x: 30, y: 66, labelSize: 11 },
  card: { scale: 28, x: 50, y: 50, labelSize: 7 },
  context: { scale: 40, x: 50, y: 50, labelSize: 11, width: 0.15 },
  strip: { scale: 40, x: 50, y: 50, labelSize: 11, width: 0.2, params: { pattern: '###-####\n######\n####-##\n#####', aspect: 1.1 }, style: { color: 'solid' } },
};
const THUMB_DEFAULT: Thumb = { scale: 36, x: 50, y: 50, labelSize: 11, width: 1 };

const SourceThumb = memo(function SourceThumb({ kind }: { kind: string }) {
  const html = useMemo(() => {
    const { labelSize, width = 1, params, style, ...place } = { ...THUMB_DEFAULT, ...THUMB_LAYOUT[kind] };
    const starter = starterFor(kind);
    const form = createForm(
      { ...starter, source: { ...starter.source, params: { ...starter.source.params, ...params } }, style: { ...starter.style, ...style } },
      { x: 50, y: 50 },
    );
    Object.assign(form, place);
    // A solid-colour starter would otherwise take the darkest ramp stop and look dim next to the ramped tiles.
    const stroke = form.style.color === 'solid' ? form.style.stroke ?? THUMB_RAMP[1] : form.style.stroke;
    form.style = { ...form.style, width, markerSize: 1.3, labelSize, stroke };
    // No paper: a thumbnail sits on its tile, so knockout fills are left see-through.
    return formToSVG(form, renderForm(form, THUMB_RAMP));
  }, [kind]);
  return <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

/**
 * An element's forms in a 100×100 thumbnail. Elements are authored for a 1000px artboard, so placing them at 100 shrinks
 * size and offsets tenfold; line weights and bead sizes would vanish at that scale, so they are re-derived here.
 */
const ElementThumb = memo(function ElementThumb({ id }: { id: string }) {
  const html = useMemo(() => {
    const element = ELEMENTS.find((e) => e.id === id)!;
    // placeElement shrinks a finish with the element (finishScale × 0.1 here), so its bleed and speckle keep their proportions;
    // the view keeps the finish's filter on the tile.
    return placeElement(element, 100, 100)
      .map((form) => {
        const st = form.style;
        // Caption text is tiny at this scale; nudge it up so a card tile still suggests lines of text.
        const legible = { width: 0.5 + st.width * 0.28, markerSize: Math.max(0.7, st.markerSize * 0.4), labelSize: st.labelSize * 1.25 };
        // A finished form is a mass of ink, not a line drawing, so it keeps near its true proportions: outlines and dots thick
        // enough to read would only fatten it. A tile is about 70 px wide, so the finish itself must not drop below roughly a
        // pixel of bleed or it stops fusing anything.
        const k = 100 / ELEMENT_ARTBOARD;
        form.style = st.finish === 'clean'
          ? { ...st, ...legible }
          : { ...st, ...legible, width: 0.3, markerSize: Math.max(1.2, st.markerSize * k), finishScale: Math.max(st.finishScale, FINISH_FLOOR) };
        return formToSVG(form, renderForm(form, THUMB_RAMP), undefined, THUMB_VIEW);
      })
      .join('');
  }, [id]);
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

/** A square-thumbnail tile that adds something to the document. */
function Tile({ name, blurb, verb = 'Add', onClick, children }: { name: string; blurb: string; verb?: string; onClick(): void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={blurb}
        aria-label={`${verb} ${name}: ${blurb}`}
        className="group flex w-full flex-col items-center gap-1 rounded-xl p-1 text-zinc-400 ring-1 ring-transparent transition hover:bg-white/[0.04] hover:text-zinc-100 hover:ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="aspect-square w-full rounded-lg bg-white/[0.025] p-1 transition-transform duration-300 group-hover:scale-[1.04]">{children}</span>
        <span className="w-full truncate text-center text-[11px]">{name}</span>
      </button>
    </li>
  );
}

export function Library({ onAdd }: { onAdd?(): void }) {
  const addForm = useStore((s) => s.addForm);
  const addElement = useStore((s) => s.addElement);
  const loadRecipe = useStore((s) => s.loadRecipe);
  return (
    <div className="px-3 pt-4 pb-2 lg:overflow-y-auto">
      <h2 className={heading}>Sources</h2>
      <ul className="grid grid-cols-3 gap-1.5">
        {SOURCES.map((s) => (
          <Tile key={s.kind} name={s.name} blurb={s.blurb} onClick={() => { addForm(starterFor(s.kind)); onAdd?.(); }}>
            <SourceThumb kind={s.kind} />
          </Tile>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[11px] leading-snug text-zinc-500">Then stack operators on it in the panel on the right.</p>

      <h2 className={`${heading} mt-5`}>Elements</h2>
      <ul className="grid grid-cols-3 gap-1.5">
        {ELEMENTS.map((e) => (
          <Tile key={e.id} name={e.name} blurb={e.blurb} onClick={() => { addElement(e.id); onAdd?.(); }}>
            <ElementThumb id={e.id} />
          </Tile>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[11px] leading-snug text-zinc-500">Ready-made pieces: several forms placed together on the artboard.</p>

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
    <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06] lg:min-h-[168px]">
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
