import type { VectorPath } from './path';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** How a polyline decides between the "front" (solid) and "back" (secondary) stroke. */
export type Tone = 'auto' | 'front' | 'back';

export interface Polyline {
  pts: Vec3[];
  /** Per-point surface normals. When present they drive front/back classification. */
  normals?: Vec3[];
  closed?: boolean;
  tone?: Tone;
  /** Draw an arrowhead at the end of the line. */
  arrow?: boolean;
}

export interface GeoNode {
  p: Vec3;
  n?: Vec3;
}

export interface GeoLabel {
  p: Vec3;
  text: string;
  anchor?: 'start' | 'middle' | 'end';
  /** Draw a small dot before the text, like a figure annotation. */
  marker?: boolean;
}

export interface Geometry {
  lines: Polyline[];
  nodes: GeoNode[];
  labels?: GeoLabel[];
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export type ParamDef =
  | { key: string; label: string; kind: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'seed' };

export type BackStyle = 'dotted' | 'dashed' | 'solid' | 'faded' | 'hidden';

export interface LayerStyle {
  /** null = follow the document ink colour. */
  stroke: string | null;
  width: number;
  back: BackStyle;
  nodes: boolean;
  nodeSize: number;
  backNodes: boolean;
  labels: boolean;
  labelSize: number;
  opacity: number;
  /** Fill colour for path layers. null/undefined = no fill. */
  fill?: string | null;
}

export interface Transform {
  x: number;
  y: number;
  /** Radius, in artboard pixels, of the generator's unit space. */
  scale: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0 = orthographic, 1 = strong perspective. */
  perspective: number;
}

export interface Layer extends Transform {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Degrees per second of Y rotation while the canvas is playing. */
  spin: number;
  params: Params;
  style: LayerStyle;
  /**
   * Editable Bézier geometry, present on `type: 'path'` layers. Coordinates are
   * local pixels around (x, y) at scale 100; see lib/vector-layer.ts.
   */
  path?: VectorPath;
}

export interface Doc {
  width: number;
  height: number;
  background: string;
  ink: string;
  /** Hand-drawn displacement amount (0 = crisp). */
  rough: number;
  layers: Layer[];
}

export interface Generator {
  type: string;
  name: string;
  blurb: string;
  params: ParamDef[];
  defaults: Params;
  transform?: Partial<Transform>;
  style?: Partial<LayerStyle>;
  build(p: Params): Geometry;
}
