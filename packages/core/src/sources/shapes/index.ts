import type { Geometry, Params, SourceDef } from '../../types.js';
import { attractor, contours, flowfield, harmonograph, plant, spacefill, superformula } from './fields.js';
import { arches, flowgrid, frame, maze, shape, spirograph } from './planar.js';
import { funnel, globe, knot, orbits, torus, vortex } from './spatial.js';
import { helix, hyperboloid, klein, mobius, polyhedron, saddle, seashell, superquadric } from './surfaces.js';

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

const GROUPS: { id: string; name: string; shapes: SourceDef[] }[] = [
  { id: 'solids', name: 'Solids & surfaces', shapes: [globe, funnel, torus, polyhedron, superquadric, hyperboloid, saddle, mobius, klein, seashell] },
  { id: 'motion', name: 'Curves & motion', shapes: [vortex, helix, knot, orbits, arches, spirograph, harmonograph, attractor] },
  { id: 'fields', name: 'Fields & growth', shapes: [flowgrid, maze, flowfield, contours, plant, spacefill] },
  { id: 'plates', name: 'Plates', shapes: [shape, superformula, frame] },
];

/** Complete, recognisable objects: one click to add, and every operator still applies. */
export const SHAPES: SourceDef[] = GROUPS.flatMap((c) =>
  c.shapes.map((def) => ({ ...def, group: 'shape' as const, category: c.id, build: (p: Params) => annotate(def.build(p)) })),
);

/** Library sections, in display order. */
export const SHAPE_CATEGORIES = GROUPS.map((c) => ({ id: c.id, name: c.name, shapes: SHAPES.filter((s) => s.category === c.id) }));
