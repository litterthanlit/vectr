import { renderLayer, type RenderedLayer } from './render.js';
import type { BackStyle, Doc, Layer } from './types.js';

/**
 * SVG serialisation. The app renders the artboard through these same functions,
 * so what an agent exports is byte-for-byte what a person sees on screen.
 *
 * Every string that can come from a document (colours, label text) is escaped:
 * documents arrive from files, links and agents, and the app injects this markup.
 */

export const LABEL_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const ROUGH_FILTER_ID = 'vectr-rough';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function backAttrs(back: BackStyle, width: number): string {
  switch (back) {
    case 'dotted':
      return ` stroke-dasharray="0 ${(width * 2.8 + 1.2).toFixed(2)}" stroke-linecap="round"`;
    case 'dashed':
      return ` stroke-dasharray="${(width * 5 + 3).toFixed(2)} ${(width * 3 + 3).toFixed(2)}"`;
    case 'faded':
      return ' stroke-opacity="0.28"';
    default:
      return '';
  }
}

/** Markup for one layer (a `<g>`), from an already-projected render. */
export function layerToSVG(layer: Layer, r: RenderedLayer, ink: string): string {
  const s = layer.style;
  const color = esc(s.stroke ?? ink);
  const w = n(s.width);
  const showBack = s.back !== 'hidden';
  const out: string[] = [`<g opacity="${n(s.opacity)}">`];

  if (showBack && r.back) {
    out.push(`<path d="${r.back}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"${backAttrs(s.back, s.width)}/>`);
  }
  if (r.front) {
    out.push(`<path d="${r.front}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const d of r.arrows) {
    out.push(`<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${n(s.width * 0.5)}" stroke-linejoin="round"/>`);
  }
  if (s.nodes && s.nodeSize > 0) {
    out.push(`<g fill="${color}">`);
    if (s.backNodes && showBack) {
      const op = s.back === 'faded' ? ' opacity="0.35"' : '';
      for (const [x, y] of r.nodesBack) out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s.nodeSize * 0.8)}"${op}/>`);
    }
    for (const [x, y] of r.nodesFront) out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s.nodeSize)}"/>`);
    out.push('</g>');
  }
  if (s.labels && r.labels.length) {
    const size = s.labelSize;
    out.push(`<g fill="${color}" font-family="${esc(LABEL_FONT)}" font-size="${n(size)}" letter-spacing="0.04em">`);
    for (const l of r.labels) {
      if (l.marker) out.push(`<circle cx="${n(l.x - size * 0.6)}" cy="${n(l.y - size * 0.32)}" r="${n(Math.max(1, size * 0.12))}"/>`);
      out.push(`<text x="${n(l.x)}" y="${n(l.y)}" text-anchor="${l.anchor}">${esc(l.text)}</text>`);
    }
    out.push('</g>');
  }
  out.push('</g>');
  return out.join('');
}

export function roughFilterSVG(rough: number): string {
  return rough > 0
    ? `<defs><filter id="${ROUGH_FILTER_ID}" x="-5%" y="-5%" width="110%" height="110%">` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="noise"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${n(rough)}" xChannelSelector="R" yChannelSelector="G"/>` +
        `</filter></defs>`
    : '';
}

/** A complete, standalone SVG document. */
export function docToSVG(doc: Doc, rendered?: Map<string, RenderedLayer>): string {
  const body = doc.layers
    .filter((l) => l.visible)
    .map((l) => layerToSVG(l, rendered?.get(l.id) ?? renderLayer(l), doc.ink))
    .join('');
  const filter = doc.rough > 0 ? ` filter="url(#${ROUGH_FILTER_ID})"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">` +
    roughFilterSVG(doc.rough) +
    `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>` +
    `<g${filter}>${body}</g></svg>`
  );
}
