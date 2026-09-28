import { ArrowLeftRight, Dices, RotateCcw, Sparkles, Spline, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { generatorFor } from '../lib/generators';
import {
  cleanupPath, clonePath, deleteAnchors, parseRef, pathStats, reverseSub, setAnchorKind, simplifyPath,
  type KindChange, type VectorPath,
} from '../lib/path';
import { isPathLayer, layerPathAbs, recenter, withPathAbs } from '../lib/vector-layer';
import { ARTBOARD_SIZES, THEMES } from '../lib/templates';
import type { BackStyle, Layer } from '../lib/types';
import { selectedLayer, useStore } from '../store';
import { ColorField, IconButton, Section, Segmented, Select, Slider, TextField, Toggle } from './controls';

const SWATCHES = ['#232323', '#F3F2E9', '#FF6A3D', '#2F6BFF', '#1FA37A', '#E8B931', '#B04BE0'];

const BACK_OPTIONS: { value: BackStyle; label: string; icon: JSX.Element }[] = [
  { value: 'dotted', label: 'Dotted', icon: <LineGlyph dash="0 3.2" /> },
  { value: 'dashed', label: 'Dashed', icon: <LineGlyph dash="4 3" /> },
  { value: 'solid', label: 'Solid', icon: <LineGlyph /> },
  { value: 'faded', label: 'Faded', icon: <LineGlyph opacity={0.3} /> },
  { value: 'hidden', label: 'Hidden', icon: <span className="text-[11px]">Off</span> },
];

function LineGlyph({ dash, opacity = 1 }: { dash?: string; opacity?: number }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      <path d="M2 5 H20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray={dash} opacity={opacity} />
    </svg>
  );
}

function ParamsSection({ layer }: { layer: Layer }) {
  const g = generatorFor(layer.type);
  const { updateParams, randomize, resetLayer, convertToPath } = useStore.getState();
  const set = (k: string, v: number | boolean | string) => updateParams(layer.id, { [k]: v }, k);
  return (
    <Section
      title={g.name}
      action={
        <div className="flex gap-0.5">
          <IconButton label="Randomize" shortcut="R" onClick={() => randomize(layer.id)}><Dices size={15} /></IconButton>
          <IconButton label="Reset to defaults" onClick={() => resetLayer(layer.id)}><RotateCcw size={14} /></IconButton>
          <IconButton label="Convert to editable path" onClick={() => convertToPath(layer.id)}><Spline size={14} /></IconButton>
        </div>
      }
    >
      <p className="-mt-1 text-[12px] leading-relaxed text-zinc-500">{g.blurb}</p>
      {g.params.map((d) => {
        const v = layer.params[d.key];
        switch (d.kind) {
          case 'range':
            return <Slider key={d.key} label={d.label} min={d.min} max={d.max} step={d.step} unit={d.unit} value={Number(v)} onChange={(x) => set(d.key, x)} />;
          case 'toggle':
            return <Toggle key={d.key} label={d.label} checked={Boolean(v)} onChange={(x) => set(d.key, x)} />;
          case 'select':
            return <Select key={d.key} label={d.label} value={String(v)} options={d.options} onChange={(x) => set(d.key, x)} />;
          case 'text':
            return <TextField key={d.key} label={d.label} value={String(v ?? '')} placeholder={d.placeholder} onChange={(x) => set(d.key, x)} />;
          case 'seed':
            return (
              <div key={d.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <Slider label={d.label} min={1} max={999} step={1} value={Number(v)} onChange={(x) => set(d.key, x)} />
                </div>
                <IconButton label="New seed" onClick={() => set(d.key, Math.floor(Math.random() * 999) + 1)}><Dices size={14} /></IconButton>
              </div>
            );
        }
      })}
    </Section>
  );
}

const KIND_OPTIONS: { value: KindChange; label: string; icon: JSX.Element }[] = [
  { value: 'straight', label: 'Sharp (no handles)', icon: <KindGlyph d="M3 9 L11 3 L19 9" /> },
  { value: 'corner', label: 'Corner (independent handles)', icon: <KindGlyph d="M3 8 Q7 2 11 5 Q15 9 19 3" /> },
  { value: 'smooth', label: 'Smooth (aligned handles)', icon: <KindGlyph d="M3 9 C7 1 15 1 19 9" /> },
  { value: 'symmetric', label: 'Mirrored (equal handles)', icon: <KindGlyph d="M3 8 C7 2 15 2 19 8" mirror /> },
];

function KindGlyph({ d, mirror }: { d: string; mirror?: boolean }) {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {mirror && <path d="M6 4.5 H16" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />}
    </svg>
  );
}

/** Stats, point editing and clean-up for path layers. */
function PathSection({ layer }: { layer: Layer & { path: VectorPath } }) {
  const anchorSel = useStore((s) => s.anchorSel);
  const tool = useStore((s) => s.tool);
  const { replaceLayer, setTool, setAnchorSel, removeLayer } = useStore.getState();
  const [tolerance, setTolerance] = useState(1);
  const abs = useMemo(() => layerPathAbs(layer), [layer]);
  const stats = pathStats(abs);
  const preview = useMemo(() => pathStats(cleanupPath(simplifyPath(abs, { tolerance }))), [abs, tolerance]);
  const apply = (next: VectorPath) => replaceLayer(withPathAbs(layer, next));

  const refs = anchorSel.map(parseRef).filter(([si, ai]) => abs.subpaths[si]?.anchors[ai]);
  const single = refs.length === 1 ? abs.subpaths[refs[0][0]].anchors[refs[0][1]] : null;
  const kinds = new Set(refs.map(([si, ai]) => {
    const a = abs.subpaths[si].anchors[ai];
    return a.in || a.out ? a.kind : 'straight';
  }));
  const kind = kinds.size === 1 ? ([...kinds][0] as KindChange) : ('' as KindChange);
  const allClosed = abs.subpaths.every((sp) => sp.closed);

  const setKind = (k: KindChange) => {
    const next = clonePath(abs);
    for (const [si, ai] of refs) next.subpaths[si].anchors[ai] = setAnchorKind(next.subpaths[si], ai, k);
    apply(next);
  };
  const setPos = (axis: 'x' | 'y') => (v: number) => {
    const next = clonePath(abs);
    const [si, ai] = refs[0];
    next.subpaths[si].anchors[ai][axis] = v;
    replaceLayer(withPathAbs(layer, next), `point-${axis}`);
  };

  return (
    <>
      <Section
        title="Path"
        action={
          <IconButton label={tool === 'edit' ? 'Done editing points' : 'Edit points'} shortcut="A" active={tool === 'edit'} onClick={() => setTool(tool === 'edit' ? 'move' : 'edit')}>
            <Spline size={15} />
          </IconButton>
        }
      >
        <dl className="grid grid-cols-3 gap-1.5 text-center">
          {[
            ['Points', stats.anchors],
            ['Curves', stats.curves],
            ['Contours', stats.subpaths],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.03] py-2 ring-1 ring-white/[0.05]">
              <dd className="font-mono text-[15px] text-white">{v}</dd>
              <dt className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">{k}</dt>
            </div>
          ))}
        </dl>
        {tool !== 'edit' && (
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Press <kbd className="kbd">A</kbd> or double-click the shape to edit its points.
          </p>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => apply({ ...abs, subpaths: abs.subpaths.map((sp) => ({ ...sp, closed: sp.anchors.length > 2 ? !allClosed : sp.closed })) })}
            className="flex-1 rounded-lg px-2 py-1.5 text-[12px] text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/[0.05] hover:text-white"
          >
            {allClosed ? 'Open path' : 'Close path'}
          </button>
          <button
            type="button"
            onClick={() => apply({ ...abs, subpaths: abs.subpaths.map(reverseSub) })}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/[0.05] hover:text-white"
          >
            <ArrowLeftRight size={13} aria-hidden="true" /> Reverse
          </button>
        </div>
        {stats.subpaths > 1 && (
          <Segmented
            label="Overlaps"
            value={abs.fillRule ?? 'nonzero'}
            options={[{ value: 'nonzero', label: 'Merge' }, { value: 'evenodd', label: 'Cut holes' }]}
            onChange={(v) => apply({ ...abs, fillRule: v })}
          />
        )}
      </Section>

      {tool === 'edit' && refs.length > 0 && (
        <Section
          title={refs.length === 1 ? `Point ${anchorSel[0]}` : `${refs.length} points`}
          action={
            <IconButton
              label="Delete points"
              shortcut="⌫"
              onClick={() => {
                const next = deleteAnchors(abs, refs);
                setAnchorSel([]);
                if (!next.subpaths.length) removeLayer(layer.id);
                else apply(next);
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          }
        >
          {single && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="X" value={single.x} onChange={setPos('x')} />
              <NumberField label="Y" value={single.y} onChange={setPos('y')} />
            </div>
          )}
          <Segmented label="Point type" value={kind} options={KIND_OPTIONS} onChange={setKind} />
        </Section>
      )}

      <Section title="Clean up">
        <p className="-mt-1 text-[12px] leading-relaxed text-zinc-500">
          Refit to the fewest points that stay within the tolerance. Sharp turns stay sharp.
        </p>
        <Slider label="Tolerance" min={0.1} max={12} step={0.1} unit="px" value={tolerance} onChange={setTolerance} />
        <button
          type="button"
          disabled={preview.anchors >= stats.anchors}
          onClick={() => {
            replaceLayer(recenter(withPathAbs(layer, cleanupPath(simplifyPath(abs, { tolerance })))));
            setAnchorSel([]);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500/15 px-3 py-2 text-[13px] font-medium text-orange-200 ring-1 ring-orange-400/30 transition hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles size={14} aria-hidden="true" />
          Simplify
          <span className="font-mono text-[12px] text-orange-300/80">{stats.anchors} → {Math.min(preview.anchors, stats.anchors)}</span>
        </button>
      </Section>
    </>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(v: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1.5 ring-1 ring-white/[0.06] focus-within:ring-orange-400/70">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <input
        inputMode="decimal"
        value={draft ?? String(Math.round(value * 100) / 100)}
        onFocus={(e) => { setDraft(String(Math.round(value * 100) / 100)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft ?? '');
          if (Number.isFinite(v)) onChange(v);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-[12px] text-zinc-200 outline-none"
      />
    </label>
  );
}

function PathLayerInspector({ layer }: { layer: Layer & { path: VectorPath } }) {
  const { updateLayer, updateStyle } = useStore.getState();
  const doc = useStore((s) => s.doc);
  const T = (k: keyof Layer) => (v: number) => updateLayer(layer.id, { [k]: v } as Partial<Layer>, String(k));
  const st = layer.style;
  const S = <K extends keyof typeof st>(k: K) => (v: (typeof st)[K]) => updateStyle(layer.id, { [k]: v } as never, String(k));
  return (
    <>
      <LayerName layer={layer} />
      <PathSection layer={layer} />
      <Section title="Fill">
        <Toggle label="Fill shape" checked={st.fill != null} onChange={(on) => updateStyle(layer.id, { fill: on ? st.stroke ?? doc.ink : null })} />
        {st.fill != null && <ColorField label="Colour" value={st.fill} swatches={SWATCHES} onChange={(v) => S('fill')(v ?? doc.ink)} />}
      </Section>
      <Section title="Stroke">
        <ColorField label="Colour" value={st.stroke} swatches={SWATCHES} allowInherit onChange={S('stroke')} />
        <Slider label="Weight" min={0} max={40} step={0.05} value={st.width} onChange={S('width')} />
        <Slider label="Opacity" min={0.05} max={1} step={0.01} value={st.opacity} onChange={S('opacity')} />
      </Section>
      <Section title="Transform">
        <div className="grid grid-cols-2 gap-3">
          <Slider label="X" min={0} max={doc.width} step={1} value={layer.x} onChange={T('x')} />
          <Slider label="Y" min={0} max={doc.height} step={1} value={layer.y} onChange={T('y')} />
        </div>
        <Slider label="Scale" min={5} max={400} step={1} unit="%" value={layer.scale} onChange={T('scale')} />
        <Slider label="Rotation" min={-180} max={180} step={1} unit="°" value={-layer.rz || 0} onChange={(v) => updateLayer(layer.id, { rz: -v }, 'rz')} />
        <Slider label="Tilt (X)" min={-90} max={90} step={1} unit="°" value={layer.rx} onChange={T('rx')} />
        <Slider label="Turn (Y)" min={-180} max={180} step={1} unit="°" value={((layer.ry + 540) % 360) - 180} onChange={T('ry')} />
      </Section>
    </>
  );
}

function LayerName({ layer }: { layer: Layer }) {
  const { updateLayer } = useStore.getState();
  return (
    <div className="border-b border-white/[0.06] px-4 py-3">
      <label className="sr-only" htmlFor="layer-name">Layer name</label>
      <input
        id="layer-name"
        value={layer.name}
        onChange={(e) => updateLayer(layer.id, { name: e.target.value }, 'name')}
        className="w-full rounded-md bg-transparent px-1 py-1 text-[15px] font-medium text-white outline-none ring-1 ring-transparent hover:ring-white/10 focus:ring-orange-400/70"
      />
    </div>
  );
}

function LayerInspector({ layer }: { layer: Layer }) {
  const { updateLayer, updateStyle } = useStore.getState();
  const doc = useStore((s) => s.doc);
  const T = (k: keyof Layer) => (v: number) => updateLayer(layer.id, { [k]: v } as Partial<Layer>, String(k));
  const st = layer.style;
  const S = <K extends keyof typeof st>(k: K) => (v: (typeof st)[K]) => updateStyle(layer.id, { [k]: v } as never, String(k));
  return (
    <>
      <LayerName layer={layer} />
      <ParamsSection layer={layer} />
      <Section title="Rotation & camera">
        <Slider label="Tilt (X)" min={-90} max={90} step={1} unit="°" value={layer.rx} onChange={T('rx')} />
        <Slider label="Turn (Y)" min={-180} max={180} step={1} unit="°" value={((layer.ry + 540) % 360) - 180} onChange={T('ry')} />
        <Slider label="Roll (Z)" min={-180} max={180} step={1} unit="°" value={layer.rz} onChange={T('rz')} />
        <Slider label="Perspective" min={0} max={1} step={0.01} value={layer.perspective} onChange={T('perspective')} />
        <Slider label="Spin" min={-90} max={90} step={1} unit="°/s" value={layer.spin} onChange={T('spin')} />
      </Section>
      <Section title="Stroke">
        <ColorField label="Colour" value={st.stroke} swatches={SWATCHES} allowInherit onChange={S('stroke')} />
        <Slider label="Weight" min={0.25} max={12} step={0.05} value={st.width} onChange={S('width')} />
        <Segmented label="Hidden lines" value={st.back} options={BACK_OPTIONS} onChange={S('back')} />
        <Slider label="Opacity" min={0.05} max={1} step={0.01} value={st.opacity} onChange={S('opacity')} />
      </Section>
      <Section title="Nodes & labels">
        <Toggle label="Show nodes" checked={st.nodes} onChange={S('nodes')} />
        {st.nodes && <Slider label="Node size" min={0.5} max={10} step={0.1} value={st.nodeSize} onChange={S('nodeSize')} />}
        {st.nodes && <Toggle label="Nodes on hidden side" checked={st.backNodes} onChange={S('backNodes')} />}
        <Toggle label="Show labels" checked={st.labels} onChange={S('labels')} />
        {st.labels && <Slider label="Label size" min={6} max={32} step={0.5} value={st.labelSize} onChange={S('labelSize')} />}
      </Section>
      <Section title="Position">
        <div className="grid grid-cols-2 gap-3">
          <Slider label="X" min={0} max={doc.width} step={1} value={layer.x} onChange={T('x')} />
          <Slider label="Y" min={0} max={doc.height} step={1} value={layer.y} onChange={T('y')} />
        </div>
        <Slider label="Size" min={8} max={Math.max(doc.width, doc.height)} step={1} value={layer.scale} onChange={T('scale')} />
      </Section>
    </>
  );
}

function DocInspector() {
  const doc = useStore((s) => s.doc);
  const commit = useStore((s) => s.commit);
  const set = (patch: Partial<typeof doc>, key?: string) => commit((d) => ({ ...d, ...patch }), key && `doc:${key}`);
  return (
    <>
      <div className="border-b border-white/[0.06] px-4 py-4">
        <h2 className="text-[15px] font-medium text-white">Document</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          Select a shape to tune it. Drag to move, hold <kbd className="kbd">Alt</kbd> or press <kbd className="kbd">O</kbd> to orbit in 3D.
        </p>
      </div>
      <Section title="Theme">
        <div className="grid grid-cols-5 gap-1.5">
          {THEMES.map((t) => {
            const active = doc.background === t.background && doc.ink === t.ink;
            return (
              <button
                key={t.id}
                type="button"
                title={t.name}
                aria-label={`${t.name} theme`}
                aria-pressed={active}
                onClick={() => set({ background: t.background, ink: t.ink, rough: t.rough })}
                className={`flex aspect-square items-center justify-center rounded-lg ring-1 transition hover:scale-105 ${active ? 'ring-2 ring-orange-400' : 'ring-white/10'}`}
                style={{ background: t.background }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="7" fill="none" stroke={t.ink} strokeWidth="1.3" />
                  <ellipse cx="10" cy="10" rx="7" ry="2.6" fill="none" stroke={t.ink} strokeWidth="1.3" strokeDasharray="0 2.4" strokeLinecap="round" />
                </svg>
              </button>
            );
          })}
        </div>
        <ColorField label="Background" value={doc.background} swatches={['#F3F2E9', '#F0F0F0', '#FFFFFF', '#050505', '#173152', '#0E0E10']} onChange={(v) => set({ background: v ?? doc.background }, 'bg')} />
        <ColorField label="Ink" value={doc.ink} swatches={SWATCHES} onChange={(v) => set({ ink: v ?? doc.ink }, 'ink')} />
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
                  commit((d) => ({ ...d, width: a.w, height: a.h, layers: d.layers.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })) }));
                }}
                className={`rounded-lg px-2 py-2 text-[12px] ring-1 transition ${active ? 'bg-white/10 text-white ring-orange-400/60' : 'text-zinc-400 ring-white/10 hover:text-zinc-100'}`}
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
  const layer = useStore(selectedLayer);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isPathLayer(layer) ? <PathLayerInspector layer={layer} /> : layer ? <LayerInspector layer={layer} /> : <DocInspector />}
    </div>
  );
}
