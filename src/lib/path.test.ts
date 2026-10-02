import { describe, expect, it } from 'vitest';
import {
  anchorCount, cubicAt, deleteAnchors, ellipsePath, insertAnchor, moveHandle, nearestOnPath, parsePathD, pathBounds,
  pathStats, pathToD, rectPath, segmentCubic, setAnchorKind, simplifyPath, smoothThrough, transformPath, cleanupPath,
  type VectorPath,
} from './path';
import { importSVG } from './svg-import';
import { createPathLayer, layerPathAbs, withPathAbs, convertToPaths } from './vector-layer';
import { createLayer } from './generators';
import { renderLayer } from './render';
import type { Vec2 } from './types';

const close = (a: number, b: number, eps = 0.05) => Math.abs(a - b) <= eps;

/** Max distance from each sample of `a` to the nearest point on `b`. */
function hausdorff(a: VectorPath, b: VectorPath, samples = 24) {
  let worst = 0;
  a.subpaths.forEach((s) => {
    const n = s.closed ? s.anchors.length : s.anchors.length - 1;
    for (let i = 0; i < n; i++) {
      const c = segmentCubic(s, i);
      for (let k = 0; k <= samples; k++) {
        const hit = nearestOnPath(b, cubicAt(c, k / samples));
        worst = Math.max(worst, hit?.dist ?? Infinity);
      }
    }
  });
  return worst;
}

describe('parse / serialise', () => {
  it('round-trips lines and curves', () => {
    const d = 'M10 10L90 10C120 10 120 60 90 60Z';
    const p = parsePathD(d);
    expect(p.subpaths).toHaveLength(1);
    expect(p.subpaths[0].closed).toBe(true);
    expect(anchorCount(p)).toBe(3);
    expect(pathToD(p)).toBe(d);
  });

  it('handles relative, H/V, S, Q, T and implicit repeats', () => {
    const p = parsePathD('m0 0 h10 v10 l-10 0 10 5 s5 5 10 0 q5 -5 10 0 t10 0');
    const s = p.subpaths[0];
    expect(s.anchors.map((a) => [a.x, a.y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [10, 15], [20, 15], [30, 15], [40, 15]]);
    // Q is converted to an exact cubic: control points at 2/3 toward the quad control.
    expect(s.anchors[5].out![0]).toBeCloseTo(10 / 3, 5);
    expect(s.anchors[5].out![1]).toBeCloseTo(-10 / 3, 5);
  });

  it('converts arcs, including compact flags', () => {
    const p = parsePathD('M0 50a50 50 0 1150 50');
    const b = pathBounds(p);
    // 3/4 of a circle centred at (50,50) with r=50.
    expect(close(b.x, 0, 0.5)).toBe(true);
    expect(close(b.y, 0, 0.5)).toBe(true);
    expect(close(b.w, 100, 0.5)).toBe(true);
    const end = p.subpaths[0].anchors.at(-1)!;
    expect(close(end.x, 50) && close(end.y, 100)).toBe(true);
  });

  it('splits subpaths and keeps fill rule', () => {
    const p = parsePathD('M0 0H10V10H0Z M2 2H8V8H2Z');
    expect(p.subpaths).toHaveLength(2);
    expect(p.subpaths.every((s) => s.closed)).toBe(true);
  });
});

describe('editing', () => {
  it('inserting an anchor does not change the shape', () => {
    const p = ellipsePath(50, 50, 40, 30);
    const s2 = insertAnchor(p.subpaths[0], 1, 0.37);
    expect(s2.anchors).toHaveLength(5);
    expect(hausdorff({ subpaths: [s2] }, p)).toBeLessThan(0.01);
    expect(hausdorff(p, { subpaths: [s2] })).toBeLessThan(0.01);
    expect(s2.anchors[2].kind).toBe('smooth');
  });

  it('moving a handle respects anchor kind', () => {
    const [top] = ellipsePath(0, 0, 10).subpaths[0].anchors;
    const sym = moveHandle(top, 'out', [8, 2]);
    expect(sym.in).toEqual([-8, -2]);
    const smooth = moveHandle({ ...top, kind: 'smooth' }, 'out', [0, 5]);
    expect(smooth.in![0]).toBeCloseTo(0);
    // Collinear with the new handle, original length (10 · kappa) preserved.
    expect(smooth.in![1]).toBeCloseTo(-10 * 0.5522847498, 4);
    const broken = moveHandle(top, 'out', [0, 5], true);
    expect(broken.kind).toBe('corner');
    expect(broken.in).toEqual(top.in);
  });

  it('corner -> smooth creates tangent handles, straight removes them', () => {
    const s = { closed: false, anchors: parsePathD('M0 0L10 10L20 0').subpaths[0].anchors };
    const a = setAnchorKind(s, 1, 'smooth');
    expect(a.kind).toBe('smooth');
    expect(a.in![1]).toBeCloseTo(0);
    expect(a.out![0]).toBeGreaterThan(0);
    const b = setAnchorKind({ ...s, anchors: [s.anchors[0], a, s.anchors[2]] }, 1, 'straight');
    expect(b.in).toBeNull();
    expect(b.out).toBeNull();
  });

  it('deletes anchors and drops degenerate subpaths', () => {
    const p = rectPath(0, 0, 10, 10);
    expect(anchorCount(deleteAnchors(p, [[0, 0]]))).toBe(3);
    expect(deleteAnchors(p, [[0, 0], [0, 1], [0, 2]]).subpaths).toHaveLength(0);
  });

  it('finds the nearest point on a curve', () => {
    const hit = nearestOnPath(ellipsePath(0, 0, 10), [20, 0])!;
    expect(close(hit.point[0], 10, 0.01) && close(hit.point[1], 0, 0.01)).toBe(true);
    expect(close(hit.dist, 10, 0.01)).toBe(true);
  });
});

describe('clean geometry', () => {
  it('refits a dense polyline circle into a few smooth anchors', () => {
    const pts: Vec2[] = [];
    for (let i = 0; i < 180; i++) pts.push([100 + Math.cos((i / 180) * Math.PI * 2) * 80, 100 + Math.sin((i / 180) * Math.PI * 2) * 80]);
    const dense: VectorPath = { subpaths: [{ closed: true, anchors: pts.map(([x, y]) => ({ x, y, in: null, out: null, kind: 'corner' })) }] };
    const clean = simplifyPath(dense, { tolerance: 0.5 });
    const st = pathStats(clean);
    expect(st.anchors).toBeLessThanOrEqual(8);
    expect(st.anchors).toBeGreaterThanOrEqual(3);
    expect(st.corners).toBe(0);
    expect(hausdorff(clean, dense)).toBeLessThan(0.8);
  });

  it('keeps the corners of a square and makes straight lines', () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 40; i++) pts.push([i * 2.5, 0]);
    for (let i = 1; i <= 40; i++) pts.push([100, i * 2.5]);
    for (let i = 1; i <= 40; i++) pts.push([100 - i * 2.5, 100]);
    for (let i = 1; i < 40; i++) pts.push([0, 100 - i * 2.5]);
    const dense: VectorPath = { subpaths: [{ closed: true, anchors: pts.map(([x, y]) => ({ x, y, in: null, out: null, kind: 'corner' })) }] };
    const clean = simplifyPath(dense, { tolerance: 0.5 });
    const st = pathStats(clean);
    expect(st.anchors).toBe(4);
    expect(st.lines).toBe(4);
    expect(st.curves).toBe(0);
  });

  it('smoothThrough passes through every point', () => {
    const pts: Vec2[] = [[0, 0], [40, 30], [80, 0], [120, 30]];
    const s = smoothThrough(pts);
    expect(s.anchors.map((a) => [a.x, a.y])).toEqual(pts);
    expect(s.anchors[1].kind).toBe('symmetric');
  });

  it('cleanup removes collinear and duplicate anchors', () => {
    const p = parsePathD('M0 0L5 0L10 0L10 0L10 10L0 10Z');
    const c = cleanupPath(p);
    expect(anchorCount(c)).toBe(4);
  });
});

describe('path layers', () => {
  it('artboard coordinates survive the local round trip under rotation and scale', () => {
    const abs = ellipsePath(300, 200, 50, 30);
    const layer = { ...createPathLayer(abs), rz: 30, scale: 150 };
    const moved = withPathAbs(layer, abs);
    const back = layerPathAbs(moved);
    expect(hausdorff(back, abs)).toBeLessThan(0.01);
  });

  it('renders a path layer to exact cubic path data', () => {
    const layer = createPathLayer(rectPath(10, 10, 100, 50, 10));
    const r = renderLayer(layer);
    expect(r.front.startsWith('M')).toBe(true);
    expect(r.front).toContain('C');
    expect(close(r.bbox.w, 100) && close(r.bbox.h, 50)).toBe(true);
    const shifted = renderLayer({ ...layer, rz: 90 });
    expect(close(shifted.bbox.w, 50) && close(shifted.bbox.h, 100)).toBe(true);
  });

  it('converts a generator into a handful of clean paths', () => {
    const layer = createLayer('shape', { x: 200, y: 200 }, { scale: 100, params: { kind: 'circle', echoes: 1 } });
    const [path] = convertToPaths(layer);
    const dense = renderLayer(layer).front;
    expect(path.type).toBe('path');
    expect(anchorCount(path.path!)).toBeLessThan((dense.match(/L/g) ?? []).length / 4);
  });

  it('transformPath is lossless for affine maps', () => {
    const p = ellipsePath(0, 0, 10);
    const t = transformPath(transformPath(p, [2, 0.5, -0.3, 1, 5, 7]), [0.5, 0, 0, 1, 0, 0]);
    expect(anchorCount(t)).toBe(4);
  });
});

describe('svg import', () => {
  it('imports common elements with transforms and paint inheritance', () => {
    const svg = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>
        <g fill="#ff0000" transform="translate(10 20)">
          <rect id="box" x="0" y="0" width="20" height="10" rx="2"/>
          <circle cx="50" cy="5" r="5" stroke="#000" stroke-width="2" fill="none"/>
        </g>
        <polygon points="0,0 10,0 5,10" style="fill:blue;opacity:.5"/>
        <line x1="0" y1="0" x2="10" y2="10" stroke="black"/>
        <g style="display:none"><rect width="5" height="5"/></g>
        <text>hi</text>
      </svg>`;
    const r = importSVG(svg);
    expect(r.viewBox).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(r.shapes.map((s) => s.name)).toEqual(['box', 'circle 1', 'polygon 1', 'line 1']);
    const [box, circle, tri, line] = r.shapes;
    expect(box.fill).toBe('#ff0000');
    expect(pathBounds(box.path).x).toBeCloseTo(10);
    expect(pathBounds(box.path).y).toBeCloseTo(20);
    expect(circle.fill).toBeNull();
    expect(circle.stroke).toBe('#000');
    expect(circle.strokeWidth).toBe(2);
    expect(tri.fill).toBe('#0000ff');
    expect(tri.opacity).toBe(0.5);
    expect(line.fill).toBeNull();
    expect(r.warnings.some((w) => w.includes('<text>'))).toBe(true);
  });
});
