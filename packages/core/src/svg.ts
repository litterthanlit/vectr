import { LABEL_LEADING, labelDy0, renderForm, type ProjectedLabel, type RenderedForm } from './render.js';
import type { Doc, Form, LabelFont } from './types.js';

/**
 * SVG serialisation. The app renders the artboard through these same functions,
 * so what an agent exports is byte-for-byte what a person sees on screen.
 *
 * Every string that can come from a document (colours, label text) is escaped:
 * documents arrive from files, links and agents, and the app injects this markup.
 */

export const LABEL_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
/** Each stack ends in fonts installed on most systems, so exports and previews still show text. */
export const LABEL_FONTS: Record<LabelFont, string> = {
  mono: LABEL_FONT,
  sans: "Inter, 'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Liberation Serif', 'DejaVu Serif', serif",
};
export const ROUGH_FILTER_ID = 'vectr-rough';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** `stroke-dasharray` for a line pattern. Dotted is zero-length dashes, which the round caps turn into dots. */
function dash(pattern: string | undefined, width: number): string {
  if (pattern === 'dotted') return ` stroke-dasharray="0 ${n(width * 2.8 + 1.2)}"`;
  if (pattern === 'dashed') return ` stroke-dasharray="${n(width * 5 + 3)} ${n(width * 3 + 3)}"`;
  return '';
}

/**
 * Markup for one form (a `<g>`), from an already-projected render. `paper` is the
 * document background, painted under knockout fills; thumbnails omit it.
 */
export function formToSVG(form: Form, r: RenderedForm, paper?: string): string {
  const st = form.style;
  const out: string[] = [`<g opacity="${n(st.opacity)}">`];
  const knock = st.knockout && paper ? esc(paper) : '';
  for (const fl of r.fills) {
    if (knock) out.push(`<path d="${fl.d}" fill="${knock}" stroke="none"/>`);
    out.push(`<path d="${fl.d}" fill="${esc(fl.color)}" fill-opacity="${n(fl.opacity)}" stroke="none"/>`);
  }
  // Hidden lines take the hidden pattern when it is dotted or dashed; otherwise they follow the form's own.
  const hiddenPattern = st.hidden === 'dotted' || st.hidden === 'dashed' ? st.hidden : st.dash;
  for (const s of r.strokes) {
    out.push(
      `<path d="${s.d}" fill="none" stroke="${esc(s.color)}" stroke-width="${n(s.width)}" stroke-opacity="${n(s.opacity)}" stroke-linecap="round" stroke-linejoin="round"${dash(s.ink ? 'solid' : s.hidden ? hiddenPattern : st.dash, s.width)}/>`,
    );
  }
  for (const a of r.arrows) out.push(`<path d="${a.d}" fill="${esc(a.color)}" stroke="${esc(a.color)}" stroke-width="${n(st.width * 0.5)}" stroke-linejoin="round"/>`);
  for (const m of r.markers) {
    out.push(
      m.filled
        ? `<path d="${m.d}" fill="${esc(m.color)}" fill-opacity="${n(m.opacity)}"/>`
        : `<path d="${m.d}" fill="none" stroke="${esc(m.color)}" stroke-opacity="${n(m.opacity)}" stroke-width="${n(m.width)}" stroke-linecap="round"/>`,
    );
  }
  if (st.labels && r.labels.length) {
    out.push(`<g fill="${esc(r.labelColor)}">`);
    for (const l of r.labels) out.push(labelToSVG(l));
    out.push('</g>');
  }
  out.push('</g>');
  return out.join('');
}

/**
 * One `<text>` with a `<tspan>` per line, positioned with dy alone: resvg's
 * dominant-baseline support is unreliable.
 */
function labelToSVG(l: ProjectedLabel): string {
  const lh = LABEL_LEADING * l.size;
  let dy = labelDy0(l.valign, l.lines.length, l.size);
  const spans: string[] = [];
  for (const line of l.lines) {
    // A blank line hands its height to the next tspan: an empty tspan has no glyphs to shift.
    if (line) spans.push(`<tspan x="${n(l.x)}" dy="${n(dy)}">${esc(line)}</tspan>`);
    dy = line ? lh : dy + lh;
  }
  const mono = l.font !== 'sans' && l.font !== 'serif';
  // resvg fails to parse a quoted family that follows ", ", and then drops to its default font.
  const family = (LABEL_FONTS[l.font] ?? LABEL_FONT).replace(/, /g, ',');
  return (
    `<text x="${n(l.x)}" y="${n(l.y)}" text-anchor="${l.anchor}" font-family="${esc(family)}" font-size="${n(l.size)}"` +
    `${mono ? ' letter-spacing="0.02em"' : ''}>${spans.join('')}</text>`
  );
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
export function docToSVG(doc: Doc, rendered?: Map<string, RenderedForm>): string {
  const body = doc.forms
    .filter((f) => f.visible)
    .map((f) => formToSVG(f, rendered?.get(f.id) ?? renderForm(f, doc.ramp), doc.background))
    .join('');
  const filter = doc.rough > 0 ? ` filter="url(#${ROUGH_FILTER_ID})"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">` +
    roughFilterSVG(doc.rough) +
    `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>` +
    `<g${filter}>${body}</g></svg>`
  );
}
