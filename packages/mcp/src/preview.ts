import { Resvg } from '@resvg/resvg-js';
import { docToSVG, type Doc } from '@vectr/core';

/**
 * Families that ship with each OS, for figure labels in previews. The SVG's font stacks
 * end in installed faces (Liberation, DejaVu, Arial…) and resvg walks them in order; these
 * decide what the generic `monospace`, `sans-serif` and `serif` fall back to (resvg-js 2.6
 * ignores the generic-family options, so the stacks are what actually carry sans and serif).
 */
const FAMILIES =
  process.platform === 'darwin'
    ? { mono: 'Menlo', sans: 'Helvetica', serif: 'Palatino' }
    : process.platform === 'win32'
      ? { mono: 'Consolas', sans: 'Arial', serif: 'Georgia' }
      : { mono: 'DejaVu Sans Mono', sans: 'Liberation Sans', serif: 'Liberation Serif' };

/** Rasterise a design to PNG. `width` is the output width in pixels. */
export function renderPNG(doc: Doc, width: number): Buffer {
  const resvg = new Resvg(docToSVG(doc), {
    fitTo: { mode: 'width', value: Math.round(width) },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: FAMILIES.mono,
      monospaceFamily: FAMILIES.mono,
      sansSerifFamily: FAMILIES.sans,
      serifFamily: FAMILIES.serif,
    },
    background: doc.background,
  });
  return resvg.render().asPng();
}
