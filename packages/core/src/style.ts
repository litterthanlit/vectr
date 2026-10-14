import type { ParamDef, Style } from './types.js';

/**
 * The house style: lines thin and lighten with depth, colour runs along a ramp,
 * and faces turned away fade rather than switch to dots.
 */
export const DEFAULT_STYLE: Style = {
  width: 1.4,
  dash: 'solid',
  taper: 'depth',
  taperAmount: 0.6,
  color: 'ramp',
  colorBy: 'depth',
  stroke: null,
  ramp: null,
  hidden: 'fade',
  fill: 'none',
  fillOpacity: 0.14,
  knockout: false,
  markers: 'none',
  markerSize: 2.6,
  markerEvery: 1,
  markersByDepth: true,
  labels: true,
  labelSize: 12,
  labelFont: 'mono',
  labelColor: null,
  opacity: 1,
  finish: 'clean',
  finishAmount: 0.5,
  finishScale: 1,
  finishSeed: 1,
};

const opt = (...v: string[]) => v.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }));

const FILLED = { key: 'fill', in: ['ribbons', 'shapes'] };
const FINISHED = { key: 'finish', in: ['ink', 'grain', 'rough'] };

/** Schema for the scalar style fields (colours — stroke, ramp, labelColor — are validated separately). */
export const STYLE_PARAMS: ParamDef[] = [
  { key: 'width', label: 'Weight', kind: 'range', min: 0.1, max: 24, step: 0.05 },
  { key: 'dash', label: 'Pattern', kind: 'select', options: opt('solid', 'dotted', 'dashed'), help: 'Dots or dashes along lines facing you' },
  { key: 'taper', label: 'Taper', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: 'depth', label: 'Depth' }, { value: 't', label: 'Along line' }], help: 'Vary weight and lightness with depth or along the line' },
  { key: 'taperAmount', label: 'Taper amount', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'taper', in: ['depth', 't'] } },
  { key: 'color', label: 'Colour', kind: 'select', options: [{ value: 'ramp', label: 'Ramp' }, { value: 'solid', label: 'Solid' }] },
  { key: 'colorBy', label: 'Ramp by', kind: 'select', options: [{ value: 'depth', label: 'Depth' }, { value: 't', label: 'Along line' }, { value: 'family', label: 'Family' }], when: { key: 'color', in: ['ramp'] } },
  { key: 'hidden', label: 'Hidden lines', kind: 'select', options: opt('fade', 'dotted', 'dashed', 'solid', 'hide') },
  {
    key: 'fill', label: 'Fill', kind: 'select',
    options: [{ value: 'none', label: 'None' }, { value: 'ribbons', label: 'Ribbons' }, { value: 'shapes', label: 'Closed shapes' }],
  },
  { key: 'fillOpacity', label: 'Fill opacity', kind: 'range', min: 0, max: 1, step: 0.01, when: FILLED },
  { key: 'knockout', label: 'Hide what is behind', kind: 'toggle', when: FILLED, help: 'Paint the background under the fill so forms beneath are covered' },
  { key: 'markers', label: 'Markers', kind: 'select', options: opt('none', 'dot', 'ring', 'cross', 'tick') },
  { key: 'markerSize', label: 'Marker size', kind: 'range', min: 0.5, max: 24, step: 0.1, when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  { key: 'markerEvery', label: 'Every nth point', kind: 'range', min: 1, max: 12, step: 1, when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  { key: 'markersByDepth', label: 'Size markers by depth', kind: 'toggle', when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  {
    key: 'finish', label: 'Finish', kind: 'select', options: opt('clean', 'ink', 'grain', 'rough'),
    help: 'A material for the whole form. Ink fuses close pieces into solid ink with torn edges (best on solid fills, fill opacity 1), grain speckles it like dry brush, rough wobbles the edges',
  },
  { key: 'finishAmount', label: 'Finish amount', kind: 'range', min: 0, max: 1, step: 0.01, when: FINISHED },
  { key: 'finishScale', label: 'Finish scale', kind: 'range', min: 0.2, max: 4, step: 0.05, when: FINISHED, help: 'Size of the bleed, speckle or wobble. 1 suits an artboard 1000 to 1600 px wide' },
  { key: 'finishSeed', label: 'Finish seed', kind: 'seed', when: FINISHED },
  { key: 'labels', label: 'Labels', kind: 'toggle' },
  { key: 'labelSize', label: 'Label size', kind: 'range', min: 4, max: 96, step: 0.5 },
  { key: 'labelFont', label: 'Label font', kind: 'select', options: opt('mono', 'sans', 'serif') },
  { key: 'opacity', label: 'Opacity', kind: 'range', min: 0.02, max: 1, step: 0.01 },
];
