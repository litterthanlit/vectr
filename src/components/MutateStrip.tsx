import { Shuffle, Sparkles, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { formToSVG, renderForm, variations, type Form } from '@vectr/core';
import { selectedForm, useStore } from '../store';
import { IconButton, Segmented } from './controls';

type Strength = 'subtle' | 'medium' | 'wild';
const STRENGTH: Record<Strength, number> = { subtle: 0.12, medium: 0.3, wild: 0.65 };
const COUNT = 6;
const THUMB_PX = 130;

/** A variation drawn on its own, framed to its bounding box. */
const Variant = memo(function Variant({ form, ramp, background }: { form: Form; ramp: string[]; background: string }) {
  const { html, box } = useMemo(() => {
    const probe = renderForm(form, ramp);
    const pad = Math.max(probe.bbox.w, probe.bbox.h) * 0.08 + 4;
    const side = Math.max(probe.bbox.w, probe.bbox.h) + pad * 2;
    const cx = probe.bbox.x + probe.bbox.w / 2, cy = probe.bbox.y + probe.bbox.h / 2;
    // The thumbnail shrinks the form to ~130px, so thicken strokes to stay legible.
    const k = Math.max(1, (side / THUMB_PX) * 0.9);
    const thick: Form = { ...form, style: { ...form.style, width: form.style.width * k, markerSize: form.style.markerSize * k } };
    return { html: formToSVG(thick, renderForm(thick, ramp)), box: `${cx - side / 2} ${cy - side / 2} ${side} ${side}` };
  }, [form, ramp]);
  return (
    <svg viewBox={box} className="h-full w-full" style={{ background }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
  );
});

/**
 * Explore by selection instead of by sliders: six mutations of the selected form.
 * Picking one applies it (undoable) and the next generation grows from it.
 */
export function MutateStrip() {
  const form = useStore(selectedForm);
  const open = useStore((s) => s.mutateOpen);
  const doc = useStore((s) => s.doc);
  const { replaceForm, setMutateOpen } = useStore.getState();
  const [seed, setSeed] = useState(1);
  const [strength, setStrength] = useState<Strength>('medium');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMutateOpen(false);
      const n = Number(e.key);
      if (n >= 1 && n <= COUNT && !(e.target instanceof HTMLInputElement)) document.getElementById(`variant-${n}`)?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setMutateOpen]);

  const list = useMemo(() => (form && open ? variations(form, COUNT, seed, STRENGTH[strength]) : []), [form, open, seed, strength]);
  if (!open || !form) return null;

  return (
    <section
      aria-label={`Variations of ${form.name}`}
      className="vectr-pop absolute right-3 bottom-20 left-3 z-20 mx-auto max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/80 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <h2 className="text-[13px] font-medium text-white">Mutate</h2>
        <p className="hidden text-[12px] text-zinc-500 sm:block">Pick a variation to evolve from it. Keys 1–6.</p>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-44">
            <Segmented<Strength>
              label=""
              value={strength}
              onChange={setStrength}
              options={[{ value: 'subtle', label: 'Subtle' }, { value: 'medium', label: 'Medium' }, { value: 'wild', label: 'Wild' }]}
            />
          </div>
          <IconButton label="New variations" onClick={() => setSeed((s) => s + 1)}><Shuffle size={15} /></IconButton>
          <IconButton label="Close mutate" onClick={() => setMutateOpen(false)}><X size={15} /></IconButton>
        </div>
      </header>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {list.map((v, i) => (
          <li key={`${seed}-${i}`}>
            <button
              id={`variant-${i + 1}`}
              type="button"
              aria-label={`Use variation ${i + 1}`}
              onClick={() => {
                replaceForm(form.id, v);
                setSeed((s) => s + 1);
              }}
              className="group relative block aspect-square w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-2 hover:ring-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Variant form={v} ramp={doc.ramp} background={doc.background} />
              <span className="absolute top-1 left-1.5 font-mono text-[10px] text-zinc-500 group-hover:text-accent">{i + 1}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
