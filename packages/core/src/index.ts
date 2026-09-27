/**
 * @vectr/core — the Vectr engine with no UI.
 *
 * Generators turn params into 3D polylines; the renderer projects them and splits
 * front- and back-facing runs; the SVG serialiser turns that into markup. The app
 * and any agent or script use exactly the same code path.
 */
export * from './types.js';
export { DEFAULT_STYLE, GENERATORS, createLayer, generatorFor, geometryFor, randomParams, uid } from './generators/index.js';
export { projector, renderLayer, renderLayerCached, type Projector, type ProjectedLabel, type RenderedLayer } from './render.js';
export { ARTBOARD_SIZES, TEMPLATES, THEMES, type Template, type Theme } from './templates.js';
export { LABEL_FONT, ROUGH_FILTER_ID, docToSVG, esc, layerToSVG, roughFilterSVG } from './svg.js';
export {
  FORMAT, FORMAT_VERSION, LIMITS, compactDoc, describeGenerators, isColor, parseDoc, serializeDoc, type ParseResult,
} from './schema.js';
export { decodeDoc, encodeDoc, shareURL } from './share.js';
