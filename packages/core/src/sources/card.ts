import { DEG, TAU, clamp, num, str, bool } from '../math.js';
import type { GeoLabel, Polyline, SourceDef, Vec3 } from '../types.js';
import { rounded } from './curve.js';

type Icon = 'none' | 'globe' | 'orbit' | 'dial' | 'crosshair' | 'spiral';
type P2 = [number, number];

const ICONS = ['none', 'globe', 'orbit', 'dial', 'crosshair', 'spiral'] as const;

/** Sample f over [0, 1] into 2D points. */
const trace = (n: number, f: (u: number) => P2): P2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
/** An ellipse as an open polyline that ends exactly where it began. */
const ellipse = (rx: number, ry: number): P2[] => {
  const pts = Array.from({ length: 48 }, (_, i): P2 => [rx * Math.cos((TAU * i) / 48), ry * Math.sin((TAU * i) / 48)]);
  return [...pts, pts[0]];
};

/** Icon strokes in glyph space, where the glyph fits a circle of radius 1. Every stroke is open. */
function glyph(icon: Icon): P2[][] {
  switch (icon) {
    case 'globe': {
      // A small engraved globe: outline, two meridians, two parallels and a polar axis, tilted like a desk globe.
      const R = 0.8, par = 0.5 * R, half = Math.sqrt(R * R - par * par);
      const tilt = -20 * DEG, [c, s] = [Math.cos(tilt), Math.sin(tilt)];
      const turn = ([x, y]: P2): P2 => [x * c - y * s, x * s + y * c];
      const strokes: P2[][] = [
        ellipse(R, R), ellipse(R * 0.38, R), ellipse(R * 0.72, R),
        [[-half, par], [half, par]], [[-half, -par], [half, -par]],
        [[0, R], [0, 1]], [[0, -R], [0, -1]],
      ];
      return strokes.map((stroke) => stroke.map(turn));
    }
    case 'orbit': {
      const tilt = -25 * DEG, [c, s] = [Math.cos(tilt), Math.sin(tilt)];
      return [ellipse(0.28, 0.28), ellipse(1, 0.38).map(([x, y]): P2 => [x * c - y * s, x * s + y * c])];
    }
    case 'dial': {
      const ticks: P2[][] = Array.from({ length: 24 }, (_, i) => {
        const a = (TAU * i) / 24, r1 = i % 6 === 0 ? 1 : 0.9;
        return [[0.76 * Math.cos(a), 0.76 * Math.sin(a)], [r1 * Math.cos(a), r1 * Math.sin(a)]];
      });
      return [ellipse(0.68, 0.68), ...ticks];
    }
    case 'crosshair':
      return [ellipse(0.58, 0.58), [[1, 0], [0.3, 0]], [[-1, 0], [-0.3, 0]], [[0, 1], [0, 0.3]], [[0, -1], [0, -0.3]]];
    case 'spiral':
      return [trace(288, (u) => [u * Math.cos(3 * TAU * u), u * Math.sin(3 * TAU * u)])];
    default:
      return [];
  }
}

export const card: SourceDef = {
  kind: 'card',
  name: 'Card',
  blurb: 'A caption panel: frame, icon and wrapped text',
  params: [
    { key: 'text', label: 'Text', kind: 'text', multiline: true, placeholder: 'Caption' },
    { key: 'meta', label: 'Meta line', kind: 'text', placeholder: 'Meta (optional)', help: 'Small monospaced line in the top-right corner' },
    { key: 'width', label: 'Width', kind: 'range', min: 0.3, max: 4, step: 0.01 },
    { key: 'height', label: 'Height', kind: 'range', min: 0.2, max: 3, step: 0.01 },
    { key: 'padding', label: 'Padding', kind: 'range', min: 0, max: 0.5, step: 0.005 },
    { key: 'corner', label: 'Corner', kind: 'range', min: 0, max: 0.5, step: 0.01, help: 'Corner rounding' },
    { key: 'icon', label: 'Icon', kind: 'select', options: ICONS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { key: 'iconSize', label: 'Icon size', kind: 'range', min: 0.05, max: 0.6, step: 0.01, when: { key: 'icon', in: ['globe', 'orbit', 'dial', 'crosshair', 'spiral'] } },
    { key: 'align', label: 'Text position', kind: 'select', options: [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] },
    { key: 'frame', label: 'Frame', kind: 'toggle', help: 'Draw the border; with fill set to shapes this is what gets filled' },
  ],
  defaults: {
    text: 'A short caption\nfor this drawing', meta: '', width: 1.6, height: 0.9, padding: 0.1, corner: 0,
    icon: 'globe', iconSize: 0.18, align: 'bottom', frame: true,
  },
  build(p) {
    const w = clamp(num(p, 'width'), 0.05, 20), h = clamp(num(p, 'height'), 0.05, 20);
    const pad = clamp(num(p, 'padding'), 0, Math.min(w, h) / 2);
    const icon = str(p, 'icon') as Icon;
    const s = clamp(num(p, 'iconSize'), 0.01, 5);
    const strokes = glyph(icon), hasIcon = strokes.length > 0;
    const lines: Polyline[] = [];

    if (bool(p, 'frame')) {
      const verts: Vec3[] = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
      const pts = rounded(verts, clamp(num(p, 'corner'), 0, 0.5) * 2);
      lines.push({ pts, closed: true, tone: 'front', family: 0, t: pts.map((_, i) => i / pts.length) });
    }

    if (hasIcon) {
      const cx = -w / 2 + pad + s / 2, cy = h / 2 - pad - s / 2;
      for (const stroke of strokes) {
        const pts = stroke.map(([x, y]): Vec3 => [cx + (x * s) / 2, cy + (y * s) / 2, 0]);
        lines.push({ pts, closed: false, tone: 'front', family: 1, t: pts.map((_, i) => i / Math.max(1, pts.length - 1)) });
      }
    }

    const labels: GeoLabel[] = [];
    const text = str(p, 'text');
    if (text.trim()) {
      const align = str(p, 'align');
      const x = -w / 2 + pad, wrap = Math.max(0.05, w - 2 * pad);
      if (align === 'top') labels.push({ p: [x, h / 2 - pad - (hasIcon ? s + pad * 0.5 : 0), 0], text, anchor: 'start', valign: 'top', wrap });
      else if (align === 'middle') labels.push({ p: [x, 0, 0], text, anchor: 'start', valign: 'middle', wrap });
      else labels.push({ p: [x, -h / 2 + pad, 0], text, anchor: 'start', valign: 'bottom', wrap });
    }
    const meta = str(p, 'meta');
    if (meta.trim()) labels.push({ p: [w / 2 - pad, h / 2 - pad, 0], text: meta, anchor: 'end', valign: 'top', size: 0.75, font: 'mono' });

    return { lines, nodes: [], labels };
  },
};
