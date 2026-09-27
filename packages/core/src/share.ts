import { compactDoc, parseDoc, type ParseResult } from './schema.js';
import type { Doc } from './types.js';

/**
 * Share-link encoding: compact JSON → deflate → base64url, prefixed with a version.
 * Uses the standard CompressionStream API (browsers and Node 18+).
 */

const PREFIX = 'v2.';
/** v1 links carry a v1 document; parseDoc migrates it. */
const LEGACY_PREFIX = 'v1.';
/** Guards against decompression bombs in pasted links. */
const MAX_ENCODED = 200_000;
const MAX_DECODED = 2_000_000;

const toB64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('Design is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function encodeDoc(doc: Doc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compactDoc(doc)));
  return PREFIX + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeDoc(code: string): Promise<ParseResult> {
  const s = code.trim().replace(/^#?d=/, '');
  const prefix = s.startsWith(PREFIX) ? PREFIX : s.startsWith(LEGACY_PREFIX) ? LEGACY_PREFIX : null;
  if (!prefix) throw new Error('Unrecognised share code');
  if (s.length > MAX_ENCODED) throw new Error('Design is too large');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await pipe(fromB64Url(s.slice(prefix.length)), new DecompressionStream('deflate-raw'), MAX_DECODED);
  } catch (e) {
    if (e instanceof Error && e.message === 'Design is too large') throw e;
    throw new Error('Share code is corrupted');
  }
  return parseDoc(new TextDecoder().decode(bytes));
}

/** `https://…/#d=v1.xxxx` for the given page URL. */
export async function shareURL(doc: Doc, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = `d=${await encodeDoc(doc)}`;
  return url.toString();
}
