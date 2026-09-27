import { sampleRamp } from './color.js';
import { lerp, rotationMatrix, apply, type Mat3 } from './math.js';
import { buildForm } from './pipeline.js';
import type { Form, Vec2, Vec3 } from './types.js';

export interface StrokeBucket {
  d: string;
  width: number;
  color: string;
  opacity: number;
  /** Drawn in the form's hidden-line style (dots/dashes). */
  hidden: boolean;
}
export interface FillBucket {
  d: string;
  color: string;
  opacity: number;
}
export interface MarkerBucket {
  d: string;
  color: string;
  opacity: number;
  filled: boolean;
  width: number;
}
export interface ProjectedLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
}

export interface RenderedForm {
  id: string;
  strokes: StrokeBucket[];
  fills: FillBucket[];
  markers: MarkerBucket[];
  arrows: { d: string; color: string }[];
  labels: ProjectedLabel[];
  bbox: { x: number; y: number; w: number; h: number };
  warnings: string[];
}

/** Colour levels a ramp is quantised into, and taper levels for weight/lightness. */
export const COLOR_LEVELS = 8;
export const TAPER_LEVELS = 6;
const HIDDEN_FADE = 0.22;
const MAX_QUADS = 24_000;
const MAX_FALLBACK_MARKERS = 400;

const f = (n: number) => (Math.round(n * 100) / 100).toString();

const cameraDistance = (perspective: number) => (perspective <= 0.001 ? Infinity : 2 + (1 - perspective) * 14);

export interface Projector {
  m: Mat3;
  d: number;
  view(p: Vec3): Vec3;
  screen(v: Vec3): Vec2;
  isBack(v: Vec3, n?: Vec3): boolean;
}

export function projector(t: Pick<Form, 'rx' | 'ry' | 'rz' | 'perspective' | 'x' | 'y' | 'scale'>): Projector {
  const m = rotationMatrix(t.rx, t.ry, t.rz);
  const d = cameraDistance(t.perspective);
  return {
    m,
    d,
    view: (p) => apply(m, p),
    screen: ([x, y, z]) => {
      const s = Number.isFinite(d) ? d / Math.max(0.05, d - z) : 1;
      return [t.x + x * s * t.scale, t.y - y * s * t.scale];
    },
    isBack: (v, n) => {
      // Only surfaces (geometry with normals) can hide lines. Loose curves are never
      // "behind" anything; the depth taper already conveys how far away they are.
      if (!n) return false;
      const rn = apply(m, n);
      if (!Number.isFinite(d)) return rn[2] < -1e-4;
      return rn[0] * -v[0] + rn[1] * -v[1] + rn[2] * (d - v[2]) < 0;
    },
  };
}

const quant = (v: number, levels: number) => Math.min(levels - 1, Math.max(0, Math.floor(v * levels)));
const center = (q: number, levels: number) => (levels === 1 ? 1 : q / (levels - 1));

/**
 * Project a form and group its segments into style buckets. Each bucket becomes a
 * single SVG path, so a form costs at most 2 × TAPER_LEVELS × COLOR_LEVELS strokes
 * however many lines it has.
 */
export function renderForm(form: Form, docRamp: string[], extraRy = 0): RenderedForm {
  const { geometry: geo, warnings } = buildForm(form);
  const st = form.style;
  const P = projector({ ...form, ry: form.ry + extraRy });
  const stops = st.ramp?.length ? st.ramp : docRamp;
  const solid = st.stroke ?? stops[0] ?? '#ffffff';
  const hiddenMode = st.hidden;

  // Pass 1: project everything once and find the depth range.
  let zmin = Infinity, zmax = -Infinity, famMax = 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = ([x, y]: Vec2) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const lines = geo.lines.map((line) => {
    const n = line.pts.length;
    const s: Vec2[] = new Array(n), z = new Float64Array(n), back: boolean[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = P.view(line.pts[i]);
      s[i] = P.screen(v);
      z[i] = v[2];
      back[i] = line.tone === 'front' ? false : line.tone === 'back' ? true : P.isBack(v, line.normals?.[i]);
      if (v[2] < zmin) zmin = v[2];
      if (v[2] > zmax) zmax = v[2];
      grow(s[i]);
    }
    if ((line.family ?? 0) > famMax) famMax = line.family ?? 0;
    return { line, s, z, back };
  });
  const nodeViews = geo.nodes.map((node) => {
    const v = P.view(node.p);
    if (v[2] < zmin) zmin = v[2];
    if (v[2] > zmax) zmax = v[2];
    if ((node.family ?? 0) > famMax) famMax = node.family ?? 0;
    const s = P.screen(v);
    grow(s);
    return { node, v, s };
  });
  const zr = zmax - zmin;
  const depth = (z: number) => (zr > 1e-6 ? (z - zmin) / zr : 1);

  const tap = (d: number, t: number) => (st.taper === 'depth' ? d : st.taper === 't' ? 1 - t : 1);
  const colorValue = (d: number, t: number, fam: number) => (st.colorBy === 'depth' ? d : st.colorBy === 't' ? t : fam / famMax);
  const colorAt = (q: number) => (st.color === 'ramp' ? sampleRamp(stops, center(q, COLOR_LEVELS)) : solid);
  const taperLevels = st.taper === 'none' ? 1 : TAPER_LEVELS;
  const colorLevels = st.color === 'ramp' ? COLOR_LEVELS : 1;

  // Pass 2: strokes.
  const strokeBuckets = new Map<string, { d: string[]; hidden: boolean; wq: number; cq: number }>();
  const arrows: { d: string; color: string }[] = [];
  for (const { line, s, z, back } of lines) {
    const n = s.length;
    if (n < 2) continue;
    const count = line.closed ? n : n - 1;
    const tv = (i: number) => (line.t ? line.t[i % n] : i / Math.max(1, n - 1));
    const fam = line.family ?? 0;
    let current = '';
    for (let k = 0; k < count; k++) {
      const a = k, b = (k + 1) % n;
      let isBack = back[b];
      if (isBack && hiddenMode === 'hide') {
        current = '';
        continue;
      }
      if (hiddenMode === 'solid') isBack = false;
      const d = (depth(z[a]) + depth(z[b])) / 2, t = (tv(a) + tv(k + 1)) / 2;
      const wq = taperLevels === 1 ? 0 : quant(tap(d, t), taperLevels);
      const cq = colorLevels === 1 ? 0 : quant(colorValue(d, t, fam), colorLevels);
      const key = `${isBack ? 1 : 0}|${wq}|${cq}`;
      let bucket = strokeBuckets.get(key);
      if (!bucket) strokeBuckets.set(key, (bucket = { d: [], hidden: isBack, wq, cq }));
      if (key === current) bucket.d.push(`L${f(s[b][0])} ${f(s[b][1])}`);
      else bucket.d.push(`M${f(s[a][0])} ${f(s[a][1])}L${f(s[b][0])} ${f(s[b][1])}`);
      current = key;
    }
    if (line.arrow && n >= 2) {
      const a = s[n - 2], b = s[n - 1];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const size = 7 + st.width * 3;
      const p1: Vec2 = [b[0] - size * Math.cos(ang - 0.4), b[1] - size * Math.sin(ang - 0.4)];
      const p2: Vec2 = [b[0] - size * Math.cos(ang + 0.4), b[1] - size * Math.sin(ang + 0.4)];
      arrows.push({
        d: `M${f(b[0])} ${f(b[1])}L${f(p1[0])} ${f(p1[1])}L${f(p2[0])} ${f(p2[1])}Z`,
        color: colorAt(colorLevels === 1 ? 0 : quant(colorValue(depth(z[n - 1]), tv(n - 1), fam), colorLevels)),
      });
    }
  }
  const strokes: StrokeBucket[] = [...strokeBuckets.values()]
    .map((b) => {
      const v = taperLevels === 1 ? 1 : center(b.wq, taperLevels);
      const amt = st.taper === 'none' ? 0 : st.taperAmount;
      return {
        d: b.d.join(''),
        width: Math.max(0.05, st.width * lerp(1 - amt, 1, v)),
        color: colorAt(b.cq),
        opacity: lerp(1 - amt * 0.7, 1, v) * (b.hidden && hiddenMode === 'fade' ? HIDDEN_FADE : 1),
        hidden: b.hidden,
      };
    })
    // Far and hidden first, so near lines paint over them.
    .sort((a, b) => Number(b.hidden) - Number(a.hidden) || a.width - b.width);

  // Ribbons: translucent bands between neighbouring lines of the same band.
  const fillBuckets = new Map<string, string[]>();
  if (st.fill === 'ribbons') {
    let quads = 0;
    for (let li = 1; li < lines.length && quads < MAX_QUADS; li++) {
      const A = lines[li - 1], B = lines[li];
      if (A.line.band === undefined || A.line.band !== B.line.band || A.s.length !== B.s.length) continue;
      const n = A.s.length;
      const count = A.line.closed && B.line.closed ? n : n - 1;
      for (let k = 0; k < count && quads < MAX_QUADS; k++, quads++) {
        const k2 = (k + 1) % n;
        const backs = Number(A.back[k]) + Number(A.back[k2]) + Number(B.back[k]) + Number(B.back[k2]);
        const isBack = hiddenMode !== 'solid' && backs >= 3;
        if (isBack && hiddenMode === 'hide') continue;
        const d = (depth(A.z[k]) + depth(B.z[k2])) / 2;
        const t = A.line.t ? A.line.t[k] : k / Math.max(1, n - 1);
        const cq = colorLevels === 1 ? 0 : quant(colorValue(d, t, A.line.family ?? 0), colorLevels);
        const key = `${isBack ? 1 : 0}|${cq}`;
        let list = fillBuckets.get(key);
        if (!list) fillBuckets.set(key, (list = []));
        const q = [A.s[k], A.s[k2], B.s[k2], B.s[k]];
        list.push(`M${f(q[0][0])} ${f(q[0][1])}L${f(q[1][0])} ${f(q[1][1])}L${f(q[2][0])} ${f(q[2][1])}L${f(q[3][0])} ${f(q[3][1])}Z`);
      }
      if (quads >= MAX_QUADS) warnings.push('ribbon fill was capped to keep the drawing light');
    }
  }
  const fills: FillBucket[] = [...fillBuckets.entries()]
    .map(([key, list]) => {
      const [bk, cq] = key.split('|').map(Number);
      return { d: list.join(''), color: colorAt(cq), opacity: st.fillOpacity * (bk ? 0.4 : 1), back: bk };
    })
    .sort((a, b) => b.back - a.back)
    .map(({ back: _back, ...rest }) => rest);

  // Markers: on the geometry's points, or on line vertices when it has none.
  const markerBuckets = new Map<string, string[]>();
  if (st.markers !== 'none' && st.markerSize > 0) {
    let marks = nodeViews.map(({ node, v, s }) => ({ s, z: v[2], back: P.isBack(v, node.n), t: node.t ?? 0, fam: node.family ?? 0 }));
    if (!marks.length) {
      const total = lines.reduce((a, l) => a + l.s.length, 0);
      const stride = Math.max(1, Math.ceil(total / MAX_FALLBACK_MARKERS));
      marks = lines.flatMap(({ line, s, z, back }) =>
        s.map((p, i) => ({ s: p, z: z[i], back: back[i], t: line.t?.[i] ?? 0, fam: line.family ?? 0 })).filter((_, i) => i % stride === 0),
      );
    }
    const every = Math.max(1, Math.round(st.markerEvery));
    marks.forEach((m, i) => {
      if (i % every) return;
      const isBack = hiddenMode !== 'solid' && m.back;
      if (isBack && hiddenMode === 'hide') return;
      const d = depth(m.z);
      const r = st.markerSize * (st.markersByDepth ? lerp(0.45, 1, d) : 1);
      const cq = colorLevels === 1 ? 0 : quant(colorValue(d, m.t, m.fam), colorLevels);
      const key = `${isBack ? 1 : 0}|${cq}`;
      let list = markerBuckets.get(key);
      if (!list) markerBuckets.set(key, (list = []));
      const [x, y] = m.s;
      switch (st.markers) {
        case 'dot':
        case 'ring':
          list.push(`M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`);
          break;
        case 'cross':
          list.push(`M${f(x - r)} ${f(y - r)}L${f(x + r)} ${f(y + r)}M${f(x + r)} ${f(y - r)}L${f(x - r)} ${f(y + r)}`);
          break;
        case 'tick':
          list.push(`M${f(x)} ${f(y - r)}L${f(x)} ${f(y + r)}`);
          break;
      }
    });
  }
  const markers: MarkerBucket[] = [...markerBuckets.entries()].map(([key, list]) => {
    const [bk, cq] = key.split('|').map(Number);
    return {
      d: list.join(''),
      color: colorAt(cq),
      opacity: bk && hiddenMode === 'fade' ? HIDDEN_FADE * 1.5 : 1,
      filled: st.markers === 'dot',
      width: Math.max(0.6, st.markerSize * 0.35),
    };
  });

  const labels: ProjectedLabel[] = (geo.labels ?? []).map((l) => {
    const [x, y] = P.screen(P.view(l.p));
    grow([x, y]);
    return { x, y, text: l.text, anchor: l.anchor ?? 'start' };
  });

  if (!Number.isFinite(minX)) minX = maxX = form.x, minY = maxY = form.y;
  return { id: form.id, strokes, fills, markers, arrows, labels, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, warnings };
}

const renderCache = new WeakMap<Form, { ramp: string; r: RenderedForm }>();
/** Cached render for a static form (no animation offset). */
export function renderFormCached(form: Form, docRamp: string[]): RenderedForm {
  const rampKey = docRamp.join(',');
  const hit = renderCache.get(form);
  if (hit && hit.ramp === rampKey) return hit.r;
  const r = renderForm(form, docRamp);
  renderCache.set(form, { ramp: rampKey, r });
  return r;
}
