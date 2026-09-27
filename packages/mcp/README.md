# vectr-mcp-server

An [MCP](https://modelcontextprotocol.io) server that lets AI agents such as Claude
compose with Vectr. The agent builds forms from sources and operators, sees a PNG
preview after every change, explores mutations, and hands you a link that opens the
result in the Vectr app for editing.

## Tools

| Tool | What it does |
| --- | --- |
| `vectr_list_building_blocks` | Sources, operators and style options with every param's range and default, plus themes and recipes |
| `vectr_create_design` | New design: blank, or from a recipe, JSON, a share link or a saved project (v1 projects are converted). Returns an id and a preview |
| `vectr_update_design` | One atomic edit: artboard settings, then remove, update (with `ops_patch` to edit a stack in place), add and reorder forms. Returns a fresh preview |
| `vectr_mutate_design` | Numbered previews of variations of a form; call again with `apply: n` to keep one |
| `vectr_render_preview` | PNG of a design at any width |
| `vectr_get_design` | Readable summary with operator indexes, or compact JSON |
| `vectr_list_designs` | Designs open in this session |
| `vectr_export_design` | `link` (opens in the app), `svg`, `png` or `json` (project file) |
| `vectr_delete_design` | Discard a design |

Invalid input never fails a call: values are clamped or dropped and listed under
**Corrections** in the reply, so the agent can see what happened and adjust.

## Setup

Build once from the repo root:

```bash
npm install
npm run mcp          # builds @vectr/core and this server
```

**Claude Code**: the repo's `.mcp.json` registers the server automatically. Start
`claude` in the repo and approve the "vectr" server when prompted. To use it from
anywhere else:

```bash
claude mcp add vectr -e VECTR_ALLOWED_DIRS=$HOME/Desktop -- node /path/to/vectr/packages/mcp/dist/index.js
```

**Claude Desktop**: add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vectr": {
      "command": "node",
      "args": ["/path/to/vectr/packages/mcp/dist/index.js"],
      "env": { "VECTR_ALLOWED_DIRS": "/Users/you/Desktop/vectr" }
    }
  }
}
```

**Debugging**: `npm run inspect -w vectr-mcp-server` opens the MCP Inspector.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VECTR_ALLOWED_DIRS` | working directory | Folders the server may read projects from and write exports to (separate with `,` or `:`). Paths are resolved through symlinks, so nothing outside these folders is reachable. |
| `VECTR_APP_URL` | `https://vectr-eight.vercel.app/` | Where share links point. Use `http://localhost:5173/` when running the app locally. |

## Notes

- Designs are kept in memory (up to 50, least recently used dropped first) and are
  gone when the server stops. Export anything worth keeping.
- Previews are rendered with [resvg](https://github.com/RazrFalcon/resvg). The "hand-drawn"
  roughness filter looks grainier there than in browsers; the exported SVG is identical
  to the app's.
- The server makes no network requests.
