import { TAU, clamp, int, lerp, num, smoothstep, str } from '../math.js';
import { cleanText } from '../render.js';
import type { GeoNode, Polyline, SourceDef } from '../types.js';

type Layout = 'window' | 'burst' | 'radial';
type Mark = 'block' | 'line' | 'dot';
type Pt = [number, number];

/** One token before it becomes geometry: a centre, a length along `ang`, a thickness and whether it is relevant. */
interface Tok {
  x: number;
  y: number;
  z: number;
  len: number;
  thick: number;
  ang: number;
  rel: 0 | 1;
}

const MAX_TOKENS = 3000;
/** Rays start this far from the centre (the field's half-size is 1), so they do not all pile onto one point. */
const HOLE = 0.05;

/**
 * A stateless random number in [0, 1) for a seed, a stream and two indices. Every row, slot and
 * stream draws its own, so changing the token count or any one param never reshuffles the rest.
 */
function rand(seed: number, stream: number, a = 0, b = 0): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x7f4a7c15;
  for (const v of [stream, a, b]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function vnoise(seed: number, stream: number, x: number, y: number): number {
  const [ix, iy] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [smoothstep(0, 1, x - ix), smoothstep(0, 1, y - iy)];
  const c = (i: number, j: number) => rand(seed, stream, i, j);
  return lerp(lerp(c(ix, iy), c(ix + 1, iy), fx), lerp(c(ix, iy + 1), c(ix + 1, iy + 1), fx), fy);
}

/** The share of a slot a token fills: grows with `k` but never quite closes the gap to the next token. */
const fraction = (k: number) => Math.min(0.94, 1 - Math.exp(-1.8 * k));

/** Normalise a word for matching: lower case, punctuation off both ends. */
const norm = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Streams of random numbers, one per decision, so that decisions stay independent. */
const S = { slot: 2, len: 3, rel: 4, depth: 5, blank: 6, short: 7, fill: 8, ragged: 9, keep: 10, off: 14, ray: 15, rayslot: 16, word: 40 } as const;

/** Everything a layout needs: the field's size, the params, and the radial strength of the field. */
interface Field {
  seed: number;
  ax: number;
  ay: number;
  W: number;
  H: number;
  rows: number;
  tokens: number;
  length: number;
  variance: number;
  height: number;
  density: number;
  relevant: number;
  /** Row spacing. */
  pitch: number;
  /** How strongly the field is "on" at a point, in coordinates normalised to the field's half-size: 1 at the core, thinning outward. */
  strength(nx: number, ny: number): number;
  /** The chance that a token at strength e is kept. */
  keep(e: number): number;
  /** Length multiplier at strength e: long near the core, short at the edge. */
  longer(e: number): number;
  /** Lognormal length factor with mean 1, spread by `variance`. */
  spread(a: number, b: number): number;
  /** A small depth per row (or ray), so a tilted field has some parallax. */
  rowZ(j: number): number;
}

/** Generated tokens in rows left-aligned like a text column, with a ragged right edge and paragraph breaks. */
function windowRows(f: Field): Tok[] {
  const { seed, ax, ay, W, rows, tokens, density, pitch } = f;
  const out: Tok[] = [];
  const per = Math.ceil(tokens / rows), pace = W / per;
  let prevShort = false;
  for (let j = 0; j < rows && out.length < tokens; j++) {
    // A blank line after a short one, like a paragraph break.
    if (prevShort && rand(seed, S.blank, j) < 0.5) {
      prevShort = false;
      continue;
    }
    const short = rand(seed, S.short, j) < 0.04 + 0.22 * (1 - density);
    prevShort = short;
    const fill = short ? lerp(0.12, 0.6, rand(seed, S.fill, j)) : 1 - (1 - density) * (0.1 + 0.9 * rand(seed, S.ragged, j) ** 2);
    const y = ay - (j + 0.5) * pitch;
    let x = -ax;
    for (let i = 0, n = Math.max(1, Math.round(per * fill)); i < n && out.length < tokens; i++) {
      const s = pace * (0.6 + 0.8 * rand(seed, S.slot, j, i));
      const len = s * fraction(f.length * f.spread(j, i));
      if (x + len > ax + 1e-9) break;
      out.push({ x: x + len / 2, y, z: 0, len, thick: f.height * pitch, ang: 0, rel: rand(seed, S.rel, j, i) < f.relevant ? 1 : 0 });
      x += s;
    }
  }
  return out;
}

/** Slot widths along one row or ray: random around an even pitch, summing to `total`. */
function slots(f: Field, count: number, total: number, stream: number, j: number): number[] {
  const w = Array.from({ length: count }, (_, i) => 0.6 + 0.8 * rand(f.seed, stream, j, i));
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  return w.map((x) => (x / sum) * total);
}

/** Generated tokens in rows across the whole width, surviving and growing longer towards the core. */
function burstRows(f: Field): Tok[] {
  const { seed, ax, ay, W, rows, tokens, pitch } = f;
  const out: Tok[] = [];
  const per = Math.ceil(tokens / rows);
  for (let j = 0; j < rows && out.length < tokens; j++) {
    const y = ay - (j + 0.5) * pitch, z = f.rowZ(j);
    let x = -ax;
    slots(f, per, W, S.slot, j).forEach((s, i) => {
      const e = f.strength((x + s / 2) / ax, y / ay);
      if (rand(seed, S.keep, j, i) < f.keep(e) && out.length < tokens) {
        const len = s * fraction(f.length * f.longer(e) * f.spread(j, i));
        const off = (s - len) * rand(seed, S.off, j, i);
        out.push({ x: x + off + len / 2, y, z, len, thick: f.height * pitch, ang: 0, rel: rand(seed, S.rel, j, i) < f.relevant ? 1 : 0 });
      }
      x += s;
    });
  }
  return out;
}

/** A token running between two points of the field. */
function between(f: Field, a: Pt, b: Pt, z: number, rel: 0 | 1): Tok {
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z, len: Math.hypot(b[0] - a[0], b[1] - a[1]), thick: f.height * f.pitch, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), rel };
}

/** A point at radius rho along the ray at angle a. The field is an ellipse when its aspect is not 1. */
const onRay = (f: Field, a: number, rho: number): Pt => [f.ax * rho * Math.cos(a), f.ay * rho * Math.sin(a)];

/** Generated tokens on rays from the centre, in sequence ray by ray, thinning outward. */
function rays(f: Field): Tok[] {
  const { seed, rows, tokens } = f;
  const out: Tok[] = [];
  const per = Math.ceil(tokens / rows), span = 1 - HOLE;
  for (let j = 0; j < rows && out.length < tokens; j++) {
    const a = (TAU * (j + (rand(seed, S.ray, j) - 0.5) * 0.5)) / rows, z = f.rowZ(j);
    let rho = HOLE;
    slots(f, per, span, S.rayslot, j).forEach((s, i) => {
      const e = f.strength((rho + s / 2) * Math.cos(a), (rho + s / 2) * Math.sin(a));
      if (rand(seed, S.keep, j, i) < f.keep(e) && out.length < tokens) {
        const len = s * fraction(f.length * f.longer(e) * f.spread(j, i));
        const from = rho + (s - len) * rand(seed, S.off, j, i);
        out.push(between(f, onRay(f, a, from), onRay(f, a, from + len), z, rand(seed, S.rel, j, i) < f.relevant ? 1 : 0));
      }
      rho += s;
    });
  }
  return out;
}

interface Word {
  /** Characters, which sets the block's length. */
  n: number;
  rel: 0 | 1;
}

/**
 * Words in reading order, grouped by the line they came from. A blank line is a paragraph break
 * (several collapse to one). Words in `highlight` are relevant; with no highlight, a seeded share is.
 */
function parseText(text: string, highlight: string, relevant: number, seed: number): Word[][] {
  const marked = new Set(highlight.split(/[,\s]+/).map(norm).filter(Boolean));
  const lines: Word[][] = [];
  let count = 0;
  for (const line of cleanText(text).split('\n')) {
    const words: Word[] = [];
    for (const w of line.split(/\s+/)) {
      if (!w || count >= MAX_TOKENS) continue;
      const roll = rand(seed, S.word, count++);
      words.push({ n: Math.min(24, [...w].length), rel: (marked.size ? marked.has(norm(w)) : roll < relevant) ? 1 : 0 });
    }
    if (words.length || (lines.length && lines[lines.length - 1].length)) lines.push(words);
  }
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** Pasted words as tokens: a block as long as the word, wrapped to the width, then arranged by the layout. */
function fromText(f: Field, lines: Word[][], layout: Layout): Tok[] {
  const { seed, ax, ay, W, H, rows } = f;
  const out: Tok[] = [];
  const cell = 2.1, space = 0.9;
  const share = clamp(f.length, 0.2, 1);

  /** Greedy wrap at character size c: each word's row and offset along it. */
  const flow = (c: number) => {
    const placed: { row: number; x: number; w: number; word: Word }[] = [];
    let row = 0;
    lines.forEach((line, li) => {
      if (li) row++;
      let x = 0;
      for (const word of line) {
        const w = Math.min(word.n * c, W);
        if (x > 0 && x + w > W + 1e-9) {
          row++;
          x = 0;
        }
        placed.push({ row, x, w, word });
        x += w + space * c;
      }
    });
    return { placed, rows: row + 1 };
  };

  if (layout === 'radial') {
    // Words flow outward along rays, each ray taking an equal share of the characters.
    const words = lines.flat();
    const rays = Math.max(1, Math.min(words.length, rows));
    const budget = words.reduce((s, w) => s + w.n + space, 0) / rays;
    const used: number[] = Array(rays).fill(0);
    let seen = 0;
    const along = words.map((word, i) => {
      const ray = Math.min(rays - 1, Math.floor(seen / budget));
      const from = used[ray];
      used[ray] += word.n + space;
      seen += word.n + space;
      return { ray, from, word, i };
    });
    const unit = (1 - HOLE) / Math.max(1, ...used);
    for (const { ray, from, word, i } of along) {
      const a = (TAU * ray) / rays;
      const [r0, r1] = [HOLE + from * unit, HOLE + (from + word.n * share) * unit];
      const e = f.strength(((r0 + r1) / 2) * Math.cos(a), ((r0 + r1) / 2) * Math.sin(a));
      if (word.rel || rand(seed, S.keep, ray, i) < 0.35 + 0.65 * f.keep(e)) out.push(between(f, onRay(f, a, r0), onRay(f, a, r1), f.rowZ(ray), word.rel));
    }
    return out;
  }

  // The largest character size whose wrapped text still fits the height (and is not absurdly big for a short text).
  let lo = 0, hi = layout === 'window' ? W / 24 : W / 16;
  for (let it = 0; it < 28; it++) {
    const mid = (lo + hi) / 2;
    if (flow(mid).rows * cell * mid <= H) lo = mid;
    else hi = mid;
  }
  const c = Math.max(lo, 1e-4), rowH = cell * c;
  const { placed, rows: used } = flow(c);
  // A window starts at the top like text; a burst centres the text block on its core.
  const top = layout === 'window' ? ay : (used * rowH) / 2;
  placed.forEach(({ row, x, w, word }, i) => {
    const y = top - (row + 0.5) * rowH;
    let len = w * share;
    if (layout === 'burst') {
      const e = f.strength((-ax + x + w / 2) / ax, y / ay);
      // Pasted words thin out less than generated tokens, so the text stays mostly readable.
      if (!word.rel && rand(seed, S.keep, row, i) >= 0.35 + 0.65 * f.keep(e)) return;
      len *= lerp(0.35, 1, Math.pow(e, 0.6));
    }
    out.push({ x: -ax + x + len / 2, y, z: layout === 'window' ? 0 : f.rowZ(row), len: Math.max(len, 1e-3), thick: f.height * rowH, ang: 0, rel: word.rel });
  });
  return out;
}

export const context: SourceDef = {
  kind: 'context',
  name: 'Context',
  blurb: 'A context window as geometry: tokens, relevance and reading order',
  params: [
    {
      key: 'text', label: 'Text', kind: 'text', multiline: true, maxLength: 4000, placeholder: 'Paste a prompt, document or transcript',
      help: 'Each word becomes a block as long as the word. Empty makes generated tokens',
    },
    {
      key: 'layout', label: 'Layout', kind: 'select',
      options: [{ value: 'window', label: 'Window' }, { value: 'burst', label: 'Burst' }, { value: 'radial', label: 'Radial' }],
      help: 'Rows like text; rows thinning from a dense core; tokens on rays from the centre',
    },
    { key: 'tokens', label: 'Tokens', kind: 'range', min: 20, max: 3000, step: 10, help: 'Generated tokens only' },
    { key: 'rows', label: 'Rows', kind: 'range', min: 4, max: 160, step: 1, help: 'Also the number of rays. Pasted text wraps to the width instead' },
    { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.25, max: 4, step: 0.01 },
    { key: 'length', label: 'Length', kind: 'range', min: 0.2, max: 3, step: 0.01, help: 'Average token length. For pasted text, the share of each word a block fills' },
    { key: 'variance', label: 'Variance', kind: 'range', min: 0, max: 1, step: 0.01, help: 'How much token lengths differ' },
    { key: 'height', label: 'Height', kind: 'range', min: 0.05, max: 1, step: 0.01, help: 'Block height as a share of the row spacing' },
    { key: 'density', label: 'Density', kind: 'range', min: 0, max: 1, step: 0.01, help: 'How full the rows are' },
    { key: 'falloff', label: 'Falloff', kind: 'range', min: 0, max: 1, step: 0.01, when: { key: 'layout', in: ['burst', 'radial'] }, help: 'How fast the field thins from the core' },
    { key: 'relevant', label: 'Relevant', kind: 'range', min: 0, max: 1, step: 0.01, help: 'Share of tokens marked relevant (family 1)' },
    { key: 'highlight', label: 'Highlight', kind: 'text', placeholder: 'word, another', help: 'Pasted text only: these words are the relevant ones. Empty uses the share above' },
    {
      key: 'mark', label: 'Mark', kind: 'select',
      options: [{ value: 'block', label: 'Block' }, { value: 'line', label: 'Line' }, { value: 'dot', label: 'Dot' }],
      help: 'Blocks need style fill "shapes" to be solid; dots need markers',
    },
    { key: 'seed', label: 'Seed', kind: 'seed' },
  ],
  defaults: {
    text: '', layout: 'window', tokens: 600, rows: 48, aspect: 1, length: 1, variance: 0.6, height: 0.55,
    density: 0.7, falloff: 0.6, relevant: 0.08, highlight: '', mark: 'block', seed: 7,
  },
  build(p) {
    const layout = str(p, 'layout') as Layout;
    const mark = str(p, 'mark') as Mark;
    const seed = int(p, 'seed');
    const v = (key: string, lo: number, hi: number) => clamp(num(p, key) || 0, lo, hi);
    const ax = Math.sqrt(v('aspect', 0.05, 20)), ay = 1 / ax;
    const rows = Math.round(v('rows', 1, 160));
    const variance = v('variance', 0, 1), density = v('density', 0, 1), falloff = v('falloff', 0, 1);
    const k = 0.6 + 2.4 * falloff;
    const f: Field = {
      seed, ax, ay, W: 2 * ax, H: 2 * ay, rows, tokens: Math.round(v('tokens', 1, MAX_TOKENS)),
      length: v('length', 0.05, 6), variance, height: v('height', 0.02, 1), density, relevant: v('relevant', 0, 1),
      pitch: (2 * ay) / rows,
      strength(nx, ny) {
        const a = Math.atan2(ny, nx), [cx, sy] = [Math.cos(a), Math.sin(a)];
        // A wobble that depends on the angle gives the burst ragged rays rather than a smooth blob; a finer one clumps it.
        const wobble = Math.max(0.35, 0.45 + 1.1 * vnoise(seed, 11, cx * 2.6 + 8, sy * 2.6 + 8) + 0.35 * (vnoise(seed, 12, cx * 6 + 8, sy * 6 + 8) - 0.5));
        const clump = 0.8 + 0.5 * vnoise(seed, 13, nx * 3.1 + 8, ny * 3.1 + 8);
        const x = (Math.hypot(nx, ny) * k) / wobble;
        // A wide, flat core (the Gaussian) with a long thin tail of stragglers (the exponential).
        return clamp(clump * (0.8 * Math.exp(-x * x) + 0.35 * Math.exp(-1.2 * x)), 0, 1);
      },
      keep: (e) => clamp(e * density * 2, 0, 1),
      longer: (e) => lerp(0.1, 3.5, Math.pow(e, 0.9)),
      spread(a, b) {
        const sigma = variance * 0.9;
        const g = (rand(seed, S.len, a, b) + rand(seed, S.len + 1, a, b) + rand(seed, S.len + 2, a, b) - 1.5) * 2;
        return Math.exp(sigma * g - (sigma * sigma) / 2);
      },
      rowZ: (j) => (layout === 'window' ? 0 : (rand(seed, S.depth, j) - 0.5) * 0.1),
    };

    const text = str(p, 'text');
    const words = text.trim() ? parseText(text, str(p, 'highlight'), f.relevant, seed) : [];
    const toks = words.length ? fromText(f, words, layout) : layout === 'burst' ? burstRows(f) : layout === 'radial' ? rays(f) : windowRows(f);

    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    toks.forEach((tk, i) => {
      const t = toks.length > 1 ? i / (toks.length - 1) : 0;
      const [c, s] = [Math.cos(tk.ang), Math.sin(tk.ang)];
      const at = (u: number, w: number): [number, number, number] => [tk.x + u * c - w * s, tk.y + u * s + w * c, tk.z];
      const [hl, ht] = [tk.len / 2, tk.thick / 2];
      if (mark === 'block') lines.push({ pts: [at(-hl, -ht), at(hl, -ht), at(hl, ht), at(-hl, ht)], closed: true, t: [t, t, t, t], family: tk.rel });
      else if (mark === 'line') lines.push({ pts: [at(-hl, 0), at(hl, 0)], t: [t, t], family: tk.rel });
      nodes.push({ p: [tk.x, tk.y, tk.z], t, family: tk.rel });
    });
    return { lines, nodes };
  },
};
