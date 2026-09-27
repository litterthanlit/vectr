/**
 * @vectr/core — the Vectr engine with no UI.
 *
 * A form is a source (a ready-made shape such as a globe or funnel, or a bare
 * curve, lattice, points or note) run through a stack of operators (revolve,
 * sweep, repeat, warp…). The renderer projects the result,
 * groups segments into depth/colour buckets for the house style, and the SVG
 * serialiser writes it out. The app and any agent or script share this code path.
 */
export * from './types.js';
export { BLOCK_SOURCES, SHAPE_CATEGORIES, SHAPE_SOURCES, SOURCES, sourceFor } from './sources/index.js';
export { SHAPE_STYLE, shapeStarter, shapeStyle, shapeTransform } from './shapes.js';
export { OPERATORS, opFor } from './operators/index.js';
export { DEFAULT_STYLE, STYLE_PARAMS } from './style.js';
export { DEFAULT_TRANSFORM, createForm, createOp, defaultName, uid, type FormSpec } from './forms.js';
export { MAX_OPS, POINT_BUDGET, buildForm, formKey, type BuildResult } from './pipeline.js';
export { COLOR_LEVELS, TAPER_LEVELS, projector, renderForm, renderFormCached } from './render.js';
export type { FillBucket, MarkerBucket, ProjectedLabel, Projector, RenderedForm, StrokeBucket } from './render.js';
export { LABEL_FONT, ROUGH_FILTER_ID, docToSVG, esc, formToSVG, roughFilterSVG } from './svg.js';
export { ARTBOARD_SIZES, THEMES, themeFor, type Theme } from './themes.js';
export { RECIPES, type Recipe } from './recipes.js';
export { mutate, variations } from './mutate.js';
export { accentFrom, isHex, sampleRamp } from './color.js';
export {
  FORMAT, FORMAT_VERSION, LIMITS, compactDoc, describeBlocks, isColor, parseDoc, serializeDoc, type ParseResult,
} from './schema.js';
export { decodeDoc, encodeDoc, shareURL } from './share.js';
