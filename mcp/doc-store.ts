/**
 * The MCP server's authoritative copy of the document: persisted to disk,
 * versioned, with an undo history and change listeners (the browser bridge).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TEMPLATES } from '../src/lib/templates';
import type { Doc } from '../src/lib/types';

export type Origin = 'agent' | 'browser';
export interface Change {
  doc: Doc;
  rev: number;
  origin: Origin;
  /** Human-readable summary shown in the app ("Drew path “Leaf”"). */
  activity?: string;
  /** Layers the change touched, so the app can select them. */
  layerIds?: string[];
  /** Id of the browser connection that made the change, so it is not echoed back. */
  source?: string;
}

const blank = () => TEMPLATES.find((t) => t.id === 'blank')!.build();

export class DocStore {
  doc: Doc;
  rev = 0;
  /** True until the document has content from somewhere; a connecting browser may then seed it. */
  fresh: boolean;
  private past: Doc[] = [];
  private listeners = new Set<(c: Change) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly file: string) {
    const loaded = this.load();
    this.doc = loaded ?? blank();
    this.fresh = !loaded;
  }

  private load(): Doc | null {
    try {
      if (!existsSync(this.file)) return null;
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Doc;
      return d && Array.isArray(d.layers) ? d : null;
    } catch (e) {
      process.stderr.write(`[vectr] could not read ${this.file}: ${(e as Error).message}\n`);
      return null;
    }
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.doc, null, 2));
        renameSync(tmp, this.file);
      } catch (e) {
        process.stderr.write(`[vectr] could not save ${this.file}: ${(e as Error).message}\n`);
      }
    }, 200);
  }

  onChange(fn: (c: Change) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply a change from an agent tool call (undoable via undo()). */
  mutate(fn: (d: Doc) => Doc, activity?: string, layerIds?: string[]): Doc {
    const next = fn(this.doc);
    if (next === this.doc) return next;
    this.past = [...this.past.slice(-99), this.doc];
    this.set(next, 'agent', activity, layerIds);
    return next;
  }

  /** Replace the document with the designer's copy from the browser. */
  receive(doc: Doc, source: string) {
    this.set(doc, 'browser', undefined, undefined, source);
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.set(prev, 'agent', 'Undid the last agent change');
    return true;
  }

  private set(doc: Doc, origin: Origin, activity?: string, layerIds?: string[], source?: string) {
    this.doc = doc;
    this.rev++;
    this.fresh = false;
    this.save();
    const change: Change = { doc, rev: this.rev, origin, activity, layerIds, source };
    for (const l of this.listeners) l(change);
  }
}
