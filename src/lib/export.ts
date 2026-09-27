import { docToSVG, serializeDoc, shareURL, type Doc } from '@vectr/core';

export function download(blob: Blob, name: string) {
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
  const img = new Image();
  const url = URL.createObjectURL(new Blob([docToSVG(doc)], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not rasterise SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = doc.width * scale;
    canvas.height = doc.height * scale;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
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
  download(new Blob([serializeDoc(doc)], { type: 'application/json' }), 'vectr-project.json');
}

/** Copies a link that reopens this exact design. Returns the URL. */
export async function copyShareLink(doc: Doc): Promise<string> {
  const url = await shareURL(doc, window.location.href.split('#')[0]);
  await navigator.clipboard.writeText(url);
  return url;
}
