import {
  BookOpen, Download, FolderOpen, Hand, Link2, Maximize, Sparkles, Minus, MousePointer2, Orbit, Pause, Play, Plus, Redo2, SlidersHorizontal, Shapes, Undo2, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, type CanvasView } from './components/Canvas';
import { IconButton } from './components/controls';
import { Inspector } from './components/Inspector';
import { Forms, Library } from './components/LeftPanel';
import { MutateStrip } from './components/MutateStrip';
import { RECIPES, accentFrom, decodeDoc } from '@vectr/core';
import { copySVG, copyShareLink, downloadPNG, downloadProject, downloadSVG } from './lib/export';
import { useStore } from './store';

function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-zinc-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-accent"
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && (
        <div role="menu" className="vectr-pop absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/90 p-1 shadow-2xl backdrop-blur-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, hint }: { onClick(): void; children: ReactNode; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-zinc-200 transition hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none"
    >
      {children}
      {hint && <span className="font-mono text-[11px] text-zinc-500">{hint}</span>}
    </button>
  );
}

export default function App() {
  const tool = useStore((s) => s.tool);
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasSelection = useStore((s) => s.selectedId !== null);
  const { setTool, togglePlay, undo, redo, loadRecipe, setMutateOpen } = useStore.getState();
  const mutateOpen = useStore((s) => s.mutateOpen);
  const ramp = useStore((s) => s.doc.ramp);

  // The interface accent follows the document's colour ramp.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentFrom(ramp));
  }, [ramp]);
  const [view, setView] = useState<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);

  const toastTimer = useRef<number>();
  const notify = (msg: string, ms = 1800) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** Load a design from any source, then report what the validator corrected. */
  const openDesign = (input: unknown, source: string) => {
    try {
      const warnings = useStore.getState().importDoc(input);
      setView({ zoom: 1, pan: { x: 0, y: 0 } });
      if (warnings.length) {
        console.warn(`[vectr] ${source}: ${warnings.length} issue(s) corrected`, warnings);
        notify(`Opened ${source} · ${warnings.length} issue${warnings.length > 1 ? 's' : ''} corrected (see console)`, 4000);
      } else {
        notify(`Opened ${source}`);
      }
    } catch (e) {
      notify(`Couldn't open ${source}: ${e instanceof Error ? e.message : 'unknown error'}`, 4000);
    }
  };
  const openFile = async (file: File) => {
    if (file.size > 5_000_000) return notify('That file is too large to be a Vectr design', 4000);
    openDesign(await file.text(), file.name);
  };

  // Share links: /#d=v1.… opens the design, then the hash is cleared so a
  // refresh keeps any edits (autosave) instead of reloading the original.
  const handledHash = useRef('');
  useEffect(() => {
    const load = () => {
      const h = window.location.hash;
      if (!h.startsWith('#d=') || h === handledHash.current) return;
      handledHash.current = h;
      decodeDoc(h)
        .then(({ doc }) => openDesign(doc, 'shared design'))
        .catch((e: Error) => notify(`Couldn't open link: ${e.message}`, 4000))
        .finally(() => window.history.replaceState(null, '', window.location.pathname + window.location.search));
    };
    load();
    window.addEventListener('hashchange', load);
    return () => window.removeEventListener('hashchange', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop a .json design anywhere on the window.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the inspector drawer on small screens when a shape gets selected.
  useEffect(() => {
    if (hasSelection && window.innerWidth < 1024 && drawer === 'left') setDrawer(null);
  }, [hasSelection, drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const id = s.selectedId;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && k === 'd' && id) {
        e.preventDefault();
        s.duplicateForm(id);
      } else if (mod && k === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      } else if (mod && k === 's') {
        e.preventDefault();
        downloadSVG(s.doc);
      } else if (mod) {
        return;
      } else if ((k === 'backspace' || k === 'delete') && id) {
        e.preventDefault();
        s.removeForm(id);
      } else if (k === 'escape') {
        s.select(null);
      } else if (k === 'v') {
        s.setTool('move');
      } else if (k === 'o') {
        s.setTool('orbit');
      } else if (k === 'p') {
        s.togglePlay();
      } else if (k === 'm' && id) {
        s.setMutateOpen(!s.mutateOpen);
      } else if (k === '0') {
        setView({ zoom: 1, pan: { x: 0, y: 0 } });
      } else if (id && k.startsWith('arrow')) {
        e.preventDefault();
        const l = s.doc.forms.find((x) => x.id === id)!;
        const step = e.shiftKey ? 10 : 1;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        s.updateForm(id, { x: l.x + dx, y: l.y + dy }, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const zoomBy = (k: number) => setView((v) => ({ ...v, zoom: Math.min(8, Math.max(0.2, v.zoom * k)) }));

  const left = (
    <>
      <Library onAdd={() => setDrawer(null)} />
      <Forms />
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-[#0b0b0c] text-zinc-200 antialiased">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-2 sm:px-3">
        <div className="flex items-center gap-2">
          <IconButton label="Generators & layers" onClick={() => setDrawer(drawer === 'left' ? null : 'left')} className="lg:hidden">
            <Shapes size={16} />
          </IconButton>
          <div className="flex items-center gap-2 px-1">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <g fill="none" stroke="#f3f2e9" strokeWidth="1.8">
                <circle cx="16" cy="16" r="11" />
                <ellipse cx="16" cy="16" rx="5" ry="11" />
                <ellipse cx="16" cy="16" rx="11" ry="4" strokeDasharray="0 3" strokeLinecap="round" />
              </g>
              <circle cx="16" cy="5" r="2.4" fill="var(--color-accent)" />
            </svg>
            <span className="text-[15px] font-semibold tracking-tight text-white">Vectr</span>
            <span className="hidden rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">v2</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Menu label="Recipes" icon={<BookOpen size={15} />}>
            {(close) =>
              RECIPES.map((t) => (
                <MenuItem key={t.id} onClick={() => { loadRecipe(t.id); setView({ zoom: 1, pan: { x: 0, y: 0 } }); close(); }}>
                  {t.name}
                </MenuItem>
              ))
            }
          </Menu>
          <Menu label="File" icon={<Download size={15} />}>
            {(close) => {
              const doc = () => useStore.getState().doc;
              return (
                <>
                  <MenuItem hint="⌘O" onClick={() => { fileInput.current?.click(); close(); }}>
                    <span className="inline-flex items-center gap-2"><FolderOpen size={14} className="text-zinc-500" />Open project…</span>
                  </MenuItem>
                  <MenuItem onClick={() => {
                    copyShareLink(doc()).then(() => notify('Share link copied'), () => notify('Clipboard unavailable'));
                    close();
                  }}>
                    <span className="inline-flex items-center gap-2"><Link2 size={14} className="text-zinc-500" />Copy share link</span>
                  </MenuItem>
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <MenuItem hint="⌘S" onClick={() => { downloadSVG(doc()); close(); }}>Download SVG</MenuItem>
                  <MenuItem hint="2×" onClick={() => { downloadPNG(doc()).catch(() => notify('PNG export failed')); close(); }}>Download PNG</MenuItem>
                  <MenuItem onClick={() => {
                    copySVG(doc()).then(() => notify('SVG copied — paste into Figma'), () => notify('Clipboard unavailable'));
                    close();
                  }}>Copy SVG code</MenuItem>
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <MenuItem onClick={() => { downloadProject(doc()); close(); }}>Save project (.json)</MenuItem>
                </>
              );
            }}
          </Menu>
          <IconButton label="Inspector" onClick={() => setDrawer(drawer === 'right' ? null : 'right')} className="lg:hidden">
            <SlidersHorizontal size={16} />
          </IconButton>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Left: library + layers */}
        <aside
          aria-label="Generators and layers"
          className={`absolute inset-y-0 left-0 z-30 flex w-[264px] flex-col border-r border-white/[0.06] bg-[#0f0f11]/95 backdrop-blur-xl transition-transform duration-300 lg:static lg:translate-x-0 lg:bg-[#0f0f11] ${
            drawer === 'left' ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden">{left}</div>
        </aside>

        {/* Canvas */}
        <main className="relative min-w-0 flex-1 bg-[radial-gradient(circle_at_50%_40%,#17171a_0%,#0b0b0c_70%)]">
          <Canvas view={view} setView={setView} />
          <MutateStrip />

          {/* Floating toolbar */}
          <div
            role="toolbar"
            aria-label="Canvas tools"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-white/10 bg-zinc-900/70 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          >
            <IconButton label="Move" shortcut="V" active={tool === 'move'} onClick={() => setTool('move')}><MousePointer2 size={16} /></IconButton>
            <IconButton label="Orbit in 3D" shortcut="O" active={tool === 'orbit'} onClick={() => setTool('orbit')}><Orbit size={16} /></IconButton>
            <div className="mx-1 h-5 w-px bg-white/10" />
            <IconButton label={playing ? 'Pause spin' : 'Play spin'} shortcut="P" active={playing} onClick={togglePlay}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </IconButton>
            <IconButton label="Mutate" shortcut="M" active={mutateOpen} disabled={!hasSelection} onClick={() => setMutateOpen(!mutateOpen)}>
              <Sparkles size={15} />
            </IconButton>
            <div className="mx-1 h-5 w-px bg-white/10" />
            <IconButton label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={undo}><Undo2 size={15} /></IconButton>
            <IconButton label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={redo}><Redo2 size={15} /></IconButton>
            <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
            <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)} className="hidden sm:inline-flex"><Minus size={15} /></IconButton>
            <button
              type="button"
              onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })}
              title="Fit to screen (0)"
              className="hidden h-8 w-12 rounded-lg font-mono text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-white sm:block"
            >
              {Math.round(view.zoom * 100)}%
            </button>
            <IconButton label="Zoom in" onClick={() => zoomBy(1.2)} className="hidden sm:inline-flex"><Plus size={15} /></IconButton>
            <IconButton label="Fit to screen" shortcut="0" onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })} className="sm:hidden"><Maximize size={15} /></IconButton>
          </div>

          <div className="pointer-events-none absolute top-3 left-3 hidden items-center gap-1.5 text-[11px] text-zinc-600 md:flex">
            <Hand size={12} /> Space-drag to pan · ⌘-scroll to zoom
          </div>

          {toast && (
            <div role="status" className="vectr-pop absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-zinc-900/80 px-4 py-1.5 text-[12px] text-zinc-200 backdrop-blur-xl">
              {toast}
            </div>
          )}
        </main>

        {/* Right: inspector */}
        <aside
          aria-label="Inspector"
          className={`absolute inset-y-0 right-0 z-30 flex w-[296px] flex-col border-l border-white/[0.06] bg-[#0f0f11]/95 backdrop-blur-xl transition-transform duration-300 lg:static lg:translate-x-0 lg:bg-[#0f0f11] ${
            drawer === 'right' ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-center justify-end px-2 pt-2 lg:hidden">
            <IconButton label="Close inspector" onClick={() => setDrawer(null)}><X size={16} /></IconButton>
          </div>
          <Inspector />
        </aside>

        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/70 bg-black/50 backdrop-blur-sm">
            <p className="text-[15px] font-medium text-white">Drop a Vectr design (.json) to open it</p>
          </div>
        )}

        {drawer && (
          <button type="button" aria-label="Close panel" onClick={() => setDrawer(null)} className="absolute inset-0 z-20 bg-black/40 lg:hidden" />
        )}
      </div>
    </div>
  );
}
