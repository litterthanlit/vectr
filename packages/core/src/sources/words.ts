/** Helpers shared by the sources that turn text into marks (context, strip). */

/**
 * A stateless random number in [0, 1) for a seed, a stream and two indices. Every row, slot and
 * stream draws its own, so changing the token count or any one param never reshuffles the rest.
 */
export function rand(seed: number, stream: number, a = 0, b = 0): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x7f4a7c15;
  for (const v of [stream, a, b]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Normalise a word for matching: lower case, punctuation off both ends. */
export const norm = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** The words of a comma- or space-separated highlight list, normalised. */
export const highlightSet = (highlight: string) => new Set(highlight.split(/[,\s]+/).map(norm).filter(Boolean));

/**
 * Whether a word is relevant: it is in the highlight list, or, with no list, a seeded `roll` (a number from `rand`)
 * falls under the `share`.
 */
export const isRelevant = (marked: Set<string>, word: string, roll: number, share: number): 0 | 1 =>
  (marked.size ? marked.has(norm(word)) : roll < share) ? 1 : 0;
