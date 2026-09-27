import type { ParamDef, Style } from './types.js';

/**
 * The house style: lines thin and lighten with depth, colour runs along a ramp,
 * and faces turned away fade rather than switch to dots.
 */
export const DEFAULT_STYLE: Style = {
  width: 1.4,
  taper: 'depth',
  taperAmount: 0.6,
  color: 'ramp',
  colorBy: 'depth',
  stroke: null,
  ramp: null,
  hidden: 'fade',
  fill: 'none',
  fillOpacity: 0.14,
  markers: 'none',
  markerSize: 2.6,
  markerEvery: 1,
  markersByDepth: true,
  labels: true,
  labelSize: 12,
  opacity: 1,
};

const opt = (...v: string[]) => v.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }));

/** Schema for the scalar style fields (colours are validated separately). */
export const STYLE_PARAMS: ParamDef[] = [
  { key: 'width', label: 'Weight', kind: 'range', min: 0.1, max: 24, step: 0.05 },
  { key: 'taper', label: 'Taper', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: 'depth', label: 'Depth' }, { value: 't', label: 'Along line' }], help: 'Vary weight and lightness with depth or along the line' },
  { key: 'taperAmount', label: 'Taper amount', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'taper', in: ['depth', 't'] } },
  { key: 'color', label: 'Colour', kind: 'select', options: [{ value: 'ramp', label: 'Ramp' }, { value: 'solid', label: 'Solid' }] },
  { key: 'colorBy', label: 'Ramp by', kind: 'select', options: [{ value: 'depth', label: 'Depth' }, { value: 't', label: 'Along line' }, { value: 'family', label: 'Family' }], when: { key: 'color', in: ['ramp'] } },
  { key: 'hidden', label: 'Hidden lines', kind: 'select', options: opt('fade', 'dotted', 'dashed', 'solid', 'hide') },
  { key: 'fill', label: 'Fill', kind: 'select', options: [{ value: 'none', label: 'None' }, { value: 'ribbons', label: 'Ribbons' }] },
  { key: 'fillOpacity', label: 'Fill opacity', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'fill', in: ['ribbons'] } },
  { key: 'markers', label: 'Markers', kind: 'select', options: opt('none', 'dot', 'ring', 'cross', 'tick') },
  { key: 'markerSize', label: 'Marker size', kind: 'range', min: 0.5, max: 24, step: 0.1, when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  { key: 'markerEvery', label: 'Every nth point', kind: 'range', min: 1, max: 12, step: 1, when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  { key: 'markersByDepth', label: 'Size markers by depth', kind: 'toggle', when: { key: 'markers', in: ['dot', 'ring', 'cross', 'tick'] } },
  { key: 'labels', label: 'Labels', kind: 'toggle' },
  { key: 'labelSize', label: 'Label size', kind: 'range', min: 4, max: 96, step: 0.5 },
  { key: 'opacity', label: 'Opacity', kind: 'range', min: 0.02, max: 1, step: 0.01 },
];
