import { memo } from 'react';
import { ROUGH_FILTER_ID, formToSVG, roughFilterSVG, type Doc, type Form, type RenderedForm } from '@vectr/core';

/**
 * The artboard is drawn with @vectr/core's SVG serialiser, so the canvas is
 * byte-for-byte what exports (and agents) produce. Each form is its own memoised
 * node, so only forms that change get re-parsed. The serialiser escapes every
 * document-supplied string, which is what makes the innerHTML here safe.
 */
export const FormGraphic = memo(function FormGraphic({ form, r, paper, w, h }: { form: Form; r: RenderedForm; paper: string; w: number; h: number }) {
  // `paper` is the document background, which knockout fills are painted with; the artboard size keeps a finish's filter on the canvas.
  return <g data-form={form.id} dangerouslySetInnerHTML={{ __html: formToSVG(form, r, paper, { x: 0, y: 0, w, h }) }} />;
});

export function ArtboardContent({ doc, rendered }: { doc: Doc; rendered: Map<string, RenderedForm> }) {
  return (
    <>
      {doc.rough > 0 && <g dangerouslySetInnerHTML={{ __html: roughFilterSVG(doc.rough) }} />}
      <rect width={doc.width} height={doc.height} fill={doc.background} />
      <g filter={doc.rough > 0 ? `url(#${ROUGH_FILTER_ID})` : undefined}>
        {doc.forms.map((f) => {
          const r = rendered.get(f.id);
          return f.visible && r ? <FormGraphic key={f.id} form={f} r={r} paper={doc.background} w={doc.width} h={doc.height} /> : null;
        })}
      </g>
    </>
  );
}
