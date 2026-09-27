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
  { id: 'graphite', name: 'Graphite', background: '#111214', ink: '#E8E9EC', rough: 0 },
  { id: 'signal', name: 'Signal', background: '#F4F5F7', ink: '#3B4BFF', rough: 0 },
  { id: 'kiln', name: 'Kiln', background: '#EDE6DD', ink: '#A4452C', rough: 0 },
  { id: 'ozone', name: 'Ozone', background: '#0B1220', ink: '#5CE1E6', rough: 0 },
  { id: 'bloom', name: 'Bloom', background: '#FFF8F3', ink: '#E0457B', rough: 0 },
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
    id: 'starter',
    name: 'Twisted torus',
    build: () =>
      withTheme('ozone', 1200, 900, [
        createLayer('torus', { x: 600, y: 450 }, {
          scale: 300, rx: -52, ry: 18, spin: 10,
          params: { major: 0.66, minor: 0.3, tubes: 36, loops: 0, twist: 2.5 },
          style: { back: 'faded', width: 1.2, nodes: false } as never,
        }),
      ]),
  },
  { id: 'blank', name: 'Blank canvas', build: () => withTheme('graphite', 1200, 900, []) },
];

export const ARTBOARD_SIZES = [
  { label: '1:1', w: 1000, h: 1000 },
  { label: '4:3', w: 1200, h: 900 },
  { label: '3:2', w: 1500, h: 1000 },
  { label: '16:9', w: 1600, h: 900 },
  { label: '4:5', w: 1080, h: 1350 },
  { label: '9:16', w: 900, h: 1600 },
];
