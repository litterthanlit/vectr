import { renderForm, type RenderedForm } from './render.js';
import type { Doc, Form, HiddenStyle } from './types.js';

/**
 * SVG serialisation. The app renders the artboard through these same functions,
 * so what an agent exports is byte-for-byte what a person sees on screen.
 *
 * Every string that can come from a document (colours, label text) is escaped:
 * documents arrive from files, links and agents, and the app injects this markup.
 */

export const LABEL_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const ROUGH_FILTER_ID = 'vectr-rough';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function dash(hidden: HiddenStyle, width: number): string {
  if (hidden === 'dotted') return ` stroke-dasharray="0 ${n(width * 2.8 + 1.2)}"`;
  if (hidden === 'dashed') return ` stroke-dasharray="${n(width * 5 + 3)} ${n(width * 3 + 3)}"`;
  return '';
}

/** Markup for one form (a `<g>`), from an already-projected render. */
export function formToSVG(form: Form, r: RenderedForm): string {
  const st = form.style;
  const out: string[] = [`<g opacity="${n(st.opacity)}">`];
  for (const fl of r.fills) {
    out.push(`<path d="${fl.d}" fill="${esc(fl.color)}" fill-opacity="${n(fl.opacity)}" stroke="none"/>`);
  }
  for (const s of r.strokes) {
    out.push(
      `<path d="${s.d}" fill="none" stroke="${esc(s.color)}" stroke-width="${n(s.width)}" stroke-opacity="${n(s.opacity)}" stroke-linecap="round" stroke-linejoin="round"${s.hidden ? dash(st.hidden, s.width) : ''}/>`,
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
    const color = r.strokes[r.strokes.length - 1]?.color ?? '#ffffff';
    out.push(`<g fill="${esc(color)}" font-family="${esc(LABEL_FONT)}" font-size="${n(st.labelSize)}" letter-spacing="0.02em">`);
    for (const l of r.labels) out.push(`<text x="${n(l.x)}" y="${n(l.y)}" text-anchor="${l.anchor}">${esc(l.text)}</text>`);
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
export function docToSVG(doc: Doc, rendered?: Map<string, RenderedForm>): string {
  const body = doc.forms
    .filter((f) => f.visible)
    .map((f) => formToSVG(f, rendered?.get(f.id) ?? renderForm(f, doc.ramp)))
    .join('');
  const filter = doc.rough > 0 ? ` filter="url(#${ROUGH_FILTER_ID})"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">` +
    roughFilterSVG(doc.rough) +
    `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>` +
    `<g${filter}>${body}</g></svg>`
  );
}
