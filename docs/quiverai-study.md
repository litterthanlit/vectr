# QuiverAI study: what it does, and how Vectr's agent tools respond

*Researched September 2026. The sources were web-search snippets of QuiverAI's docs, blog, pricing page and press coverage. The proxy blocked fetching the primary pages directly, so treat details marked (unverified) with care.*

## What QuiverAI is

QuiverAI makes the **Arrow** family of models: Arrow 1.0, 1.1 / 1.1 Max, and **Arrow 2 / Arrow 2 Telos**, released September 2026. The models write **SVG code directly** instead of drawing pixels and tracing them. Arrow 2 handles four jobs: **generate, edit, vectorize and micro-animate**. It accepts up to 14 reference images.

| Surface | Shape |
| --- | --- |
| REST API `https://api.quiver.ai/v1` | `POST /svgs/generations` (text → SVG; `model`, `prompt`, `instructions`, `n`, `stream`), `POST /svgs/vectorizations` (image → SVG; `image.url`, `auto_crop`, target size 128–4096 px), `POST /svgs/edits`, `POST /svgs/animations`, and an OpenResponses-compatible `POST /responses` |
| Response | `{ id, created, data: [{ svg, mime_type: "image/svg+xml" }], credits }` |
| Streaming | SSE events `reasoning`, `draft` and `content`, so the UI can show progressive drafts |
| MCP | Hosted at `https://app.quiver.ai/mcp`: Streamable HTTP with OAuth. Tools cover model discovery, text→SVG, raster→SVG, gallery lookup, async task polling and fetching the SVG. Arrow 2 adds refine and animate. |
| SDKs | `quiverai-node`, a Vercel AI SDK provider, a Codex plugin |
| Pricing (unverified) | Arrow 2: $4 per million input tokens, $20 per million output. Arrow 1.1: $0.20 per generation. Free tier of $5 every 30 days. 20 requests per minute per organisation |

**Why its output counts as "clean".** The model redraws as code rather than tracing pixels. The result is fewer, deliberate anchors, real shapes and fills, and meaningful groups that open well in Figma and Illustrator. Arrow 2's animation moves groups that already exist in the SVG, so good grouping is a product requirement, not decoration.

**Designer UX patterns.**
- One workspace: describe what you want, refine by chatting, then adjust on a canvas.
- Streamed drafts render progressively.
- A Gallery keeps past creations.
- Two model tiers: fast and high-fidelity.

## The gap Vectr fills

QuiverAI's MCP is **generation-shaped**. A prompt goes in, a finished SVG comes back, and you change it by prompting again. That suits a first draft. It is weak at the next 80% of design work:

1. **Precise edits.** "Make that corner sharp", "pull the tip 40px right" or "add a point here" shouldn't mean regenerating the whole file.
2. **Seeing the structure.** Agents need to see anchors and handles, not only the rendered picture.
3. **Clean-up of any source**, whether that is Quiver output, an auto-trace or a messy hand-drawn path.
4. **Co-editing.** The designer's hand edits and the agent's edits should land on the same canvas.

So Vectr does not compete on generation. It is the **editable vector workspace that any agent drives**, and it can take Quiver's SVG as input (`import_svg`).

| Need | QuiverAI | Vectr MCP |
| --- | --- | --- |
| Create vectors | Model writes the SVG | The agent (Claude or any MCP client) draws with `draw_path` / `draw_shape`, or imports SVG from anywhere, Quiver included |
| Edit | Re-prompt with `/svgs/edits` | `edit_path` works on anchors: move, set handles, insert, delete, corner↔smooth, close, reverse, holes. Ops are atomic and addressed by `[subpath, index]` |
| Clean geometry | A property of the model | `clean_path` refits to the fewest anchors within a tolerance (Schneider curve fitting plus corner detection), with a before → after report. Works on any path |
| Seeing | The rendered SVG | `render_preview` returns a PNG. `show_points` overlays anchors (square = corner, circle = smooth), handles and index labels |
| Structure | Groups inside the SVG | One named layer per part. Export gives each a `<g id="leaf">` with one `<path>`, and Figma turns ids into layer names |
| Designer in the loop | Canvas inside Quiver's app | Live WebSocket link: agent strokes appear in the Vectr app as single undo steps, and hand edits flow back to the agent |
| Cost / hosting | Hosted, per token or per generation | Local, open, no extra model bill. The agent you already use does the drawing |

## Design decisions borrowed or adapted

- **"Clean geometry" as a measurable promise.** Quiver sells fewer deliberate anchors. Vectr makes that visible, with point, curve and contour counts in the inspector and the before → after figure on Simplify and `clean_path`.
- **Drafts you can watch.** Quiver streams drafts. Vectr streams actions: each tool call shows up live with an activity pill ("Drew “Leaf”").
- **Grouping for animation later.** Named, one-concept-per-layer output keeps the door open for group-based micro-animation, the way Arrow 2 animates.
- **Agent-friendly coordinates.** Everything the agent sees is in absolute artboard pixels, handles included. `points + smooth:true` lets agents sketch curves without doing handle maths, which they get wrong most often.

## Possible next steps

- `quiver_generate` as an optional tool behind a `QUIVERAI_API_KEY`: call Arrow, then `import_svg` → `clean_path` automatically. You get Quiver's first draft and Vectr's editing.
- Group layers (for multi-part icons and Arrow-style animation).
- Boolean ops (union, subtract) and offset stroke, the next most-requested vector operations.
