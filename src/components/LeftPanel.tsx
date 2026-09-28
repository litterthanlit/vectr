import { ChevronDown, ChevronUp, Circle, Copy, Eye, EyeOff, Hexagon, Lock, PenTool, Spline, Square, Star, Trash2, Unlock } from 'lucide-react';
import { memo, useMemo } from 'react';
import { GENERATORS, createLayer } from '../lib/generators';
import { ellipsePath, polygonPath, rectPath, starPath, type VectorPath } from '../lib/path';
import { renderLayer } from '../lib/render';
import { createPathLayer, isPathLayer } from '../lib/vector-layer';
import { useStore } from '../store';
import { LayerGraphic } from './Artboard';
import { IconButton } from './controls';

const Thumb = memo(function Thumb({ type }: { type: string }) {
  const { layer, r } = useMemo(() => {
    const scale = type === 'frame' ? 26 : type === 'truchet' ? 30 : 36;
    const layer = createLayer(type, { x: 50, y: 50 }, {
      scale,
      style: { width: 1, nodeSize: 1.5, labels: false } as never,
    });
    return { layer, r: renderLayer(layer) };
  }, [type]);
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <LayerGraphic layer={layer} r={r} ink="currentColor" />
    </svg>
  );
});

const PRIMITIVES: { id: string; label: string; icon: JSX.Element; build(cx: number, cy: number, r: number): VectorPath }[] = [
  { id: 'rect', label: 'Rectangle', icon: <Square size={16} />, build: (cx, cy, r) => rectPath(cx - r, cy - r * 0.75, r * 2, r * 1.5, r * 0.12) },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle size={16} />, build: (cx, cy, r) => ellipsePath(cx, cy, r) },
  { id: 'polygon', label: 'Polygon', icon: <Hexagon size={16} />, build: (cx, cy, r) => polygonPath(cx, cy, r, 6) },
  { id: 'star', label: 'Star', icon: <Star size={16} />, build: (cx, cy, r) => starPath(cx, cy, r, r * 0.48, 5) },
];

/** Editable vector primitives plus the pen, above the parametric generators. */
function Draw({ onAdd }: { onAdd?(): void }) {
  const tool = useStore((s) => s.tool);
  const { addLayers, setTool } = useStore.getState();
  const add = (p: (typeof PRIMITIVES)[number]) => {
    const { doc } = useStore.getState();
    const n = doc.layers.length % 5;
    const r = Math.round(Math.min(doc.width, doc.height) * 0.16);
    const layer = createPathLayer(p.build(doc.width / 2 + n * 24, doc.height / 2 + n * 24, r), {
      name: p.label,
      style: { fill: '#FF6A3D', width: 0 },
    });
    addLayers([layer]);
    onAdd?.();
  };
  return (
    <div className="px-3 pt-4">
      <h2 className="mb-3 px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">Draw</h2>
      <div className="grid grid-cols-5 gap-1.5">
        <button
          type="button"
          onClick={() => { setTool('pen'); onAdd?.(); }}
          aria-pressed={tool === 'pen'}
          title="Pen (P)"
          aria-label="Pen tool"
          className={`flex aspect-square items-center justify-center rounded-xl ring-1 transition focus-visible:outline-2 focus-visible:outline-orange-400 ${
            tool === 'pen' ? 'bg-orange-500/15 text-orange-200 ring-orange-400/40' : 'bg-white/[0.025] text-zinc-400 ring-transparent hover:bg-white/[0.05] hover:text-zinc-100 hover:ring-white/[0.08]'
          }`}
        >
          <PenTool size={16} />
        </button>
        {PRIMITIVES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => add(p)}
            title={`Add ${p.label.toLowerCase()} (editable path)`}
            aria-label={`Add ${p.label}`}
            className="flex aspect-square items-center justify-center rounded-xl bg-white/[0.025] text-zinc-400 ring-1 ring-transparent transition hover:bg-white/[0.05] hover:text-zinc-100 hover:ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-orange-400"
          >
            {p.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Library({ onAdd }: { onAdd?(): void }) {
  const addLayer = useStore((s) => s.addLayer);
  return (
    <>
    <Draw onAdd={onAdd} />
    <div className="px-3 pt-4 pb-2">
      <h2 className="mb-3 px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">Generators</h2>
      <ul className="grid grid-cols-3 gap-1.5">
        {GENERATORS.map((g) => (
          <li key={g.type}>
            <button
              type="button"
              onClick={() => { addLayer(g.type); onAdd?.(); }}
              title={g.blurb}
              aria-label={`Add ${g.name}: ${g.blurb}`}
              className="group flex w-full flex-col items-center gap-1 rounded-xl p-1.5 text-zinc-400 ring-1 ring-transparent transition hover:bg-white/[0.04] hover:text-zinc-100 hover:ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-orange-400"
            >
              <span className="aspect-square w-full rounded-lg bg-white/[0.025] p-1 transition-transform duration-300 group-hover:scale-[1.04]">
                <Thumb type={g.type} />
              </span>
              <span className="truncate text-[11px]">{g.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
    </>
  );
}

export function Layers() {
  const layers = useStore((s) => s.doc.layers);
  const selectedId = useStore((s) => s.selectedId);
  const { select, updateLayer, removeLayer, duplicateLayer, moveLayer } = useStore.getState();
  const ordered = [...layers].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06]">
      <h2 className="px-4 pt-4 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        Layers <span className="ml-1 font-mono text-zinc-600">{layers.length}</span>
      </h2>
      {ordered.length === 0 && (
        <p className="px-4 py-2 text-[13px] leading-relaxed text-zinc-500">Pick a generator above to drop your first shape.</p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Layers">
        {ordered.map((l) => {
          const active = l.id === selectedId;
          return (
            <li key={l.id}>
              <div
                className={`group flex items-center gap-1 rounded-lg py-0.5 pr-1 pl-2 transition-colors ${
                  active ? 'bg-orange-500/10 ring-1 ring-orange-500/30' : 'hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(l.id)}
                  aria-current={active}
                  className={`min-w-0 flex-1 truncate py-1.5 text-left text-[13px] ${active ? 'text-white' : l.visible ? 'text-zinc-300' : 'text-zinc-600'}`}
                >
                  {isPathLayer(l) && <Spline size={12} className="mr-1.5 inline -translate-y-px text-zinc-500" aria-hidden="true" />}
                  {l.name}
                </button>
                <div className="hidden items-center group-hover:flex group-focus-within:flex">
                  <IconButton label="Move up" onClick={() => moveLayer(l.id, 1)} className="h-6 min-w-6"><ChevronUp size={14} /></IconButton>
                  <IconButton label="Move down" onClick={() => moveLayer(l.id, -1)} className="h-6 min-w-6"><ChevronDown size={14} /></IconButton>
                  <IconButton label="Duplicate" onClick={() => duplicateLayer(l.id)} className="h-6 min-w-6"><Copy size={13} /></IconButton>
                  <IconButton label="Delete" onClick={() => removeLayer(l.id)} className="h-6 min-w-6"><Trash2 size={13} /></IconButton>
                </div>
                <IconButton label={l.locked ? 'Unlock' : 'Lock'} onClick={() => updateLayer(l.id, { locked: !l.locked })} className="h-6 min-w-6">
                  {l.locked ? <Lock size={13} /> : <Unlock size={13} className="opacity-40" />}
                </IconButton>
                <IconButton label={l.visible ? 'Hide' : 'Show'} onClick={() => updateLayer(l.id, { visible: !l.visible })} className="h-6 min-w-6">
                  {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
