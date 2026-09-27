import { memo } from 'react';
import { ROUGH_FILTER_ID, layerToSVG, roughFilterSVG, type Doc, type Layer, type RenderedLayer } from '@vectr/core';

/**
 * The artboard is drawn with @vectr/core's SVG serialiser, so the canvas is
 * byte-for-byte what exports (and agents) produce. Each layer is its own memoised
 * node, so only layers that change get re-parsed. The serialiser escapes every
 * document-supplied string, which is what makes the innerHTML here safe.
 */
export const LayerGraphic = memo(function LayerGraphic({ layer, r, ink }: { layer: Layer; r: RenderedLayer; ink: string }) {
  return <g data-layer={layer.id} dangerouslySetInnerHTML={{ __html: layerToSVG(layer, r, ink) }} />;
});

export function ArtboardContent({ doc, rendered }: { doc: Doc; rendered: Map<string, RenderedLayer> }) {
  return (
    <>
      {doc.rough > 0 && <g dangerouslySetInnerHTML={{ __html: roughFilterSVG(doc.rough) }} />}
      <rect width={doc.width} height={doc.height} fill={doc.background} />
      <g filter={doc.rough > 0 ? `url(#${ROUGH_FILTER_ID})` : undefined}>
        {doc.layers.map((l) => {
          const r = rendered.get(l.id);
          return l.visible && r ? <LayerGraphic key={l.id} layer={l} r={r} ink={doc.ink} /> : null;
        })}
      </g>
    </>
  );
}
