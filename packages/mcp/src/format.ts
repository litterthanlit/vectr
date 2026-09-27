import { OPERATORS, RECIPES, SOURCES, THEMES, describeBlocks } from '@vectr/core';
import type { Design, DesignStore } from './designs.js';

const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));
const kv = (o: unknown) => (o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).map(([k, v]) => `${k}=${fmt(v)}`).join(', ') : '');

/** One-screen summary of a design: what an agent needs to decide its next edit. */
export function summarize(store: DesignStore, d: Design): string {
  const doc = d.doc;
  const theme = THEMES.find((t) => t.background === doc.background && t.ramp.join() === doc.ramp.join());
  const compact = store.compact(d).forms as Record<string, unknown>[];
  const lines = [
    `**${d.name}** (id \`${d.id}\`) · ${doc.width}×${doc.height} · ${theme ? `theme ${theme.id}` : `background ${doc.background}, ramp ${doc.ramp.join(' → ')}`}${doc.rough ? ` · rough ${fmt(doc.rough)}` : ''}`,
  ];
  if (!doc.forms.length) {
    lines.push('', 'No forms yet. Add some with vectr_update_design → add_forms.');
    return lines.join('\n');
  }
  lines.push('', 'Forms, bottom → top:');
  doc.forms.forEach((f, i) => {
    const c = compact[i];
    const src = c.source as { kind: string; params?: Record<string, unknown> };
    const chain = f.ops
      .map((o, k) => {
        const p = (c.ops as { params?: Record<string, unknown> }[] | undefined)?.[k]?.params;
        return `[${k}] ${o.kind}${p ? `(${kv(p)})` : ''}${o.enabled ? '' : ' (off)'}`;
      })
      .join(' → ');
    const bits = [`at (${fmt(f.x)}, ${fmt(f.y)})`, `scale ${fmt(f.scale)}`, `rotate x${fmt(f.rx)}° y${fmt(f.ry)}° z${fmt(f.rz)}°`];
    if (f.perspective) bits.push(`perspective ${fmt(f.perspective)}`);
    if (f.spin) bits.push(`spin ${fmt(f.spin)}°/s`);
    if (!f.visible) bits.push('hidden');
    lines.push(`- \`${f.id}\` "${f.name}" ${bits.join(' · ')}`);
    lines.push(`  ${src.kind}${src.params ? `(${kv(src.params)})` : ''}${chain ? ` → ${chain}` : ''}`);
    if (c.style) lines.push(`  style: ${kv(c.style)}`);
  });
  return lines.join('\n');
}

export function warningsBlock(warnings: string[]): string {
  if (!warnings.length) return '';
  return `\n\n**Corrections (${warnings.length})**: the design was saved with these fixes applied:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
}

type ParamInfo = ReturnType<typeof describeBlocks>['sources'][number]['params'][number];
const paramLine = (p: ParamInfo) => {
  const range = 'min' in p ? `${p.min}–${p.max}` : 'options' in p ? (p.options as string[]).join(' | ') : p.type;
  const when = 'only_when' in p && p.only_when ? ` _(only when ${p.only_when.key} is ${p.only_when.in.join('/')})_` : '';
  return `- \`${p.key}\` (${p.label}): ${range}, default ${fmt(p.default)}${when}`;
};

export function blocksMarkdown(kind?: string): string {
  const b = describeBlocks();
  const out: string[] = [];
  if (!kind) {
    out.push(
      '# Vectr building blocks',
      '',
      'A form = one **source** (makes lines/points) → a stack of **operators** applied in order (max ' + b.limits.maxOps + ') → a **style**.',
      'Forms also take x, y (artboard px, centre), scale (radius in px), rx/ry/rz (degrees), perspective 0–1.',
      '',
      `**Themes**: ${THEMES.map((t) => `${t.id} (bg ${t.background}, ramp ${t.ramp.join('→')})`).join('; ')}`,
      `**Recipes**: ${RECIPES.map((r) => `${r.id} — ${r.blurb}`).join('; ')}`,
      '',
    );
  }
  const section = (title: string, list: typeof b.sources) => {
    const shown = list.filter((x) => !kind || x.kind === kind);
    if (!shown.length) return;
    if (!kind) out.push(`## ${title}`, '');
    for (const x of shown) {
      out.push(`### ${x.kind} — ${x.name}`, x.description);
      for (const p of x.params) out.push(paramLine(p));
      out.push('');
    }
  };
  section('Sources', b.sources);
  section('Operators', b.operators);
  if (!kind || kind === 'style') {
    out.push('## Style', `- \`stroke\`: ${b.style.stroke}`, `- \`ramp\`: ${b.style.ramp}`);
    for (const p of b.style.params) out.push(paramLine(p as ParamInfo));
  }
  return out.join('\n');
}

export const SOURCE_KINDS = SOURCES.map((s) => s.kind) as [string, ...string[]];
export const OP_KINDS = OPERATORS.map((o) => o.kind) as [string, ...string[]];
export const BLOCK_KINDS = [...SOURCE_KINDS, ...OP_KINDS, 'style'] as [string, ...string[]];
