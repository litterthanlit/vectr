/**
 * Path layers: bridges editable Bézier paths (lib/path.ts) and the layer
 * transform model shared with the generators (x, y, scale, rx/ry/rz).
 *
 * A path layer stores anchors in local pixels around its origin (x, y); at
 * scale 100 with no rotation, local + origin = artboard pixels. Tilting (rx/ry)
 * is an orthographic affine map, so Béziers stay exact Béziers on screen.
 */
import { DEFAULT_STYLE, uid } from './generators';
import { anchorCount, invert, parsePathD, pathBounds, simplifyPath, transformPath, type VectorPath } from './path';
import { pathAffine, renderLayer } from './render';
import type { Layer, LayerStyle } from './types';

export const PATH_TYPE = 'path';
export const isPathLayer = (l: Layer | null | undefined): l is Layer & { path: VectorPath } => !!l && l.type === PATH_TYPE && !!l.path;

export const PATH_STYLE: LayerStyle = {
  ...DEFAULT_STYLE,
  width: 2,
  back: 'solid',
  nodes: false,
  labels: false,
  fill: null,
};

/** The layer's path in artboard coordinates. */
export const layerPathAbs = (layer: Layer): VectorPath =>
  layer.path ? transformPath(layer.path, pathAffine(layer)) : { subpaths: [] };

/** Replace a layer's geometry from artboard coordinates (inverse of layerPathAbs). */
export function withPathAbs(layer: Layer, abs: VectorPath): Layer {
  return { ...layer, path: transformPath(abs, invert(pathAffine(layer))) };
}

export interface PathLayerOptions {
  name?: string;
  style?: Partial<LayerStyle>;
}

/** New path layer whose origin sits at the centre of the artwork, so rotate/scale pivot naturally. */
export function createPathLayer(abs: VectorPath, opts: PathLayerOptions = {}): Layer {
  const b = pathBounds(abs);
  const cx = round2(b.x + b.w / 2), cy = round2(b.y + b.h / 2);
  return {
    id: uid(),
    type: PATH_TYPE,
    name: opts.name ?? 'Path',
    visible: true,
    locked: false,
    spin: 0,
    x: cx,
    y: cy,
    scale: 100,
    rx: 0,
    ry: 0,
    rz: 0,
    perspective: 0,
    params: {},
    style: { ...PATH_STYLE, ...opts.style },
    path: transformPath(abs, [1, 0, 0, 1, -cx, -cy]),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Move the origin to the artwork's centre without moving the artwork. */
export function recenter(layer: Layer): Layer {
  if (!layer.path) return layer;
  const abs = layerPathAbs(layer);
  const b = pathBounds(abs);
  const moved = { ...layer, x: round2(b.x + b.w / 2), y: round2(b.y + b.h / 2) };
  return withPathAbs(moved, abs);
}

/**
 * Bake a generator layer into editable path layers. The dense polylines the
 * generators produce are refit into a handful of Béziers on the way.
 */
export function convertToPaths(layer: Layer, tolerance = 0.6): Layer[] {
  if (layer.type === PATH_TYPE) return [layer];
  const r = renderLayer(layer);
  const color = layer.style.stroke;
  const out: Layer[] = [];
  const make = (d: string, name: string, opacity: number) => {
    if (!d) return;
    const path = simplifyPath(parsePathD(d), { tolerance });
    if (!anchorCount(path)) return;
    out.push(createPathLayer(path, {
      name,
      style: { stroke: color, width: layer.style.width, opacity: layer.style.opacity * opacity },
    }));
  };
  make(r.front, layer.name, 1);
  if (layer.style.back !== 'hidden') make(r.back, `${layer.name} · hidden lines`, 0.35);
  return out;
}

export { pathAffine };
