# Vectr

Generative vector shapes without the pen tool. Pick a generator, turn a few dials,
orbit it in 3D, export clean SVG.

![Vectr](docs/screenshot.png)

## What it does

- **12 parametric generators**: Globe, Funnel (surface of revolution), Vortex (helix),
  Torus, Knot, Orbits (annotated rings), Arches, Flow grid (bend, fan, twist, wave,
  ripple, pinch, bulge), Maze (Truchet tiles), Shape (rounded polygon, star, squircle,
  flower, blob), Spirograph and Figure frame.
- **Real 3D with a hidden-line style**: lines facing away from you can be drawn dotted,
  dashed, faded, solid or hidden, the way technical illustrations do it.
- **Nodes and labels** for the "diagram" look: dots at intersections, figure captions.
- **Themes**: Paper, Chalk (with a hand-drawn displacement), Mono, Blueprint, Ember.
- **Export**: SVG download, SVG to clipboard (paste into Figma), 2× PNG, project JSON.
- Undo and redo, autosave to localStorage, spin animation, and a responsive layout.

## Shortcuts

| Key | Action |
| --- | --- |
| `V` / `O` | Move tool / Orbit tool (or hold `Alt` while dragging) |
| `Shift` + drag | Lock axis when moving; snap to 15° when orbiting |
| `R` | Randomize the selected shape |
| `P` | Play or pause spin |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘D` | Duplicate |
| `⌘S` | Download SVG |
| Arrows | Nudge (hold `Shift` for 10px) |
| `Space` + drag, scroll | Pan |
| `⌘` + scroll, `0` | Zoom / fit |

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # geometry + export tests
npm run build
```

## Architecture

```
src/lib/generators/  Pure functions: params → 3D polylines (+ normals), nodes, labels
src/lib/render.ts    Rotate → project → split each line into front/back runs → SVG path data
src/components/      Artboard (shared by canvas and export), Canvas, Inspector, Library
src/store.ts         Zustand store with coalesced undo history and autosave
```

To add a generator, write one `Generator` object (a param schema plus `build()`) and
register it in `src/lib/generators/index.ts`. The inspector UI is built from the schema,
so you don't need to write any UI code for it.
