import { createForm, type FormSpec } from './forms.js';
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

/** Starting points, each a single stack of source + operators. */
export const RECIPES: Recipe[] = [
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
    id: 'meridian',
    name: 'Meridian',
    blurb: 'An instrument plate: a beaded globe ringed by ticks and dotted orbits, with a caption card',
    build: () => doc('fog', [
      {
        name: 'Orbit tracks',
        source: { kind: 'orbits', params: { arrangement: 'random', count: 4, radius: 2.1, spread: 0.3, aspect: 0.4, tilt: 35, seed: 23 } },
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 2.4, dash: 'dotted', hidden: 'solid' },
        transform: { x: 765, y: 465, scale: 385, rx: -14, ry: 28, rz: -16 },
      },
      {
        name: 'Globe',
        source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
        ops: [
          { kind: 'revolve', params: { rings: 13, spokes: 24 } },
          { kind: 'resample', params: { mode: 'dots', spacing: 0.11, keepLines: true } },
        ],
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 0.8, markers: 'dot', markerSize: 2.1, markersByDepth: true, hidden: 'fade' },
        transform: { x: 765, y: 465, scale: 385, rx: -14, ry: 28, rz: -16 },
      },
      {
        name: 'Equator',
        source: { kind: 'orbits', params: { arrangement: 'fan', count: 1, radius: 1, tilt: 0 } },
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 2, hidden: 'fade' },
        transform: { x: 765, y: 465, scale: 385, rx: -14, ry: 28, rz: -16 },
      },
      {
        name: 'Limb',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { color: 'ramp', taper: 'none', width: 4.5 },
        transform: { x: 765, y: 465, scale: 385, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Limb ticks',
        source: { kind: 'curve', params: { shape: 'circle' } },
        ops: [{ kind: 'ticks', params: { count: 300, length: 0.07, side: 'out', majorEvery: 0, vary: 'wave', amount: 0.75, cycles: 9, keepLines: false } }],
        style: { color: 'ramp', taper: 'none', width: 1.1 },
        transform: { x: 765, y: 465, scale: 389, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Axis note',
        source: { kind: 'note', params: { text: 'axis 23.4\u00b0', angle: 148, length: 0.75, elbow: 0.7 } },
        style: { color: 'ramp', taper: 'none', width: 1, markers: 'dot', markerSize: 3.2, markersByDepth: false, labelSize: 13 },
        transform: { x: 575, y: 225, scale: 150, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Caption',
        source: {
          kind: 'card',
          params: { text: 'Parallels and meridians,\nbeaded at every fifteenth\ndegree of arc.', meta: 'PL. 04', width: 1.6, height: 0.82, padding: 0.1, icon: 'globe', iconSize: 0.2 },
        },
        style: { color: 'ramp', taper: 'none', width: 1, fill: 'shapes', fillOpacity: 0.12, knockout: true, labelFont: 'sans', labelSize: 22 },
        transform: { x: 240, y: 700, scale: 250, rx: 0, ry: 0, rz: 0, perspective: 0 },
      },
    ]),
  },
  {
    id: 'gyroscope',
    name: 'Gyroscope',
    blurb: 'Gimbal rings turning inside a graduated dial, with a spinning rotor at the centre',
    build: () => doc('graphite', [
      {
        name: 'Dial bezel',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { color: 'ramp', taper: 'none', width: 3 },
        transform: { x: 450, y: 450, scale: 400, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Dial graduations',
        source: { kind: 'curve', params: { shape: 'circle' } },
        ops: [{ kind: 'ticks', params: { count: 240, length: 0.05, side: 'in', majorEvery: 10, majorLength: 2.6, keepLines: false } }],
        style: { color: 'ramp', taper: 'none', width: 1 },
        transform: { x: 450, y: 450, scale: 394, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Gimbal rings',
        source: { kind: 'orbits', params: { arrangement: 'nested', count: 7, radius: 1, spread: 0.5, tilt: 45 } },
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 1.3, hidden: 'solid' },
        transform: { x: 450, y: 450, scale: 290, rx: -24, ry: 18, rz: 0 },
        spin: 14,
      },
      {
        name: 'Graduated ring',
        source: { kind: 'orbits', params: { arrangement: 'nested', count: 1, radius: 1, spread: 0 } },
        ops: [{ kind: 'ticks', params: { count: 120, length: 0.05, side: 'out', majorEvery: 10, majorLength: 2.2, keepLines: true } }],
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 2, hidden: 'solid' },
        transform: { x: 450, y: 450, scale: 290, rx: -24, ry: 18, rz: 0 },
        spin: 14,
      },
      {
        name: 'Rotor',
        source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
        ops: [{ kind: 'revolve', params: { rings: 7, spokes: 12 } }],
        style: { color: 'ramp', colorBy: 'depth', taper: 'depth', taperAmount: 0.5, width: 1.1, hidden: 'fade' },
        transform: { x: 450, y: 450, scale: 62, rx: -24, ry: 18, rz: 0 },
        spin: 90,
      },
      {
        name: 'Height scale',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [{ kind: 'ticks', params: { count: 41, length: 0.03, side: 'in', majorEvery: 5, majorLength: 2.6, keepLines: true } }],
        style: { color: 'ramp', taper: 'none', width: 1 },
        transform: { x: 1150, y: 450, scale: 380, rx: 0, ry: 0, rz: 90 },
      },
      {
        name: 'Readout',
        source: { kind: 'card', params: { text: 'Three axes, one\nplane of spin.', meta: 'N\u00ba 7', width: 1.3, height: 0.62, padding: 0.09, icon: 'dial', iconSize: 0.2, align: 'bottom' } },
        style: { color: 'ramp', taper: 'none', width: 1, fill: 'shapes', fillOpacity: 0.1, knockout: true, labelFont: 'sans', labelSize: 20 },
        transform: { x: 935, y: 715, scale: 250, rx: 0, ry: 0, rz: 0, perspective: 0 },
      },
    ]),
  },
  {
    id: 'orrery',
    name: 'Orrery',
    blurb: 'Concentric orbits tipped toward you, with bodies riding them and a small sphere at the centre',
    build: () => doc('kiln', [
      {
        name: 'Ecliptic ring',
        source: { kind: 'curve', params: { shape: 'circle' } },
        ops: [{ kind: 'ticks', params: { count: 360, length: 0.032, side: 'in', majorEvery: 30, majorLength: 2.8, keepLines: true } }],
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 1.4 },
        transform: { x: 600, y: 470, scale: 520, rx: -66, ry: 0, rz: -8 },
      },
      {
        name: 'Orbit paths',
        source: { kind: 'orbits', params: { arrangement: 'fan', count: 5, radius: 0.92, spread: 0.78, tilt: 0 } },
        ops: [{ kind: 'resample', params: { mode: 'dots', spacing: 0.06, keepLines: true } }],
        style: { color: 'ramp', colorBy: 'family', taper: 'none', width: 0.9, markers: 'dot', markerSize: 1.7, markersByDepth: false, hidden: 'solid' },
        transform: { x: 600, y: 470, scale: 520, rx: -66, ry: 0, rz: -8 },
      },
      {
        name: 'Bodies',
        source: { kind: 'orbits', params: { arrangement: 'fan', count: 5, radius: 0.92, spread: 0.78, tilt: 0 } },
        ops: [{ kind: 'scatter', params: { count: 6, spacing: 'random', keepLines: false, seed: 5 } }],
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', markers: 'dot', markerSize: 8, markersByDepth: false },
        transform: { x: 600, y: 470, scale: 520, rx: -66, ry: 0, rz: -8 },
      },
      {
        name: 'Sun',
        source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
        ops: [{ kind: 'revolve', params: { rings: 7, spokes: 14 } }],
        style: { color: 'ramp', colorBy: 'depth', taper: 'none', width: 1, fill: 'ribbons', fillOpacity: 0.35 },
        transform: { x: 600, y: 470, scale: 44, rx: -20, ry: 20, rz: -8 },
      },
      {
        name: 'Legend',
        source: { kind: 'card', params: { text: 'Five bodies,\none slow clock.', meta: '1 : 3 : 5 : 8 : 13', width: 1.3, height: 0.58, padding: 0.09, icon: 'orbit', iconSize: 0.2, align: 'bottom' } },
        style: { color: 'ramp', taper: 'none', width: 1, fill: 'shapes', fillOpacity: 0.1, knockout: true, labelFont: 'mono', labelSize: 17 },
        transform: { x: 190, y: 770, scale: 250, rx: 0, ry: 0, rz: 0, perspective: 0 },
      },
    ]),
  },
  {
    id: 'sonar',
    name: 'Sonar',
    blurb: 'Concentric ticked rings and a fading sweep, with a few contacts and a reading panel',
    build: () => doc('ozone', [
      {
        name: 'Range rings',
        source: { kind: 'curve', params: { shape: 'circle' } },
        ops: [
          // Ticks first, so each repeated ring carries its own in proportion.
          { kind: 'ticks', params: { count: 200, length: 0.06, side: 'out', majorEvery: 0, vary: 'wave', amount: 0.9, cycles: 6, keepLines: true } },
          { kind: 'repeat', params: { layout: 'linear', count: 5, dz: 0, grow: -0.2 } },
        ],
        style: { color: 'ramp', colorBy: 'family', taper: 'none', width: 1 },
        transform: { x: 470, y: 450, scale: 380, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Outer ring',
        source: { kind: 'curve', params: { shape: 'circle' } },
        style: { color: 'ramp', colorBy: 'family', taper: 'none', width: 3 },
        transform: { x: 470, y: 450, scale: 380, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Bearing axes',
        source: { kind: 'curve', params: { shape: 'line' } },
        ops: [
          { kind: 'ticks', params: { count: 41, length: 0.02, side: 'both', majorEvery: 5, majorLength: 2.4, keepLines: true } },
          { kind: 'repeat', params: { layout: 'radial', axis: 'z', count: 2, radius: 0, arc: 90, center: false } },
        ],
        style: { color: 'solid', taper: 'none', width: 0.9, dash: 'dashed' },
        transform: { x: 470, y: 450, scale: 380, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Sweep',
        source: { kind: 'note', params: { text: '', angle: 36, length: 1, elbow: 0 } },
        ops: [{ kind: 'repeat', params: { layout: 'linear', count: 18, dx: 0, dy: 0, dz: 0, turn: -1.6, center: false } }],
        style: { color: 'ramp', colorBy: 'family', taper: 'none', width: 1.6 },
        transform: { x: 470, y: 450, scale: 380, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Bearing note',
        source: { kind: 'note', params: { text: '036\u00b0', angle: 24, length: 0.5, elbow: 0.35 } },
        style: { color: 'ramp', taper: 'none', width: 1, markers: 'dot', markerSize: 3.4, markersByDepth: false, labelSize: 14 },
        transform: { x: 790, y: 232, scale: 120, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Contacts',
        source: { kind: 'points', params: { count: 3, spread: 'disc', seed: 23 } },
        style: { color: 'ramp', taper: 'none', markers: 'ring', markerSize: 7, markersByDepth: false },
        transform: { x: 470, y: 450, scale: 300, rx: 0, ry: 0, rz: 0 },
      },
      {
        name: 'Reading',
        source: { kind: 'card', params: { text: 'Three contacts,\none of them closing.', meta: 'BRG 036', width: 1.35, height: 0.62, padding: 0.09, icon: 'crosshair', iconSize: 0.2, align: 'bottom' } },
        style: { color: 'ramp', taper: 'none', width: 1, fill: 'shapes', fillOpacity: 0.1, knockout: true, labelFont: 'sans', labelSize: 20 },
        transform: { x: 985, y: 700, scale: 250, rx: 0, ry: 0, rz: 0, perspective: 0 },
      },
    ]),
  },
  {
    id: 'blank',
    name: 'Blank canvas',
    blurb: 'An empty graphite artboard',
    build: () => doc('graphite', []),
  },
];
