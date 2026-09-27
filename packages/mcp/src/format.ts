import { GENERATORS, THEMES, TEMPLATES, describeGenerators } from '@vectr/core';
import type { Design, DesignStore } from './designs.js';

const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : JSON.stringify(v));

/** One-screen summary of a design: what an agent needs to decide its next edit. */
export function summarize(store: DesignStore, d: Design): string {
  const doc = d.doc;
  const theme = THEMES.find((t) => t.background === doc.background && t.ink === doc.ink);
  const compact = store.compact(d).layers as Record<string, unknown>[];
  const lines = [
    `**${d.name}** (id \`${d.id}\`) · ${doc.width}×${doc.height} · ${theme ? `theme ${theme.id}` : `background ${doc.background}, ink ${doc.ink}`}${doc.rough ? ` · rough ${fmt(doc.rough)}` : ''}`,
  ];
  if (!doc.layers.length) {
    lines.push('', 'No layers yet. Add some with vectr_update_design → add_layers.');
    return lines.join('\n');
  }
  lines.push('', 'Layers, bottom → top:');
  doc.layers.forEach((l, i) => {
    const c = compact[i];
    const bits = [
      `at (${fmt(l.x)}, ${fmt(l.y)})`,
      `size ${fmt(l.scale)}`,
      `rotate x${fmt(l.rx)}° y${fmt(l.ry)}° z${fmt(l.rz)}°`,
    ];
    if (l.perspective) bits.push(`perspective ${fmt(l.perspective)}`);
    if (l.spin) bits.push(`spin ${fmt(l.spin)}°/s`);
    if (!l.visible) bits.push('hidden');
    const params = c.params ? Object.entries(c.params).map(([k, v]) => `${k}=${fmt(v)}`).join(', ') : 'defaults';
    const style = c.style ? Object.entries(c.style).map(([k, v]) => `${k}=${fmt(v)}`).join(', ') : '';
    lines.push(`- \`${l.id}\` **${l.type}** "${l.name}" ${bits.join(' · ')}`);
    lines.push(`  params: ${params}${style ? ` · style: ${style}` : ''}`);
  });
  return lines.join('\n');
}

export function warningsBlock(warnings: string[]): string {
  if (!warnings.length) return '';
  return `\n\n**Corrections (${warnings.length})**: the design was saved with these fixes applied:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
}

export function generatorsMarkdown(type?: string): string {
  const all = describeGenerators().filter((g) => !type || g.type === type);
  const out: string[] = [];
  if (!type) {
    out.push(
      '# Vectr generators',
      '',
      'Each layer has a `type` (below), a position `x`,`y` (artboard pixels, centre of the shape), a `scale` (radius in pixels), ' +
        'rotation `rx` (tilt), `ry` (turn), `rz` (roll) in degrees, `perspective` 0–1, plus `params` and `style`.',
      '',
      '**style**: `stroke` (colour, omit to use the document ink), `width` 0.1–40, `back` (how lines facing away are drawn: dotted | dashed | solid | faded | hidden), ' +
        '`nodes` (bool), `nodeSize`, `backNodes` (bool), `labels` (bool), `labelSize`, `opacity` 0–1.',
      '',
      `**Themes**: ${THEMES.map((t) => `${t.id} (${t.background} / ${t.ink})`).join(', ')}`,
      `**Templates**: ${TEMPLATES.map((t) => `${t.id} (${t.name})`).join(', ')}`,
      '',
    );
  }
  for (const g of all) {
    out.push(`## ${g.type} (${g.name})`, g.description);
    const tr = Object.entries(g.defaultTransform).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
    if (tr) out.push(`Default rotation: ${tr}`);
    for (const p of g.params) {
      const range = 'min' in p ? `${p.min}–${p.max}` : 'options' in p ? p.options.join(' | ') : p.type;
      out.push(`- \`${p.key}\` (${p.label}): ${range}, default ${fmt(p.default)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export const GENERATOR_TYPES = GENERATORS.map((g) => g.type) as [string, ...string[]];
