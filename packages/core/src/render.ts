import { sampleRamp } from './color.js';
import { lerp, rotationMatrix, apply, type Mat3 } from './math.js';
import { buildForm } from './pipeline.js';
import type { Form, LabelFont, Vec2, Vec3 } from './types.js';

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
  /** Screen position of the anchor point. */
  x: number;
  y: number;
  /** Already word-wrapped, so the app, SVG export and PNG previews break identically. */
  lines: string[];
  anchor: 'start' | 'middle' | 'end';
  /** Where the block sits relative to y: 'bottom' puts the last baseline at y. */
  valign: 'top' | 'middle' | 'bottom';
  /** Font size in pixels. */
  size: number;
  font: LabelFont;
}

export interface RenderedForm {
  id: string;
  strokes: StrokeBucket[];
  fills: FillBucket[];
  markers: MarkerBucket[];
  arrows: { d: string; color: string }[];
  labels: ProjectedLabel[];
  /** Text colour: the form's labelColor, else the colour of its nearest lines. */
  labelColor: string;
  bbox: { x: number; y: number; w: number; h: number };
  warnings: string[];
}

/** Colour levels a ramp is quantised into, and taper levels for weight/lightness. */
export const COLOR_LEVELS = 8;
export const TAPER_LEVELS = 6;
const HIDDEN_FADE = 0.22;
const MAX_QUADS = 24_000;
const MAX_FALLBACK_MARKERS = 400;

/** Line height of multi-line labels, in ems. */
export const LABEL_LEADING = 1.25;
const MAX_LABEL_LINES = 12;
const MAX_LABEL_CHARS = 2000;

/** CRLF and CR become LF; control characters (other than LF and tab) are dropped. */
export const cleanText = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

/**
 * Estimated advance of one character in ems. Measured against Arial/Helvetica-class
 * faces, then rounded up a little (Inter and DejaVu run wider) so wrapped text rarely
 * overflows its box.
 */
function charEm(ch: string, font: LabelFont): number {
  if (font !== 'sans' && font !== 'serif') return 0.62; // monospace, letter-spacing included
  if (ch === ' ' || ch === '\t' || 'ijltfr.,\'!|:;'.includes(ch)) return 0.3;
  if ('mw'.includes(ch)) return 0.86;
  if ('MW'.includes(ch)) return 0.95;
  if (ch >= '0' && ch <= '9') return 0.58;
  if (ch >= 'A' && ch <= 'Z') return 0.7;
  if (ch >= 'a' && ch <= 'z') return 0.56;
  return (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.6;
}

/** Estimated width of one line of text, in pixels. */
export function textWidth(text: string, size: number, font: LabelFont = 'mono'): number {
  let w = 0;
  for (const ch of text) w += charEm(ch, font);
  return w * size;
}

/**
 * Break text into label lines: explicit newlines are kept, words are packed greedily
 * into `maxPx`, words wider than a line are cut, and at most 12 lines survive (the last
 * ends in an ellipsis). Without a usable `maxPx` only explicit newlines break.
 */
export function wrapText(text: string, maxPx: number, size: number, font: LabelFont = 'mono'): string[] {
  const max = maxPx > 0 && Number.isFinite(maxPx) ? maxPx : Infinity;
  const w = (s: string) => textWidth(s, size, font);
  const lines: string[] = [];
  const full = () => lines.length > MAX_LABEL_LINES;
  const push = (l: string) => void (full() || lines.push(l));
  for (const para of cleanText(text).slice(0, MAX_LABEL_CHARS).split('\n')) {
    let cur = '';
    for (let word of para.split(/\s+/)) {
      if (!word) continue;
      if (cur && w(`${cur} ${word}`) <= max) {
        cur += ` ${word}`;
        continue;
      }
      if (cur) push(cur);
      // A word wider than the line is cut into line-sized pieces.
      while (w(word) > max && !full()) {
        const chars = [...word];
        let k = 1;
        while (k < chars.length && w(chars.slice(0, k + 1).join('')) <= max) k++;
        push(chars.slice(0, k).join(''));
        word = chars.slice(k).join('');
      }
      cur = word;
    }
    push(cur);
    if (full()) break;
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length > MAX_LABEL_LINES) {
    lines.length = MAX_LABEL_LINES;
    let last = lines[MAX_LABEL_LINES - 1];
    while (last.length > 1 && w(`${last}…`) > max) last = last.slice(0, -1);
    lines[MAX_LABEL_LINES - 1] = `${last}…`;
  }
  return lines;
}

/** Offset of a label's first baseline from its anchor point, in pixels. */
export const labelDy0 = (valign: ProjectedLabel['valign'], lines: number, size: number) => {
  const lh = LABEL_LEADING * size;
  return valign === 'top' ? 0.8 * size : valign === 'middle' ? -((lines - 1) * lh) / 2 + 0.35 * size : -(lines - 1) * lh;
};

const FONTS: LabelFont[] = ['mono', 'sans', 'serif'];
const ANCHORS: ProjectedLabel['anchor'][] = ['start', 'middle', 'end'];
const VALIGNS: ProjectedLabel['valign'][] = ['top', 'middle', 'bottom'];
/** Narrow untrusted input (labels arrive from agents and files) to one of a few known values. */
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

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

  // Fills: translucent ribbons between neighbouring lines of a band, or every closed line as a shape.
  const fillBuckets = new Map<string, string[]>();
  if (st.fill === 'shapes') {
    let pts = 0;
    for (const { line, s, z, back } of lines) {
      const n = s.length;
      if (!line.closed || n < 3) continue;
      if (pts >= MAX_QUADS * 4) {
        warnings.push('shape fill was capped to keep the drawing light');
        break;
      }
      const isBack = hiddenMode !== 'solid' && back.filter(Boolean).length * 2 > n;
      if (isBack && hiddenMode === 'hide') continue;
      // Wind every polygon the same way, or overlapping shapes in one path cancel under nonzero fill.
      let area = 0;
      for (let i = 0; i < n; i++) area += s[i][0] * s[(i + 1) % n][1] - s[(i + 1) % n][0] * s[i][1];
      if (!(Math.abs(area) > 0.1)) continue;
      const ring = area < 0 ? [...s].reverse() : s;
      let d = 0, t = 0;
      for (let i = 0; i < n; i++) {
        d += depth(z[i]);
        t += line.t?.[i] ?? 0.5;
      }
      const cq = colorLevels === 1 ? 0 : quant(colorValue(d / n, t / n, line.family ?? 0), colorLevels);
      const key = `${isBack ? 1 : 0}|${cq}`;
      let list = fillBuckets.get(key);
      if (!list) fillBuckets.set(key, (list = []));
      list.push(`M${ring.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`);
      pts += n;
    }
  }
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

  // Labels are wrapped here, not at draw time, so every output breaks lines the same way.
  const labels: ProjectedLabel[] = [];
  for (const l of geo.labels ?? []) {
    const [x, y] = P.screen(P.view(l.p));
    const mult = typeof l.size === 'number' && l.size > 0 ? Math.min(l.size, 20) : 1;
    const size = Math.min(500, Math.max(1, st.labelSize * mult));
    const font = pick(l.font, FONTS, pick(st.labelFont, FONTS, 'mono'));
    const lines = wrapText(String(l.text ?? ''), (l.wrap ?? 0) * form.scale, size, font);
    if (!lines.length) continue;
    const anchor = pick(l.anchor, ANCHORS, 'start');
    const valign = pick(l.valign, VALIGNS, 'bottom');
    labels.push({ x, y, lines, anchor, valign, size, font });
    if (!st.labels) continue;
    // Grow the box over the estimated text block, so selecting a card selects its words.
    const width = Math.max(...lines.map((s) => textWidth(s, size, font)));
    const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;
    const first = y + labelDy0(valign, lines.length, size);
    grow([left, first - 0.8 * size]);
    grow([left + width, first + (lines.length - 1) * LABEL_LEADING * size + 0.25 * size]);
  }

  if (!Number.isFinite(minX)) minX = maxX = form.x, minY = maxY = form.y;
  const labelColor = st.labelColor ?? strokes[strokes.length - 1]?.color ?? (st.color === 'solid' ? solid : stops[stops.length - 1] ?? solid);
  return {
    id: form.id, strokes, fills, markers, arrows, labels, labelColor,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, warnings,
  };
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
