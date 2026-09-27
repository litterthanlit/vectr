import type { Geometry, SourceDef } from '../../types.js';
import { arches, flowgrid, frame, maze, shape, spirograph } from './planar.js';
import { funnel, globe, knot, orbits, torus, vortex } from './spatial.js';

/**
 * Give ready-made shape geometry what the v2 styling reads: position along each
 * line (`t`) and a family per line. Lines and nodes without normals hide by depth,
 * so a knot's far side still drops back the way it always did.
 */
function annotate(g: Geometry): Geometry {
  return {
    ...g,
    lines: g.lines.map((l, i) => ({
      ...l,
      t: l.t ?? l.pts.map((_, k) => k / Math.max(1, l.pts.length - 1)),
      family: l.family ?? i,
      tone: !l.normals && (l.tone ?? 'auto') === 'auto' ? 'depth' : l.tone,
    })),
    nodes: g.nodes.map((n) => (n.n || n.tone ? n : { ...n, tone: 'depth' })),
  };
}

const asShape = (def: SourceDef): SourceDef => ({ ...def, group: 'shape', build: (p) => annotate(def.build(p)) });

/** Complete, recognisable objects: one click to add, and every operator still applies. */
export const SHAPES: SourceDef[] = [
  globe, funnel, vortex, torus, knot, orbits, arches, flowgrid, maze, shape, spirograph, frame,
].map(asShape);
