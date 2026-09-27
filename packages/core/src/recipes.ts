import { createForm, type FormSpec } from './forms.js';
import { shapeStarter } from './shapes.js';
import { THEMES } from './themes.js';
import type { Doc } from './types.js';

export interface Recipe {
  id: string;
  name: string;
  blurb: string;
  build(): Doc;
}

const W = 1200, H = 900;

function doc(theme: string, specs: (FormSpec & { at?: { x: number; y: number } })[]): Doc {
  const t = THEMES.find((x) => x.id === theme)!;
  return {
    version: 2, width: W, height: H, background: t.background, ramp: [...t.ramp], rough: 0,
    forms: specs.map((s) => createForm(s, s.at ?? { x: W / 2, y: H / 2 })),
  };
}

/** Starting points: a row of ready-made shapes, then single stacks of source + operators. */
export const RECIPES: Recipe[] = [
  {
    id: 'field-study',
    name: 'Field study',
    blurb: 'Five ready-made shapes side by side in plain ink',
    build: () => doc('kiln', [
      { ...shapeStarter('funnel', { transform: { scale: 96 } }), at: { x: 190, y: 450 } },
      { ...shapeStarter('maze', { transform: { scale: 88 } }), at: { x: 395, y: 450 } },
      { ...shapeStarter('vortex', { transform: { scale: 92 } }), at: { x: 605, y: 440 } },
      { ...shapeStarter('arches', { transform: { scale: 95 } }), at: { x: 805, y: 460 } },
      { ...shapeStarter('flowgrid', { transform: { scale: 92 } }), at: { x: 1010, y: 450 } },
    ]),
  },
  {
    id: 'cabinet',
    name: 'Cabinet',
    blurb: 'Six solids and surfaces laid out in two rows',
    build: () => doc('signal', [
      { ...shapeStarter('polyhedron', { params: { solid: 'dodecahedron' }, transform: { scale: 120 } }), at: { x: 230, y: 290 } },
      { ...shapeStarter('superquadric', { transform: { scale: 110 } }), at: { x: 600, y: 290 } },
      { ...shapeStarter('hyperboloid', { transform: { scale: 120 } }), at: { x: 970, y: 290 } },
      { ...shapeStarter('mobius', { transform: { scale: 125 } }), at: { x: 230, y: 640 } },
      { ...shapeStarter('seashell', { transform: { scale: 135 } }), at: { x: 600, y: 640 } },
      { ...shapeStarter('saddle', { transform: { scale: 105 } }), at: { x: 970, y: 640 } },
    ]),
  },
  {
    id: 'field-notes',
    name: 'Field notes',
    blurb: 'Terraced contours beside a branching plant',
    build: () => doc('graphite', [
      { ...shapeStarter('contours', { params: { lift: 0.8, levels: 18 }, transform: { scale: 300 } }), at: { x: 430, y: 470 } },
      { ...shapeStarter('plant', { params: { species: 'twig', jitter: 0.4 }, transform: { scale: 290 } }), at: { x: 930, y: 450 } },
    ]),
  },
  {
    id: 'strange-orbit',
    name: 'Strange orbit',
    blurb: 'A chaotic flow traced as one long line, coloured along its path',
    build: () => doc('ozone', [{
      ...shapeStarter('attractor', { params: { system: 'aizawa', steps: 12000 }, transform: { scale: 330, rx: 20, ry: 25 } }),
      style: { color: 'ramp', colorBy: 't', taper: 'depth', taperAmount: 0.6, width: 0.9, hidden: 'solid', markers: 'none' },
      spin: 6,
    }]),
  },
  {
    id: 'pulse-bloom',
    name: 'Pulse bloom',
    blurb: 'A flower echoed inward, turning as it shrinks, stirred by noise',
    build: () => doc('bloom', [{
      source: { kind: 'curve', params: { shape: 'flower', sides: 5, inner: 0.55 } },
      ops: [
        { kind: 'repeat', params: { layout: 'linear', count: 26, dz: 0, grow: -0.036, turn: 3.5 } },
        { kind: 'warp', params: { kind: 'noise', amount: 0.22, frequency: 1.4, seed: 21 } },
      ],
      style: { colorBy: 'family', taper: 't', taperAmount: 0.35, width: 1.3 },
      transform: { scale: 330, rx: 0, ry: 0 },
    }]),
  },
  {
    id: 'strata',
    name: 'Strata',
    blurb: 'Waves stacked in depth with ribbons between them',
    build: () => doc('kiln', [{
      source: { kind: 'curve', params: { shape: 'wave', cycles: 2.5, amplitude: 0.22 } },
      ops: [
        { kind: 'repeat', params: { layout: 'linear', count: 22, dz: 0.085 } },
        { kind: 'warp', params: { kind: 'noise', amount: 0.45, frequency: 1.2, seed: 4 } },
      ],
      style: { fill: 'ribbons', fillOpacity: 0.16, colorBy: 'family', width: 1.1 },
      transform: { scale: 360, rx: -38, ry: 32, perspective: 0.35 },
    }]),
  },
  {
    id: 'constellation',
    name: 'Constellation',
    blurb: 'Points on a sphere, each linked to its nearest neighbours',
    build: () => doc('ozone', [{
      source: { kind: 'points', params: { count: 150, spread: 'shell', seed: 8 } },
      ops: [{ kind: 'connect', params: { mode: 'nearest', k: 3, bow: 0.6 } }],
      style: { markers: 'dot', markerSize: 3.4, width: 1, hidden: 'fade' },
      transform: { scale: 320, rx: -16, ry: 20 },
      spin: 8,
    }]),
  },
  {
    id: 'tidal-field',
    name: 'Tidal field',
    blurb: 'A lattice laid flat and rippled into terrain',
    build: () => doc('signal', [{
      source: { kind: 'lattice', params: { cols: 34, rows: 26, aspect: 1.3, draw: 'rows' } },
      ops: [{ kind: 'warp', params: { kind: 'ripple', amount: 1.3, frequency: 3.2 } }],
      style: { taperAmount: 0.8, width: 1.6 },
      transform: { scale: 420, rx: -64, ry: 0, perspective: 0.55, y: 470 },
    }]),
  },
  {
    id: 'coil-garden',
    name: 'Coil garden',
    blurb: 'Tapering helices arranged in a ring, beaded with rings',
    build: () => doc('graphite', [{
      source: { kind: 'curve', params: { shape: 'spiral', turns: 9, pitch: 3, inner: 0.05, size: 0.5 } },
      ops: [
        { kind: 'repeat', params: { layout: 'radial', axis: 'y', count: 5, radius: 1.05 } },
        { kind: 'scatter', params: { count: 90, spacing: 'even' } },
      ],
      style: { markers: 'dot', markerSize: 2.6, colorBy: 't', width: 1.3, taperAmount: 0.75 },
      transform: { scale: 230, rx: -18, ry: 10 },
      spin: 12,
    }]),
  },
  {
    id: 'vessel',
    name: 'Vessel',
    blurb: 'A vase profile revolved with a slight twist and translucent bands',
    build: () => doc('signal', [{
      source: { kind: 'curve', params: { shape: 'profile', profile: 'vase', top: 0.55, bottom: 0.35, curve: 1.6 } },
      ops: [{ kind: 'revolve', params: { rings: 7, spokes: 40, twist: 0.35 } }],
      style: { fill: 'ribbons', fillOpacity: 0.07, colorBy: 't', width: 1 },
      transform: { scale: 300, rx: -22, ry: 0 },
    }]),
  },
  {
    id: 'meander',
    name: 'Meander',
    blurb: 'Arc tiles on a circular board, linking into coloured loops',
    build: () => doc('graphite', [{
      source: { kind: 'lattice', params: { cols: 14, rows: 14, aspect: 1, draw: 'points', mask: 'circle' } },
      ops: [{ kind: 'tile', params: { motif: 'arcs', hidden: 0.25, seed: 19 } }],
      style: { colorBy: 'family', width: 2.2, taper: 'none' },
      transform: { scale: 330, rx: 0, ry: 0 },
    }]),
  },
  {
    id: 'loom-knot',
    name: 'Loom knot',
    blurb: 'A torus knot broken into dashes, coloured along its length',
    build: () => doc('ozone', [{
      source: { kind: 'curve', params: { shape: 'knot', p: 3, q: 7, tube: 0.32 } },
      ops: [{ kind: 'resample', params: { mode: 'dashes', spacing: 0.045, duty: 0.62 } }],
      style: { colorBy: 't', width: 2.4, taperAmount: 0.7 },
      transform: { scale: 330, rx: -40, ry: 10 },
      spin: 10,
    }]),
  },
  {
    id: 'blank',
    name: 'Blank canvas',
    blurb: 'An empty graphite artboard',
    build: () => doc('graphite', []),
  },
];
