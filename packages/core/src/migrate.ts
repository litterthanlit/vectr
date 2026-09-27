import { shapeStyle, shapeTransform } from './shapes.js';

/**
 * Vectr v1 → v2. Each v1 generator lives on as a v2 shape source, so a v1 layer becomes
 * a form with that source and no operators, keeping its params, position, rotation,
 * colour and line style. Output is a raw v2 object that then goes through the normal
 * validator, so migration never has to be trusted.
 */

type Raw = Record<string, unknown>;

/** v1 layer type → the shape source that carries the same generator. */
const KIND: Record<string, string> = {
  sphere: 'globe', revolve: 'funnel', vortex: 'vortex', torus: 'torus', knot: 'knot', orbits: 'orbits',
  arches: 'arches', grid: 'flowgrid', truchet: 'maze', shape: 'shape', spirograph: 'spirograph', frame: 'frame',
};

const HIDDEN: Record<string, string> = { dotted: 'dotted', dashed: 'dashed', solid: 'solid', faded: 'fade', hidden: 'hide' };

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function migrateV1(raw: Raw, warnings: string[]): Raw {
  const width = typeof raw.width === 'number' ? raw.width : 1200;
  const height = typeof raw.height === 'number' ? raw.height : 900;
  const ink = typeof raw.ink === 'string' ? raw.ink : undefined;
  const forms: Raw[] = [];
  (Array.isArray(raw.layers) ? raw.layers : []).forEach((layer, i) => {
    const kind = isObj(layer) && typeof layer.type === 'string' ? KIND[layer.type] : undefined;
    if (!kind) {
      warnings.push(`layers[${i}]: unknown v1 layer type ${JSON.stringify(isObj(layer) ? layer.type : layer)}, skipped`);
      return;
    }
    const l = layer as Raw;
    const cam = shapeTransform(kind) as Record<string, number>;
    const look = shapeStyle(kind);
    const st = isObj(l.style) ? l.style : {};
    const pick = <T>(v: unknown, type: string, fallback: T): T => (typeof v === type ? (v as T) : fallback);
    const nodes = pick(st.nodes, 'boolean', look.markers === 'dot');
    forms.push({
      ...(typeof l.id === 'string' ? { id: l.id } : {}),
      ...(typeof l.name === 'string' ? { name: l.name } : {}),
      ...(typeof l.visible === 'boolean' ? { visible: l.visible } : {}),
      ...(typeof l.locked === 'boolean' ? { locked: l.locked } : {}),
      x: num(l.x, width / 2), y: num(l.y, height / 2),
      scale: num(l.scale, cam.scale), rx: num(l.rx, cam.rx), ry: num(l.ry, cam.ry), rz: num(l.rz, cam.rz),
      perspective: num(l.perspective, 0), spin: num(l.spin, 0),
      // The v1 generator lives on as a shape source, so params carry over as they were.
      source: { kind, params: isObj(l.params) ? l.params : {} },
      ops: [],
      style: {
        ...look,
        stroke: typeof st.stroke === 'string' ? st.stroke : null,
        width: num(st.width, look.width!),
        hidden: HIDDEN[pick(st.back, 'string', '')] ?? look.hidden,
        markers: nodes ? 'dot' : 'none',
        markerSize: num(st.nodeSize, look.markerSize!),
        labels: pick(st.labels, 'boolean', true),
        labelSize: num(st.labelSize, look.labelSize!),
        opacity: num(st.opacity, 1),
      },
    });
  });
  warnings.push('Converted from a Vectr v1 design');
  return {
    version: 2,
    width,
    height,
    ...(typeof raw.background === 'string' ? { background: raw.background } : {}),
    ...(ink ? { ramp: [ink] } : {}),
    rough: typeof raw.rough === 'number' ? raw.rough : 0,
    forms,
  };
}
