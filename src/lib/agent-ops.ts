/**
 * Agent-facing vector operations. Everything is expressed in absolute artboard
 * pixels (including handle positions) because that is what language models
 * reason about reliably; conversion to the layer's local space happens here.
 *
 * Pure functions over Doc/Layer so the MCP server, the browser and the tests
 * all share one behaviour.
 */
import {
  anchor, anchorCount, cleanupPath, clonePath, deleteAnchors, inferKind, insertAnchor, nearestOnPath, parsePathD,
  pathBounds, pathStats, polyline, reverseSub, setAnchorKind, simplifyPath, smoothThrough,
  type Anchor, type AnchorKind, type AnchorRef, type KindChange, type SubPath, type VectorPath,
} from './path';
import { layerPathAbs, withPathAbs, isPathLayer, recenter } from './vector-layer';
import { renderLayerCached } from './render';
import type { Doc, Layer, Vec2 } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (v: Vec2): Vec2 => [r2(v[0]), r2(v[1])];

/** An anchor as agents write it: absolute position, absolute handle positions. */
export interface AbsAnchor {
  x: number;
  y: number;
  in?: Vec2 | null;
  out?: Vec2 | null;
  kind?: AnchorKind;
}

export function anchorFromAbs(a: AbsAnchor): Anchor {
  const inH: Vec2 | null = a.in ? [a.in[0] - a.x, a.in[1] - a.y] : null;
  const outH: Vec2 | null = a.out ? [a.out[0] - a.x, a.out[1] - a.y] : null;
  return anchor(a.x, a.y, inH, outH, a.kind ?? inferKind(inH, outH));
}

export function anchorToAbs(a: Anchor): Required<AbsAnchor> {
  return {
    x: r2(a.x), y: r2(a.y),
    in: a.in ? pt([a.x + a.in[0], a.y + a.in[1]]) : null,
    out: a.out ? pt([a.x + a.out[0], a.y + a.out[1]]) : null,
    kind: a.kind,
  };
}

/** Geometry input accepted by the drawing tools. Exactly one source should be given. */
export interface GeometryInput {
  /** SVG path data, e.g. "M10 10 C 40 0, 60 0, 90 10". */
  d?: string;
  /** Points to connect; with smooth=true a curve passes through each one. */
  points?: Vec2[];
  smooth?: boolean;
  /** Explicit anchors with absolute handle positions. */
  anchors?: AbsAnchor[];
  closed?: boolean;
}

export function geometryFromInput(g: GeometryInput): VectorPath {
  if (g.d) {
    const p = parsePathD(g.d);
    if (!p.subpaths.length) throw new Error('Path data "d" produced no geometry; it must start with M/m.');
    return p;
  }
  if (g.anchors?.length) {
    if (g.anchors.length < 2) throw new Error('A path needs at least 2 anchors.');
    return { subpaths: [{ closed: !!g.closed, anchors: g.anchors.map(anchorFromAbs) }] };
  }
  if (g.points?.length) {
    if (g.points.length < 2) throw new Error('A path needs at least 2 points.');
    const sub = g.smooth ? smoothThrough(g.points, !!g.closed) : polyline(g.points, !!g.closed);
    return { subpaths: [sub] };
  }
  throw new Error('Provide one of "d", "points" or "anchors".');
}

export function describePath(layer: Layer) {
  const abs = layerPathAbs(layer);
  const b = pathBounds(abs);
  return {
    id: layer.id,
    name: layer.name,
    bbox: { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) },
    stats: pathStats(abs),
    fillRule: abs.fillRule ?? 'nonzero',
    subpaths: abs.subpaths.map((s, si) => ({
      index: si,
      closed: s.closed,
      anchors: s.anchors.map((a, ai) => ({ ref: [si, ai] as AnchorRef, ...anchorToAbs(a) })),
    })),
  };
}

export function summarizeLayer(layer: Layer) {
  const r = renderLayerCached(layer);
  const base = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    locked: layer.locked,
    bbox: { x: r2(r.bbox.x), y: r2(r.bbox.y), w: r2(r.bbox.w), h: r2(r.bbox.h) },
    transform: { x: layer.x, y: layer.y, scale: layer.scale, rotation: -layer.rz || 0, tilt_x: layer.rx, turn_y: layer.ry },
    style: {
      stroke: layer.style.stroke ?? 'ink', strokeWidth: layer.style.width, opacity: layer.style.opacity,
      ...(isPathLayer(layer) ? { fill: layer.style.fill ?? 'none' } : { hiddenLines: layer.style.back }),
    },
  };
  if (isPathLayer(layer)) return { ...base, anchors: anchorCount(layer.path), subpaths: layer.path.subpaths.length };
  return { ...base, params: layer.params };
}

export function summarizeDoc(doc: Doc) {
  return {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    ink: doc.ink,
    handDrawn: doc.rough,
    layers: doc.layers.map(summarizeLayer),
  };
}

export function findLayer(doc: Doc, ref: string): Layer {
  const l = doc.layers.find((x) => x.id === ref) ?? doc.layers.find((x) => x.name === ref);
  if (!l) {
    const names = doc.layers.map((x) => `${x.id} ("${x.name}")`).join(', ') || 'none';
    throw new Error(`No layer "${ref}". Layers: ${names}`);
  }
  return l;
}

// ---------------------------------------------------------------------------
// Point-level edit operations
// ---------------------------------------------------------------------------

type Ref = AnchorRef | string;
const toRef = (r: Ref): AnchorRef => (typeof r === 'string' ? (r.split(':').map(Number) as AnchorRef) : r);

export type EditOp =
  | { op: 'move'; anchors?: Ref[] | 'all'; dx: number; dy: number }
  | { op: 'set'; at: Ref; x?: number; y?: number; in?: Vec2 | null; out?: Vec2 | null; kind?: AnchorKind }
  | { op: 'kind'; anchors: Ref[] | 'all'; kind: KindChange }
  | { op: 'insert'; subpath: number; segment: number; t?: number }
  | { op: 'insert_at'; x: number; y: number }
  | { op: 'delete'; anchors: Ref[] }
  | { op: 'append'; subpath?: number; x: number; y: number; in?: Vec2 | null; out?: Vec2 | null; prepend?: boolean }
  | ({ op: 'add_subpath' } & GeometryInput)
  | { op: 'remove_subpath'; subpath: number }
  | { op: 'close'; subpath: number; closed?: boolean }
  | { op: 'reverse'; subpath: number }
  | { op: 'fill_rule'; rule: 'nonzero' | 'evenodd' };

function checkRef(p: VectorPath, [s, i]: AnchorRef) {
  const sub = p.subpaths[s];
  if (!sub) throw new Error(`Subpath ${s} does not exist (path has ${p.subpaths.length}).`);
  if (!Number.isInteger(i) || i < 0 || i >= sub.anchors.length) throw new Error(`Anchor [${s}, ${i}] does not exist (subpath ${s} has ${sub.anchors.length} anchors).`);
}

function allRefs(p: VectorPath): AnchorRef[] {
  return p.subpaths.flatMap((s, si) => s.anchors.map((_, ai): AnchorRef => [si, ai]));
}

function subAt(p: VectorPath, s: number): SubPath {
  const sub = p.subpaths[s];
  if (!sub) throw new Error(`Subpath ${s} does not exist (path has ${p.subpaths.length}).`);
  return sub;
}

/** Apply edit ops in order (indices refer to the state after earlier ops). Throws on invalid input; nothing is applied. */
export function applyEdits(layer: Layer, ops: EditOp[]): Layer {
  if (!isPathLayer(layer)) throw new Error(`Layer "${layer.name}" is a ${layer.type} generator. Call convert_to_path first to edit its points.`);
  let p = clonePath(layerPathAbs(layer));
  ops.forEach((op, n) => {
    try {
      p = applyOne(p, op);
    } catch (e) {
      throw new Error(`Op #${n} (${op.op}): ${(e as Error).message}`);
    }
  });
  return withPathAbs(layer, p);
}

function applyOne(p: VectorPath, op: EditOp): VectorPath {
  switch (op.op) {
    case 'move': {
      const refs = op.anchors === 'all' || !op.anchors ? allRefs(p) : op.anchors.map(toRef);
      refs.forEach((r) => checkRef(p, r));
      for (const [s, i] of refs) {
        const a = p.subpaths[s].anchors[i];
        a.x += op.dx;
        a.y += op.dy;
      }
      return p;
    }
    case 'set': {
      const r = toRef(op.at);
      checkRef(p, r);
      const sub = p.subpaths[r[0]];
      const cur = sub.anchors[r[1]];
      const x = op.x ?? cur.x, y = op.y ?? cur.y;
      // Handles given absolutely; handles not given keep their relative offset (they travel with the anchor).
      const inH: Vec2 | null = op.in === undefined ? cur.in : op.in && [op.in[0] - x, op.in[1] - y];
      const outH: Vec2 | null = op.out === undefined ? cur.out : op.out && [op.out[0] - x, op.out[1] - y];
      let next: Anchor = { x, y, in: inH, out: outH, kind: op.kind ?? (op.in !== undefined || op.out !== undefined ? inferKind(inH, outH) : cur.kind) };
      if (op.kind && op.kind !== 'corner') {
        sub.anchors[r[1]] = next;
        next = setAnchorKind(sub, r[1], op.kind);
      }
      sub.anchors[r[1]] = next;
      return p;
    }
    case 'kind': {
      const refs = op.anchors === 'all' ? allRefs(p) : op.anchors.map(toRef);
      refs.forEach((r) => checkRef(p, r));
      for (const [s, i] of refs) p.subpaths[s].anchors[i] = setAnchorKind(p.subpaths[s], i, op.kind);
      return p;
    }
    case 'insert': {
      const sub = subAt(p, op.subpath);
      const segs = sub.closed ? sub.anchors.length : sub.anchors.length - 1;
      if (op.segment < 0 || op.segment >= segs) throw new Error(`Segment ${op.segment} does not exist (subpath has ${segs}).`);
      p.subpaths[op.subpath] = insertAnchor(sub, op.segment, Math.min(0.999, Math.max(0.001, op.t ?? 0.5)));
      return p;
    }
    case 'insert_at': {
      const hit = nearestOnPath(p, [op.x, op.y]);
      if (!hit) throw new Error('Path has no segments.');
      p.subpaths[hit.sub] = insertAnchor(p.subpaths[hit.sub], hit.seg, Math.min(0.999, Math.max(0.001, hit.t)));
      return p;
    }
    case 'delete': {
      const refs = op.anchors.map(toRef);
      refs.forEach((r) => checkRef(p, r));
      return deleteAnchors(p, refs);
    }
    case 'append': {
      const s = op.subpath ?? p.subpaths.length - 1;
      const sub = subAt(p, s);
      if (sub.closed) throw new Error(`Subpath ${s} is closed; open it first with {op:"close", closed:false}.`);
      const a = anchorFromAbs({ x: op.x, y: op.y, in: op.in, out: op.out });
      if (op.prepend) sub.anchors.unshift(a);
      else sub.anchors.push(a);
      return p;
    }
    case 'add_subpath': {
      const g = geometryFromInput(op);
      return { ...p, subpaths: [...p.subpaths, ...g.subpaths] };
    }
    case 'remove_subpath': {
      subAt(p, op.subpath);
      return { ...p, subpaths: p.subpaths.filter((_, i) => i !== op.subpath) };
    }
    case 'close': {
      const sub = subAt(p, op.subpath);
      sub.closed = op.closed ?? true;
      return p;
    }
    case 'reverse': {
      p.subpaths[op.subpath] = reverseSub(subAt(p, op.subpath));
      return p;
    }
    case 'fill_rule':
      return { ...p, fillRule: op.rule };
    default:
      throw new Error(`Unknown op "${(op as { op: string }).op}".`);
  }
}

/** Simplify (refit) and tidy a path layer. */
export function cleanLayer(layer: Layer, opts: { tolerance?: number; cornerAngle?: number; refit?: boolean } = {}) {
  if (!isPathLayer(layer)) throw new Error(`Layer "${layer.name}" is not a path.`);
  const abs = layerPathAbs(layer);
  const before = pathStats(abs);
  const refit = opts.refit ?? true;
  let next = refit ? simplifyPath(abs, { tolerance: opts.tolerance ?? 1, cornerAngle: opts.cornerAngle }) : abs;
  next = cleanupPath(next, 0.01, 2);
  // Never accept a "clean-up" that makes things worse.
  if (refit && anchorCount(next) > before.anchors) next = cleanupPath(abs, 0.01, 2);
  const out = recenter(withPathAbs(layer, next));
  return { layer: out, before, after: pathStats(next) };
}
