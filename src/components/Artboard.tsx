import { memo } from 'react';
import type { RenderedLayer } from '../lib/render';
import type { BackStyle, Doc, Layer } from '../lib/types';

export const LABEL_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

function backProps(back: BackStyle, width: number) {
  switch (back) {
    case 'dotted':
      return { strokeDasharray: `0 ${(width * 2.8 + 1.2).toFixed(2)}`, strokeLinecap: 'round' as const };
    case 'dashed':
      return { strokeDasharray: `${(width * 5 + 3).toFixed(2)} ${(width * 3 + 3).toFixed(2)}` };
    case 'faded':
      return { strokeOpacity: 0.28 };
    default:
      return {};
  }
}

export const LayerGraphic = memo(function LayerGraphic({ layer, r, ink, exportId }: { layer: Layer; r: RenderedLayer; ink: string; exportId?: string }) {
  const s = layer.style;
  const color = s.stroke ?? ink;
  const showBack = s.back !== 'hidden';
  const nodeR = s.nodeSize;
  if (layer.type === 'path') {
    // Path layers export as one clean <path>: the same anchors designers edit.
    const stroked = s.width > 0;
    return (
      <g opacity={s.opacity} id={exportId} data-layer={exportId ? undefined : layer.id}>
        <path
          d={r.front}
          fill={s.fill ?? 'none'}
          fillRule={r.fillRule}
          stroke={stroked ? color : undefined}
          strokeWidth={stroked ? s.width : undefined}
          strokeLinecap={stroked ? 'round' : undefined}
          strokeLinejoin={stroked ? 'round' : undefined}
        />
        {s.nodes && nodeR > 0 && (
          <g fill={color}>{r.nodesFront.map(([x, y], i) => <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={nodeR} />)}</g>
        )}
      </g>
    );
  }
  return (
    <g opacity={s.opacity} id={exportId} data-layer={exportId ? undefined : layer.id}>
      {showBack && r.back && (
        <path d={r.back} fill="none" stroke={color} strokeWidth={s.width} strokeLinejoin="round" {...backProps(s.back, s.width)} />
      )}
      {r.front && (
        <path d={r.front} fill="none" stroke={color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {r.arrows.map((d, i) => (
        <path key={i} d={d} fill={color} stroke={color} strokeWidth={s.width * 0.5} strokeLinejoin="round" />
      ))}
      {s.nodes && nodeR > 0 && (
        <g fill={color}>
          {s.backNodes && showBack &&
            r.nodesBack.map(([x, y], i) => <circle key={`b${i}`} cx={x.toFixed(2)} cy={y.toFixed(2)} r={nodeR * 0.8} opacity={s.back === 'faded' ? 0.35 : 1} />)}
          {r.nodesFront.map(([x, y], i) => <circle key={`f${i}`} cx={x.toFixed(2)} cy={y.toFixed(2)} r={nodeR} />)}
        </g>
      )}
      {s.labels && r.labels.length > 0 && (
        <g fill={color} fontFamily={LABEL_FONT} fontSize={s.labelSize} letterSpacing="0.04em">
          {r.labels.map((l, i) => (
            <g key={i}>
              {l.marker && <circle cx={l.x - s.labelSize * 0.6} cy={l.y - s.labelSize * 0.32} r={Math.max(1, s.labelSize * 0.12)} />}
              <text x={l.x.toFixed(2)} y={l.y.toFixed(2)} textAnchor={l.anchor}>{l.text}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
});

/** Unique, Figma-friendly ids from layer names (Figma turns ids into layer names on paste). */
export function exportIds(doc: Doc): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const l of doc.layers) {
    const base = l.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
    const safe = /^[a-z]/.test(base) ? base : `layer-${base}`;
    const n = used.get(safe) ?? 0;
    used.set(safe, n + 1);
    out.set(l.id, n ? `${safe}-${n + 1}` : safe);
  }
  return out;
}

/** Pure artboard contents: shared by the live canvas and the SVG export. */
export function ArtboardContent({ doc, rendered, forExport }: { doc: Doc; rendered: Map<string, RenderedLayer>; forExport?: boolean }) {
  const ids = forExport ? exportIds(doc) : null;
  return (
    <>
      {doc.rough > 0 && (
        <defs>
          <filter id="vectr-rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={3} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={doc.rough} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      )}
      <rect width={doc.width} height={doc.height} fill={doc.background} />
      <g filter={doc.rough > 0 ? 'url(#vectr-rough)' : undefined}>
        {doc.layers.map((l) => {
          const r = rendered.get(l.id);
          return l.visible && r ? <LayerGraphic key={l.id} layer={l} r={r} ink={doc.ink} exportId={ids?.get(l.id)} /> : null;
        })}
      </g>
    </>
  );
}
