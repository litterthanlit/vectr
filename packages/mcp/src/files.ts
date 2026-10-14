import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * File access is confined to a set of allowed root directories (VECTR_ALLOWED_DIRS,
 * default: the working directory). Paths are resolved through symlinks before the
 * check, so `../` tricks and links pointing outside a root are both rejected.
 */

export const MAX_READ_BYTES = 5_000_000;

export class FileAccessError extends Error {}

export class Files {
  readonly roots: string[];

  constructor(roots: string[]) {
    this.roots = roots.map((r) => realpathSync(resolve(r)));
  }

  static fromEnv(env = process.env, cwd = process.cwd()): Files {
    const list = (env.VECTR_ALLOWED_DIRS ?? '').split(/[,:;]/).map((s) => s.trim()).filter(Boolean);
    return new Files(list.length ? list : [cwd]);
  }

  private inside(p: string) {
    return this.roots.some((root) => {
      const rel = relative(root, p);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
  }

  private resolveTarget(path: string): string {
    const abs = resolve(isAbsolute(path) ? path : resolve(this.roots[0], path));
    // Resolve symlinks on the deepest existing ancestor, then re-append the rest.
    let existing = abs;
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    const real = resolve(realpathSync(existing), relative(existing, abs));
    if (!this.inside(real)) {
      throw new FileAccessError(
        `"${path}" is outside the allowed folders (${this.roots.join(', ')}). Use a path inside one of them, or set VECTR_ALLOWED_DIRS.`,
      );
    }
    return real;
  }

  async read(path: string, extensions: string[]): Promise<string> {
    const p = this.resolveTarget(path);
    this.checkExt(p, extensions);
    if (!existsSync(p)) throw new FileAccessError(`File not found: ${path}`);
    const st = statSync(p);
    if (!st.isFile()) throw new FileAccessError(`Not a file: ${path}`);
    if (st.size > MAX_READ_BYTES) throw new FileAccessError(`File is too large (${st.size} bytes; limit ${MAX_READ_BYTES})`);
    return readFile(p, 'utf8');
  }

  async write(path: string, data: string | Uint8Array, extensions: string[]): Promise<string> {
    const p = this.resolveTarget(path);
    this.checkExt(p, extensions);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return p;
  }

  private checkExt(p: string, extensions: string[]) {
    const ext = extname(p).toLowerCase();
    if (!extensions.includes(ext)) {
      throw new FileAccessError(`Expected a ${extensions.join(' or ')} file, got "${ext || 'no extension'}"`);
    }
  }

  describe() {
    return this.roots.map((r) => r + sep).join(', ');
  }
}
