import { describe, expect, it } from 'vitest';
import {
  COLOR_LEVELS, LABEL_FONT, LABEL_FONTS, SOURCES, buildForm, cleanText, compactDoc, createForm, decodeDoc, describeBlocks, docToSVG, encodeDoc,
  formToSVG, parseDoc, renderForm, sampleRamp, serializeDoc, textWidth, wrapText,
} from '../src/index.js';
import type { Form, Geometry, GeoLabel, Polyline, Style } from '../src/index.js';

const RAMP = ['#222222', '#ffffff'];
const at = { x: 500, y: 500 };

type Spec = { kind: string; params?: Record<string, unknown> };
const mk = (source: Spec, style: Partial<Style> = {}, ops: Spec[] = [], transform: Partial<Form> = {}): Form =>
  createForm({ source: source as never, ops: ops as never, style, transform }, at);
const sphere = (style: Partial<Style> = {}) => mk({ kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } }, style, [{ kind: 'revolve' }]);

// A source that returns whatever geometry a test hands it, so tests can control lines and labels exactly.
const probes = new Map<number, Geometry>();
SOURCES.push({
  kind: 'probe', name: 'Probe', blurb: 'test geometry',
  params: [{ key: 'id', label: 'Id', kind: 'seed' }, { key: 'text', label: 'Text', kind: 'text', multiline: true }],
  defaults: { id: 0, text: '' },
  build: (p) => probes.get(Number(p.id)) ?? { lines: [], nodes: [] },
});
let nextProbe = 1;
/** Orthographic, face-on, 100px per unit: screen x = 500 + 100x, y = 500 - 100y. */
const probe = (g: Partial<Geometry>, style: Partial<Style> = {}, transform: Partial<Form> = {}) => {
  const id = nextProbe++;
  probes.set(id, { lines: [], nodes: [], ...g });
  return mk({ kind: 'probe', params: { id } }, style, [], { rx: 0, ry: 0, scale: 100, ...transform });
};
const labelProbe = (label: Partial<GeoLabel>, style: Partial<Style> = {}, transform: Partial<Form> = {}) =>
  probe({ labels: [{ p: [0, 0, 0], text: 'Label', ...label }] }, style, transform);

const sq = (x: number, y: number, s: number, o: Partial<Polyline> = {}): Polyline => ({
  pts: [[x, y, 0], [x + s, y, 0], [x + s, y + s, 0], [x, y + s, 0]], closed: true, ...o,
});
/** Signed area of every subpath in a path's `d`. */
const areas = (d: string) =>
  d.split('M').slice(1).map((sub) => {
    const p = sub.replace('Z', '').split('L').map((q) => q.split(' ').map(Number));
    return p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;
  });

/** The attribute tail (after stroke-linejoin) of every stroke path, in render order. */
const strokeTails = (svg: string) =>
  [...svg.matchAll(/<path d="[^"]*" fill="none" stroke="[^"]*" stroke-width="[^"]*" stroke-opacity="[^"]*" stroke-linecap="round" stroke-linejoin="round"([^>]*)\/>/g)].map((m) => m[1]);
const DOTS = /stroke-dasharray="0 [\d.]+"/;
const DASHES = /stroke-dasharray="[1-9][\d.]* [\d.]+"/;

describe('closed-shape fill', () => {
  it('fills a closed circle and leaves an open arc alone', () => {
    const circle = renderForm(mk({ kind: 'curve', params: { shape: 'circle' } }, { fill: 'shapes' }), RAMP);
    expect(circle.fills.length).toBeGreaterThan(0);
    expect(circle.fills[0].d).toMatch(/^M[-\d. L]+Z$/);
    const arc = renderForm(mk({ kind: 'curve', params: { shape: 'arc' } }, { fill: 'shapes' }), RAMP);
    expect(arc.fills).toHaveLength(0);
    const none = renderForm(mk({ kind: 'curve', params: { shape: 'circle' } }), RAMP);
    expect(none.fills).toHaveLength(0);
  });

  it('needs at least three points', () => {
    const r = renderForm(probe({ lines: [{ pts: [[0, 0, 0], [1, 0, 0]], closed: true }] }, { fill: 'shapes' }), RAMP);
    expect(r.fills).toHaveLength(0);
  });

  it('buckets by side and colour, with ramp colours like ribbons', () => {
    const form = mk({ kind: 'curve', params: { shape: 'circle' } }, { fill: 'shapes' }, [{ kind: 'repeat', params: { count: 24, dz: 0.2 } }], { rx: -50 });
    const r = renderForm(form, RAMP);
    expect(r.fills.length).toBeGreaterThan(2);
    expect(r.fills.length).toBeLessThanOrEqual(2 * COLOR_LEVELS);
    const ramp = Array.from({ length: COLOR_LEVELS }, (_, q) => sampleRamp(RAMP, q / (COLOR_LEVELS - 1)));
    for (const f of r.fills) expect(ramp).toContain(f.color);
    // Ribbons still work on a sphere.
    const rib = renderForm(sphere({ fill: 'ribbons' }), RAMP);
    expect(rib.fills.length).toBeGreaterThan(0);
    expect(rib.fills.length).toBeLessThanOrEqual(2 * COLOR_LEVELS);
  });

  it('winds every polygon the same way so overlaps do not cancel', () => {
    const a = sq(-1, -1, 1.5), b = sq(-0.5, -0.5, 1.5);
    const reversed = { ...b, pts: [...b.pts].reverse() };
    const r = renderForm(probe({ lines: [a, reversed] }, { fill: 'shapes' }), RAMP);
    expect(r.fills).toHaveLength(1);
    const [x, y] = areas(r.fills[0].d);
    expect(Math.abs(x)).toBeGreaterThan(100);
    expect(Math.sign(x)).toBe(Math.sign(y));
  });

  it('dims shapes that face away, and drops them when hidden lines are hidden', () => {
    const back = probe({ lines: [sq(0, 0, 1, { tone: 'back' })] }, { fill: 'shapes', fillOpacity: 0.5 });
    expect(renderForm(back, RAMP).fills[0].opacity).toBeCloseTo(0.2);
    expect(renderForm({ ...back, style: { ...back.style, hidden: 'hide' } }, RAMP).fills).toHaveLength(0);
    expect(renderForm({ ...back, style: { ...back.style, hidden: 'solid' } }, RAMP).fills[0].opacity).toBeCloseTo(0.5);
    const front = probe({ lines: [sq(0, 0, 1, { tone: 'front' })] }, { fill: 'shapes', fillOpacity: 0.5 });
    expect(renderForm(front, RAMP).fills[0].opacity).toBeCloseTo(0.5);
  });

  it('calls a shape back only when more than half its points are', () => {
    const n = (...z: number[]) => z.map((v) => [0, 0, v] as [number, number, number]);
    const style = { fill: 'shapes', fillOpacity: 0.5 } as const;
    const three = renderForm(probe({ lines: [sq(0, 0, 1, { normals: n(-1, -1, -1, 1) })] }, style), RAMP);
    const two = renderForm(probe({ lines: [sq(0, 0, 1, { normals: n(-1, -1, 1, 1) })] }, style), RAMP);
    expect(three.fills[0].opacity).toBeCloseTo(0.2);
    expect(two.fills[0].opacity).toBeCloseTo(0.5);
  });

  it('draws back fills first so front ones paint over them', () => {
    const r = renderForm(probe({ lines: [sq(0, 0, 1, { tone: 'front' }), sq(2, 0, 1, { tone: 'back' })] }, { fill: 'shapes', fillOpacity: 0.5 }), RAMP);
    expect(r.fills.map((f) => f.opacity.toFixed(2))).toEqual(['0.20', '0.50']);
  });
});

describe('knockout', () => {
  const shapes = (style: Partial<Style>) => mk({ kind: 'curve', params: { shape: 'rect' } }, { fill: 'shapes', ...style });
  const underlays = (svg: string, paper: string) => svg.split(`fill="${paper}" stroke="none"`).length - 1;

  it('paints an opaque paper path before each tint, only when asked and given a paper', () => {
    const on = shapes({ knockout: true });
    const r = renderForm(on, RAMP);
    const svg = formToSVG(on, r, '#f4f1ea');
    expect(underlays(svg, '#f4f1ea')).toBe(r.fills.length);
    const i = svg.indexOf('fill="#f4f1ea"');
    expect(svg.slice(i - 10 - r.fills[0].d.length, i)).toContain(r.fills[0].d);
    // The tint follows the underlay with the same outline.
    expect(svg.indexOf(`<path d="${r.fills[0].d}" fill="${r.fills[0].color}"`)).toBeGreaterThan(i);
    expect(underlays(formToSVG(on, r), '#f4f1ea')).toBe(0);
    const off = shapes({ knockout: false });
    expect(underlays(formToSVG(off, renderForm(off, RAMP), '#f4f1ea'), '#f4f1ea')).toBe(0);
  });

  it('also underlays ribbons, and escapes the paper', () => {
    const f = sphere({ fill: 'ribbons', knockout: true });
    const r = renderForm(f, RAMP);
    expect(underlays(formToSVG(f, r, '#abcdef'), '#abcdef')).toBe(r.fills.length);
    const evil = formToSVG(f, r, '"/><script>x</script>');
    expect(evil).not.toContain('<script>');
    expect(evil).toContain('&quot;/&gt;&lt;script&gt;');
  });

  it('comes through docToSVG with the document background', () => {
    const { doc } = parseDoc({ background: '#f4f1ea', forms: [{ source: { kind: 'curve', params: { shape: 'rect' } }, style: { fill: 'shapes', knockout: true } }] });
    expect(docToSVG(doc)).toContain('fill="#f4f1ea" stroke="none"');
  });
});

describe('line pattern', () => {
  const tails = (style: Partial<Style>) => {
    const f = sphere(style);
    const r = renderForm(f, RAMP);
    const t = strokeTails(formToSVG(f, r));
    expect(t).toHaveLength(r.strokes.length);
    return { vis: t.filter((_, i) => !r.strokes[i].hidden), hid: t.filter((_, i) => r.strokes[i].hidden) };
  };

  it('dots visible strokes, and hidden ones too unless hidden has a pattern of its own', () => {
    const { vis, hid } = tails({ dash: 'dotted', hidden: 'fade' });
    expect(vis.length).toBeGreaterThan(0);
    expect(hid.length).toBeGreaterThan(0);
    for (const t of [...vis, ...hid]) expect(t).toMatch(DOTS);
  });

  it('leaves solid lines solid', () => {
    const { vis, hid } = tails({ dash: 'solid', hidden: 'fade' });
    for (const t of [...vis, ...hid]) expect(t).not.toContain('dasharray');
  });

  it('lets hidden dashed or dotted override on hidden strokes only', () => {
    let { vis, hid } = tails({ dash: 'solid', hidden: 'dashed' });
    expect(hid.length).toBeGreaterThan(0);
    for (const t of hid) expect(t).toMatch(DASHES);
    for (const t of vis) expect(t).not.toContain('dasharray');
    ({ vis, hid } = tails({ dash: 'dotted', hidden: 'dashed' }));
    for (const t of vis) expect(t).toMatch(DOTS);
    for (const t of hid) expect(t).toMatch(DASHES);
    ({ vis, hid } = tails({ dash: 'dashed', hidden: 'dotted' }));
    for (const t of vis) expect(t).toMatch(DASHES);
    for (const t of hid) expect(t).toMatch(DOTS);
  });

  it('applies the pattern to every line when hidden lines are drawn solid', () => {
    const { vis, hid } = tails({ dash: 'dashed', hidden: 'solid' });
    expect(hid).toHaveLength(0);
    for (const t of vis) expect(t).toMatch(DASHES);
  });
});

describe('label text', () => {
  const tspans = (svg: string) => [...svg.matchAll(/<tspan x="([-\d.]+)" dy="([-\d.]+)">([^<]*)<\/tspan>/g)].map((m) => ({ x: +m[1], dy: +m[2], text: m[3] }));
  const note = (text: string, style: Partial<Style> = {}) => mk({ kind: 'note', params: { text } }, style);
  const svgOf = (f: Form) => formToSVG(f, renderForm(f, RAMP));

  it('turns a note with a line break into one tspan per line', () => {
    const f = note('a\nb');
    expect(renderForm(f, RAMP).labels[0].lines).toEqual(['a', 'b']);
    const t = tspans(svgOf(f));
    expect(t.map((s) => s.text)).toEqual(['a', 'b']);
    expect(svgOf(f).match(/<tspan/g)).toHaveLength(2);
    expect(svgOf(f).match(/<text /g)).toHaveLength(1);
  });

  it('escapes label text, and every other string, in the markup', () => {
    const svg = svgOf(note('<script>alert(1)</script>\n"x" & \'y\''));
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).toContain('&quot;x&quot; &amp; &#39;y&#39;');
    const hostile = note('hi', { labelColor: '"/><script>' as never });
    expect(svgOf(hostile)).not.toContain('<script');
  });

  it('normalises line endings and strips control characters', () => {
    expect(cleanText('a\r\nb\rc\x00d\x07e\x1bf\x7fg\x0bh\x0ci\tj\nk')).toBe('a\nb\ncdefghi\tj\nk');
    const r = renderForm(note('a\r\nb\x07c\rd\x00'), RAMP);
    expect(r.labels[0].lines).toEqual(['a', 'bc', 'd']);
    expect(svgOf(note('x\x1by'))).toContain('>xy<');
  });

  it('keeps a single bottom-aligned line where it has always been', () => {
    const f = note('Hello');
    const r = renderForm(f, RAMP);
    const [l] = r.labels;
    const x = Math.round(l.x * 100) / 100, y = Math.round(l.y * 100) / 100;
    expect(l).toMatchObject({ lines: ['Hello'], valign: 'bottom', size: f.style.labelSize, font: 'mono' });
    expect(formToSVG(f, r)).toContain(
      `<text x="${x}" y="${y}" text-anchor="${l.anchor}" font-family="${LABEL_FONT.replace(/, /g, ',').replace(/'/g, '&#39;')}" font-size="12" letter-spacing="0.02em"><tspan x="${x}" dy="0">Hello</tspan></text>`,
    );
  });

  it('places the first baseline by valign and steps by 1.25 × size', () => {
    const dys = (valign: GeoLabel['valign']) => {
      const f = labelProbe({ text: 'a\nb\nc', valign }, { labelSize: 10 });
      return tspans(svgOf(f)).map((s) => s.dy);
    };
    expect(dys('bottom')).toEqual([-25, 12.5, 12.5]);
    expect(dys('top')).toEqual([8, 12.5, 12.5]);
    expect(dys('middle')).toEqual([-9, 12.5, 12.5]);
    expect(dys(undefined)).toEqual(dys('bottom'));
  });

  it('keeps blank lines as space without emitting empty tspans', () => {
    const t = tspans(svgOf(labelProbe({ text: 'a\n\nb' }, { labelSize: 10 })));
    expect(t.map((s) => s.text)).toEqual(['a', 'b']);
    expect(t.map((s) => s.dy)).toEqual([-25, 25]);
    expect(svgOf(labelProbe({ text: ' \n ' }))).not.toContain('<text');
  });

  it('sizes and fonts from the form, with per-label overrides', () => {
    const base = renderForm(labelProbe({}, { labelSize: 10, labelFont: 'serif' }), RAMP).labels[0];
    expect(base).toMatchObject({ size: 10, font: 'serif' });
    const over = renderForm(labelProbe({ size: 2, font: 'sans' }, { labelSize: 10, labelFont: 'serif' }), RAMP).labels[0];
    expect(over).toMatchObject({ size: 20, font: 'sans' });
  });

  it('writes a stack per font that ends in installed faces, without resvg-hostile quoting', () => {
    expect(LABEL_FONTS.mono).toBe(LABEL_FONT);
    expect(LABEL_FONTS.sans).toMatch(/^Inter, .*'Liberation Sans', 'DejaVu Sans', sans-serif$/);
    expect(LABEL_FONTS.serif).toMatch(/'Iowan Old Style'.*'Liberation Serif', 'DejaVu Serif', serif$/);
    for (const font of ['mono', 'sans', 'serif'] as const) {
      const svg = svgOf(labelProbe({ font }));
      expect(svg).toContain(`font-family="${LABEL_FONTS[font].replace(/, /g, ',').replace(/'/g, '&#39;')}"`);
      // resvg cannot parse a quoted family after ", ".
      expect(svg).not.toMatch(/font-family="[^"]*, &#39;/);
      expect(svg.includes('letter-spacing')).toBe(font === 'mono');
    }
  });

  it('survives odd labels', () => {
    const odd = { p: [0, 0, 0], text: undefined, size: NaN, wrap: NaN, anchor: 'sideways', valign: 'up', font: 'comic' } as unknown as GeoLabel;
    const f = probe({ labels: [odd, { p: [0, 0, 0], text: 'ok', size: -4, wrap: -1 }, { p: [0, 0, 0], text: 'x'.repeat(5000), wrap: 1e-9 }] });
    const svg = svgOf(f);
    expect(svg).not.toMatch(/NaN|sideways|comic|undefined/);
    expect(renderForm(f, RAMP).labels.every((l) => l.lines.length <= 12 && l.size >= 1)).toBe(true);
  });
});

describe('wrapText', () => {
  const fonts = ['mono', 'sans', 'serif'] as const;
  const prose = 'The quick brown fox jumps over the lazy dog while MM WW iiii llll 12345 and 67890 keep going on and on';

  it.each(fonts)('keeps every line within the width (%s)', (font) => {
    for (const max of [110, 160, 300]) {
      const lines = wrapText(prose, max, 12, font);
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines) expect(textWidth(l, 12, font)).toBeLessThanOrEqual(max);
      expect(lines.join(' ')).toBe(prose);
    }
  });

  it('measures monospace flat and proportional fonts by glyph', () => {
    expect(textWidth('iiii', 10, 'mono')).toBeCloseTo(textWidth('MMMM', 10, 'mono'));
    expect(textWidth('iiii', 10, 'sans')).toBeLessThan(textWidth('nnnn', 10, 'sans'));
    expect(textWidth('nnnn', 10, 'sans')).toBeLessThan(textWidth('NNNN', 10, 'sans'));
    expect(textWidth('mmmm', 10, 'serif')).toBeGreaterThan(textWidth('nnnn', 10, 'serif'));
    expect(textWidth('', 10)).toBe(0);
  });

  it('splits words longer than a line', () => {
    const word = 'x'.repeat(50);
    const lines = wrapText(word, 60, 10, 'mono');
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) expect(textWidth(l, 10, 'mono')).toBeLessThanOrEqual(60);
    expect(lines.join('')).toBe(word);
    const mixed = wrapText(`ab ${word} cd`, 60, 10, 'mono');
    expect(mixed[0]).toBe('ab');
    expect(mixed.at(-1)).toMatch(/x+ cd$|^cd$/);
    // A line narrower than one glyph still makes progress.
    expect(wrapText('abc', 1, 10, 'mono')).toEqual(['a', 'b', 'c']);
  });

  it('caps at 12 lines and ends the last with an ellipsis', () => {
    const lines = wrapText('word '.repeat(200), 100, 12, 'sans');
    expect(lines).toHaveLength(12);
    expect(lines[11].endsWith('…')).toBe(true);
    expect(textWidth(lines[11], 12, 'sans')).toBeLessThanOrEqual(100);
    expect(lines.slice(0, 11).every((l) => !l.includes('…'))).toBe(true);
    const explicit = wrapText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'), Infinity, 12);
    expect(explicit).toHaveLength(12);
    expect(explicit[11]).toBe('line 11…');
    expect(wrapText(Array.from({ length: 12 }, () => 'ok').join('\n'), 50, 12)).toHaveLength(12);
    expect(wrapText(Array.from({ length: 12 }, () => 'ok').join('\n'), 50, 12).join('')).not.toContain('…');
  });

  it('keeps explicit breaks, blank lines and trims trailing ones', () => {
    expect(wrapText('a\n\nb', Infinity, 12)).toEqual(['a', '', 'b']);
    expect(wrapText('a\nb\n\n', Infinity, 12)).toEqual(['a', 'b']);
    expect(wrapText('a\r\nb', Infinity, 12)).toEqual(['a', 'b']);
    expect(wrapText('  a   b  ', Infinity, 12)).toEqual(['a b']);
    expect(wrapText('', 100, 12)).toEqual([]);
  });

  it('never throws or loops on odd numbers, and bounds huge input', () => {
    for (const max of [0, -5, NaN, Infinity, 1e-9]) for (const size of [0, -1, NaN, 1e9]) expect(() => wrapText(prose, max, size)).not.toThrow();
    const t0 = Date.now();
    const huge = wrapText('word '.repeat(1_000_000), 80, 12);
    expect(huge.length).toBeLessThanOrEqual(12);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('wraps labels at wrap × scale pixels, ignoring perspective', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const f = labelProbe({ text, wrap: 0.8 }, { labelSize: 12 }, { scale: 100, perspective: 0.8 });
    const [l] = renderForm(f, RAMP).labels;
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines) expect(textWidth(line, l.size, l.font)).toBeLessThanOrEqual(80);
    const unwrapped = renderForm(labelProbe({ text }), RAMP).labels[0];
    expect(unwrapped.lines).toEqual([text]);
  });
});

describe('label colour', () => {
  const note = (style: Partial<Style>, params: Record<string, unknown> = {}) => mk({ kind: 'note', params: { text: 'Hi', ...params } }, style);

  it('uses labelColor when set', () => {
    const f = note({ labelColor: '#abcdef', color: 'solid', stroke: '#112233' });
    const r = renderForm(f, RAMP);
    expect(r.labelColor).toBe('#abcdef');
    expect(formToSVG(f, r)).toContain('<g fill="#abcdef">');
  });

  it('otherwise takes the colour of the nearest lines, never a fixed white', () => {
    const r = renderForm(note({ color: 'solid', stroke: '#223344' }), RAMP);
    expect(r.labelColor).toBe('#223344');
    expect(r.labelColor).toBe(r.strokes[r.strokes.length - 1].color);
    const ramp = renderForm(note({}), ['#223344', '#556677']);
    expect(ramp.labelColor).toBe(ramp.strokes[ramp.strokes.length - 1].color);
    expect(ramp.labelColor).not.toBe('#ffffff');
  });

  it('falls back to the solid colour or the last ramp stop when there are no lines', () => {
    const bare = { length: 0, elbow: 0 };
    expect(renderForm(note({ color: 'solid', stroke: '#223344' }, bare), RAMP).labelColor).toBe('#223344');
    expect(renderForm(note({ color: 'solid' }, bare), ['#336699', '#ffffff']).labelColor).toBe('#336699');
    expect(renderForm(note({ color: 'ramp' }, bare), ['#336699', '#778899']).labelColor).toBe('#778899');
    expect(renderForm(note({ color: 'ramp', ramp: ['#010203', '#040506'] }, bare), ['#336699', '#778899']).labelColor).toBe('#040506');
  });
});

describe('ink lines', () => {
  const inked = (style: Partial<Style> = {}) =>
    probe({ lines: [sq(-1, -1, 1, { family: 0 }), { pts: [[0.2, 0.2, 0], [1, 0.8, 0]], family: 1, ink: true }], labels: [] }, { color: 'solid', stroke: '#336699', taper: 'none', width: 2, ...style });

  it('go into one trailing bucket in the label colour, as wide as the form, never hidden', () => {
    const r = renderForm(inked(), RAMP);
    const ink = r.strokes.filter((s) => s.ink);
    expect(ink).toHaveLength(1);
    expect(r.strokes[r.strokes.length - 1]).toBe(ink[0]);
    expect(ink[0]).toMatchObject({ color: r.labelColor, width: 2, opacity: 1, hidden: false });
    expect(ink[0].d).toBe('M520 480L600 420');
    // The ordinary line is still there, in the stroke colour, and not part of the ink bucket.
    expect(r.strokes.filter((s) => !s.ink).map((s) => s.color)).toEqual(['#336699']);
  });

  it('take a set labelColor, which is worked out from the ordinary strokes otherwise', () => {
    expect(renderForm(inked({ labelColor: '#abcdef' }), RAMP).strokes.at(-1)).toMatchObject({ ink: true, color: '#abcdef' });
    const plain = renderForm(inked(), RAMP);
    expect(plain.labelColor).toBe('#336699');
    // Ink alone does not set the label colour: it falls back like a form with no lines.
    const only = renderForm(probe({ lines: [{ pts: [[0, 0, 0], [1, 0, 0]], ink: true }] }, { color: 'solid', stroke: '#336699' }), RAMP);
    expect(only.strokes).toHaveLength(1);
    expect(only.strokes[0]).toMatchObject({ ink: true, color: '#336699' });
  });

  it('stay untapered, solid and opaque however the form is styled', () => {
    const f = inked({ taper: 'depth', taperAmount: 1, dash: 'dotted', color: 'ramp', opacity: 0.5, hidden: 'hide' });
    const r = renderForm(f, RAMP);
    const ink = r.strokes.at(-1)!;
    expect(ink).toMatchObject({ ink: true, width: 2, opacity: 1, hidden: false });
    const svg = formToSVG(f, r);
    const tails = strokeTails(svg);
    expect(tails.at(-1)).toBe('');
    expect(tails.slice(0, -1).every((t) => DOTS.test(t))).toBe(true);
  });

  it('are kept by operators that copy lines', () => {
    const r = renderForm(mk({ kind: 'card', params: { icon: 'dial' } }, { color: 'solid', stroke: '#336699' }, [{ kind: 'ticks', params: { count: 8 } }], { rx: 0, ry: 0 }), RAMP);
    expect(r.strokes.filter((s) => s.ink)).toHaveLength(1);
  });

  it('draw every card icon in the label colour', () => {
    for (const icon of ['globe', 'orbit', 'dial', 'crosshair', 'spiral']) {
      const g = buildForm(mk({ kind: 'card', params: { icon } })).geometry;
      const glyph = g.lines.filter((l) => l.family === 1);
      expect(glyph.length).toBeGreaterThan(0);
      expect(glyph.every((l) => l.ink)).toBe(true);
      expect(g.lines.filter((l) => l.closed).every((l) => !l.ink)).toBe(true);
      const f = mk({ kind: 'card', params: { icon } }, { color: 'solid', stroke: '#c8c8cc', labelColor: '#111113' }, [], { rx: 0, ry: 0, scale: 100 });
      const r = renderForm(f, RAMP);
      expect(r.strokes.at(-1)).toMatchObject({ ink: true, color: '#111113' });
      expect(r.strokes.filter((s) => !s.ink).every((s) => s.color === '#c8c8cc')).toBe(true);
    }
  });
});

describe('bounding box', () => {
  const box = (f: Form) => renderForm(f, RAMP).bbox;
  const long = 'A long card of text that spills well past the leader line';

  it('grows to cover the text block', () => {
    const on = mk({ kind: 'note', params: { text: long } });
    const off = mk({ kind: 'note', params: { text: long } }, { labels: false });
    const r = renderForm(on, RAMP);
    const l = r.labels[0];
    expect(r.bbox.w).toBeGreaterThan(box(off).w + 100);
    expect(r.bbox.x + r.bbox.w).toBeGreaterThanOrEqual(Math.max(l.x + textWidth(l.lines[0], l.size, l.font), l.x) - 1e-6);
  });

  it.each([
    ['start', 0, 1], ['middle', 0.5, 0.5], ['end', 1, 0],
  ] as const)('covers %s-anchored text on both sides', (anchor, before, after) => {
    const f = labelProbe({ text: 'a block of words\nand a second line', anchor }, { labelSize: 20 });
    const r = renderForm(f, RAMP);
    const w = textWidth('a block of words', 20, 'mono');
    expect(r.bbox.x).toBeLessThanOrEqual(500 - before * w + 1e-6);
    expect(r.bbox.x + r.bbox.w).toBeGreaterThanOrEqual(500 + after * w - 1e-6);
  });

  it.each(['top', 'middle', 'bottom'] as const)('covers %s-aligned lines vertically', (valign) => {
    const f = labelProbe({ text: 'one\ntwo\nthree', valign }, { labelSize: 20 });
    const [l] = renderForm(f, RAMP).labels;
    const { bbox } = renderForm(f, RAMP);
    const first = l.y + (valign === 'top' ? 16 : valign === 'middle' ? -25 + 7 : -50);
    expect(bbox.y).toBeLessThanOrEqual(first - 16 + 1e-6);
    expect(bbox.y + bbox.h).toBeGreaterThanOrEqual(first + 50 + 5 - 1e-6);
  });

  it('is not widened by labels that are switched off', () => {
    const f = labelProbe({ text: long }, { labels: false });
    const r = renderForm(f, RAMP);
    expect(r.bbox.w).toBe(0);
    expect(r.labels).toHaveLength(1);
  });
});

describe('style round trips', () => {
  const spec = {
    background: '#f4f1ea',
    forms: [
      {
        source: { kind: 'curve', params: { shape: 'rect' } },
        style: { fill: 'shapes', knockout: true, dash: 'dashed', hidden: 'dotted', labelFont: 'sans', labelColor: '#2a9d8f' },
      },
      { source: { kind: 'note', params: { text: 'one\ntwo' } }, style: { labelFont: 'serif', labelColor: '#2a9d8f', labelSize: 14, dash: 'dotted' } },
      { source: { kind: 'curve', params: { shape: 'arc' } }, ops: [{ kind: 'revolve' }], style: { fill: 'ribbons', knockout: true } },
    ],
  };

  it('parses the new style keys without warnings', () => {
    const { doc, warnings } = parseDoc(spec);
    expect(warnings).toEqual([]);
    expect(doc.forms[0].style).toMatchObject({ fill: 'shapes', knockout: true, dash: 'dashed', hidden: 'dotted', labelFont: 'sans', labelColor: '#2a9d8f' });
    expect(doc.forms[1].source.params.text).toBe('one\ntwo');
  });

  it('survives compactDoc → parseDoc, serialize → parse, and share links with identical art', async () => {
    const { doc } = parseDoc(spec);
    const svg = docToSVG(doc);
    expect(svg).toContain('fill="#f4f1ea" stroke="none"');
    expect(svg).toContain('<tspan');
    const compact = compactDoc(doc) as { forms: { style: Record<string, unknown> }[] };
    expect(compact.forms[0].style).toMatchObject({ fill: 'shapes', knockout: true, dash: 'dashed', labelFont: 'sans', labelColor: '#2a9d8f' });
    const a = parseDoc(compact);
    expect(a.warnings).toEqual([]);
    expect(docToSVG(a.doc)).toBe(svg);
    const b = parseDoc(serializeDoc(doc));
    expect(b.warnings).toEqual([]);
    expect(docToSVG(b.doc)).toBe(svg);
    const c = await decodeDoc(`#d=${await encodeDoc(doc)}`);
    expect(c.warnings).toEqual([]);
    expect(docToSVG(c.doc)).toBe(svg);
  });

  it('warns about a bad labelColor, dash or fill and falls back to the defaults', () => {
    const { doc, warnings } = parseDoc({ forms: [{ source: { kind: 'curve' }, style: { labelColor: 'red', dash: 'wavy', fill: 'confetti', labelFont: 'comic' } }] });
    const all = warnings.join('\n');
    expect(all).toMatch(/style\.labelColor must be a hex colour/);
    expect(all).toMatch(/dash/);
    expect(all).toMatch(/fill/);
    expect(all).toMatch(/labelFont/);
    expect(doc.forms[0].style).toMatchObject({ labelColor: null, dash: 'solid', fill: 'none', labelFont: 'mono' });
    expect(parseDoc({ forms: [{ source: { kind: 'curve' }, style: { labelColor: '#ABC' } }] }).doc.forms[0].style.labelColor).toBe('#aabbcc');
    expect(parseDoc({ forms: [{ source: { kind: 'curve' }, style: { labelColor: null } }] }).warnings).toEqual([]);
  });
});

describe('text params', () => {
  const noteText = (text: unknown) => parseDoc({ forms: [{ source: { kind: 'note', params: { text } } }] }).doc.forms[0].source.params.text;

  it('normalises line endings and strips control characters before limiting length', () => {
    expect(noteText('a\r\nb\x07\x1b[31m\x00c\rd')).toBe('a\nb[31mc\nd');
    expect(noteText('a\r\n'.repeat(150))).toHaveLength(200);
    expect(noteText('x'.repeat(500))).toHaveLength(200);
  });

  it('reports multiline text params', () => {
    const params = describeBlocks().sources.find((s) => s.kind === 'probe')!.params;
    expect(params.find((p) => p.key === 'text')).toMatchObject({ type: 'string', maxLength: 200, multiline: true });
    expect(params.find((p) => p.key === 'id')).not.toHaveProperty('multiline');
  });
});
