import type { SourceDef } from '../types.js';
import { curve } from './curve.js';
import { formula } from './formula.js';
import { lattice, note, points } from './others.js';
import { SHAPES } from './shapes/index.js';
export { SHAPE_CATEGORIES } from './shapes/index.js';

/** Building blocks first, then the ready-made shapes. */
export const SOURCES: SourceDef[] = [...[curve, lattice, points, formula, note].map((s) => ({ ...s, group: 'block' as const })), ...SHAPES];
export const BLOCK_SOURCES = SOURCES.filter((s) => s.group === 'block');
export const SHAPE_SOURCES = SOURCES.filter((s) => s.group === 'shape');

export const sourceFor = (kind: string): SourceDef | undefined => SOURCES.find((s) => s.kind === kind);
