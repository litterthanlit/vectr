import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtboardContent } from '../components/Artboard';
import { renderLayer } from './render';
import type { Doc } from './types';

export function docToSVG(doc: Doc): string {
  const rendered = new Map(doc.layers.map((l) => [l.id, renderLayer(l)]));
  const body = renderToStaticMarkup(createElement(ArtboardContent, { doc, rendered, forExport: true }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${body}</svg>`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSVG(doc: Doc) {
  download(new Blob([docToSVG(doc)], { type: 'image/svg+xml' }), 'vectr.svg');
}

export async function downloadPNG(doc: Doc, scale = 2) {
  const svg = docToSVG(doc);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not rasterise SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = doc.width * scale;
    canvas.height = doc.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (blob) download(blob, 'vectr.png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copySVG(doc: Doc) {
  await navigator.clipboard.writeText(docToSVG(doc));
}

export function downloadProject(doc: Doc) {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'vectr-project.json');
}
