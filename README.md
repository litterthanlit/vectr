# Vectr

Compose generative vector art without the pen tool. Drop in a ready-made shape (globe,
funnel, vortex, maze…) or start from a bare source, stack operators on it, and let depth
and colour do the drawing. Export clean SVG.

**Live:** https://vectr-eight.vercel.app

![Vectr](docs/screenshot.png)

## How it works

Every form is a small pipeline:

```
source              →  operators, top to bottom                  →  style
27 shapes, or          revolve · sweep · extrude · repeat · mirror   plain ink with dotted hidden
curve · lattice        kaleidoscope · warp · jitter · smooth         lines, pen presets, or weight
points · formula       connect · tile · scatter · offset · hatch     and colour that follow depth,
note                   resample                                      ribbons, markers
```

A circle revolved with an offset is a torus; add a twist warp and it corkscrews. A wave
repeated in depth with ribbon fills becomes strata. Points on a sphere, linked to their
nearest neighbours, become a constellation.

- **27 ready-made shapes** in four searchable groups, one click each:
  - *Solids & surfaces*: Globe, Funnel, Torus, Polyhedron (Platonic solids and geodesic
    spheres), Superquadric, Tower (a ruled hyperboloid), Saddle, Möbius, Klein bottle, Seashell
  - *Curves & motion*: Vortex, Helix, Knot, Orbits, Arches, Spirograph, Harmonograph,
    Attractor (Lorenz, Aizawa, Thomas, Halvorsen, Clifford, de Jong)
  - *Fields & growth*: Flow grid, Maze, Flow field, Contours, Plant (L-systems, optionally
    in 3D), Space-filling curves (Hilbert, Peano, Gosper, dragon, snowflake)
  - *Plates*: Shape, Superformula, Frame

  All are built from public mathematics, drawn in plain ink with dotted hidden lines,
  and take operators like any other form.
- **Formula**: type your own curve `x(t), y(t), z(t)` or surface `x(u,v)…` with sliders
  `a`, `b`, `c`. It is a small maths-only language (never run as code), and mistakes show
  up as a readable warning.
- **5 building blocks, 15 operators**, each with its own settings, reorderable and
  toggleable. New: Extrude, Kaleidoscope, Smooth, Offset and Hatch (parallel or cross
  hatching clipped to any closed outline, holes included).
- **My shapes**: save any tuned form as your own shape, then rename, delete, export or
  import them as a JSON file.
- **Pen presets**: Hairline, Fineliner, Technical, Marker and Brush set line weight,
  hidden-line style and taper in one click.
- **A signature style**: lines thin and lighten with depth, colour runs along an OKLab
  ramp (by depth, along the line, or per copy), back faces fade, optional ribbon fills
  between neighbouring lines and markers on points. Classic dotted or dashed hidden
  lines are still one setting away.
- **Mutate**: press `M` to see six variations of the selected form, click one to adopt
  it, and keep evolving. Subtle, medium or wild.
- **Recipes**: twelve starting points (Field study, Cabinet, Field notes, Strange orbit,
  Pulse bloom, Strata, Constellation, Tidal field, Coil garden, Vessel, Meander, Loom knot).
- **Themes**: Graphite, Signal, Kiln, Ozone, Bloom. Each is a background plus a colour
  ramp, and the interface accent follows it.
- **Export and share**: SVG, SVG to clipboard, 2× PNG, project JSON, or a share link that
  holds the whole design in the URL. Vectr v1 files and links open unchanged.
- Undo and redo, autosave, spin animation, keyboard shortcuts, responsive layout.

## Shortcuts

| Key | Action |
| --- | --- |
| `V` / `O` | Move tool / Orbit tool (or hold `Alt` while dragging) |
| `Shift` + drag | Lock axis when moving; snap to 15° when orbiting |
| `M` | Mutate the selected form (then `1`–`6` to pick) |
| `P` | Play or pause spin |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘D` | Duplicate |
| `⌘S` / `⌘O` | Download SVG / open a project file |
| Arrows | Nudge (hold `Shift` for 10px) |
| `Space` + drag, scroll | Pan |
| `⌘` + scroll, `0` | Zoom / fit |

## For agents and scripts

### MCP server (Claude and other agents)

[`packages/mcp`](packages/mcp) is an MCP server. Run `npm run mcp` once, then start
Claude Code in this repo; `.mcp.json` registers it. Ask for something like *"a slow
constellation on a sphere over rippled terrain, ozone theme"* and Claude will compose
the stacks, check the previews, try a few mutations, and give you a link that opens the
result in the [live app](https://vectr-eight.vercel.app). See
[packages/mcp/README.md](packages/mcp/README.md) for setup and the tool list.

### Library and CLI

The engine lives in [`packages/core`](packages/core) (`@vectr/core`) and has no UI, so
scripts and agents run exactly what the app runs. A design is plain JSON; each form
needs only `source.kind`:

```bash
npm run build -w @vectr/core
echo '{"theme":"ozone","forms":[{"source":{"kind":"curve","params":{"shape":"circle","size":0.3}},
      "ops":[{"kind":"revolve","params":{"offset":0.7}},{"kind":"warp","params":{"kind":"twist"}}]}]}' \
  | npm run -s vectr -- render - -o torus.svg
npm run -s vectr -- link design.json      # link that opens it in the app
npm run -s vectr -- blocks                # every source, operator and style option, as JSON
```

Bad values are clamped or dropped, never fatal, and each fix is reported
(`warning: forms[0] (lattice): "rows" clamped to 2–60`) so an agent can correct itself.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine, format, migration, MCP and CLI tests
npm run build
```

## Architecture

```
packages/core/src/
  sources/      27 ready-made shapes; curve (15 shapes), lattice, points, formula, note
                → polylines with t / family / band
  expr.ts       the Formula source's maths-only expression parser (no eval)
  operators/    pure (geometry, params) → geometry functions, each with a param schema
  pipeline.ts   source → enabled ops, cached, with a point budget so any stack stays fast
  render.ts     project, split visible/hidden, bucket segments by depth and colour
  svg.ts        buckets → SVG (the canvas and every export use this)
  schema.ts     validate and normalise untrusted designs; migrate.ts converts v1
  mutate.ts     seeded variations of a form
  share.ts      share links (compact JSON → deflate → base64url)
packages/mcp/   MCP server for agents
src/            the React app: canvas, pipeline inspector, Mutate, store (undo + autosave)
```

To add an operator, write one `OpDef` (a param schema plus `apply`) and register it in
`packages/core/src/operators/index.ts`. The inspector, validation, MCP descriptions and
Mutate all read its schema, so you don't need to write any UI code for it.
