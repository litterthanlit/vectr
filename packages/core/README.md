# @vectr/core

The engine behind Vectr, with no UI: parametric shape generators, 3D projection with
hidden-line styling, SVG output, design validation, share links and a CLI. It runs in
the browser and in Node 18+, with zero runtime dependencies.

## API

```ts
import { parseDoc, docToSVG, describeGenerators, encodeDoc } from '@vectr/core';

// 1. Describe a design. Only layer `type` is required; everything else has defaults.
const { doc, warnings } = parseDoc({
  theme: 'signal',                 // graphite | signal | kiln | ozone | bloom
  width: 1200, height: 900,
  layers: [
    { type: 'revolve', x: 400, y: 450, scale: 180, rx: -18, params: { profile: 'vase' } },
    { type: 'grid', x: 850, y: 450, params: { warp: 'twist', amount: 0.8 }, style: { back: 'dashed' } },
  ],
});

// 2. Render it. This is exactly what the app shows.
const svg = docToSVG(doc);

// 3. Or hand it back to a person as a link that opens in the app.
const code = await encodeDoc(doc);   // → "v1.…", use as https://your-vectr/#d=<code>
```

| Function | What it does |
| --- | --- |
| `parseDoc(input)` | Accepts a saved file, a bare doc, a partial spec or a JSON string. Returns `{ doc, warnings }` and throws only when the input can't be a design at all. |
| `docToSVG(doc)` | A standalone SVG string. Every document string is escaped. |
| `describeGenerators()` | Every generator with its params (type, range, options, default), for building prompts or tool schemas. |
| `compactDoc(doc)` | The design with default values removed: the smallest faithful form. |
| `serializeDoc(doc)` | The saved-project file format (`{ format: "vectr", version: 1, doc }`). |
| `encodeDoc` / `decodeDoc` | Share-link codes (size-capped against decompression bombs). |
| `renderLayer(layer)` | Low level: projected front/back path data, nodes, labels and bbox. |

## Design format

```jsonc
{
  "width": 1200, "height": 900,          // 64–8000
  "theme": "ozone",                      // or set "background" / "ink" colours directly
  "rough": 2,                            // hand-drawn wobble, 0–20
  "layers": [{
    "type": "sphere",                    // run `vectr generators` for the full list
    "x": 600, "y": 450,                  // centre, artboard pixels (default: centre)
    "scale": 300,                        // radius in pixels
    "rx": 15, "ry": 30, "rz": 0,         // tilt / turn / roll, degrees
    "perspective": 0,                    // 0 = flat, 1 = strong
    "params": { "meridians": 8 },        // per-generator settings
    "style": {
      "stroke": "#ff6a3d",               // omit to follow the document ink
      "width": 1.5,
      "back": "dotted",                  // dotted | dashed | solid | faded | hidden
      "nodes": true, "nodeSize": 3, "labels": true
    }
  }]
}
```

## CLI

```
vectr render <design.json | ->  [-o out.svg]
vectr check  <design.json | ->          # prints the normalised design
vectr link   <design.json | ->  [--base URL]
vectr template <starter | blank>
vectr generators
```

Warnings go to stderr and the exit code is 1 only for unusable input, so agents can
generate a design, read the warnings, and try again.
