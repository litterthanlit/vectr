import {
  ChevronDown, ChevronRight, ChevronUp, Copy, Eye, EyeOff, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ARTBOARD_SIZES, MAX_OPS, OPERATORS, STYLE_PARAMS, THEMES, opFor, sourceFor,
  type Doc, type Form, type Op, type ParamDef, type Style,
} from '@vectr/core';
import { selectedForm, useStore } from '../store';
import { ColorField, IconButton, Section, Slider, Toggle } from './controls';
import { ParamFields } from './ParamFields';
import { RampEditor, rampCSS } from './RampEditor';

const STYLE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Line', keys: ['width', 'taper', 'taperAmount', 'hidden'] },
  { title: 'Colour', keys: ['color', 'colorBy'] },
  { title: 'Fill & markers', keys: ['fill', 'fillOpacity', 'markers', 'markerSize', 'markerEvery', 'markersByDepth'] },
  { title: 'Labels & opacity', keys: ['labels', 'labelSize', 'opacity'] },
];

/** A card in the build pipeline: numbered and collapsible; secondary actions live inside. */
function Card({
  index, title, subtitle, open, onToggle, dimmed, toggle, actions, children,
}: {
  index: string; title: string; subtitle?: string; open: boolean; onToggle(): void; dimmed?: boolean;
  toggle?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="relative rounded-xl bg-white/[0.025] ring-1 ring-white/[0.06]">
      <div className="flex items-center gap-1 py-1 pr-1 pl-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-left transition ${dimmed ? 'opacity-45' : ''}`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] font-mono text-[10px] text-zinc-400">{index}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-zinc-100">{title}</span>
            {subtitle && <span className="block truncate text-[11px] text-zinc-500">{subtitle}</span>}
          </span>
          {open ? <ChevronDown size={14} className="shrink-0 text-zinc-500" /> : <ChevronRight size={14} className="shrink-0 text-zinc-500" />}
        </button>
        {toggle}
      </div>
      {open && (
        <div className="space-y-3 border-t border-white/[0.05] px-3 pt-3 pb-2.5">
          {children}
          {actions && <div className="-mr-1 flex justify-end gap-0.5 border-t border-white/[0.04] pt-1.5">{actions}</div>}
        </div>
      )}
    </li>
  );
}

function AddOperator({ form }: { form: Form }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const addOp = useStore((s) => s.addOp);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const full = form.ops.length >= MAX_OPS;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={full}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 py-2 text-[12px] text-zinc-400 transition hover:border-accent/60 hover:text-white disabled:opacity-40"
      >
        <Plus size={14} /> {full ? `Up to ${MAX_OPS} operators` : 'Add operator'}
      </button>
      {open && (
        <div role="menu" className="vectr-pop absolute right-0 left-0 z-40 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur-xl">
          {OPERATORS.map((o) => (
            <button
              key={o.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                addOp(form.id, o.kind);
                setOpen(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none"
            >
              <span className="block text-[13px] text-zinc-100">{o.name}</span>
              <span className="block text-[11px] leading-snug text-zinc-500">{o.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pipeline({ form }: { form: Form }) {
  const { updateSource, updateOp, moveOp, removeOp, duplicateOp } = useStore.getState();
  const src = sourceFor(form.source.kind);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(['source']));
  const prevCount = useRef(form.ops.length);
  // Open a newly added operator so its settings are right there.
  useEffect(() => {
    if (form.ops.length > prevCount.current) setOpenIds((s) => new Set(s).add(form.ops[form.ops.length - 1].id));
    prevCount.current = form.ops.length;
  }, [form.ops]);
  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const shape = form.source.params.shape;
  const shapeLabel = src?.params.find((d) => d.key === 'shape');
  const subtitle = shapeLabel && 'options' in shapeLabel ? shapeLabel.options.find((o) => o.value === shape)?.label : src?.blurb;

  return (
    <Section title="Build">
      <ol className="space-y-1.5" aria-label="Source and operators, applied top to bottom">
        {src && (
          <Card index="S" title={src.name} subtitle={subtitle} open={openIds.has('source')} onToggle={() => toggle('source')}>
            <ParamFields defs={src.params} values={form.source.params} onChange={(k, v) => updateSource(form.id, { [k]: v }, k)} />
          </Card>
        )}
        {form.ops.map((op: Op, i) => {
          const def = opFor(op.kind);
          if (!def) return null;
          return (
            <Card
              key={op.id}
              index={String(i + 1)}
              title={def.name}
              subtitle={def.blurb}
              open={openIds.has(op.id)}
              onToggle={() => toggle(op.id)}
              dimmed={!op.enabled}
              toggle={
                <IconButton label={op.enabled ? `Turn ${def.name} off` : `Turn ${def.name} on`} onClick={() => updateOp(form.id, op.id, { enabled: !op.enabled })} className="h-7 min-w-7">
                  {op.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconButton>
              }
              actions={
                <>
                  <IconButton label="Move up" disabled={i === 0} onClick={() => moveOp(form.id, op.id, -1)} className="h-7 min-w-7"><ChevronUp size={14} /></IconButton>
                  <IconButton label="Move down" disabled={i === form.ops.length - 1} onClick={() => moveOp(form.id, op.id, 1)} className="h-7 min-w-7"><ChevronDown size={14} /></IconButton>
                  <IconButton label="Duplicate" disabled={form.ops.length >= MAX_OPS} onClick={() => duplicateOp(form.id, op.id)} className="h-7 min-w-7"><Copy size={13} /></IconButton>
                  <IconButton label={`Remove ${def.name}`} onClick={() => removeOp(form.id, op.id)} className="h-7 min-w-7"><Trash2 size={13} /></IconButton>
                </>
              }
            >
              <ParamFields defs={def.params} values={op.params} onChange={(k, v) => updateOp(form.id, op.id, { params: { [k]: v } }, k)} />
            </Card>
          );
        })}
      </ol>
      <AddOperator form={form} />
    </Section>
  );
}

function StyleSections({ form, doc }: { form: Form; doc: Doc }) {
  const updateStyle = useStore((s) => s.updateStyle);
  const st = form.style;
  const values = st as unknown as Record<string, string | number | boolean>;
  const set = (k: string, v: unknown) => updateStyle(form.id, { [k]: v } as Partial<Style>, k);
  const inGroup = (keys: string[]) => (d: ParamDef) => keys.includes(d.key);
  return (
    <>
      {STYLE_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          <ParamFields defs={STYLE_PARAMS} values={values} only={inGroup(g.keys)} onChange={set} />
          {g.title === 'Colour' &&
            (st.color === 'ramp' ? (
              <>
                <Toggle label="Own ramp" checked={st.ramp !== null} onChange={(on) => set('ramp', on ? [...doc.ramp] : null)} />
                {st.ramp ? (
                  <RampEditor label="Ramp" hint={st.colorBy === 'depth' ? 'far → near' : 'start → end'} stops={st.ramp} onChange={(r) => set('ramp', r)} />
                ) : (
                  <div className="h-3 rounded-full ring-1 ring-white/10" style={{ background: rampCSS(doc.ramp) }} title="Document ramp" />
                )}
              </>
            ) : (
              <ColorField label="Line colour" value={st.stroke} swatches={doc.ramp} allowInherit inheritLabel="Ramp start" onChange={(c) => set('stroke', c)} />
            ))}
        </Section>
      ))}
    </>
  );
}

function FormInspector({ form }: { form: Form }) {
  const { updateForm, setMutateOpen } = useStore.getState();
  const doc = useStore((s) => s.doc);
  const mutateOpen = useStore((s) => s.mutateOpen);
  const T = (k: keyof Form) => (v: number) => updateForm(form.id, { [k]: v } as Partial<Form>, String(k));
  return (
    <>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <label className="sr-only" htmlFor="form-name">Form name</label>
        <input
          id="form-name"
          value={form.name}
          onChange={(e) => updateForm(form.id, { name: e.target.value }, 'name')}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 text-[15px] font-medium text-white outline-none ring-1 ring-transparent hover:ring-white/10 focus:ring-accent/70"
        />
        <button
          type="button"
          onClick={() => setMutateOpen(!mutateOpen)}
          aria-pressed={mutateOpen}
          title="Mutate (M): explore variations"
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium ring-1 transition ${
            mutateOpen ? 'bg-accent text-zinc-950 ring-accent' : 'text-zinc-200 ring-white/15 hover:ring-accent/60'
          }`}
        >
          <Sparkles size={13} /> Mutate
        </button>
      </div>
      <Pipeline form={form} />
      <StyleSections form={form} doc={doc} />
      <Section title="Rotation & camera">
        <Slider label="Tilt (X)" min={-90} max={90} step={1} unit="°" value={form.rx} onChange={T('rx')} />
        <Slider label="Turn (Y)" min={-180} max={180} step={1} unit="°" value={((form.ry + 540) % 360) - 180} onChange={T('ry')} />
        <Slider label="Roll (Z)" min={-180} max={180} step={1} unit="°" value={form.rz} onChange={T('rz')} />
        <Slider label="Perspective" min={0} max={1} step={0.01} value={form.perspective} onChange={T('perspective')} />
        <Slider label="Spin" min={-90} max={90} step={1} unit="°/s" value={form.spin} onChange={T('spin')} />
      </Section>
      <Section title="Position">
        <div className="grid grid-cols-2 gap-3">
          <Slider label="X" min={0} max={doc.width} step={1} value={form.x} onChange={T('x')} />
          <Slider label="Y" min={0} max={doc.height} step={1} value={form.y} onChange={T('y')} />
        </div>
        <Slider label="Size" min={8} max={Math.max(doc.width, doc.height)} step={1} value={form.scale} onChange={T('scale')} />
      </Section>
    </>
  );
}

function DocInspector() {
  const doc = useStore((s) => s.doc);
  const commit = useStore((s) => s.commit);
  const set = (patch: Partial<Doc>, key?: string) => commit((d) => ({ ...d, ...patch }), key && `doc:${key}`);
  return (
    <>
      <div className="border-b border-white/[0.06] px-4 py-4">
        <h2 className="text-[15px] font-medium text-white">Document</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          Add a source on the left, then stack operators on it. Drag to move; hold <kbd className="kbd">Alt</kbd> or press <kbd className="kbd">O</kbd> to orbit.
        </p>
      </div>
      <Section title="Theme">
        <div className="grid grid-cols-5 gap-1.5">
          {THEMES.map((t) => {
            const active = doc.background === t.background && doc.ramp.join() === t.ramp.join();
            return (
              <button
                key={t.id}
                type="button"
                title={t.name}
                aria-label={`${t.name} theme`}
                aria-pressed={active}
                onClick={() => set({ background: t.background, ramp: [...t.ramp] })}
                className={`flex aspect-square flex-col justify-end overflow-hidden rounded-lg p-1.5 ring-1 transition hover:scale-105 ${active ? 'ring-2 ring-accent' : 'ring-white/10'}`}
                style={{ background: t.background }}
              >
                <span className="block h-1.5 rounded-full" style={{ background: rampCSS(t.ramp) }} />
              </button>
            );
          })}
        </div>
        <ColorField label="Background" value={doc.background} swatches={THEMES.map((t) => t.background)} onChange={(v) => set({ background: v ?? doc.background }, 'bg')} />
        <RampEditor label="Colour ramp" hint="used by every form" stops={doc.ramp} onChange={(ramp) => set({ ramp }, 'ramp')} />
        <Slider label="Hand-drawn" min={0} max={8} step={0.1} value={doc.rough} onChange={(v) => set({ rough: v }, 'rough')} />
      </Section>
      <Section title="Artboard">
        <div className="grid grid-cols-3 gap-1.5">
          {ARTBOARD_SIZES.map((a) => {
            const active = doc.width === a.w && doc.height === a.h;
            return (
              <button
                key={a.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const dx = (a.w - doc.width) / 2, dy = (a.h - doc.height) / 2;
                  commit((d) => ({ ...d, width: a.w, height: a.h, forms: d.forms.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy })) }));
                }}
                className={`rounded-lg px-2 py-2 text-[12px] ring-1 transition ${active ? 'bg-white/10 text-white ring-accent/60' : 'text-zinc-400 ring-white/10 hover:text-zinc-100'}`}
              >
                <span className="block font-medium">{a.label}</span>
                <span className="block font-mono text-[10px] text-zinc-500">{a.w}×{a.h}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}

export function Inspector() {
  const form = useStore(selectedForm);
  return <div className="min-h-0 flex-1 overflow-y-auto">{form ? <FormInspector key={form.id} form={form} /> : <DocInspector />}</div>;
}
