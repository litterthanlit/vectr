import { apply, rotationMatrix, type Mat3 } from './math.js';
import type { Layer, Vec2, Vec3 } from './types.js';
import { geometryFor } from './generators/index.js';

export interface ProjectedLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  marker: boolean;
}

export interface RenderedLayer {
  id: string;
  front: string;
  back: string;
  nodesFront: Vec2[];
  nodesBack: Vec2[];
  arrows: string[];
  labels: ProjectedLabel[];
  bbox: { x: number; y: number; w: number; h: number };
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Camera distance in unit space for a given perspective amount; Infinity = orthographic. */
const cameraDistance = (perspective: number) => (perspective <= 0.001 ? Infinity : 2 + (1 - perspective) * 14);

export interface Projector {
  m: Mat3;
  d: number;
  /** Rotated (camera-space) point. */
  view(p: Vec3): Vec3;
  /** Screen-space point in artboard pixels. */
  screen(v: Vec3): Vec2;
  /** True when a camera-space point with the given normal faces away from the viewer. */
  isBack(v: Vec3, n?: Vec3): boolean;
}

export function projector(layer: Pick<Layer, 'rx' | 'ry' | 'rz' | 'perspective' | 'x' | 'y' | 'scale'>): Projector {
  const m = rotationMatrix(layer.rx, layer.ry, layer.rz);
  const d = cameraDistance(layer.perspective);
  return {
    m,
    d,
    view: (p) => apply(m, p),
    screen: ([x, y, z]) => {
      const s = Number.isFinite(d) ? d / Math.max(0.05, d - z) : 1;
      return [layer.x + x * s * layer.scale, layer.y - y * s * layer.scale];
    },
    isBack: (v, n) => {
      if (n) {
        const rn = apply(m, n);
        if (!Number.isFinite(d)) return rn[2] < -1e-4;
        return rn[0] * -v[0] + rn[1] * -v[1] + rn[2] * (d - v[2]) < 0;
      }
      return v[2] < -0.02;
    },
  };
}

/**
 * Project a layer's geometry into SVG path data. Each polyline is split into
 * runs that face the viewer (front) and runs that face away (back), so the back
 * half of a shape can be drawn dotted, dashed, faded or hidden.
 */
export function renderLayer(layer: Layer, extraRy = 0): RenderedLayer {
  const geo = geometryFor(layer);
  const P = projector({ ...layer, ry: layer.ry + extraRy });
  let front = '';
  let back = '';
  const arrows: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = ([x, y]: Vec2) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const line of geo.lines) {
    const n = line.pts.length;
    if (n < 2) continue;
    const count = line.closed ? n + 1 : n;
    let run = '';
    let runBack: boolean | null = null;
    const flush = () => {
      if (run) {
        if (runBack) back += run;
        else front += run;
      }
    };
    for (let i = 0; i < count; i++) {
      const k = i % n;
      const v = P.view(line.pts[k]);
      const s = P.screen(v);
      grow(s);
      const isBack = line.tone === 'front' ? false : line.tone === 'back' ? true : P.isBack(v, line.normals?.[k]);
      if (runBack === null) {
        runBack = isBack;
        run = `M${f(s[0])} ${f(s[1])}`;
      } else if (isBack !== runBack) {
        // Share the transition point so runs meet without gaps.
        run += `L${f(s[0])} ${f(s[1])}`;
        flush();
        runBack = isBack;
        run = `M${f(s[0])} ${f(s[1])}`;
      } else {
        run += `L${f(s[0])} ${f(s[1])}`;
      }
    }
    flush();

    if (line.arrow) {
      const a = P.screen(P.view(line.pts[n - 2]));
      const b = P.screen(P.view(line.pts[n - 1]));
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const size = 7 + layer.style.width * 3;
      const p1: Vec2 = [b[0] - size * Math.cos(ang - 0.4), b[1] - size * Math.sin(ang - 0.4)];
      const p2: Vec2 = [b[0] - size * Math.cos(ang + 0.4), b[1] - size * Math.sin(ang + 0.4)];
      const tip: Vec2 = [b[0] + Math.cos(ang) * size * 0.2, b[1] + Math.sin(ang) * size * 0.2];
      arrows.push(`M${f(tip[0])} ${f(tip[1])}L${f(p1[0])} ${f(p1[1])}L${f(p2[0])} ${f(p2[1])}Z`);
    }
  }

  const nodesFront: Vec2[] = [];
  const nodesBack: Vec2[] = [];
  for (const node of geo.nodes) {
    const v = P.view(node.p);
    const s = P.screen(v);
    grow(s);
    (P.isBack(v, node.n) ? nodesBack : nodesFront).push(s);
  }

  const labels: ProjectedLabel[] = (geo.labels ?? []).map((l) => {
    const [x, y] = P.screen(P.view(l.p));
    return { x, y, text: l.text, anchor: l.anchor ?? 'start', marker: Boolean(l.marker) };
  });

  if (!Number.isFinite(minX)) minX = maxX = layer.x, minY = maxY = layer.y;
  return {
    id: layer.id,
    front,
    back,
    nodesFront,
    nodesBack,
    arrows,
    labels,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

const renderCache = new WeakMap<Layer, RenderedLayer>();
/** Cached render for a static layer (no animation offset). */
export function renderLayerCached(layer: Layer): RenderedLayer {
  let r = renderCache.get(layer);
  if (!r) {
    r = renderLayer(layer);
    renderCache.set(layer, r);
  }
  return r;
}
