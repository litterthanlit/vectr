import { Resvg } from '@resvg/resvg-js';
import { docToSVG, type Doc } from '@vectr/core';

/** A monospace family that ships with each OS, for figure labels in previews. */
const MONO = process.platform === 'darwin' ? 'Menlo' : process.platform === 'win32' ? 'Consolas' : 'DejaVu Sans Mono';

/** Rasterise a design to PNG. `width` is the output width in pixels. */
export function renderPNG(doc: Doc, width: number): Buffer {
  const resvg = new Resvg(docToSVG(doc), {
    fitTo: { mode: 'width', value: Math.round(width) },
    font: { loadSystemFonts: true, defaultFontFamily: MONO, monospaceFamily: MONO },
    background: doc.background,
  });
  return resvg.render().asPng();
}
