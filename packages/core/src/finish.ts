import { clamp } from './math.js';
import type { Finish, Style } from './types.js';

/**
 * Finishes: SVG filters that give a whole form a material. Every primitive here (turbulence, displacement,
 * blur, colour matrix, composite) is drawn the same by browsers and by resvg, so previews match the app.
 *
 * Sizes are in artboard pixels and tuned for an artboard 1000 to 1600 px wide; `finishScale` multiplies every
 * feature size, `finishAmount` how strongly the finish works.
 */

export const FINISHES: readonly Finish[] = ['clean', 'ink', 'grain', 'rough'];
export const FINISH_ID_PREFIX = 'vectr-fin-';

/** A rectangle in artboard pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** FNV-1a, in base 36: short, stable, and made only of characters that are safe in an id. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A filter's recipe: its primitives, and how far (in pixels) it can move ink from where the form drew it. */
interface Recipe {
  body: string;
  reach: number;
}

/** A turbulence field. Low frequencies are broad, slow wobbles; high ones are grain. */
const noise = (freq: string, octaves: number, seed: number, result: string) =>
  `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" result="${result}"/>`;

const displace = (src: string, map: string, scale: number, x: 'R' | 'G' | 'B', y: 'R' | 'G' | 'B', result: string) =>
  `<feDisplacementMap in="${src}" in2="${map}" scale="${f3(scale)}" xChannelSelector="${x}" yChannelSelector="${y}" result="${result}"/>`;

/** Alpha taken from the noise's red channel: `gain` × red − `offset`, colour dropped. */
const mask = (src: string, gain: number, offset: number, result: string) =>
  `<feColorMatrix in="${src}" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${f3(gain)} 0 0 0 ${f3(-offset)}" result="${result}"/>`;

const RECIPES: Record<Exclude<Finish, 'clean'>, (a: number, s: number, seed: number) => Recipe> = {
  // Pieces that sit close are fused into solid ink (a blur, then a cut on the alpha), and the fused mass is torn at its edge
  // (displacement) while the original pieces ride on top, so droplets and the thinnest streaks survive the fusing. The inside of
  // the mass is solid and the colours stay where they were drawn.
  ink(a, s, seed) {
    const blur = lerp(2.2, 6, a) * s, wobble = lerp(5, 18, a) * s, bristle = lerp(3, 11, a) * s;
    return {
      reach: wobble / 2 + bristle / 2 + 3 * blur,
      body:
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${f3(blur)}" result="soft"/>` +
        `<feColorMatrix in="soft" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -6.4" result="fused"/>` +
        // The fused mass takes the pieces' own colours where they reach, and a blend only in the gaps they were fused across.
        `<feMorphology in="SourceGraphic" operator="dilate" radius="${Math.max(1, Math.round(blur))}" result="spread"/>` +
        `<feComposite in="spread" in2="fused" operator="in" result="paint"/>` +
        `<feMerge result="mass"><feMergeNode in="fused"/><feMergeNode in="paint"/></feMerge>` +
        // The same two displacements move the mass and the pieces, so the finest detail stays on the mass's edge.
        noise(f3(0.016 / s), 2, seed, 'tear') + noise(f3(0.13 / s), 1, seed + 17, 'fray') +
        displace('mass', 'tear', wobble, 'R', 'G', 'a1') + displace('a1', 'fray', bristle, 'G', 'B', 'a2') +
        displace('SourceGraphic', 'tear', wobble, 'R', 'G', 'b1') + displace('b1', 'fray', bristle, 'G', 'B', 'b2') +
        // A last short blur and cut smooths the stair-steps the displacement leaves on the mass.
        `<feGaussianBlur in="a2" stdDeviation="${f3(0.9 * s)}" result="edge"/>` +
        `<feColorMatrix in="edge" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -6.6" result="body"/>` +
        `<feMerge><feMergeNode in="body"/><feMergeNode in="b2"/></feMerge>`,
    };
  },
  // Dry brush and worn print: the edges are roughened, then two masks cut the fill: fine speckle, like the tooth of paper, and
  // long thin streaks, like the drag of a brush. Each is noise cut hard, so the fill is either there or not. At the default
  // amount most of it is still there.
  grain(a, s, seed) {
    const rough = lerp(1.5, 5, a) * s;
    return {
      reach: rough,
      body:
        noise(f3(0.3 / s), 3, seed, 'tooth') + displace('SourceGraphic', 'tooth', rough, 'R', 'G', 'worn') +
        mask('tooth', 40, 40 * lerp(0.2, 0.44, a), 'speckle') +
        noise(`${f3(0.006 / s)} ${f3(0.18 / s)}`, 2, seed + 31, 'drag') + mask('drag', 40, 40 * lerp(0.12, 0.38, a), 'streak') +
        `<feComposite in="worn" in2="speckle" operator="in" result="grit"/>` +
        `<feComposite in="grit" in2="streak" operator="in"/>`,
    };
  },
  // Displacement and nothing else: the form's edges wobble as if drawn by hand.
  rough(a, s, seed) {
    const wobble = lerp(1.5, 14, a) * s;
    return { reach: wobble, body: noise(f3(0.045 / s), 2, seed, 'wobble') + displace('SourceGraphic', 'wobble', wobble, 'R', 'G', 'out') };
  },
};

/**
 * The filter for a form's finish, with the id that names it, or null for a clean form (or one with nothing to filter).
 * The region is the form's box plus the most the finish can move ink, cut to the visible `view` when there is one (pieces
 * that fly far off the artboard would otherwise make the filter work on a canvas several times its size). The id hashes
 * everything the filter depends on, region included, so identical forms share one id and different filters never collide.
 */
export function finishFilter(
  st: Pick<Style, 'finish' | 'finishAmount' | 'finishScale' | 'finishSeed'>,
  box: Box,
  view?: Box,
): { id: string; defs: string } | null {
  const kind = st.finish;
  if (kind === 'clean' || !FINISHES.includes(kind)) return null;
  const amount = clamp(Number(st.finishAmount) || 0, 0, 1);
  // The style range is 0.2 to 4; the filter allows more, so a caller drawing a thumbnail can shrink the finish to fit.
  const scale = clamp(Number(st.finishScale) || 1, 0.02, 8);
  const seed = Math.round(clamp(Number(st.finishSeed) || 1, 1, 999));
  const { body, reach } = RECIPES[kind](amount, scale, seed);
  const pad = 0.12 * Math.max(box.w, box.h) + reach + 24;
  let [x0, y0, x1, y1] = [box.x - pad, box.y - pad, box.x + box.w + pad, box.y + box.h + pad];
  if (view) {
    // Ink can only come from `reach` away, so nothing farther than that outside the view matters.
    const m = reach + 8;
    [x0, y0, x1, y1] = [Math.max(x0, view.x - m), Math.max(y0, view.y - m), Math.min(x1, view.x + view.w + m), Math.min(y1, view.y + view.h + m)];
  }
  const [x, y] = [Math.floor(x0), Math.floor(y0)];
  const [w, h] = [Math.max(1, Math.ceil(x1 - x)), Math.max(1, Math.ceil(y1 - y))];
  const id = FINISH_ID_PREFIX + hash([kind, f3(amount), f3(scale), seed, x, y, w, h].join('|'));
  return {
    id,
    defs: `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" color-interpolation-filters="sRGB">${body}</filter></defs>`,
  };
}
