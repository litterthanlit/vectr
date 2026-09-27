# @vectr/core

The engine behind Vectr, with no UI: sources and operators that compose into forms,
3D projection with depth-driven styling, SVG output, validation, v1 migration, share
links, mutation and a CLI. It runs in browsers and Node 18+ and has no runtime
dependencies.

## API

```ts
import { parseDoc, docToSVG, describeBlocks, variations, encodeDoc } from '@vectr/core';

// 1. Describe a design. Only source.kind is required per form.
const { doc, warnings } = parseDoc({
  theme: 'kiln',
  forms: [
    {
      source: { kind: 'curve', params: { shape: 'wave', cycles: 3 } },
      ops: [
        { kind: 'repeat', params: { count: 20, dz: 0.08 } },
        { kind: 'warp', params: { kind: 'noise', amount: 0.4 } },
      ],
      style: { fill: 'ribbons', colorBy: 'family' },
      rx: -35, ry: 30,
    },
  ],
});

// 2. Render it. This is exactly what the app shows.
const svg = docToSVG(doc);

// 3. Explore, or hand it to a person as a link that opens in the app.
const [a, b, c] = variations(doc.forms[0], 3, /* seed */ 7);
const code = await encodeDoc(doc); // "v2.…" → https://your-vectr/#d=<code>
```

| Function | What it does |
| --- | --- |
| `parseDoc(input)` | Accepts a saved file, a bare doc, a partial spec, a JSON string or a Vectr v1 design. Returns `{ doc, warnings }`; throws only when the input can't be a design. |
| `docToSVG(doc)` | Standalone SVG. Every document string is escaped. |
| `describeBlocks()` | Every source, operator and style option, with param types, ranges, defaults and `only_when` conditions. |
| `buildForm(form)` | Run a source and its operators: geometry plus warnings (point budget, skipped operators). |
| `renderForm(form, ramp)` | Projected, bucketed strokes, fills, markers and labels. |
| `mutate` / `variations` | Seeded variations of a form. |
| `compactDoc` / `serializeDoc` | Smallest faithful JSON / the saved-project format (`{ format: "vectr", version: 2, doc }`). |
| `encodeDoc` / `decodeDoc` | Share-link codes; v1 codes still decode. |

## Building blocks

| Shapes (ready-made sources) | |
| --- | --- |
| `globe` | latitude / longitude wireframe with orbiting rings |
| `funnel` | surface of revolution with whiskers: trumpet, cone, hourglass, vase, bowl, bulb |
| `vortex` | tapering helix strands with level loops and rungs |
| `torus` | donut mesh, optionally twisted into spirals |
| `knot` | (p, q) torus knot with echoes and beads |
| `orbits` | rings inscribed on an ellipsoid shell, with equator, axis and labels |
| `arches` | receding arches with construction lines and a trajectory arrow |
| `flowgrid` | a grid that bends, fans, twists or ripples, with nodes |
| `maze` | Truchet tiles that link into loops |
| `shape` | rounded polygons, stars, squircles, flowers and blobs with echoes |
| `spirograph` | hypo- and epitrochoid rosettes |
| `frame` | a plate border with crosshair, ruler ticks and captions |

Shapes are drawn in plain ink by default in the app; `shapeStarter(kind)` gives that
form spec (camera plus style) for scripts.

| Building-block sources | |
| --- | --- |
| `curve` | circle, arc, line, rect, polygon, star, squircle, flower, blob, spiral/helix, wave, trochoid, lissajous, torus knot, vessel profile |
| `lattice` | a grid of points and lines, square or hex, with an optional circle or diamond mask |
| `points` | seeded clouds: disc, ring, box, ball, sphere shell, sunflower |
| `note` | an annotation: a dot, a leader line and a label |

| Operators | |
| --- | --- |
| `revolve` | spin lines around the vertical axis into a surface (rings, spokes, offset, twist) |
| `sweep` | copy lines along a straight, helical or orbital path, with rails |
| `repeat` | row, ring or grid arrays that grow or turn per copy |
| `mirror` | reflect across x, y and/or z |
| `warp` | bend, twist, taper, wave, fan, ripple, bulge, pinch, spherize, noise (normals are carried through) |
| `jitter` | seeded wobble, grainy to flowing |
| `connect` | nearest neighbours, within distance, in order, or to the centre; optionally bowed |
| `tile` | a motif at every point; quarter arcs link into loops |
| `scatter` | points along the lines |
| `resample` | even spacing, dashes or dots |

Run `vectr blocks` for every parameter.

## CLI

```
vectr render <design.json | ->  [-o out.svg]
vectr check  <design.json | ->          # prints the normalised design
vectr link   <design.json | ->  [--base URL]
vectr recipe <pulse-bloom | strata | constellation | tidal-field | coil-garden | vessel | meander | loom-knot | blank>
vectr blocks
```

Warnings go to stderr and the exit code is 1 only for unusable input, so agents can
generate a design, read the warnings, and try again.
