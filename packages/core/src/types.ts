export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/**
 * How a polyline decides whether it is drawn as visible or hidden. `auto` follows the
 * normals (lines without normals stay visible); `depth` hides whatever sits behind the
 * form's centre, for ready-made shapes whose loose lines have no surface.
 */
export type Tone = 'auto' | 'front' | 'back' | 'depth';

export interface Polyline {
  pts: Vec3[];
  /** Per-point surface normals. When present they drive visible/hidden classification. */
  normals?: Vec3[];
  closed?: boolean;
  tone?: Tone;
  /** Draw an arrowhead at the end of the line. */
  arrow?: boolean;
  /** Per-point position along the original source curve, 0–1. Drives "by t" styling. */
  t?: number[];
  /** Ordinal within its structure (ring index, copy index…). Drives "by family" colour. */
  family?: number;
  /** Lines sharing a band, adjacent in order and equal in length, get ribbon fills between them. */
  band?: number;
}

export interface GeoNode {
  p: Vec3;
  n?: Vec3;
  tone?: Tone;
  t?: number;
  family?: number;
}

export interface GeoLabel {
  p: Vec3;
  text: string;
  anchor?: 'start' | 'middle' | 'end';
}

export interface Geometry {
  lines: Polyline[];
  nodes: GeoNode[];
  labels?: GeoLabel[];
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

/** Show a param only when another select param has one of these values. */
export interface ParamWhen {
  key: string;
  in: string[];
}

export type ParamDef = (
  | { key: string; label: string; kind: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'seed' }
) & { when?: ParamWhen; help?: string };

/** A building block: a source (makes geometry) or an operator (transforms it). */
export interface BlockDef {
  kind: string;
  name: string;
  blurb: string;
  /** Sources only: a bare building block, or a complete ready-made shape. */
  group?: 'block' | 'shape';
  params: ParamDef[];
  defaults: Params;
}

export interface SourceDef extends BlockDef {
  build(p: Params): Geometry;
}

export interface OpDef extends BlockDef {
  apply(g: Geometry, p: Params): Geometry;
}

export type HiddenStyle = 'fade' | 'dotted' | 'dashed' | 'solid' | 'hide';
export type Taper = 'none' | 'depth' | 't';
export type ColorBy = 'depth' | 't' | 'family';
export type MarkerShape = 'none' | 'dot' | 'ring' | 'cross' | 'tick';

export interface Style {
  width: number;
  /** Line weight and lightness vary along depth or along the curve. */
  taper: Taper;
  taperAmount: number;
  color: 'solid' | 'ramp';
  colorBy: ColorBy;
  /** Solid colour; null = the last (nearest, strongest) stop of the ramp. */
  stroke: string | null;
  /** Gradient stops; null = the document ramp. */
  ramp: string[] | null;
  /** How lines facing away from the viewer are drawn. */
  hidden: HiddenStyle;
  fill: 'none' | 'ribbons';
  fillOpacity: number;
  markers: MarkerShape;
  markerSize: number;
  markerEvery: number;
  markersByDepth: boolean;
  labels: boolean;
  labelSize: number;
  opacity: number;
}

export interface Transform {
  x: number;
  y: number;
  /** Radius, in artboard pixels, of the form's unit space. */
  scale: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0 = orthographic, 1 = strong perspective. */
  perspective: number;
}

export interface Op {
  id: string;
  kind: string;
  enabled: boolean;
  params: Params;
}

export interface Form extends Transform {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Degrees per second of Y rotation while the canvas is playing. */
  spin: number;
  source: { kind: string; params: Params };
  ops: Op[];
  style: Style;
}

export interface Doc {
  version: 2;
  width: number;
  height: number;
  background: string;
  /** Document colour ramp (2–6 hex stops). Forms use it unless they set their own. */
  ramp: string[];
  /** Hand-drawn displacement amount (0 = crisp). */
  rough: number;
  forms: Form[];
}
