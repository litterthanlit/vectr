/**
 * Rasterise the document so agents can look at what they drew — the visual
 * feedback loop that turns "write SVG blind" into "draw, look, refine".
 */
import { Resvg } from '@resvg/resvg-js';
import { docToSVG } from '../src/lib/export';
import { layerPathAbs, isPathLayer } from '../src/lib/vector-layer';
import { renderLayerCached } from '../src/lib/render';
import type { Doc, Layer } from '../src/lib/types';

export interface PreviewOptions {
  /** Crop to this layer (with padding). */
  focus?: Layer;
  /** Draw anchors, handles and indices for these path layers. */
  points?: Layer[];
  /** Output width in pixels. */
  width?: number;
}

const esc = (s: string) => s.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** SVG overlay showing every anchor (square = corner, circle = smooth), its handles and its [subpath, index] ref. */
function pointsOverlay(layers: Layer[], unit: number): string {
  const out: string[] = [];
  const r = 3.2 * unit, sw = 1.1 * unit, fs = 9 * unit;
  for (const layer of layers) {
    if (!isPathLayer(layer)) continue;
    const abs = layerPathAbs(layer);
    abs.subpaths.forEach((s, si) =>
      s.anchors.forEach((a, ai) => {
        for (const h of [a.in, a.out]) {
          if (!h) continue;
          const hx = a.x + h[0], hy = a.y + h[1];
          out.push(`<line x1="${a.x}" y1="${a.y}" x2="${hx}" y2="${hy}" stroke="#2f6bff" stroke-width="${sw}"/>`);
          out.push(`<circle cx="${hx}" cy="${hy}" r="${r * 0.7}" fill="#fff" stroke="#2f6bff" stroke-width="${sw}"/>`);
        }
        out.push(
          a.kind === 'corner'
            ? `<rect x="${a.x - r}" y="${a.y - r}" width="${r * 2}" height="${r * 2}" fill="#fff" stroke="#ff3d00" stroke-width="${sw}"/>`
            : `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="#fff" stroke="#ff3d00" stroke-width="${sw}"/>`,
        );
        out.push(
          `<text x="${a.x + r * 1.6}" y="${a.y - r * 1.6}" font-family="monospace" font-size="${fs}" fill="#ff3d00" stroke="#fff" stroke-width="${unit * 2.5}" paint-order="stroke">${esc(`${si}:${ai}`)}</text>`,
        );
      }),
    );
  }
  return `<g id="vectr-points">${out.join('')}</g>`;
}

export function renderPreview(doc: Doc, opts: PreviewOptions = {}): { png: Buffer; viewBox: [number, number, number, number] } {
  let svg = docToSVG(doc);
  let vb: [number, number, number, number] = [0, 0, doc.width, doc.height];
  if (opts.focus) {
    const b = renderLayerCached(opts.focus).bbox;
    const pad = Math.max(24, Math.max(b.w, b.h) * 0.12);
    vb = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2];
  }
  const width = Math.max(64, Math.min(2048, Math.round(opts.width ?? (opts.focus ? 800 : 1024))));
  const unit = vb[2] / width; // one output pixel in artboard units
  if (opts.points?.length) svg = svg.replace(/<\/svg>$/, `${pointsOverlay(opts.points, unit * 1.6)}</svg>`);
  svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${vb.join(' ')}"`).replace(/ width="\d+" height="\d+"/, ` width="${vb[2]}" height="${vb[3]}"`);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: doc.background, font: { loadSystemFonts: true } }).render().asPng();
  return { png, viewBox: vb };
}
