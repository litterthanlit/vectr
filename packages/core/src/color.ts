/**
 * Colour utilities. Ramps interpolate in OKLab, which keeps gradients perceptually
 * even (no muddy midpoints between saturated stops).
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v.trim());

export function normalizeHex(v: string): string {
  let h = v.trim().toLowerCase();
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLab(hex: string): Lab {
  const h = normalizeHex(hex);
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const labCache = new Map<string, Lab>();
const lab = (hex: string) => {
  let v = labCache.get(hex);
  if (!v) {
    v = hexToLab(hex);
    labCache.set(hex, v);
  }
  return v;
};

/** Colour at position t (0–1) along a ramp of hex stops. */
export function sampleRamp(stops: string[], t: number): string {
  if (stops.length === 0) return '#000000';
  if (stops.length === 1) return normalizeHex(stops[0]);
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = lab(stops[i]), b = lab(stops[i + 1]);
  return labToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** Relative luminance-ish lightness (OKLab L), 0–1. */
export const lightness = (hex: string) => lab(normalizeHex(hex))[0];

/**
 * A UI accent drawn from a ramp: the most colourful stop that still reads on a dark
 * interface (OKLab L ≥ 0.6), lifted in lightness if every stop is too dark.
 */
export function accentFrom(stops: string[]): string {
  const scored = stops.filter(isHex).map((h) => {
    const [L, a, b] = lab(normalizeHex(h));
    return { h: normalizeHex(h), L, a, b, c: Math.hypot(a, b) };
  });
  if (!scored.length) return '#9da3b4';
  const readable = scored.filter((s) => s.L >= 0.6);
  if (readable.length) return readable.sort((x, y) => y.c - x.c)[0].h;
  const best = scored.sort((x, y) => y.c - x.c || y.L - x.L)[0];
  return labToHex([Math.max(0.68, best.L), best.a, best.b]);
}
