import { Plus, X } from 'lucide-react';
import { THEMES, sampleRamp } from '@vectr/core';

const MAX_STOPS = 6;

/** CSS gradient that matches the renderer's OKLab interpolation closely. */
export const rampCSS = (stops: string[]) =>
  stops.length === 1 ? stops[0] : `linear-gradient(90deg, ${Array.from({ length: 12 }, (_, i) => sampleRamp(stops, i / 11)).join(', ')})`;

/**
 * Edit a colour ramp: a live gradient bar, one swatch per stop, and the theme
 * ramps as one-click presets. Far → near for depth, start → end along a line.
 */
export function RampEditor({ label, stops, onChange, hint }: { label: string; stops: string[]; onChange(stops: string[]): void; hint?: string }) {
  const set = (i: number, c: string) => onChange(stops.map((s, k) => (k === i ? c : s)));
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-zinc-300">{label}</span>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      <div className="h-6 rounded-md ring-1 ring-white/10" style={{ background: rampCSS(stops) }} aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-1.5">
        {stops.map((c, i) => (
          <div key={i} className="group relative">
            <label className="block h-7 w-7 cursor-pointer overflow-hidden rounded-md ring-1 ring-white/15 transition hover:scale-105" style={{ background: c }}>
              <span className="sr-only">Stop {i + 1} colour</span>
              <input type="color" value={c} onChange={(e) => set(i, e.target.value)} className="h-0 w-0 opacity-0" />
            </label>
            {stops.length > 1 && (
              <button
                type="button"
                aria-label={`Remove stop ${i + 1}`}
                onClick={() => onChange(stops.filter((_, k) => k !== i))}
                className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-white/20 group-hover:flex group-focus-within:flex"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
        {stops.length < MAX_STOPS && (
          <button
            type="button"
            aria-label="Add stop"
            onClick={() => onChange([...stops, sampleRamp(stops, 1)])}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 ring-1 ring-dashed ring-white/15 transition hover:text-white"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Ramp presets">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            title={`${t.name} ramp`}
            aria-label={`Use the ${t.name} ramp`}
            onClick={() => onChange([...t.ramp])}
            className="h-3 w-9 rounded-full ring-1 ring-white/10 transition hover:scale-110"
            style={{ background: rampCSS(t.ramp) }}
          />
        ))}
      </div>
    </div>
  );
}
