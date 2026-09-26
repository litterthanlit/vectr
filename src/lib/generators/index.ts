import type { Generator, Geometry, Layer, LayerStyle, Params } from '../types';
import { rng } from '../math';
import { arches, frame, grid, shape, spirograph, truchet } from './planar';
import { knot, orbits, revolve, sphere, torus, vortex } from './spatial';

export const GENERATORS: Generator[] = [
  sphere, revolve, vortex, torus, knot, orbits,
  arches, grid, truchet, shape, spirograph, frame,
];

export const generatorFor = (type: string) => GENERATORS.find((g) => g.type === type) ?? sphere;

export const DEFAULT_STYLE: LayerStyle = {
  stroke: null,
  width: 1.5,
  back: 'dotted',
  nodes: true,
  nodeSize: 3.2,
  backNodes: true,
  labels: true,
  labelSize: 11,
  opacity: 1,
};

let counter = 0;
export const uid = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createLayer(type: string, at: { x: number; y: number }, overrides: Partial<Layer> = {}): Layer {
  const g = generatorFor(type);
  return {
    id: uid(),
    type: g.type,
    name: g.name,
    visible: true,
    locked: false,
    spin: 0,
    x: at.x,
    y: at.y,
    scale: 160,
    rx: 0,
    ry: 0,
    rz: 0,
    perspective: 0,
    ...g.transform,
    ...overrides,
    params: { ...g.defaults, ...overrides.params },
    style: { ...DEFAULT_STYLE, ...g.style, ...overrides.style },
  };
}

/** Geometry depends only on params, which are replaced (never mutated) on edit. */
const cache = new WeakMap<Params, Geometry>();
export function geometryFor(layer: Layer): Geometry {
  let g = cache.get(layer.params);
  if (!g) {
    g = generatorFor(layer.type).build(layer.params);
    cache.set(layer.params, g);
  }
  return g;
}

/** Shuffle a generator's params within a pleasant middle band of each range. */
export function randomParams(type: string, current: Params): Params {
  const g = generatorFor(type);
  const r = rng(Math.floor(Math.random() * 1e9));
  const next: Params = { ...current };
  for (const d of g.params) {
    if (d.kind === 'range') {
      const t = 0.15 + r() * 0.7;
      const v = d.min + (d.max - d.min) * t;
      next[d.key] = Math.round(v / d.step) * d.step;
    } else if (d.kind === 'seed') {
      next[d.key] = Math.floor(r() * 999) + 1;
    } else if (d.kind === 'select' && d.key !== 'mode') {
      next[d.key] = d.options[Math.floor(r() * d.options.length)].value;
    }
  }
  return next;
}
