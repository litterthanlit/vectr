/**
 * On-canvas Bézier editing for path layers (edit tool, A / Enter / double-click).
 *
 * - Click an anchor to select it, Shift-click to add, drag on empty space to marquee.
 * - Drag anchors to move them (Shift locks the axis); drag handles to shape curves.
 *   Smooth anchors keep handles collinear, mirrored ones keep them equal; hold Alt to break.
 * - Drag a segment to bend it; double-click a segment to add an anchor.
 * - Double-click an anchor to toggle sharp ↔ smooth.
 *
 * Corners draw as squares and smooth anchors as circles, so the structure of a
 * path is readable at a glance (the same cue render_preview gives agents).
 */
import { useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import {
  anchor, clonePath, insertAnchor, moveHandle, nearestOnPath, parseRef, pathBounds, pathToD, refKey, segmentCubic,
  setAnchorKind, type AnchorRef, type VectorPath,
} from '../lib/path';
import { createPathLayer, layerPathAbs, withPathAbs } from '../lib/vector-layer';
import type { Layer, Vec2 } from '../lib/types';
import { useStore } from '../store';

const ACCENT = '#ff6a3d';
const HANDLE = '#2f6bff';

type Drag =
  | { kind: 'anchors'; start: Vec2; orig: VectorPath; refs: AnchorRef[]; moved: boolean }
  | { kind: 'handle'; ref: AnchorRef; which: 'in' | 'out'; orig: VectorPath }
  | { kind: 'bend'; sub: number; seg: number; t: number; start: Vec2; orig: VectorPath }
  | { kind: 'marquee'; start: Vec2; cur: Vec2; additive: boolean; base: string[] };

interface Props {
  layer: Layer;
  /** Screen pixels per artboard unit. */
  s: number;
  toArt(e: { clientX: number; clientY: number }): Vec2;
  panning: boolean;
}

export function PathEditor({ layer, s, toArt, panning }: Props) {
  const anchorSel = useStore((st) => st.anchorSel);
  const { setAnchorSel, updatePath, setTool, select } = useStore.getState();
  const abs = useMemo(() => layerPathAbs(layer), [layer]);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const sel = useMemo(() => new Set(anchorSel), [anchorSel]);
  const u = 1 / s; // one screen pixel in artboard units

  const commit = (next: VectorPath, key = 'edit') => updatePath(layer.id, withPathAbs(layer, next).path!, key);

  const capture = (e: RPointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onAnchorDown = (e: RPointerEvent, ref: AnchorRef) => {
    if (panning || e.button !== 0) return;
    capture(e);
    const k = refKey(ref);
    let keys = anchorSel;
    if (e.shiftKey) keys = sel.has(k) ? anchorSel.filter((x) => x !== k) : [...anchorSel, k];
    else if (!sel.has(k)) keys = [k];
    setAnchorSel(keys);
    drag.current = { kind: 'anchors', start: toArt(e), orig: clonePath(abs), refs: keys.map(parseRef), moved: false };
  };

  const onHandleDown = (e: RPointerEvent, ref: AnchorRef, which: 'in' | 'out') => {
    if (panning || e.button !== 0) return;
    capture(e);
    drag.current = { kind: 'handle', ref, which, orig: clonePath(abs) };
  };

  const onSegmentDown = (e: RPointerEvent) => {
    if (panning || e.button !== 0) return;
    capture(e);
    const p = toArt(e);
    const hit = nearestOnPath(abs, p);
    if (!hit) return;
    drag.current = { kind: 'bend', sub: hit.sub, seg: hit.seg, t: Math.min(0.85, Math.max(0.15, hit.t)), start: p, orig: clonePath(abs) };
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (panning || e.button !== 0) return; // let the canvas pan
    capture(e);
    const p = toArt(e);
    drag.current = { kind: 'marquee', start: p, cur: p, additive: e.shiftKey, base: e.shiftKey ? anchorSel : [] };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toArt(e);
    if (d.kind === 'anchors') {
      let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if (!d.moved && Math.hypot(dx, dy) < 2 * u) return;
      d.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const next = clonePath(d.orig);
      for (const [si, ai] of d.refs) {
        const a = next.subpaths[si]?.anchors[ai];
        if (a) { a.x = round(a.x + dx); a.y = round(a.y + dy); }
      }
      commit(next, 'drag');
    } else if (d.kind === 'handle') {
      const next = clonePath(d.orig);
      const a = next.subpaths[d.ref[0]].anchors[d.ref[1]];
      const rel: Vec2 = [round(p[0] - a.x), round(p[1] - a.y)];
      next.subpaths[d.ref[0]].anchors[d.ref[1]] = moveHandle(a, d.which, rel, e.altKey);
      commit(next, 'handle');
    } else if (d.kind === 'bend') {
      commit(bend(d.orig, d.sub, d.seg, d.t, [p[0] - d.start[0], p[1] - d.start[1]]), 'bend');
    } else if (d.kind === 'marquee') {
      d.cur = p;
      setMarquee({ a: d.start, b: p });
      const [x0, x1] = [Math.min(d.start[0], p[0]), Math.max(d.start[0], p[0])];
      const [y0, y1] = [Math.min(d.start[1], p[1]), Math.max(d.start[1], p[1])];
      const inside = abs.subpaths.flatMap((sp, si) =>
        sp.anchors.flatMap((a, ai) => (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1 ? [`${si}:${ai}`] : [])),
      );
      setAnchorSel([...new Set([...d.base, ...inside])]);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'marquee') {
      setMarquee(null);
      const tiny = Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) < 3 * u;
      if (tiny && !d.additive) {
        // A plain click clears the point selection; clicking well away from the shape leaves edit mode.
        const b = pathBounds(abs), pad = 24 * u;
        const outside = d.start[0] < b.x - pad || d.start[0] > b.x + b.w + pad || d.start[1] < b.y - pad || d.start[1] > b.y + b.h + pad;
        if (anchorSel.length) setAnchorSel([]);
        else if (outside) { setTool('move'); select(null); }
      }
    }
  };

  const onAnchorDouble = (ref: AnchorRef) => {
    const next = clonePath(abs);
    const sub = next.subpaths[ref[0]];
    const a = sub.anchors[ref[1]];
    sub.anchors[ref[1]] = setAnchorKind(sub, ref[1], a.in || a.out ? 'straight' : 'smooth');
    commit(next, `kind:${Date.now()}`);
  };

  const onSegmentDouble = (e: RMouseEvent) => {
    const hit = nearestOnPath(abs, toArt(e));
    if (!hit) return;
    const next = clonePath(abs);
    next.subpaths[hit.sub] = insertAnchor(next.subpaths[hit.sub], hit.seg, Math.min(0.999, Math.max(0.001, hit.t)));
    commit(next, `insert:${Date.now()}`);
    setAnchorSel([`${hit.sub}:${hit.seg + 1}`]);
  };

  // Handles are shown for selected anchors and their neighbours (Illustrator-style), which keeps dense paths calm.
  const showHandles = new Set<string>();
  abs.subpaths.forEach((sp, si) => {
    const n = sp.anchors.length;
    sp.anchors.forEach((_, ai) => {
      if (!sel.has(`${si}:${ai}`)) return;
      showHandles.add(`${si}:${ai}`);
      if (sp.closed || ai > 0) showHandles.add(`${si}:${(ai - 1 + n) % n}`);
      if (sp.closed || ai < n - 1) showHandles.add(`${si}:${(ai + 1) % n}`);
    });
  });

  const d = pathToD(abs);
  const r = 4.5 * u;
  const hitR = 11 * u; // 22px touch target

  return (
    <g onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <rect
        x={-1e5} y={-1e5} width={2e5} height={2e5} fill="transparent"
        style={{ cursor: panning ? 'grab' : 'crosshair' }}
        onPointerDown={onBackgroundDown}
        aria-hidden="true"
      />
      {/* White halo keeps the outline legible on any fill colour. */}
      <path d={d} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={3.5 * u} pointerEvents="none" />
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.25 * u} pointerEvents="none" />
      <path
        d={d} fill="none" stroke="transparent" strokeWidth={12 * u}
        style={{ cursor: panning ? 'grab' : 'copy' }}
        onPointerDown={onSegmentDown}
        onDoubleClick={onSegmentDouble}
        aria-label="Path outline: drag to bend, double-click to add a point"
      />
      {abs.subpaths.map((sp, si) =>
        sp.anchors.map((a, ai) => {
          const k = `${si}:${ai}`;
          if (!showHandles.has(k)) return null;
          return (['in', 'out'] as const).map((w) => {
            const h = a[w];
            if (!h) return null;
            const hx = a.x + h[0], hy = a.y + h[1];
            return (
              <g key={`${k}${w}`}>
                <line x1={a.x} y1={a.y} x2={hx} y2={hy} stroke={HANDLE} strokeWidth={u} pointerEvents="none" />
                <circle cx={hx} cy={hy} r={3.2 * u} fill="#fff" stroke={HANDLE} strokeWidth={1.25 * u} pointerEvents="none" />
                <circle
                  cx={hx} cy={hy} r={hitR} fill="transparent" style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => onHandleDown(e, [si, ai], w)}
                  aria-label={`${w === 'in' ? 'Incoming' : 'Outgoing'} handle of point ${k}`}
                />
              </g>
            );
          });
        }),
      )}
      {abs.subpaths.map((sp, si) =>
        sp.anchors.map((a, ai) => {
          const k = `${si}:${ai}`;
          const on = sel.has(k);
          const fill = on ? ACCENT : '#fff';
          return (
            <g key={k}>
              {a.kind === 'corner' ? (
                <rect x={a.x - r} y={a.y - r} width={r * 2} height={r * 2} rx={u} fill={fill} stroke={ACCENT} strokeWidth={1.5 * u} pointerEvents="none" />
              ) : (
                <circle cx={a.x} cy={a.y} r={r * 1.05} fill={fill} stroke={ACCENT} strokeWidth={1.5 * u} pointerEvents="none" />
              )}
              <circle
                cx={a.x} cy={a.y} r={hitR} fill="transparent" style={{ cursor: 'move' }}
                onPointerDown={(e) => onAnchorDown(e, [si, ai])}
                onDoubleClick={() => onAnchorDouble([si, ai])}
                aria-label={`Point ${k}, ${a.kind}${on ? ', selected' : ''}`}
              />
            </g>
          );
        }),
      )}
      {marquee && (
        <rect
          x={Math.min(marquee.a[0], marquee.b[0])} y={Math.min(marquee.a[1], marquee.b[1])}
          width={Math.abs(marquee.b[0] - marquee.a[0])} height={Math.abs(marquee.b[1] - marquee.a[1])}
          fill="rgba(255,106,61,0.08)" stroke={ACCENT} strokeWidth={u} strokeDasharray={`${4 * u} ${3 * u}`} pointerEvents="none"
        />
      )}
    </g>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Bend a segment so the point at t follows the cursor, keeping its end anchors
 * fixed. The offset is split between the two control points in proportion to
 * their influence at t; smooth neighbours rotate their opposite handle to stay smooth.
 */
function bend(orig: VectorPath, si: number, seg: number, t: number, delta: Vec2): VectorPath {
  const next = clonePath(orig);
  const sp = next.subpaths[si];
  const n = sp.anchors.length;
  const [p0, c1, c2, p3] = segmentCubic(sp, seg);
  const a = sp.anchors[seg], b = sp.anchors[(seg + 1) % n];
  // A straight segment gets default handles at thirds first.
  const h1: Vec2 = a.out ? [c1[0] - p0[0], c1[1] - p0[1]] : [(p3[0] - p0[0]) / 3, (p3[1] - p0[1]) / 3];
  const h2: Vec2 = b.in ? [c2[0] - p3[0], c2[1] - p3[1]] : [(p0[0] - p3[0]) / 3, (p0[1] - p3[1]) / 3];
  const k = 1 / (3 * t * (1 - t) * ((1 - t) * (1 - t) + t * t));
  const w1 = (1 - t) * k, w2 = t * k;
  const out: Vec2 = [round(h1[0] + delta[0] * w1), round(h1[1] + delta[1] * w1)];
  const inn: Vec2 = [round(h2[0] + delta[0] * w2), round(h2[1] + delta[1] * w2)];
  sp.anchors[seg] = a.kind === 'corner' ? { ...a, out } : moveHandle(a, 'out', out);
  sp.anchors[(seg + 1) % n] = b.kind === 'corner' ? { ...sp.anchors[(seg + 1) % n], in: inn } : moveHandle(sp.anchors[(seg + 1) % n], 'in', inn);
  return next;
}

// ---------------------------------------------------------------------------
// Pen tool
// ---------------------------------------------------------------------------

/**
 * Click to place sharp points, click-drag to pull out smooth handles (Alt breaks
 * the mirror), Shift snaps to 45°, click the first point to close, Enter or Esc
 * to finish.
 */
export function PenTool({ s, toArt, panning }: Omit<Props, 'layer'>) {
  const penLayerId = useStore((st) => st.penLayerId);
  const draft = useStore((st) => st.doc.layers.find((l) => l.id === st.penLayerId) ?? null);
  const drag = useRef<{ id: string; sub: number; idx: number } | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const u = 1 / s;

  const abs = useMemo(() => (draft?.path ? layerPathAbs(draft) : null), [draft]);
  const sub = abs ? abs.subpaths[abs.subpaths.length - 1] : null;
  const last = sub?.anchors[sub.anchors.length - 1];
  const first = sub?.anchors[0];
  const nearFirst = (p: Vec2) => !!(first && sub && !sub.closed && sub.anchors.length >= 2 && Math.hypot(p[0] - first.x, p[1] - first.y) < 9 * u);

  const snap = (p: Vec2, e: { shiftKey: boolean }): Vec2 => {
    if (!e.shiftKey || !last) return p;
    const dx = p[0] - last.x, dy = p[1] - last.y;
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [last.x + Math.cos(ang) * len, last.y + Math.sin(ang) * len];
  };

  const onDown = (e: RPointerEvent) => {
    if (panning || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const st = useStore.getState();
    let p = toArt(e);
    if (draft && abs && sub) {
      if (nearFirst(p)) {
        const next = clonePath(abs);
        next.subpaths[next.subpaths.length - 1].closed = true;
        st.updatePath(draft.id, withPathAbs(draft, next).path!);
        st.finishPen();
        return;
      }
      p = snap(p, e);
      const next = clonePath(abs);
      const target = next.subpaths[next.subpaths.length - 1];
      target.anchors.push(anchor(round(p[0]), round(p[1])));
      st.updatePath(draft.id, withPathAbs(draft, next).path!);
      drag.current = { id: draft.id, sub: next.subpaths.length - 1, idx: target.anchors.length - 1 };
    } else {
      const layer = createPathLayer({ subpaths: [{ closed: false, anchors: [anchor(round(p[0]), round(p[1]))] }] }, { name: 'Path' });
      st.addLayers([layer]);
      useStore.setState({ penLayerId: layer.id });
      drag.current = { id: layer.id, sub: 0, idx: 0 };
    }
  };

  const onMove = (e: RPointerEvent) => {
    const p = toArt(e);
    setHover(snap(p, e));
    const d = drag.current;
    if (!d) return;
    const st = useStore.getState();
    const layer = st.doc.layers.find((l) => l.id === d.id);
    if (!layer?.path) return;
    const next = layerPathAbs(layer);
    const a = next.subpaths[d.sub].anchors[d.idx];
    const outH: Vec2 = [round(p[0] - a.x), round(p[1] - a.y)];
    if (Math.hypot(outH[0], outH[1]) < 3 * u) return;
    next.subpaths[d.sub].anchors[d.idx] = e.altKey
      ? { ...a, out: outH, kind: 'corner' }
      : { ...a, out: outH, in: [-outH[0], -outH[1]], kind: 'symmetric' };
    st.updatePath(d.id, withPathAbs(layer, next).path!, 'pen');
  };

  const onUp = () => {
    drag.current = null;
  };

  const closing = hover && nearFirst(hover);
  const preview = last && hover && !drag.current
    ? `M${last.x} ${last.y}C${last.x + (last.out?.[0] ?? 0)} ${last.y + (last.out?.[1] ?? 0)} ${hover[0]} ${hover[1]} ${hover[0]} ${hover[1]}`
    : null;

  return (
    <g onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}>
      <rect
        x={-1e5} y={-1e5} width={2e5} height={2e5} fill="transparent"
        style={{ cursor: panning ? 'grab' : 'crosshair' }}
        onPointerDown={onDown}
        aria-label="Pen: click to add points, drag for curves"
      />
      {preview && <path d={preview} fill="none" stroke={ACCENT} strokeWidth={u} strokeDasharray={`${4 * u} ${3 * u}`} pointerEvents="none" />}
      {abs && penLayerId && (
        <g pointerEvents="none">
          <path d={pathToD(abs)} fill="none" stroke={ACCENT} strokeWidth={1.25 * u} />
          {abs.subpaths.flatMap((sp, si) =>
            sp.anchors.map((a, ai) => {
              const isLast = a === last;
              return (
                <g key={`${si}:${ai}`}>
                  {isLast && (['in', 'out'] as const).map((w) => a[w] && (
                    <g key={w}>
                      <line x1={a.x} y1={a.y} x2={a.x + a[w]![0]} y2={a.y + a[w]![1]} stroke={HANDLE} strokeWidth={u} />
                      <circle cx={a.x + a[w]![0]} cy={a.y + a[w]![1]} r={3 * u} fill="#fff" stroke={HANDLE} strokeWidth={1.25 * u} />
                    </g>
                  ))}
                  <rect x={a.x - 4 * u} y={a.y - 4 * u} width={8 * u} height={8 * u} rx={u} fill={isLast ? ACCENT : '#fff'} stroke={ACCENT} strokeWidth={1.5 * u} />
                </g>
              );
            }),
          )}
          {closing && first && <circle cx={first.x} cy={first.y} r={8 * u} fill="none" stroke={ACCENT} strokeWidth={1.5 * u} />}
        </g>
      )}
    </g>
  );
}
