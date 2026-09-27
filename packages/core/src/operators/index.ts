import type { OpDef } from '../types.js';
import { mirror, repeat, scatter } from './arrange.js';
import { jitter, resample, warp } from './deform.js';
import { extrude, hatch, kaleidoscope, offset, smooth } from './draw.js';
import { connect, tile } from './link.js';
import { revolve, sweep } from './structure.js';

/** In menu order: build a surface → arrange → deform → link → finish. */
export const OPERATORS: OpDef[] = [
  revolve, sweep, extrude, repeat, mirror, kaleidoscope, warp, jitter, smooth, connect, tile, scatter, offset, hatch, resample,
];

export const opFor = (kind: string): OpDef | undefined => OPERATORS.find((o) => o.kind === kind);
