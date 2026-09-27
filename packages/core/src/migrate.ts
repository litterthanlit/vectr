/**
 * Vectr v1 → v2. v1 had one fixed generator per shape; v2 builds shapes from a source
 * plus operators. Each v1 layer becomes the nearest equivalent stack, keeping its
 * position, rotation, colour and line style. Output is a raw v2 object that then goes
 * through the normal validator, so migration never has to be trusted.
 */

type Raw = Record<string, unknown>;
type P = Record<string, number | string | boolean>;

/** v1 defaults, needed because v1 share links and compact files omitted them. */
const V1: Record<string, { params: P; transform?: P; style?: P }> = {
  sphere: { params: { meridians: 6, parallels: 7, rings: 2, nodeGrid: false }, transform: { rx: 12, ry: 18 }, style: { nodes: false } },
  revolve: { params: { profile: 'trumpet', rings: 4, spokes: 12, top: 0.95, bottom: 0.2, height: 1.5, curve: 2.4 }, transform: { rx: -18, ry: 10 } },
  vortex: { params: { turns: 3.5, strands: 2, top: 1, bottom: 0.1, height: 1.7 }, transform: { rx: -14, ry: 0, rz: -8 } },
  torus: { params: { major: 0.68, minor: 0.3, tubes: 24, loops: 6, twist: 0 }, transform: { rx: -55, ry: 0 }, style: { nodes: false } },
  knot: { params: { p: 2, q: 5, major: 0.62, minor: 0.3, beads: 20 }, transform: { rx: -30, ry: 0 } },
  orbits: { params: { rings: 5, labels: '' }, transform: { rx: -8, ry: 0 }, style: { back: 'dashed', nodes: false } },
  arches: { params: { count: 3, width: 0.6, depth: 0.45, shrink: 0.1 }, transform: { rx: -8, ry: 38 } },
  grid: { params: { warp: 'bend', amount: 0.32, frequency: 2, rows: 14, cols: 13, aspect: 1, nodeEvery: 2 } },
  truchet: { params: { tiles: 6, mask: 'square', style: 'arcs', dotted: 0.45, seed: 11 }, transform: { rz: 45, scale: 150 } },
  shape: { params: { kind: 'polygon', sides: 6, inner: 0.5, round: 0.35, echoes: 1, spacing: 0.1, stack: 0, alternate: false, seed: 4 }, style: { width: 3 } },
  spirograph: { params: { mode: 'hypo', ring: 96, wheel: 36, pen: 0.8, beads: 0 }, style: { width: 1 } },
  frame: { params: { aspect: 1.45, fig: '', caption: '' }, style: { width: 1, nodes: false } },
};

const V1_STYLE: P = { width: 1.5, back: 'dotted', nodes: true, nodeSize: 3.2, labels: true, labelSize: 11, opacity: 1 };
const HIDDEN: Record<string, string> = { dotted: 'dotted', dashed: 'dashed', solid: 'solid', faded: 'fade', hidden: 'hide' };

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read a v1 value, falling back to the v1 default when missing or the wrong type. */
function reader(defaults: P, raw: unknown) {
  const src = isObj(raw) ? raw : {};
  return {
    n: (k: string) => (typeof src[k] === 'number' && Number.isFinite(src[k]) ? (src[k] as number) : Number(defaults[k] ?? 0)),
    s: (k: string) => (typeof src[k] === 'string' ? (src[k] as string) : String(defaults[k] ?? '')),
    b: (k: string) => (typeof src[k] === 'boolean' ? (src[k] as boolean) : Boolean(defaults[k])),
  };
}

type Stack = { source: Raw; ops: Raw[]; lost?: string };

function stackFor(type: string, p: ReturnType<typeof reader>): Stack | null {
  switch (type) {
    case 'sphere':
      return {
        source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
        ops: [{ kind: 'revolve', params: { rings: p.n('parallels') + 2, spokes: p.n('meridians') * 2 } }],
        lost: p.n('rings') > 0 ? 'orbiting rings' : undefined,
      };
    case 'revolve':
      return {
        source: { kind: 'curve', params: { shape: 'profile', profile: p.s('profile'), top: p.n('top'), bottom: p.n('bottom'), curve: p.n('curve'), height: p.n('height') } },
        ops: [{ kind: 'revolve', params: { rings: p.n('rings'), spokes: p.n('spokes') } }],
      };
    case 'vortex': {
      const top = Math.max(0.01, p.n('top'));
      const ops: Raw[] = [];
      if (p.n('strands') > 1) ops.push({ kind: 'repeat', params: { layout: 'radial', axis: 'y', count: p.n('strands'), radius: 0 } });
      return {
        source: { kind: 'curve', params: { shape: 'spiral', turns: p.n('turns'), pitch: p.n('height') / top, inner: Math.min(1, p.n('bottom') / top), size: top } },
        ops,
      };
    }
    case 'torus':
      return {
        source: { kind: 'curve', params: { shape: 'circle', size: p.n('minor') } },
        ops: [{ kind: 'revolve', params: { offset: p.n('major'), spokes: p.n('tubes'), rings: p.n('loops'), twist: p.n('tubes') ? p.n('twist') / p.n('tubes') : 0 } }],
      };
    case 'knot': {
      const size = p.n('major') + p.n('minor');
      const ops: Raw[] = p.n('beads') > 0 ? [{ kind: 'scatter', params: { count: p.n('beads') } }] : [];
      return { source: { kind: 'curve', params: { shape: 'knot', p: p.n('p'), q: p.n('q'), size, tube: size ? p.n('minor') / size : 0.3 } }, ops };
    }
    case 'orbits':
      return {
        source: { kind: 'curve', params: { shape: 'arc', start: -90, sweep: 180 } },
        ops: [{ kind: 'revolve', params: { rings: p.n('rings') + 2, spokes: 2 } }],
        lost: p.s('labels') ? 'orbit labels' : 'ring layout (approximated)',
      };
    case 'arches': {
      const count = p.n('count');
      return {
        source: { kind: 'curve', params: { shape: 'arc', start: 0, sweep: 180, size: p.n('width') } },
        ops: [{ kind: 'repeat', params: { layout: 'linear', count, dz: p.n('depth'), grow: -p.n('shrink') / Math.max(1, count - 1) } }],
      };
    }
    case 'grid': {
      const kind = p.s('warp');
      const ops: Raw[] = kind === 'none' ? [] : [{ kind: 'warp', params: { kind: kind === 'twist' ? 'twist' : kind, axis: 'x', amount: p.n('amount'), frequency: p.n('frequency') } }];
      return { source: { kind: 'lattice', params: { cols: p.n('cols'), rows: p.n('rows'), aspect: p.n('aspect') } }, ops };
    }
    case 'truchet': {
      const mask = p.s('mask');
      const style = p.s('style');
      return {
        source: { kind: 'lattice', params: { cols: p.n('tiles'), rows: p.n('tiles'), aspect: 1, draw: 'points', mask: mask === 'square' ? 'none' : mask } },
        ops: [{ kind: 'tile', params: { motif: style === 'lines' ? 'diagonals' : style, hidden: p.n('dotted'), seed: p.n('seed') } }],
      };
    }
    case 'shape': {
      const echoes = p.n('echoes');
      const ops: Raw[] = echoes > 1
        ? [{ kind: 'repeat', params: { layout: 'linear', count: echoes, dz: p.n('stack'), grow: -p.n('spacing'), alternate: p.b('alternate') } }]
        : [];
      return { source: { kind: 'curve', params: { shape: p.s('kind'), sides: p.n('sides'), inner: p.n('inner'), round: p.n('round'), seed: p.n('seed') } }, ops };
    }
    case 'spirograph': {
      const ops: Raw[] = p.n('beads') > 0 ? [{ kind: 'scatter', params: { count: p.n('beads') } }] : [];
      return { source: { kind: 'curve', params: { shape: 'trochoid', ring: p.n('ring'), wheel: p.n('wheel'), pen: p.n('pen'), outside: p.s('mode') === 'epi' } }, ops };
    }
    case 'frame': {
      const a = p.n('aspect');
      return {
        source: { kind: 'curve', params: { shape: 'rect', aspect: a, round: 0, size: Math.sqrt(a) } },
        ops: [],
        lost: p.s('fig') || p.s('caption') ? 'frame labels and ruler marks' : undefined,
      };
    }
  }
  return null;
}

function hasNodes(type: string, p: ReturnType<typeof reader>): boolean {
  switch (type) {
    case 'revolve':
    case 'torus':
      return true;
    case 'sphere':
      return p.b('nodeGrid');
    case 'grid':
      return p.n('nodeEvery') > 0;
    case 'knot':
    case 'spirograph':
      return p.n('beads') > 0;
    default:
      return false;
  }
}

export function migrateV1(raw: Raw, warnings: string[]): Raw {
  const width = typeof raw.width === 'number' ? raw.width : 1200;
  const height = typeof raw.height === 'number' ? raw.height : 900;
  const ink = typeof raw.ink === 'string' ? raw.ink : undefined;
  const forms: Raw[] = [];
  const lost = new Set<string>();
  (Array.isArray(raw.layers) ? raw.layers : []).forEach((layer, i) => {
    if (!isObj(layer) || typeof layer.type !== 'string' || !V1[layer.type]) {
      warnings.push(`layers[${i}]: unknown v1 layer type ${JSON.stringify(isObj(layer) ? layer.type : layer)}, skipped`);
      return;
    }
    const def = V1[layer.type];
    const stack = stackFor(layer.type, reader(def.params, layer.params));
    if (!stack) return;
    if (stack.lost) lost.add(stack.lost);
    const style = reader({ ...V1_STYLE, ...def.style }, layer.style);
    const rawStyle = isObj(layer.style) ? layer.style : {};
    const t = reader({ scale: 160, rx: 0, ry: 0, rz: 0, perspective: 0, spin: 0, ...def.transform, x: width / 2, y: height / 2 }, layer);
    forms.push({
      ...(typeof layer.id === 'string' ? { id: layer.id } : {}),
      ...(typeof layer.name === 'string' ? { name: layer.name } : {}),
      ...(typeof layer.visible === 'boolean' ? { visible: layer.visible } : {}),
      ...(typeof layer.locked === 'boolean' ? { locked: layer.locked } : {}),
      x: t.n('x'), y: t.n('y'), scale: t.n('scale'), rx: t.n('rx'), ry: t.n('ry'), rz: t.n('rz'), perspective: t.n('perspective'), spin: t.n('spin'),
      source: stack.source,
      ops: stack.ops,
      // Keep the v1 look: one solid colour, no taper, v1 hidden-line style.
      style: {
        color: 'solid',
        taper: 'none',
        stroke: typeof rawStyle.stroke === 'string' ? rawStyle.stroke : null,
        width: style.n('width'),
        hidden: HIDDEN[style.s('back')] ?? 'dotted',
        // v2 markers sit on real nodes, so only keep dots where the rebuilt stack still has them.
        markers: style.b('nodes') && hasNodes(layer.type, reader(def.params, layer.params)) ? 'dot' : 'none',
        markerSize: style.n('nodeSize'),
        markersByDepth: false,
        markerEvery: layer.type === 'grid' ? Math.max(1, reader(def.params, layer.params).n('nodeEvery')) : 1,
        labels: style.b('labels'),
        labelSize: style.n('labelSize'),
        opacity: style.n('opacity'),
      },
    });
  });
  warnings.push('Converted from a Vectr v1 design; shapes were rebuilt as source + operator stacks');
  if (lost.size) warnings.push(`Not carried over from v1: ${[...lost].join(', ')}`);
  return {
    version: 2,
    width,
    height,
    ...(typeof raw.background === 'string' ? { background: raw.background } : {}),
    ...(ink ? { ramp: [ink] } : {}),
    rough: typeof raw.rough === 'number' ? raw.rough : 0,
    forms,
  };
}
