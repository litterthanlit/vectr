import type { SourceDef } from '../types.js';
import { card } from './card.js';
import { curve } from './curve.js';
import { lattice, note, points } from './others.js';
import { orbits } from './orbits.js';

export const SOURCES: SourceDef[] = [curve, lattice, points, note, orbits, card];

export const sourceFor = (kind: string): SourceDef | undefined => SOURCES.find((s) => s.kind === kind);
