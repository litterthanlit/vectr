import type { SourceDef } from '../types.js';
import { card } from './card.js';
import { context } from './context.js';
import { curve } from './curve.js';
import { lattice, note, points } from './others.js';
import { orbits } from './orbits.js';
import { strip } from './strip.js';

export const SOURCES: SourceDef[] = [curve, lattice, points, note, orbits, card, context, strip];

export const sourceFor = (kind: string): SourceDef | undefined => SOURCES.find((s) => s.kind === kind);
