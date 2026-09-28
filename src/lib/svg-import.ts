/**
 * SVG markup -> editable vector paths. Works without a DOM (Node / MCP), so it
 * uses a tiny tag scanner rather than DOMParser. It understands the drawable
 * elements designers and generative models (QuiverAI, Figma, icon sets)
 * actually emit: path, rect, circle, ellipse, line, polyline, polygon, nested
 * <g> with transforms, presentation attributes, inline style and <style>-free
 * inheritance of fill/stroke.
 */
import {
  IDENTITY, ellipsePath, multiply, parsePathD, polyline, rectPath, transformPath,
  type Affine, type VectorPath,
} from './path';
import type { Vec2 } from './types';

export interface ImportedShape {
  name: string;
  path: VectorPath;
  /** null = none. */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

export interface ImportResult {
  shapes: ImportedShape[];
  viewBox: { x: number; y: number; w: number; h: number } | null;
  warnings: string[];
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
}

function* scanTags(src: string): Generator<Tag> {
  const clean = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const attrs: Record<string, string> = {};
    const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3]))) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    yield { closing: m[1] === '/', name: m[2].replace(/^svg:/, ''), attrs, selfClosing: m[4] === '/' };
  }
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const nums = (s: string) => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

export function parseTransform(t: string | undefined): Affine {
  if (!t) return IDENTITY;
  let m: Affine = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(t))) {
    const v = nums(x[2]);
    let n: Affine = IDENTITY;
    switch (x[1]) {
      case 'matrix':
        if (v.length === 6) n = v as Affine;
        break;
      case 'translate':
        n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(a), s = Math.sin(a);
        const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
        n = multiply(multiply([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, n);
  }
  return m;
}

interface Paint {
  fill: string | null | undefined;
  stroke: string | null | undefined;
  strokeWidth: number | undefined;
  opacity: number;
  fillOpacity: number | undefined;
  fillRule: 'nonzero' | 'evenodd' | undefined;
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', none: 'none' };

function color(v: string | undefined, warnings: string[]): string | null | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  if (s === '' || s === 'inherit') return undefined;
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'currentColor') return 'currentColor';
  if (s.startsWith('url(')) {
    warnings.push(`Gradient/pattern paint ${s} replaced with a flat colour`);
    return '#888888';
  }
  return NAMED[s.toLowerCase()] ?? s;
}

function styleOf(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...attrs };
  if (attrs.style) {
    for (const decl of attrs.style.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

function readPaint(attrs: Record<string, string>, parent: Paint, warnings: string[]): Paint {
  const st = styleOf(attrs);
  const fill = color(st.fill, warnings);
  const stroke = color(st.stroke, warnings);
  const sw = st['stroke-width'] !== undefined ? parseFloat(st['stroke-width']) : undefined;
  const op = st.opacity !== undefined ? parseFloat(st.opacity) : 1;
  const fo = st['fill-opacity'] !== undefined ? parseFloat(st['fill-opacity']) : undefined;
  const fr = st['fill-rule'] === 'evenodd' ? 'evenodd' : st['fill-rule'] === 'nonzero' ? 'nonzero' : undefined;
  return {
    fill: fill !== undefined ? fill : parent.fill,
    stroke: stroke !== undefined ? stroke : parent.stroke,
    strokeWidth: sw !== undefined && Number.isFinite(sw) ? sw : parent.strokeWidth,
    opacity: parent.opacity * (Number.isFinite(op) ? op : 1),
    fillOpacity: fo !== undefined ? fo : parent.fillOpacity,
    fillRule: fr ?? parent.fillRule,
  };
}

const f = (attrs: Record<string, string>, k: string, d = 0) => {
  const v = parseFloat(attrs[k] ?? '');
  return Number.isFinite(v) ? v : d;
};

function shapePath(tag: Tag): VectorPath | null {
  const a = tag.attrs;
  switch (tag.name) {
    case 'path':
      return a.d ? parsePathD(a.d) : null;
    case 'rect': {
      const w = f(a, 'width'), h = f(a, 'height');
      if (w <= 0 || h <= 0) return null;
      const r = a.rx !== undefined ? f(a, 'rx') : f(a, 'ry');
      return rectPath(f(a, 'x'), f(a, 'y'), w, h, r);
    }
    case 'circle': {
      const r = f(a, 'r');
      return r > 0 ? ellipsePath(f(a, 'cx'), f(a, 'cy'), r) : null;
    }
    case 'ellipse': {
      const rx = f(a, 'rx'), ry = f(a, 'ry');
      return rx > 0 && ry > 0 ? ellipsePath(f(a, 'cx'), f(a, 'cy'), rx, ry) : null;
    }
    case 'line':
      return { subpaths: [polyline([[f(a, 'x1'), f(a, 'y1')], [f(a, 'x2'), f(a, 'y2')]])] };
    case 'polyline':
    case 'polygon': {
      const v = nums(a.points ?? '');
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      return pts.length > 1 ? { subpaths: [polyline(pts, tag.name === 'polygon')] } : null;
    }
  }
  return null;
}

const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SKIP_CONTAINERS = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'style', 'title', 'desc', 'metadata', 'marker']);

export function importSVG(markup: string): ImportResult {
  const warnings: string[] = [];
  const shapes: ImportedShape[] = [];
  let viewBox: ImportResult['viewBox'] = null;
  const root: Paint = { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, fillOpacity: undefined, fillRule: undefined };
  const stack: { name: string; m: Affine; paint: Paint; label?: string }[] = [{ name: '#root', m: IDENTITY, paint: root }];
  // While inside a skipped element, count nested tags of the same name to find its end.
  let skipTag: string | null = null;
  let skipDepth = 0;
  const counts: Record<string, number> = {};
  const skipped = new Set<string>();

  for (const tag of scanTags(markup)) {
    if (skipTag) {
      if (tag.name === skipTag && !tag.selfClosing) skipDepth += tag.closing ? -1 : 1;
      if (skipDepth === 0) skipTag = null;
      continue;
    }
    if (tag.closing) {
      const i = stack.map((s) => s.name).lastIndexOf(tag.name);
      if (i > 0) stack.length = i;
      continue;
    }
    const hidden = /display\s*:\s*none|visibility\s*:\s*hidden/.test(tag.attrs.style ?? '') || tag.attrs.display === 'none' || tag.attrs.visibility === 'hidden';
    if (SKIP_CONTAINERS.has(tag.name) || hidden) {
      if (!tag.selfClosing) {
        skipTag = tag.name;
        skipDepth = 1;
      }
      continue;
    }
    const top = stack[stack.length - 1];
    let m = multiply(top.m, parseTransform(tag.attrs.transform));
    const paint = readPaint(tag.attrs, top.paint, warnings);
    const label = tag.attrs.id ?? tag.attrs['data-name'] ?? tag.attrs['inkscape:label'] ?? top.label;

    if (tag.name === 'svg') {
      const vb = nums(tag.attrs.viewBox ?? '');
      if (stack.length === 1) {
        if (vb.length === 4) viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
        else if (tag.attrs.width && tag.attrs.height) viewBox = { x: 0, y: 0, w: f(tag.attrs, 'width'), h: f(tag.attrs, 'height') };
      } else if (vb.length === 4) {
        // Nested <svg>: map its viewBox into its viewport.
        const w = f(tag.attrs, 'width', vb[2]), h = f(tag.attrs, 'height', vb[3]);
        const k = Math.min(w / vb[2], h / vb[3]);
        m = multiply(m, [k, 0, 0, k, f(tag.attrs, 'x') - vb[0] * k, f(tag.attrs, 'y') - vb[1] * k]);
      }
    }

    if (DRAWABLE.has(tag.name)) {
      let path = shapePath(tag);
      if (path && path.subpaths.length) {
        path = transformPath(path, m);
        if (paint.fillRule) path.fillRule = paint.fillRule;
        const lin = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        counts[tag.name] = (counts[tag.name] ?? 0) + 1;
        shapes.push({
          name: tag.attrs.id ?? tag.attrs['data-name'] ?? (label ? `${label} ${counts[tag.name]}` : `${tag.name} ${counts[tag.name]}`),
          path,
          fill: tag.name === 'line' ? null : paint.fill ?? null,
          stroke: paint.stroke ?? null,
          strokeWidth: (paint.strokeWidth ?? 1) * lin,
          opacity: paint.opacity * (paint.fillOpacity ?? 1),
        });
      }
    } else if (!tag.selfClosing && !['svg', 'g', 'a', 'switch'].includes(tag.name)) {
      skipped.add(tag.name);
    }
    if (!tag.selfClosing) stack.push({ name: tag.name, m, paint, label: tag.name === 'svg' ? undefined : label });
  }
  for (const s of skipped) warnings.push(`<${s}> elements are not imported (convert text to outlines first)`);
  return { shapes, viewBox, warnings: [...new Set(warnings)] };
}
