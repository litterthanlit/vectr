import { useId, useState, type ReactNode } from 'react';

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-4 py-4" aria-label={title}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">{title}</h3>
        {action}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Slider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange(v: number): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const pct = ((value - min) / (max - min)) * 100;
  const commitDraft = () => {
    if (draft !== null) {
      const v = parseFloat(draft);
      if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      setDraft(null);
    }
  };
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
      <label htmlFor={id} className="text-[13px] text-zinc-300">{label}</label>
      <input
        aria-label={`${label} value`}
        className="w-16 rounded-md bg-white/[0.04] px-2 py-1 text-right font-mono text-[12px] text-zinc-200 outline-none ring-1 ring-white/[0.06] focus:ring-accent/70"
        value={draft ?? `${value.toFixed(decimals)}${unit ?? ''}`}
        onFocus={(e) => { setDraft(value.toFixed(decimals)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="vectr-range col-span-2"
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-zinc-300">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${checked ? 'bg-accent' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

export function Select({
  label, value, options, onChange,
}: { label: string; value: string; options: { value: string; label: string }[]; onChange(v: string): void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-[13px] text-zinc-300">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 max-w-[60%] rounded-md bg-white/[0.04] px-2 py-1.5 text-[13px] text-zinc-200 outline-none ring-1 ring-white/[0.06] focus:ring-accent/70"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange(v: T): void }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] text-zinc-300">{label}</div>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              value === o.value ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {o.icon ?? o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange(v: string): void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[13px] text-zinc-300">{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-white/[0.04] px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none ring-1 ring-white/[0.06] placeholder:text-zinc-600 focus:ring-accent/70"
      />
    </div>
  );
}

export function ColorField({
  label, value, swatches, onChange, allowInherit, inheritLabel = 'Ink',
}: {
  label: string; value: string | null; swatches: string[]; onChange(v: string | null): void;
  allowInherit?: boolean; inheritLabel?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[13px] text-zinc-300">{label}</label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-zinc-500">{value ?? inheritLabel}</span>
          <input
            id={id}
            type="color"
            value={value ?? swatches[0]}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-6 cursor-pointer rounded-md border-0 bg-transparent p-0"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {allowInherit && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={`h-6 rounded-md px-2 text-[11px] ring-1 transition ${value === null ? 'bg-white/10 text-white ring-accent/70' : 'text-zinc-400 ring-white/10 hover:text-zinc-200'}`}
          >
            {inheritLabel}
          </button>
        )}
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Use ${c}`}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-md ring-1 transition hover:scale-110 ${value?.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-accent' : 'ring-white/15'}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function IconButton({
  label, onClick, children, active, disabled, shortcut, className = '',
}: {
  label: string; onClick?(): void; children: ReactNode; active?: boolean; disabled?: boolean; shortcut?: string; className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30 ${
        active ? 'bg-white/10 text-white' : ''
      } ${className}`}
    >
      {children}
    </button>
  );
}
