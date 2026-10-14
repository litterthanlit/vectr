import { DEG, clamp, int, num, str } from '../math.js';
import { cleanText } from '../render.js';
import type { GeoNode, ParamDef, Polyline, SourceDef } from '../types.js';
import { BITE, EPS, fillet, tidy, type Corner, type Pt } from './shapes.js';
import { highlightSet, isRelevant, norm, rand } from './words.js';

type Mode = 'pattern' | 'generate' | 'text';
type End = 'square' | 'slant' | 'round';
type Align = 'center' | 'top' | 'bottom';

/** One thing along a row, `n` units long (for a gap, `n` gaps). Slabs and necks chain into runs; a gap breaks the chain. */
interface Item {
  kind: 'slab' | 'neck' | 'gap';
  n: number;
  rel: 0 | 1;
}

/** A slab or neck placed in the field. A stub is a zero-length neck that stands for a slab's neighbour when drawing the slab alone. */
interface Seg {
  kind: 'slab' | 'neck';
  x0: number;
  x1: number;
  rel: 0 | 1;
  stub?: boolean;
}

/** Everything the outline of a run depends on, in field units. */
interface Look {
  /** Slab height, and neck height. */
  h: number;
  nh: number;
  align: Align;
  /** Horizontal run of a ramp per unit of height (0 = vertical step), and which edges ramp. */
  run: number;
  ramps: [boolean, boolean];
  /** Tangent of the slant. */
  lean: number;
  start: End;
  finish: End;
  radius: number;
  /** Arc segments per quarter turn of a fillet; 0 leaves corners sharp. */
  res: number;
}

const MAX_ROWS = 160;
const MAX_SLABS = 3200;
const MAX_WORDS = 3000;
/** Points a form may use before the fillets are made coarser. */
const POINTS = 34_000;
/** Generated strips: the mean and least slab length, and the neck length, in units. */
const MEAN = 6, LEAST = 3, NECK = 2;
/** Row pitch, in units, of an unhurried row: a text line is about this tall. Generated rows have no such limit. */
const CELL = { pattern: 2.2, text: 2.2, generate: 6 } as const;

/** Streams of random numbers, one per decision (a slab's length takes three). */
const S = { len: 3, rel: 8, joint: 9, short: 10, word: 40 } as const;

const opt = (...v: string[]) => v.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }));
const only = (...v: Mode[]) => ({ key: 'mode', in: v });

const params: ParamDef[] = [
  {
    key: 'mode', label: 'Mode', kind: 'select',
    options: [{ value: 'pattern', label: 'Pattern' }, { value: 'generate', label: 'Generate' }, { value: 'text', label: 'Text' }],
    help: 'Draw a pattern you type, generated rows, or the words of a text',
  },
  {
    key: 'pattern', label: 'Pattern', kind: 'text', multiline: true, maxLength: 4000, placeholder: '#####---######', when: only('pattern'),
    help: '# is a slab, - a neck, a space or . a gap, one unit each. A new line starts a new row',
  },
  { key: 'rows', label: 'Rows', kind: 'range', min: 1, max: 80, step: 1, when: only('generate') },
  { key: 'segments', label: 'Segments', kind: 'range', min: 2, max: 40, step: 1, when: only('generate'), help: 'Slabs per row' },
  { key: 'variance', label: 'Variance', kind: 'range', min: 0, max: 1, step: 0.01, when: only('generate'), help: 'How much slab lengths differ' },
  { key: 'necks', label: 'Necks', kind: 'range', min: 0, max: 1, step: 0.01, when: only('generate'), help: 'Share of joints that are necks rather than gaps' },
  {
    key: 'text', label: 'Text', kind: 'text', multiline: true, maxLength: 4000, placeholder: 'Paste a prompt, document or transcript', when: only('text'),
    help: 'Each word becomes a slab as long as the word. A space is a neck; a sentence end or a double space is a gap; a new line starts a new row',
  },
  { key: 'columns', label: 'Columns', kind: 'range', min: 8, max: 120, step: 1, when: only('text'), help: 'Characters per row before the text wraps' },
  { key: 'highlight', label: 'Highlight', kind: 'text', placeholder: 'word, another', when: only('text'), help: 'These words are the relevant ones. Empty uses the share below' },
  { key: 'relevant', label: 'Relevant', kind: 'range', min: 0, max: 1, step: 0.01, when: only('generate', 'text'), help: 'Share of slabs marked relevant (family 1)' },
  { key: 'seed', label: 'Seed', kind: 'seed', when: only('generate', 'text') },
  { key: 'height', label: 'Height', kind: 'range', min: 0.1, max: 1, step: 0.01, help: 'Slab height as a share of the row spacing' },
  { key: 'neck', label: 'Neck', kind: 'range', min: 0.1, max: 0.9, step: 0.01, help: 'Neck height as a share of the slab height' },
  { key: 'neckAlign', label: 'Neck position', kind: 'select', options: opt('center', 'top', 'bottom') },
  { key: 'ramp', label: 'Ramp', kind: 'range', min: 0, max: 75, step: 1, unit: '°', help: 'Slope where a neck meets a slab, from horizontal. 0 is a vertical step' },
  {
    key: 'rampEdge', label: 'Ramp on', kind: 'select', options: opt('both', 'top', 'bottom'),
    help: 'Which edge of each slab and neck joint slopes; the other edge steps',
  },
  { key: 'corner', label: 'Corner', kind: 'range', min: 0, max: 0.5, step: 0.01, help: 'Corner radius as a share of the slab height' },
  { key: 'startEnd', label: 'Start end', kind: 'select', options: opt('square', 'slant', 'round') },
  { key: 'finishEnd', label: 'Finish end', kind: 'select', options: opt('square', 'slant', 'round') },
  { key: 'slant', label: 'Slant', kind: 'range', min: 0, max: 60, step: 1, unit: '°', help: 'Slanted ends lean this far from vertical, the bottom corner reaching past the top on the finish end' },
  { key: 'gap', label: 'Gap', kind: 'range', min: 0.05, max: 3, step: 0.01, help: 'Length of a gap, as a multiple of the slab height' },
  { key: 'aspect', label: 'Aspect', kind: 'range', min: 0.25, max: 4, step: 0.01 },
  { key: 'align', label: 'Align', kind: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }], help: 'Where rows of different lengths sit' },
];

// ---------------------------------------------------------------------------------------------------------------------
// Rows of items

/** A pattern as rows: '#' a slab, '-' a neck, anything else a gap, runs of the same character making one longer item. */
function patternRows(pattern: string): Item[][] {
  return cleanText(pattern).split('\n').slice(0, MAX_ROWS).map((line) => {
    const row: Item[] = [];
    for (const ch of line) {
      const kind = ch === '#' ? 'slab' : ch === '-' ? 'neck' : 'gap';
      const last = row[row.length - 1];
      if (last?.kind === kind) last.n++;
      else row.push({ kind, n: 1, rel: 0 });
    }
    return row;
  });
}

/** Spread of slab lengths with mean 1: lognormal, from a roughly normal draw made of three uniforms. */
const spread = (seed: number, sigma: number, j: number, i: number) => {
  const g = (rand(seed, S.len, j, i) + rand(seed, S.len + 1, j, i) + rand(seed, S.len + 2, j, i) - 1.5) * 2;
  return Math.exp(sigma * g - (sigma * sigma) / 2);
};

/**
 * Generated rows: a fixed number of slabs each, joined by necks or broken by gaps. Slab lengths are drawn around a mean,
 * then each row is scaled to a common length (a few stop short, like the last line of a paragraph), so the rows sit in a block
 * with a ragged edge rather than at random lengths. Every decision has its own draw.
 */
function generatedRows(rows: number, segments: number, variance: number, necks: number, relevant: number, seed: number): Item[][] {
  const sigma = variance * 0.9;
  return Array.from({ length: rows }, (_, j) => {
    const f = Array.from({ length: segments }, (_, i) => spread(seed, sigma, j, i));
    const scale = (MEAN * segments * (1 - 0.55 * variance * rand(seed, S.short, j) ** 3)) / f.reduce((a, b) => a + b, 0);
    const row: Item[] = [];
    for (let i = 0; i < segments; i++) {
      row.push({ kind: 'slab', n: Math.max(LEAST, Math.round(f[i] * scale)), rel: rand(seed, S.rel, j, i) < relevant ? 1 : 0 });
      if (i < segments - 1) {
        const neck = rand(seed, S.joint, j, i) < necks;
        row.push({ kind: neck ? 'neck' : 'gap', n: neck ? NECK : 1, rel: 0 });
      }
    }
    return row;
  });
}

/** A word that ends a sentence, possibly inside a closing quote or bracket. */
const ENDS = /[.!?…]["'”’)\]]*$/;

/**
 * The words of a text as rows. A word is a slab as long as its letters; the joint after it is a neck, or a gap after a
 * sentence end or a double space. Rows wrap at `columns` characters and a new line starts a new row (blank lines collapse to one).
 */
function textRows(text: string, highlight: string, share: number, seed: number, columns: number): Item[][] {
  const marked = highlightSet(highlight);
  const rows: Item[][] = [];
  let count = 0, blank = false;
  for (const line of cleanText(text).split('\n')) {
    let row: Item[] = [], used = 0, gap = false, any = false;
    for (const [, word, space] of line.matchAll(/(\S+)(\s*)/g)) {
      const n = Math.min(24, [...norm(word)].length);
      if (!n || count >= MAX_WORDS) continue;
      const w = Math.min(n, columns), rel = isRelevant(marked, word, rand(seed, S.word, count++), share);
      if (row.length && used + 1 + w > columns) {
        rows.push(row);
        row = [];
        used = 0;
      } else if (row.length) {
        row.push({ kind: gap ? 'gap' : 'neck', n: 1, rel: 0 });
        used++;
      }
      row.push({ kind: 'slab', n: w, rel });
      used += w;
      gap = ENDS.test(word) || space.length > 1 || space.includes('\t');
      any = true;
    }
    if (any) {
      rows.push(row);
      blank = false;
    } else if (rows.length && !blank) {
      rows.push([]);
      blank = true;
    }
  }
  return rows;
}

/** Drop trailing gaps and empty rows at the end, and anything past the caps. */
function trim(rows: Item[][]): Item[][] {
  let slabs = 0;
  const out = rows.slice(0, MAX_ROWS).map((row) => {
    const kept: Item[] = [];
    for (const it of row) {
      if (it.kind === 'slab' && ++slabs > MAX_SLABS) break;
      kept.push(it);
    }
    while (kept.length && kept[kept.length - 1].kind === 'gap') kept.pop();
    return kept;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Outlines

/** Top and bottom of a segment in a row whose slabs are centred on `yc`. */
function span(s: Seg, yc: number, k: Look): [number, number] {
  if (s.kind === 'slab') return [yc + k.h / 2, yc - k.h / 2];
  if (k.align === 'top') return [yc + k.h / 2, yc + k.h / 2 - k.nh];
  if (k.align === 'bottom') return [yc - k.h / 2 + k.nh, yc - k.h / 2];
  return [yc + k.nh / 2, yc - k.nh / 2];
}

/**
 * The outline of a chain of slabs and necks, as a polygon: along the top edge left to right, then back along the bottom.
 * Where a slab meets a neck the edge steps, or ramps when the ramp sits on that edge; the ramp lies on the slab, so a
 * neck is always exactly as long as it was asked to be. Then the ends are cut and every corner is rounded.
 */
function outline(segs: Seg[], yc: number, k: Look, start: End, finish: End): Pt[] {
  const first = segs[0], last = segs[segs.length - 1];
  /** One edge, left to right: 0 is the top, 1 the bottom. */
  const edge = (e: 0 | 1): Corner[] => {
    const y = (s: Seg) => span(s, yc, k)[e];
    // A stub's own corner is no corner of the slab beside it unless their edges are level.
    const own = (s: Seg, other: Seg) => (s.stub && Math.abs(y(s) - y(other)) > EPS ? 0 : k.radius);
    const pts: Corner[] = [{ x: first.x0, y: y(first), r: own(first, segs[Math.min(1, segs.length - 1)]) }];
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i], b = segs[i + 1], xb = a.x1, ya = y(a), yb = y(b);
      if (Math.abs(ya - yb) < EPS) continue;
      const slab = a.kind === 'slab' ? a : b;
      const run = k.ramps[e] ? Math.min(Math.abs(ya - yb) * k.run, BITE * (slab.x1 - slab.x0)) : 0;
      const ra = a.stub ? 0 : k.radius, rb = b.stub ? 0 : k.radius;
      if (a.kind === 'slab') pts.push({ x: xb - run, y: ya, r: ra }, { x: xb, y: yb, r: rb });
      else pts.push({ x: xb, y: ya, r: ra }, { x: xb + run, y: yb, r: rb });
    }
    pts.push({ x: last.x1, y: y(last), r: own(last, segs[Math.max(0, segs.length - 2)]) });
    return pts;
  };
  const top = edge(0), bottom = edge(1);
  /** How far a slanted end's top corner is pulled in from its bottom corner. */
  const lean = (s: Seg) => Math.min((span(s, yc, k)[0] - span(s, yc, k)[1]) * k.lean, BITE * (s.x1 - s.x0));
  if (start === 'slant' && !first.stub) top[0].x += lean(first);
  if (finish === 'slant' && !last.stub) top[top.length - 1].x -= lean(last);
  // A round end is a corner as big as half the end's height, so the two corners make a semicircle.
  const cap = (s: Seg) => (span(s, yc, k)[0] - span(s, yc, k)[1]) / 2;
  if (start === 'round' && !first.stub) top[0].r = bottom[0].r = cap(first);
  if (finish === 'round' && !last.stub) top[top.length - 1].r = bottom[bottom.length - 1].r = cap(last);
  return fillet(tidy([...top, ...bottom.reverse()]), k.res);
}

const closed = (poly: Pt[], family: number, tAt: (x: number) => number): Polyline => ({
  pts: poly.map(([x, y]) => [x, y, 0]), closed: true, tone: 'front', family, t: poly.map(([x]) => tAt(x)),
});

// ---------------------------------------------------------------------------------------------------------------------

export const strip: SourceDef = {
  kind: 'strip',
  name: 'Strip',
  blurb: 'Hyphenated ribbons: slabs joined by necks, with ramps and slanted ends',
  params,
  defaults: {
    mode: 'pattern', pattern: '####--######', rows: 12, segments: 9, variance: 0.6, necks: 0.45,
    text: 'Everything the model can see sits inside one window. Most of it is background; a few passages carry the answer.',
    columns: 40, highlight: '', relevant: 0.1, seed: 5,
    height: 0.7, neck: 0.5, neckAlign: 'center', ramp: 30, rampEdge: 'bottom', corner: 0.08,
    startEnd: 'square', finishEnd: 'slant', slant: 18, gap: 0.4, aspect: 1.6, align: 'left',
  },
  build(p) {
    const mode = str(p, 'mode') as Mode;
    const v = (key: string, lo: number, hi: number) => clamp(num(p, key) || 0, lo, hi);
    const seed = int(p, 'seed');
    const ax = Math.sqrt(v('aspect', 0.05, 20)), ay = 1 / ax;
    const [W, H] = [2 * ax, 2 * ay];
    const height = v('height', 0.02, 1), gapShare = v('gap', 0, 10);
    const share = v('relevant', 0, 1);

    const raw = mode === 'generate'
      ? generatedRows(Math.round(v('rows', 1, 80)), Math.round(v('segments', 1, 40)), v('variance', 0, 1), v('necks', 0, 1), share, seed)
      : mode === 'text'
        ? textRows(str(p, 'text'), str(p, 'highlight'), share, seed, Math.round(v('columns', 4, 400)))
        : patternRows(str(p, 'pattern'));
    const rows = trim(raw);
    const stats = rows.map((row) => ({
      c: row.reduce((s, it) => s + (it.kind === 'gap' ? 0 : it.n), 0),
      g: row.reduce((s, it) => s + (it.kind === 'gap' ? it.n : 0), 0),
    }));
    const live = stats.filter((r) => r.c > 0);
    if (!live.length) return { lines: [], nodes: [] };

    // Fit the widest row to the field, and the rows into its height, without letting a few rows swell past a text line.
    const cell = CELL[mode] ?? CELL.pattern, k = gapShare * height;
    const pitch = Math.min(H / rows.length, ...live.map((r) => (cell * W) / (r.c + cell * k * r.g)));
    const unit = Math.min(...live.map((r) => (W - r.g * k * pitch) / r.c));
    const h = height * pitch, gapLen = gapShare * h;

    // Fillets get coarser as the number of slabs grows, so a full field stays within the point budget.
    const slabs = rows.reduce((s, row) => s + row.filter((it) => it.kind === 'slab').length, 0);
    const marked = rows.reduce((s, row) => s + row.filter((it) => it.kind === 'slab' && it.rel).length, 0);
    const res = clamp(Math.floor((POINTS / (slabs + 0.6 * marked) - 12) / 11), 0, 8);

    const rampDeg = v('ramp', 0, 80);
    const edgeSel = str(p, 'rampEdge');
    const look: Look = {
      h, nh: h * v('neck', 0.05, 0.95), align: str(p, 'neckAlign') as Align,
      run: rampDeg < 0.5 ? 0 : 1 / Math.tan(rampDeg * DEG),
      ramps: [edgeSel !== 'bottom', edgeSel !== 'top'],
      lean: Math.tan(v('slant', 0, 80) * DEG),
      start: str(p, 'startEnd') as End, finish: str(p, 'finishEnd') as End,
      radius: v('corner', 0, 0.5) * h, res,
    };
    const centre = str(p, 'align') === 'center';

    const lines: Polyline[] = [];
    const nodes: GeoNode[] = [];
    const overlays: { segs: Seg[]; yc: number; tAt: (x: number) => number }[] = [];
    rows.forEach((row, j) => {
      const yc = (rows.length * pitch) / 2 - (j + 0.5) * pitch;
      let x = centre ? -stats[j].c * unit / 2 - stats[j].g * gapLen / 2 : -ax;
      const runs: Seg[][] = [];
      let run: Seg[] = [];
      for (const it of row) {
        if (it.kind === 'gap') {
          if (run.length) runs.push(run);
          run = [];
          x += it.n * gapLen;
        } else {
          run.push({ kind: it.kind, x0: x, x1: x + it.n * unit, rel: it.rel });
          x += it.n * unit;
        }
      }
      if (run.length) runs.push(run);
      if (!runs.length) return;
      // t runs from 0 at the start of a row's marks to 1 at the end of them.
      const x0 = runs[0][0].x0, x1 = runs[runs.length - 1][runs[runs.length - 1].length - 1].x1;
      const tAt = (px: number) => (x1 - x0 > EPS ? clamp((px - x0) / (x1 - x0), 0, 1) : 0);
      for (const r of runs) {
        const poly = outline(r, yc, look, look.start, look.finish);
        if (poly.length >= 3) lines.push(closed(poly, 0, tAt));
        r.forEach((s, i) => {
          if (s.kind !== 'slab') return;
          const cx = (s.x0 + s.x1) / 2;
          nodes.push({ p: [cx, yc, 0], t: tAt(cx), family: s.rel });
          if (!s.rel) return;
          // The slab alone, with a stub where a neck was, so its sides and ramps match the outline it sits on.
          const stub = (at: number): Seg => ({ kind: 'neck', x0: at, x1: at, rel: 0, stub: true });
          const segs = [...(i ? [stub(s.x0)] : []), s, ...(i < r.length - 1 ? [stub(s.x1)] : [])];
          overlays.push({ segs, yc, tAt });
        });
      }
    });
    // Relevant slabs are drawn after every other outline, so a family colour paints them on top.
    for (const o of overlays) {
      const poly = outline(o.segs, o.yc, look, o.segs[0].stub ? 'square' : look.start, o.segs[o.segs.length - 1].stub ? 'square' : look.finish);
      if (poly.length >= 3) lines.push(closed(poly, 1, o.tAt));
    }
    return { lines, nodes };
  },
};
