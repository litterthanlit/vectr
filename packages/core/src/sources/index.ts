import type { SourceDef } from '../types.js';
import { curve } from './curve.js';
import { lattice, note, points } from './others.js';

export const SOURCES: SourceDef[] = [curve, lattice, points, note];

export const sourceFor = (kind: string): SourceDef | undefined => SOURCES.find((s) => s.kind === kind);
