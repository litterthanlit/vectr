import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { renderLayer, renderLayerCached, type RenderedLayer } from '../lib/render';
import { useStore } from '../store';
import { ArtboardContent } from './Artboard';

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; lx: number; ly: number }
  | { kind: 'orbit'; id: string; sx: number; sy: number; rx: number; ry: number }
  | { kind: 'scale'; id: string; cx: number; cy: number; d0: number; s0: number }
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number };

export interface CanvasView {
  zoom: number;
  pan: { x: number; y: number };
}

export function Canvas({ view, setView }: { view: CanvasView; setView(v: CanvasView): void }) {
  const doc = useStore((s) => s.doc);
  const selectedId = useStore((s) => s.selectedId);
  const tool = useStore((s) => s.tool);
  const playing = useStore((s) => s.playing);
  const { select, updateLayer } = useStore.getState();

  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [time, setTime] = useState(0);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Spin animation clock. Respect reduced-motion preferences.
  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const start = performance.now() - time * 1000;
    const tick = (t: number) => {
      setTime((t - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        spaceDown.current = true;
        setPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const rendered = useMemo(() => {
    const m = new Map<string, RenderedLayer>();
    for (const l of doc.layers) {
      m.set(l.id, playing && l.spin ? renderLayer(l, (l.spin * time) % 360) : renderLayerCached(l));
    }
    return m;
  }, [doc.layers, playing, time]);

  const pad = 64;
  const fit = Math.max(0.05, Math.min((size.w - pad * 2) / doc.width, (size.h - pad * 2) / doc.height));
  const s = fit * view.zoom;
  const ox = (size.w - doc.width * s) / 2 + view.pan.x;
  const oy = (size.h - doc.height * s) / 2 + view.pan.y;

  const toArt = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
  };

  // Wheel: pinch / ctrl-scroll zooms around the cursor, plain scroll pans.
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, pan } = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const next = Math.min(8, Math.max(0.2, zoom * Math.exp(-e.deltaY * 0.01)));
        const k = next / zoom;
        const cx = e.clientX - r.left - r.width / 2;
        const cy = e.clientY - r.top - r.height / 2;
        setViewRef.current({ zoom: next, pan: { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k } });
      } else {
        setViewRef.current({ zoom, pan: { x: pan.x - e.deltaX, y: pan.y - e.deltaY } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const viewRef = useRef(view);
  viewRef.current = view;
  const setViewRef = useRef(setView);
  setViewRef.current = setView;

  const startPan = (e: RPointerEvent) => {
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: view.pan.x, py: view.pan.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button === 1 || spaceDown.current) return startPan(e);
    if (e.button === 0) select(null);
  };

  const onLayerDown = (e: RPointerEvent, id: string) => {
    if (e.button === 1 || spaceDown.current) return startPan(e);
    e.stopPropagation();
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    select(id);
    wrap.current!.setPointerCapture(e.pointerId);
    if (tool === 'orbit' || e.altKey) {
      drag.current = { kind: 'orbit', id, sx: e.clientX, sy: e.clientY, rx: layer.rx, ry: layer.ry };
    } else {
      const p = toArt(e);
      drag.current = { kind: 'move', id, sx: p.x, sy: p.y, lx: layer.x, ly: layer.y };
    }
  };

  const onHandleDown = (e: RPointerEvent, id: string) => {
    e.stopPropagation();
    const layer = doc.layers.find((l) => l.id === id)!;
    const p = toArt(e);
    wrap.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: 'scale', id, cx: layer.x, cy: layer.y, d0: Math.hypot(p.x - layer.x, p.y - layer.y) || 1, s0: layer.scale };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ zoom: view.zoom, pan: { x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy } });
    } else if (d.kind === 'move') {
      const p = toArt(e);
      let dx = p.x - d.sx, dy = p.y - d.sy;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      updateLayer(d.id, { x: Math.round(d.lx + dx), y: Math.round(d.ly + dy) }, 'drag');
    } else if (d.kind === 'orbit') {
      const snap = (v: number) => (e.shiftKey ? Math.round(v / 15) * 15 : Math.round(v));
      updateLayer(d.id, {
        ry: snap(d.ry + (e.clientX - d.sx) * 0.5),
        rx: snap(Math.max(-90, Math.min(90, d.rx - (e.clientY - d.sy) * 0.5))),
      }, 'orbit');
    } else if (d.kind === 'scale') {
      const p = toArt(e);
      const k = Math.hypot(p.x - d.cx, p.y - d.cy) / d.d0;
      updateLayer(d.id, { scale: Math.max(8, Math.round(d.s0 * k)) }, 'scale');
    }
  };

  const onUp = () => {
    drag.current = null;
  };

  const selected = doc.layers.find((l) => l.id === selectedId && l.visible);
  const sel = selected ? rendered.get(selected.id) : undefined;
  const hs = 8 / s; // handle size in artboard units
  const cursor = panning ? 'grab' : tool === 'orbit' ? 'grab' : 'default';

  return (
    <div
      ref={wrap}
      className="vectr-canvas relative h-full w-full touch-none overflow-hidden select-none"
      style={{ cursor }}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg width={size.w} height={size.h} className="block" role="img" aria-label="Artboard">
        <g transform={`translate(${ox} ${oy}) scale(${s})`}>
          <rect
            x={-1} y={-1} width={doc.width + 2} height={doc.height + 2}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1 / s}
          />
          <g style={{ filter: 'drop-shadow(0 24px 48px rgba(0,0,0,0.45))' }}>
            <rect width={doc.width} height={doc.height} fill={doc.background} />
          </g>
          <svg width={doc.width} height={doc.height} viewBox={`0 0 ${doc.width} ${doc.height}`} overflow="hidden">
            <ArtboardContent doc={doc} rendered={rendered} />
          </svg>

          {/* Hit areas */}
          {doc.layers.map((l) => {
            const r = rendered.get(l.id);
            if (!r || !l.visible || l.locked) return null;
            const p = 6 / s;
            return (
              <rect
                key={l.id}
                x={r.bbox.x - p} y={r.bbox.y - p} width={r.bbox.w + p * 2} height={r.bbox.h + p * 2}
                fill="transparent"
                style={{ cursor: panning ? 'grab' : tool === 'orbit' ? 'grab' : 'move' }}
                onPointerDown={(e) => onLayerDown(e, l.id)}
                aria-label={`Select ${l.name}`}
              />
            );
          })}

          {/* Selection chrome */}
          {selected && sel && (
            <g pointerEvents="none">
              <rect
                x={sel.bbox.x} y={sel.bbox.y} width={sel.bbox.w} height={sel.bbox.h}
                fill="none" stroke="#ff6a3d" strokeWidth={1.25 / s}
              />
              <circle cx={selected.x} cy={selected.y} r={3 / s} fill="#ff6a3d" />
              <g transform={`translate(${sel.bbox.x} ${sel.bbox.y - 8 / s}) scale(${1 / s})`}>
                <text fontSize={11} fontFamily="Inter, sans-serif" fill="#ff6a3d" fontWeight={500}>
                  {selected.name} · {Math.round(selected.rx)}° / {Math.round(selected.ry)}°
                </text>
              </g>
            </g>
          )}
          {selected && sel && !selected.locked &&
            [
              [sel.bbox.x, sel.bbox.y, 'nwse-resize'],
              [sel.bbox.x + sel.bbox.w, sel.bbox.y, 'nesw-resize'],
              [sel.bbox.x, sel.bbox.y + sel.bbox.h, 'nesw-resize'],
              [sel.bbox.x + sel.bbox.w, sel.bbox.y + sel.bbox.h, 'nwse-resize'],
            ].map(([x, y, c], i) => (
              <rect
                key={i}
                x={(x as number) - hs / 2} y={(y as number) - hs / 2} width={hs} height={hs} rx={2 / s}
                fill="#fff" stroke="#ff6a3d" strokeWidth={1.25 / s}
                style={{ cursor: c as string }}
                onPointerDown={(e) => onHandleDown(e, selected.id)}
                aria-label="Scale handle"
              />
            ))}
        </g>
      </svg>
    </div>
  );
}
