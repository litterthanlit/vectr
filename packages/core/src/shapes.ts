import type { FormSpec } from './forms.js';
import type { Params, Style, Transform } from './types.js';

/**
 * The ink look ready-made shapes are drawn in: one solid colour, even weight, hidden
 * faces dotted, dots on the nodes. Every setting can still be changed afterwards.
 */
export const SHAPE_STYLE: Partial<Style> = {
  color: 'solid',
  taper: 'none',
  width: 1.5,
  hidden: 'dotted',
  markers: 'dot',
  markerSize: 3.2,
  markerEvery: 1,
  markersByDepth: false,
  labels: true,
  labelSize: 11,
  opacity: 1,
};

interface ShapeLook {
  transform?: Partial<Transform>;
  style?: Partial<Style>;
}

/** Each shape's own camera and any departures from the ink look. */
const LOOKS: Record<string, ShapeLook> = {
  globe: { transform: { rx: 12, ry: 18 }, style: { markers: 'none' } },
  funnel: { transform: { rx: -18, ry: 10 } },
  vortex: { transform: { rx: -14, ry: 0, rz: -8 } },
  torus: { transform: { rx: -55, ry: 0 }, style: { markers: 'none' } },
  knot: { transform: { rx: -30, ry: 0 } },
  orbits: { transform: { rx: -8, ry: 0 }, style: { hidden: 'dashed', markers: 'none' } },
  arches: { transform: { rx: -8, ry: 38 } },
  flowgrid: { transform: { rx: 0, ry: 0 } },
  maze: { transform: { rx: 0, ry: 0, rz: 45, scale: 150 } },
  shape: { transform: { rx: 0, ry: 0 }, style: { width: 3 } },
  spirograph: { transform: { rx: 0, ry: 0 }, style: { width: 1 } },
  frame: { transform: { rx: 0, ry: 0 }, style: { width: 1, markers: 'none' } },
  hyperboloid: { transform: { rx: 14, ry: 0 }, style: { width: 1.1, markers: 'none' } },
  saddle: { transform: { rx: 30, ry: 35 }, style: { width: 1.1, markers: 'none' } },
  mobius: { transform: { rx: 38, ry: 12 }, style: { width: 1.2 } },
  klein: { transform: { rx: 25, ry: 20 }, style: { width: 1 } },
  seashell: { transform: { rx: 14, ry: 30 }, style: { width: 1 } },
  helix: { transform: { rx: -8, ry: 0, rz: -18 }, style: { markerSize: 2.4 } },
  polyhedron: { transform: { rx: 18, ry: 24 }, style: { markerSize: 3 } },
  superquadric: { transform: { rx: 22, ry: 30 }, style: { width: 1.1 } },
  attractor: { transform: { rx: -8, ry: 20 }, style: { width: 0.7, hidden: 'solid', markerSize: 0.8 } },
  harmonograph: { transform: { rx: 0, ry: 0 }, style: { width: 0.8 } },
  flowfield: { transform: { rx: 0, ry: 0 }, style: { width: 1.2 } },
  contours: { transform: { rx: 55, ry: 20 }, style: { width: 1.1 } },
  plant: { transform: { rx: 0, ry: 0 }, style: { width: 1.1, markerSize: 2 } },
  spacefill: { transform: { rx: 0, ry: 0 }, style: { width: 1.4 } },
  superformula: { transform: { rx: 0, ry: 0 }, style: { width: 1.2 } },
};

const BASE_TRANSFORM: Partial<Transform> = { scale: 160, rx: 0, ry: 0, rz: 0, perspective: 0 };

/** Camera for a shape (its default view at the standard size). */
export const shapeTransform = (kind: string): Partial<Transform> => ({ ...BASE_TRANSFORM, ...LOOKS[kind]?.transform });

/** Style for a shape: the ink look plus that shape's own tweaks. */
export const shapeStyle = (kind: string): Partial<Style> => ({ ...SHAPE_STYLE, ...LOOKS[kind]?.style });

/** What clicking a shape adds: the shape with its default settings, camera and ink style. */
export function shapeStarter(kind: string, extra: { params?: Params; transform?: Partial<Transform> } = {}): FormSpec {
  return {
    source: { kind, params: extra.params },
    transform: { ...shapeTransform(kind), ...extra.transform },
    style: shapeStyle(kind),
  };
}
