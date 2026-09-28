# Vectr

Generative vector shapes and editable Bézier paths, drawn by you or by an AI agent
over MCP. Pick a generator or draw with the pen, edit every point cleanly, orbit it in 3D,
export clean SVG.

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
- **Editable paths**: pen tool, rectangle, ellipse, polygon and star primitives. Every
  anchor has Figma-style handles (sharp, corner, smooth, mirrored).
- **Point editing**: drag anchors and handles, marquee-select, drag a segment to bend it,
  double-click to add a point, double-click a point to toggle sharp/smooth, delete, nudge.
- **Clean up**: Simplify refits any path to the fewest anchors within a tolerance and
  shows points before → after. *Convert to path* bakes any generator into clean Béziers.
- **Agents draw live** through the MCP server below; their strokes appear on your canvas
  as undoable steps.
- **Export**: SVG download, SVG to clipboard (paste into Figma, with layer names), 2× PNG,
  project JSON.
- Undo and redo, autosave to localStorage, spin animation, and a responsive layout.

## Shortcuts

| Key | Action |
| --- | --- |
| `V` / `O` | Move tool / Orbit tool (or hold `Alt` while dragging) |
| `A` / `Enter` / double-click | Edit points of the selected path |
| `P` | Pen: click for corners, drag for curves, click the first point to close, `Enter` to finish |
| `Alt` + drag handle | Break a smooth point into a corner |
| `⌘A`, `⌫`, arrows | In point editing: select all points, delete points, nudge points |
| `Shift` + drag | Lock axis when moving; snap to 15° when orbiting |
| `R` | Randomize the selected shape |
| `⇧P` | Play or pause spin |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘D` | Duplicate |
| `⌘S` | Download SVG |
| Arrows | Nudge (hold `Shift` for 10px) |
| `Space` + drag, scroll | Pan |
| `⌘` + scroll, `0` | Zoom / fit |

## Let an agent draw (MCP)

`mcp/server.ts` is a [Model Context Protocol](https://modelcontextprotocol.io) server. It
gives any MCP client (Claude Code, Claude Desktop, Cursor…) a vector canvas it can draw on
and edit point by point.

```bash
# Claude Code, from this repo (.mcp.json is already included):
claude            # then approve the "vectr" server
# or anywhere:
claude mcp add vectr -- npx tsx /path/to/vectr/mcp/server.ts
```

Claude Desktop / other clients:

```json
{ "mcpServers": { "vectr": { "command": "npx", "args": ["tsx", "/path/to/vectr/mcp/server.ts"] } } }
```

Keep `npm run dev` open and the app connects to the server automatically ("Agent live" in
the header). The agent's strokes appear as you watch, and your edits flow back to it.

| Tool | What it does |
| --- | --- |
| `get_canvas` / `set_canvas` | Artboard, colours, themes, layer summaries |
| `draw_path` | Path from SVG `d`, from `points` (+ `smooth` to curve through them), or from explicit `anchors` |
| `draw_shape` | rect (rounded), ellipse, polygon, star, all as editable paths |
| `import_svg` | Any SVG (QuiverAI, Figma, icon sets) → one editable layer per element, optional fit box and clean-up |
| `get_path` | Every anchor: `[subpath, index]`, position, absolute handles, kind |
| `edit_path` | Atomic point ops: move, set, kind (sharp/corner/smooth/mirrored), insert, insert_at, delete, append, add/remove subpath, close, reverse, fill rule |
| `clean_path` | Refit to minimal anchors within a tolerance; reports before → after |
| `convert_to_path` | Bake a parametric generator into clean paths |
| `list_generators` / `add_generator` | The 12 parametric 3D generators |
| `update_layer` / `duplicate_layer` / `delete_layers` / `undo` | Layer management |
| `render_preview` | PNG of the canvas or one layer; `show_points` overlays anchors and handles so the agent can see its structure |
| `export_svg` | Clean, named SVG, optionally written to a file |

Env: `VECTR_FILE` (document path, default `~/.vectr/document.json`), `VECTR_PORT` (live
bridge, default `7331`, `0` = off). The bridge listens on `127.0.0.1` only and refuses
connections from non-localhost web origins.

Why this exists and how it relates to QuiverAI's generation models:
[docs/quiverai-study.md](docs/quiverai-study.md).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # geometry, path editing, SVG import, MCP end-to-end tests
npm run mcp      # run the MCP server on stdio
npm run build
```

## Architecture

```
src/lib/generators/  Pure functions: params → 3D polylines (+ normals), nodes, labels
src/lib/render.ts    Rotate → project → split each line into front/back runs → SVG path data
src/lib/path.ts      Bézier path model: parse/serialise SVG d, insert/delete/kind ops, curve fitting (simplify)
src/lib/svg-import.ts  DOM-free SVG → paths (transforms, paint inheritance)
src/lib/vector-layer.ts  Path layers ↔ layer transforms, convert generators to paths
src/lib/agent-ops.ts Agent-facing edit ops in absolute coordinates (shared by MCP + tests)
src/lib/agent-link.ts  Browser side of the live MCP bridge
src/components/      Artboard (shared by canvas and export), Canvas, PathEditor (points + pen), Inspector, Library
mcp/                 MCP server (tools, preview renderer, doc store, WebSocket bridge)
src/store.ts         Zustand store with coalesced undo history and autosave
```

To add a generator, write one `Generator` object (a param schema plus `build()`) and
register it in `src/lib/generators/index.ts`. The inspector UI is built from the schema,
so you don't need to write any UI code for it.
