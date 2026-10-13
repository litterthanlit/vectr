# @vectr/core

The engine behind Vectr, with no UI: sources and operators that compose into forms,
3D projection with depth-driven styling, SVG output, validation, v1 migration, share
links, mutation and a CLI. It runs in browsers and Node 18+ and has no runtime
dependencies.

## API

```ts
import { parseDoc, docToSVG, describeBlocks, variations, encodeDoc, ELEMENTS, placeElement } from '@vectr/core';

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

// 4. Drop in a ready-made element: several forms, sized for this artboard and centred on it.
const dial = ELEMENTS.find((e) => e.id === 'dial')!;
const withDial = { ...doc, forms: [...doc.forms, ...placeElement(dial, doc.width, doc.height)] };
```

| Function | What it does |
| --- | --- |
| `parseDoc(input)` | Accepts a saved file, a bare doc, a partial spec, a JSON string or a Vectr v1 design. Returns `{ doc, warnings }`; throws only when the input can't be a design. |
| `docToSVG(doc)` | Standalone SVG. Every document string is escaped. |
| `describeBlocks()` | Every source, operator and style option, with param types, ranges, defaults and `only_when` conditions, plus themes, recipes and elements (ready-made multi-form pieces whose `forms` can be pasted into a design). |
| `ELEMENTS` | Ready-made multi-form pieces (`globe`, `dial`, `orbit-shell`, `ruler`, `caption`, `gimbal`, `gauge`, `reticle`, `contour`), each `{ id, name, blurb, forms }`. A form has one line weight, so an element layers several. They are authored for a 1000×1000 artboard and name no colours, so they follow the document's theme. |
| `placeElement(element, width, height)` | The element's `Form`s for a document of that size: scaled by `min(width, height) / 1000` and centred on the artboard (`elementScale` is that factor). Append them to `doc.forms`. |
| `elementDocForms(element, width?, height?)` | The same forms as plain entries for a design's `forms` array (what `parseDoc` reads), with position, scale and rotation explicit. Defaults to the 1000×1000 reference artboard. |
| `buildForm(form)` | Run a source and its operators: geometry plus warnings (point budget, skipped operators). |
| `renderForm(form, ramp)` | Projected, bucketed strokes, fills, markers and labels. |
| `wrapText(text, maxPx, size, font?)` | The lines a label breaks into: explicit newlines kept, words packed greedily into `maxPx`, over-long words cut, at most 12 lines (the last ends in an ellipsis). The renderer uses it for every label, so it tells you how tall one will be. |
| `LABEL_FONTS` | CSS font stacks for the label fonts `mono`, `sans` and `serif` (`style.labelFont`). |
| `mutate` / `variations` | Seeded variations of a form. |
| `compactDoc` / `serializeDoc` | Smallest faithful JSON / the saved-project format (`{ format: "vectr", version: 2, doc }`). |
| `encodeDoc` / `decodeDoc` | Share-link codes; v1 codes still decode. |

## Building blocks

| Sources | |
| --- | --- |
| `curve` | circle, arc, line, rect, polygon, star, squircle, flower, blob, spiral/helix, wave, trochoid, lissajous, torus knot, vessel profile |
| `lattice` | a grid of points and lines, square or hex, with an optional circle or diamond mask |
| `points` | seeded clouds: disc, ring, box, ball, sphere shell, sunflower |
| `note` | an annotation: a dot, a leader line and a label |
| `orbits` | rings on a shell at many tilts: scattered, fanned or nested as a gimbal; radius spread, aspect and arc length |
| `card` | a caption panel: frame, icon (globe, orbit, dial, crosshair, spiral), word-wrapped multi-line text and an optional meta line. Keep it flat (`rx`, `ry`, `perspective` 0) |
| `context` | a context window as geometry: a field of token blocks, bars or dots, in a `window` (text rows), `burst` (dense core thinning outward) or `radial` (tokens on rays) layout. Paste up to 4000 characters in `text` and each word becomes a block as long as the word (`highlight` words are relevant), or leave it empty for generated tokens with a seeded `relevant` share. `t` is reading order and `family` is 0 or 1 (relevant), so colour by family with a two-stop ramp picks out what matters; blocks need style `fill: "shapes"` to be solid |

| Operators | |
| --- | --- |
| `revolve` | spin lines around the vertical axis into a surface (rings, spokes, offset, twist) |
| `sweep` | copy lines along a straight, helical or orbital path, with rails |
| `repeat` | row, ring or grid arrays that grow or turn per copy |
| `mirror` | reflect across x, y and/or z |
| `warp` | bend, twist, taper, wave, fan, ripple, bulge, pinch, spherize, noise (normals are carried through) |
| `jitter` | seeded wobble, grainy to flowing |
| `connect` | nearest neighbours, within distance, in order, to the centre, or to a point (`focus`: threads converge on `fx`, `fy`, `fz`, with `split` fans above and below, `which` every, relevant or a seeded share of points); optionally bowed |
| `tile` | a motif at every point; quarter arcs link into loops |
| `scatter` | points along the lines |
| `resample` | even spacing, dashes or dots; in dots mode `keepLines` leaves the lines in place so the dots are beads on them |
| `ticks` | hatch marks along every line, outside, inside or both: every Nth one longer (`majorEvery`), lengths varied by wave or at random. Dials, rulers, combs |

| Style (per form) | |
| --- | --- |
| `width`, `opacity` | line weight and opacity. One weight per form, so layer forms for thick and thin |
| `dash` | `solid`, `dotted` or `dashed` lines |
| `taper`, `color`, `colorBy`, `stroke`, `ramp` | weight and colour follow depth, position along the line or the copy index; or a solid colour; or the form's own ramp |
| `hidden` | lines facing away: `fade`, `dotted`, `dashed`, `solid` or `hide` |
| `fill`, `fillOpacity`, `knockout` | `ribbons` (bands between neighbouring lines) or `shapes` (closed shapes); `knockout` paints the document background under the fill so forms beneath are hidden |
| `markers`, `markerSize`, `markerEvery`, `markersByDepth` | dots, rings, crosses or ticks on points |
| `labels`, `labelSize`, `labelFont`, `labelColor` | labels on or off, their size, typeface (`mono`, `sans`, `serif`) and colour (hex, or `null` for the nearest line colour; it also colours card icons) |

Run `vectr blocks` for every parameter.

## CLI

```
vectr render <design.json | ->  [-o out.svg]
vectr check  <design.json | ->          # prints the normalised design
vectr link   <design.json | ->  [--base URL]
vectr recipe <pulse-bloom | strata | constellation | tidal-field | coil-garden | vessel | meander | loom-knot | meridian | gyroscope | orrery | sonar | blank>
vectr blocks
```

Warnings go to stderr and the exit code is 1 only for unusable input, so agents can
generate a design, read the warnings, and try again.
