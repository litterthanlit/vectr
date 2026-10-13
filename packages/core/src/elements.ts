import { DEFAULT_TRANSFORM, createForm, type FormSpec } from './forms.js';
import { DEFAULT_STYLE, STYLE_PARAMS } from './style.js';
import type { Form, Params, Style, Transform } from './types.js';

/** One form of an element, with its position as an offset from the artboard centre. */
export type ElementForm = FormSpec & { offset?: { x: number; y: number } };

/**
 * A ready-made piece of line-art that is several forms at once: a beaded globe, a
 * graduated dial, a caption card. Forms differ in line weight (a form has only one),
 * so a drawing that mixes hairlines and heavy rings needs more than one.
 */
export interface Element {
  id: string;
  name: string;
  blurb: string;
  forms: ElementForm[];
}

/** Elements are authored for a square artboard this many pixels wide; other sizes scale from it. */
export const ELEMENT_ARTBOARD = 1000;

// Colour: elements name no colours. Ramp colouring by depth gives a tilted form the full ramp, far lightest to near
// strongest, and a flat form (a dial, a card) the ramp's last stop, so each adapts to whatever theme the document uses.
const hair: Partial<Style> = { width: 0.9, taper: 'none', color: 'ramp', colorBy: 'depth' };
const flat: Partial<Transform> = { rx: 0, ry: 0, rz: 0, perspective: 0 };

// The attention element draws one token field twice, as dots and as the points threads leave from, so both share these.
const ATTENTION_FIELD = { layout: 'window', mark: 'dot', tokens: 700, rows: 40, relevant: 0.12, seed: 5 };
const ATTENTION_SCALE = 330;
/** How far above and below the field's middle the two foci sit, in the field's unit space. */
const ATTENTION_FOCUS = 1.38;

export const ELEMENTS: Element[] = [
  {
    id: 'globe',
    name: 'Globe',
    blurb: 'A tilted wireframe sphere, every meridian and parallel strung with beads',
    forms: [{
      name: 'Globe',
      source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
      ops: [
        { kind: 'revolve', params: { rings: 13, spokes: 24 } },
        { kind: 'resample', params: { mode: 'dots', spacing: 0.085, keepLines: true } },
      ],
      style: { ...hair, markers: 'dot', markerSize: 2.2, markersByDepth: true, hidden: 'fade' },
      transform: { scale: 380, rx: -14, ry: 28, rz: -16, perspective: 0 },
    }],
  },
  {
    id: 'dial',
    name: 'Dial',
    blurb: 'A heavy bezel ringed by fine graduations, every tenth one long',
    forms: [
      {
        name: 'Bezel',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { ...hair, width: 3.4 },
        transform: { scale: 330, ...flat },
      },
      {
        name: 'Graduations',
        source: { kind: 'curve', params: { shape: 'circle' } },
        ops: [{ kind: 'ticks', params: { count: 180, length: 0.06, side: 'in', majorEvery: 10, majorLength: 2.4, keepLines: false } }],
        style: { ...hair, width: 1 },
        transform: { scale: 330 - 4, ...flat },
      },
      {
        name: 'Inner scale',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { ...hair, width: 1.4, dash: 'dotted' },
        transform: { scale: 232, ...flat },
      },
    ],
  },
  {
    id: 'orbit-shell',
    name: 'Orbit shell',
    blurb: 'Rings at scattered tilts on one shell, beaded, around a small core',
    forms: [
      {
        name: 'Orbits',
        source: { kind: 'orbits', params: { arrangement: 'random', count: 9, radius: 1.2, spread: 0.35, tilt: 80, seed: 11 } },
        ops: [{ kind: 'resample', params: { mode: 'dots', spacing: 0.07, keepLines: true } }],
        style: { ...hair, markers: 'dot', markerSize: 2, markersByDepth: true, hidden: 'solid' },
        transform: { scale: 360, rx: -26, ry: 18, rz: 0, perspective: 0 },
      },
      {
        name: 'Core',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { ...hair, fill: 'shapes', fillOpacity: 1 },
        transform: { scale: 16, ...flat },
      },
    ],
  },
  {
    id: 'ruler',
    name: 'Ruler',
    blurb: 'A graduated rule with long ticks every fifth mark',
    forms: [
      {
        name: 'Rule',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [{ kind: 'ticks', params: { count: 81, length: 0.045, side: 'out', majorEvery: 0, keepLines: true } }],
        style: { ...hair, width: 1 },
        transform: { scale: 420, ...flat },
      },
      {
        name: 'Major marks',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [{ kind: 'ticks', params: { count: 17, length: 0.11, side: 'out', majorEvery: 0, keepLines: false } }],
        style: { ...hair, width: 2 },
        transform: { scale: 420, ...flat },
      },
    ],
  },
  {
    id: 'caption',
    name: 'Caption',
    blurb: 'A flat caption card with an icon and wrapped sans text, hiding what is behind it',
    forms: [{
      name: 'Caption',
      source: {
        kind: 'card',
        params: { text: 'What this drawing\nshows, in a few\nplain words.', width: 1.7, height: 0.8, padding: 0.1, icon: 'globe', iconSize: 0.2, align: 'bottom' },
      },
      style: { ...hair, width: 1, fill: 'shapes', fillOpacity: 0.12, knockout: true, labelFont: 'sans', labelSize: 27 },
      transform: { scale: 260, ...flat },
    }],
  },
  {
    id: 'gimbal',
    name: 'Gimbal',
    blurb: 'Nested rings turned about one axis, the outermost graduated',
    forms: [
      {
        name: 'Gimbal rings',
        source: { kind: 'orbits', params: { arrangement: 'nested', count: 7, radius: 1, spread: 0.5, tilt: 45 } },
        style: { ...hair, width: 1.3, hidden: 'solid' },
        transform: { scale: 360, rx: -24, ry: 18, rz: 0, perspective: 0 },
      },
      {
        name: 'Graduated ring',
        source: { kind: 'orbits', params: { arrangement: 'nested', count: 1, radius: 1, spread: 0 } },
        ops: [{ kind: 'ticks', params: { count: 120, length: 0.045, side: 'out', majorEvery: 10, majorLength: 2.2, keepLines: true } }],
        style: { ...hair, width: 1.8, hidden: 'solid' },
        transform: { scale: 360, rx: -24, ry: 18, rz: 0, perspective: 0 },
      },
    ],
  },
  {
    id: 'gauge',
    name: 'Gauge',
    blurb: 'A three-quarter scale with graduations, a needle and a hub',
    forms: [
      {
        name: 'Scale arc',
        source: { kind: 'curve', params: { shape: 'arc', start: -30, sweep: 240 } },
        ops: [{ kind: 'ticks', params: { count: 49, length: 0.07, side: 'in', majorEvery: 6, majorLength: 2.2, keepLines: true } }],
        style: { ...hair, width: 2.4 },
        transform: { scale: 340, ...flat },
      },
      {
        name: 'Minor scale',
        source: { kind: 'curve', params: { shape: 'arc', start: -30, sweep: 240 } },
        style: { ...hair, width: 1.2, dash: 'dotted' },
        transform: { scale: 260, ...flat },
      },
      {
        name: 'Needle',
        source: { kind: 'note', params: { text: '', angle: 52, length: 0.86, elbow: 0 } },
        style: { ...hair, width: 2.4, markers: 'dot', markerSize: 11, markersByDepth: false },
        transform: { scale: 300, ...flat },
      },
    ],
  },
  {
    id: 'reticle',
    name: 'Reticle',
    blurb: 'Crossed graduated axes inside a ring and a dotted inner ring',
    forms: [
      {
        name: 'Reticle ring',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { ...hair, width: 1.6 },
        transform: { scale: 360, ...flat },
      },
      {
        name: 'Inner ring',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { ...hair, width: 1.4, dash: 'dotted' },
        transform: { scale: 190, ...flat },
      },
      {
        name: 'Horizontal axis',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [{ kind: 'ticks', params: { count: 37, length: 0.03, side: 'both', majorEvery: 6, majorLength: 2.4, keepLines: true } }],
        style: { ...hair, width: 1 },
        transform: { scale: 420, ...flat },
      },
      {
        name: 'Vertical axis',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [{ kind: 'ticks', params: { count: 37, length: 0.03, side: 'both', majorEvery: 6, majorLength: 2.4, keepLines: true } }],
        style: { ...hair, width: 1 },
        transform: { scale: 420, ...flat, rz: 90 },
      },
    ],
  },
  {
    id: 'contour',
    name: 'Contour',
    blurb: 'Nested terrain-style outlines with every fifth one drawn heavier',
    forms: [
      {
        name: 'Contours',
        source: { kind: 'curve', params: { shape: 'blob', inner: 0.7, seed: 5 } },
        ops: [
          { kind: 'repeat', params: { layout: 'linear', count: 25, dz: 0, grow: -0.039 } },
          { kind: 'warp', params: { kind: 'noise', amount: 0.32, frequency: 1.1, seed: 12 } },
        ],
        style: { ...hair, width: 0.9, colorBy: 'family' },
        transform: { scale: 380, ...flat },
      },
      {
        name: 'Index contours',
        source: { kind: 'curve', params: { shape: 'blob', inner: 0.7, seed: 5 } },
        ops: [
          { kind: 'repeat', params: { layout: 'linear', count: 5, dz: 0, grow: -0.195 } },
          { kind: 'warp', params: { kind: 'noise', amount: 0.32, frequency: 1.1, seed: 12 } },
        ],
        style: { ...hair, width: 2.2, colorBy: 'family' },
        transform: { scale: 380, ...flat },
      },
    ],
  },
  {
    id: 'context-window',
    name: 'Context window',
    blurb: 'A burst of solid token blocks, dense at the core and thinning outward, the few relevant ones picked out by colour',
    forms: [{
      name: 'Context window',
      source: { kind: 'context', params: { layout: 'burst', tokens: 1800, rows: 84, falloff: 0.55, relevant: 0.08, height: 0.78, seed: 12 } },
      style: { ...hair, width: 0.4, colorBy: 'family', fill: 'shapes', fillOpacity: 1 },
      transform: { scale: 470, ...flat },
    }],
  },
  {
    id: 'attention',
    name: 'Attention',
    blurb: 'A field of token dots with dotted threads from the relevant ones converging above and below on two rings of focus',
    forms: [
      {
        name: 'Token field',
        source: { kind: 'context', params: ATTENTION_FIELD },
        style: { ...hair, colorBy: 'family', markers: 'dot', markerSize: 2.8, markersByDepth: false },
        transform: { scale: ATTENTION_SCALE, ...flat },
      },
      {
        name: 'Attention threads',
        source: { kind: 'context', params: ATTENTION_FIELD },
        ops: [{ kind: 'connect', params: { mode: 'focus', fx: 0, fy: ATTENTION_FOCUS, fz: 0, split: true, which: 'relevant', bow: 0.1, keepLines: false, seed: 5 } }],
        style: { ...hair, width: 1.1, colorBy: 'family', dash: 'dotted' },
        transform: { scale: ATTENTION_SCALE, ...flat },
      },
      ...[-1, 1].map((side): ElementForm => ({
        name: side < 0 ? 'Upper focus' : 'Lower focus',
        source: { kind: 'note', params: { text: '', length: 0, elbow: 0 } },
        style: { ...hair, width: 1.6, markers: 'ring', markerSize: 7, markersByDepth: false },
        transform: { scale: 100, ...flat },
        offset: { x: 0, y: side * ATTENTION_FOCUS * ATTENTION_SCALE },
      })),
    ],
  },
  {
    id: 'strip-field',
    name: 'Strip field',
    blurb: 'Rows of hyphenated slabs joined by necks and broken by gaps, like context read as ribbons, the few relevant slabs picked out by colour',
    forms: [{
      name: 'Strip field',
      source: { kind: 'strip', params: { mode: 'generate', rows: 14, segments: 6, relevant: 0.12, seed: 8, aspect: 1, height: 0.68 } },
      style: { ...hair, width: 0.5, colorBy: 'family', fill: 'shapes', fillOpacity: 1 },
      transform: { scale: 420, ...flat },
    }],
  },
  {
    id: 'memory-burst',
    name: 'Memory burst',
    blurb: 'Working memory blown apart: a dense core of slanted token blocks fused into ink, tearing into streaks and spray, the relevant ones in the accent',
    forms: [{
      name: 'Memory burst',
      // A burst-layout field is already dense at its core and thin at its edge, so the operator only has to throw it outward.
      // The ink finish needs solid fills, and the spray droplets (the form's only points) are drawn as big dots that survive it.
      source: {
        kind: 'context',
        params: { layout: 'burst', tokens: 2000, rows: 56, falloff: 0.4, aspect: 1, variance: 0.8, height: 0.9, relevant: 0.14, cut: 'slant', cutAngle: 24, seed: 3 },
      },
      ops: [{ kind: 'burst', params: { mode: 'radial', shatter: 3, spray: 340, keepPoints: false, seed: 3 } }],
      style: {
        ...hair, width: 0.5, colorBy: 'family', fill: 'shapes', fillOpacity: 1,
        markers: 'dot', markerSize: 8, markersByDepth: true, finish: 'ink',
      },
      transform: { scale: 380, ...flat },
    }],
  },
  {
    id: 'linked-mark',
    name: 'Linked mark',
    blurb: 'A bold mark of two slabs joined by a thin neck: a vertical step on top, a 30° ramp below, and the second slab cut on a slant',
    forms: [{
      name: 'Linked mark',
      source: {
        kind: 'strip',
        params: {
          mode: 'pattern', pattern: '####--######', height: 0.7, neck: 0.5, neckAlign: 'center', ramp: 30, rampEdge: 'bottom', corner: 0.08,
          startEnd: 'square', finishEnd: 'slant', slant: 18, aspect: 1.6,
        },
      },
      style: { ...hair, width: 0.8, fill: 'shapes', fillOpacity: 1 },
      transform: { scale: 330, ...flat },
    }],
  },
];

/** The artboard-relative scale for a document: elements grow and shrink with its shorter side. */
export const elementScale = (width: number, height: number) => Math.min(width, height) / ELEMENT_ARTBOARD;

/** The smallest finish scale a document may hold (a finish can be drawn smaller than this, but not stored smaller). */
const FINISH_SCALE_MIN = (STYLE_PARAMS.find((d) => d.key === 'finishScale') as { min: number }).min;

/**
 * A form's spec with its scale, offset, label size and finish scale multiplied by k. A finish is sized in pixels like a
 * label, so it has to shrink and grow with the drawing or a small element would be all bleed. `minFinish` keeps what is
 * stored in a document within the style's range; a thumbnail, which is never stored, passes none.
 */
function scaled(spec: ElementForm, k: number, minFinish = 0): { spec: FormSpec; offset: { x: number; y: number } } {
  const { offset, ...rest } = spec;
  let style = rest.style;
  if (style?.labelSize !== undefined) style = { ...style, labelSize: style.labelSize * k };
  if (style?.finish && style.finish !== 'clean' && k !== 1) {
    style = { ...style, finishScale: Math.max(minFinish, (style.finishScale ?? DEFAULT_STYLE.finishScale) * k) };
  }
  const transform = { ...rest.transform, scale: (rest.transform?.scale ?? DEFAULT_TRANSFORM.scale) * k };
  return { spec: { ...rest, style, transform }, offset: { x: (offset?.x ?? 0) * k, y: (offset?.y ?? 0) * k } };
}

/** The forms of an element, ready to add to a document of the given size, centred on it. */
export function placeElement(element: Element, width: number, height: number): Form[] {
  const k = elementScale(width, height);
  return element.forms.map((f) => {
    const { spec, offset } = scaled(f, k);
    return createForm(spec, { x: width / 2 + offset.x, y: height / 2 + offset.y });
  });
}

/**
 * The element as entries for a design's `forms` array (what `parseDoc` reads), laid out on the
 * 1000×1000 reference artboard: position, scale and rotation are explicit, and the source and
 * operators carry only what the element sets. Agents can copy these straight into a design.
 */
export function elementDocForms(element: Element, width = ELEMENT_ARTBOARD, height = ELEMENT_ARTBOARD) {
  const k = elementScale(width, height);
  return element.forms.map((f) => {
    const { spec, offset } = scaled(f, k, FINISH_SCALE_MIN);
    const t = { ...DEFAULT_TRANSFORM, ...spec.transform };
    const out: Record<string, unknown> = {
      ...(spec.name ? { name: spec.name } : {}),
      source: { kind: spec.source.kind, params: spec.source.params as Params },
      ...(spec.ops?.length ? { ops: spec.ops.map((o) => ({ kind: o.kind, ...(o.params ? { params: o.params } : {}) })) } : {}),
      ...(spec.style ? { style: spec.style } : {}),
      x: Math.round(width / 2 + offset.x), y: Math.round(height / 2 + offset.y),
      scale: Math.round(t.scale), rx: t.rx, ry: t.ry, rz: t.rz, perspective: t.perspective,
    };
    if (spec.spin) out.spin = spec.spin;
    return out;
  });
}
