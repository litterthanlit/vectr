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

export const LayerGraphic = memo(function LayerGraphic({ layer, r, ink }: { layer: Layer; r: RenderedLayer; ink: string }) {
  const s = layer.style;
  const color = s.stroke ?? ink;
  const showBack = s.back !== 'hidden';
  const nodeR = s.nodeSize;
  return (
    <g opacity={s.opacity} data-layer={layer.id}>
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

/** Pure artboard contents: shared by the live canvas and the SVG export. */
export function ArtboardContent({ doc, rendered }: { doc: Doc; rendered: Map<string, RenderedLayer> }) {
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
          return l.visible && r ? <LayerGraphic key={l.id} layer={l} r={r} ink={doc.ink} /> : null;
        })}
      </g>
    </>
  );
}
