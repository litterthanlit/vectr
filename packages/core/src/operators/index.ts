import type { OpDef } from '../types.js';
import { mirror, repeat, scatter } from './arrange.js';
import { burst } from './burst.js';
import { jitter, resample, warp } from './deform.js';
import { connect, tile } from './link.js';
import { revolve, sweep } from './structure.js';
import { ticks } from './ticks.js';

/** In menu order: build a surface → arrange → deform → link → finish → blow apart. */
export const OPERATORS: OpDef[] = [revolve, sweep, repeat, mirror, warp, jitter, connect, tile, scatter, resample, ticks, burst];

export const opFor = (kind: string): OpDef | undefined => OPERATORS.find((o) => o.kind === kind);
