import { createLayer } from './generators/index.js';
import type { Doc, Layer } from './types.js';

export interface Theme {
  id: string;
  name: string;
  background: string;
  ink: string;
  rough: number;
}

export const THEMES: Theme[] = [
  { id: 'paper', name: 'Paper', background: '#F3F2E9', ink: '#232323', rough: 0 },
  { id: 'chalk', name: 'Chalk', background: '#050505', ink: '#E6E6E3', rough: 2.2 },
  { id: 'mono', name: 'Mono', background: '#F0F0F0', ink: '#0A0A0A', rough: 0 },
  { id: 'blueprint', name: 'Blueprint', background: '#173152', ink: '#D8E6F7', rough: 0 },
  { id: 'ember', name: 'Ember', background: '#0E0E10', ink: '#FF6A3D', rough: 0 },
];

export interface Template {
  id: string;
  name: string;
  build(): Doc;
}

const withTheme = (id: string, width: number, height: number, layers: Layer[]): Doc => {
  const t = THEMES.find((x) => x.id === id)!;
  return { width, height, background: t.background, ink: t.ink, rough: t.rough, layers };
};

export const TEMPLATES: Template[] = [
  {
    id: 'specimen',
    name: 'Specimen row',
    build: () =>
      withTheme('paper', 1600, 900, [
        createLayer('revolve', { x: 250, y: 450 }, { scale: 118 }),
        createLayer('truchet', { x: 525, y: 450 }, { scale: 96, params: { seed: 11 } }),
        createLayer('vortex', { x: 800, y: 450 }, { scale: 118 }),
        createLayer('arches', { x: 1075, y: 450 }, { scale: 112 }),
        createLayer('grid', { x: 1350, y: 450 }, { scale: 112, style: { nodeSize: 3.4 } as never }),
      ]),
  },
  {
    id: 'globe',
    name: 'Chalk globe',
    build: () =>
      withTheme('chalk', 1000, 1000, [
        createLayer('sphere', { x: 500, y: 500 }, {
          scale: 330, spin: 12,
          params: { meridians: 7, parallels: 8, rings: 2, ringSize: 0.42, seed: 4 },
          style: { back: 'solid', width: 1.1, nodes: false } as never,
        }),
      ]),
  },
  {
    id: 'figure',
    name: 'Figure plate',
    build: () =>
      withTheme('chalk', 1200, 900, [
        createLayer('frame', { x: 600, y: 440 }, { scale: 330, style: { labelSize: 10, width: 1 } as never }),
        createLayer('orbits', { x: 600, y: 440 }, { scale: 330, style: { labelSize: 10, width: 1.1 } as never }),
      ]),
  },
  {
    id: 'icons',
    name: 'Icon set',
    build: () => {
      const kinds: [string, Record<string, number | string | boolean>][] = [
        ['squircle', { round: 0.55 }],
        ['polygon', { sides: 6, round: 0.3 }],
        ['star', { sides: 5, inner: 0.5, round: 0.25 }],
        ['circle', { echoes: 3, spacing: 0.28, alternate: true }],
        ['flower', { sides: 6, inner: 0.35 }],
        ['blob', { inner: 0.6, seed: 9 }],
      ];
      return withTheme('mono', 1200, 900, kinds.map(([kind, extra], i) =>
        createLayer('shape', { x: 300 + (i % 3) * 300, y: 300 + Math.floor(i / 3) * 300 }, {
          name: kind[0].toUpperCase() + kind.slice(1),
          scale: 64,
          params: { kind, ...extra },
          style: { width: 6, nodes: false } as never,
        }),
      ));
    },
  },
  { id: 'blank', name: 'Blank canvas', build: () => withTheme('paper', 1200, 900, []) },
];

export const ARTBOARD_SIZES = [
  { label: '1:1', w: 1000, h: 1000 },
  { label: '4:3', w: 1200, h: 900 },
  { label: '3:2', w: 1500, h: 1000 },
  { label: '16:9', w: 1600, h: 900 },
  { label: '4:5', w: 1080, h: 1350 },
  { label: '9:16', w: 900, h: 1600 },
];
