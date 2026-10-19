# Sketchpad spike: can Excalidraw be the engine?

Throwaway feasibility spike, 2026-10-18. Standalone Vite + React 19 + TypeScript app,
outside the pnpm workspace. `@excalidraw/excalidraw@0.18.1` (latest stable, MIT).

```sh
cd prototypes/sketchpad
npm install            # not part of the workspace
npx vite build && npx vite preview --port 5199 --strictPort &
node scripts/run.mjs   # headless Chromium checks -> shots/, exports/, scripts/results.json
```

URL flags: `?field=svg|elements|image` (how the field is drawn), `?probe=1` (alignment bands),
`?collab=1&tab=A` (BroadcastChannel sync).

## Verdict

**Yes, with a one-line patch (not a fork).** Everything we asked for works on the stock
package. The only non-public hook is the custom dot fills, which need a one-line
`pnpm patch` of `roughjs`, not of Excalidraw. The field underlay sits outside Excalidraw and
stays locked to it within antialiasing (about 1 px) during pan and zoom. The real costs are bundle size
(about 360 KB gzip for Excalidraw on the first load), fonts that load from a CDN by default (this
must be fixed for offline Electron), and a fill picker in Excalidraw's own UI that cannot show our
fills.

## 1. Field underlay

**Approach:** an absolutely positioned `<svg>` behind `<Excalidraw>`, which runs with
`viewBackgroundColor: "transparent"` (plus a CSS rule that makes `.excalidraw` transparent).
`onScrollChange(scrollX, scrollY, zoom)` writes
`transform="scale(z) translate(sx sy)"` directly to a `<g>`, without a React render. The field is
drawn in scene units (1 step = 12 units, 8 steps per 5 yd), with origin at the back-left of the
left end zone. It has end zones, yard lines every 5 yd, numbers, HS hashes at 28 and 56 steps
from the front, sideline ticks and a 1-step grid as an SVG `<pattern>` anchored to the front
sideline. The step grid and line color (white, yellow or black) can be toggled live.

**Why it stays locked:** Excalidraw 0.18 renders the static canvas synchronously in the same
React commit that calls `onScrollChange`. Render throttling is opt-in
(`window.EXCALIDRAW_THROTTLE_RENDER`). Leave throttling off, because turning it on would add a
frame of lag.

**Measured** (`probe=1`). The underlay draws 12-unit blue bands on the 50-yard line and the front
hash row, and Excalidraw draws 4-unit red lines on their centers. Every screenshot row and column
is scanned for how far the red line sits off-center in the blue band.

| check | result |
|---|---|
| 7 screenshots after discrete pans and zooms (zoom 0.57 to 0.77), 5,783 scanlines | median 0 to 0.5 px, worst p95 1.5 px |
| 16 screenshots taken **mid-motion** (pan and zoom every frame, zoom 0.56 to 4.9), 16,029 scanlines | median ≤ 0.5 px in every shot; p95 ≤ 0.5 px in most shots and ≤ 3 px in the worst |
| scanlines over 2 px | 78 of about 21,800 (0.4%). Each one falls where something cuts a band short: the toolbar (rows y < 90), the side panel (columns x > 1240), or the field's own white features (the "50" numerals, hash dashes and sidelines cross the 50-yard band). This is an artifact of the measurement, not lag |
| 67 frames read back in the page (static canvas pixels vs the underlay's current transform; nothing else on the row can interfere) | median 0.76 px, p95 1.32 px, max 1.58 px |

**Alternatives compared** (same scene, 180 frames of scripted pan and zoom, headless with software
rendering, so the numbers are relative):

| field drawn as | frame ms (mean / p95 / max) | notes |
|---|---|---|
| SVG underlay (chosen) | 16.7 / 16.8 / ≤ 18 | field not in the scene, so no select, undo or export side effects |
| one locked SVG `image` element | 16.7 / 16.8 / 20 | also cheap and locked by construction, but it is part of the scene, so it has to be filtered out of saves, collab and exports and kept out of undo |
| ~470 locked line and text elements | **28 to 30 / 78 to 86 / 104 to 124** (3 runs) | about 1.7x the mean frame time with 5x worse p95, and it bloats the scene; select-all correctly skipped the locked elements |

The image-element variant is a reasonable fallback if we ever need the field inside
Excalidraw's own exports.

## 2. Custom fills (dots, staggered dots, evenly distributed dots)

**Approach:** Excalidraw copies `element.fillStyle` into rough.js options unchanged, and
rough.js looks up its filler by name in `roughjs/bin/fillers/filler.js` (unknown names fall back
to hachure). One inserted line sends names starting with `om-` to our own filler
(`src/fills/omFillers.ts`). It is wired in here as a Vite `transform` (`vite.config.ts`); in the
monorepo it would be a `pnpm patch roughjs` (see `patches/roughjs@4.6.4.patch`). Excalidraw
itself is untouched.

- `om-dots` is a square grid, `om-dots-staggered` uses hex rows offset by half a space, and
  `om-dots-even` spreads rows and the dots in each row evenly between the edges. A dot is kept only
  if it fits fully inside the outline. Spacing follows the stroke-width picker (1, 2 or 4 steps),
  or can be set explicitly with `om-dots:24`. Dots use the element's background color.
- The filler returns a `fillPath` op set, so rough draws the dots as solid circles on canvas and
  as `<path fill>` in SVG. Output is deterministic (no `Math.random`), unlike rough's built-in
  `dots`.
- Tested on a rectangle, a rounded rectangle, ellipses and a rectangle drawn with the mouse.
- **Survives** `serializeAsJSON`/`restore`, undo, `exportToSvg`, `exportToBlob`, the PDF, and
  copy and paste across tabs. All of these keep `fillStyle` as-is, and every tab running the
  patched build draws it.
- **Costs:** Excalidraw's fill picker highlights nothing for our fills, so we add our own
  buttons (done here) and ideally hide the stock picker. `FillStyle` is a closed TS union, so
  setting it needs a cast. Opening a scene in stock Excalidraw shows hachure, which degrades
  gracefully. If a future rough.js renames `filler.js`, the patch fails loudly at build time.

Rejected alternatives: rough's own `dots` (random jitter, tiny stroked rings, no stagger);
dot elements in a group (hundreds of elements that don't follow a resize); and an overlay
renderer reading `customData` (wrong z-order, and every export path would need it too).

## 3. Sticky notes, images, clipboard, undo, save and load

- **Sticky note:** a rounded yellow `rectangle` with a bound `label` (via
  `convertToExcalidrawElements`), tagged `customData.omSticky`. It edits, moves and exports as
  normal. Note: `convertToExcalidrawElements` regenerates ids unless you pass `{ regenerateIds: false }`.
- **Images:** dropping a PNG works (`DataTransfer` drop gives an image element plus a file). The element
  stays `status: "pending"` until the host marks files as saved, and images live as data URLs in
  the files map, so stored JSON grows with each image. The `.dots` table would want files in their
  own table.
- **Copy and paste between two tabs:** select-all and Ctrl+C put an `excalidraw/clipboard` JSON
  on the system clipboard (4.7 KB). Ctrl+V in a second tab restored all 9 elements, including
  4 `om-*` fills, the sticky with its `customData`, and the text.
- **Undo:** independent by construction. Adding a sticky and pressing Ctrl+Z took 10 → 12 → 10
  elements, and the field never takes part.
- **Save and load to a `.dots` stand-in:** `serializeAsJSON(..., "local")` goes into a
  localStorage "table" of rows `{id, name, kind, json, updatedAt}` (about 8 KB for this scene).
  `restore()` and `updateScene` round-trip 10 → 0 → 10 elements with fills intact.
  **Save as template** is the same JSON under a new row with `kind: "template"`.

## 4. Export (field composited)

The field is outside Excalidraw, so we pin Excalidraw's export bounds to a known viewport: we add
an invisible rectangle covering the union of the field and the drawings, and export with
`exportPadding: 0`. The scene SVG width then equals the computed bounds exactly (2353 = 2353),
so the field can be drawn underneath with a single translate.

- **SVG** (`exports/sketch.svg`, 124 KB): the field `<g>` with the scene's children appended.
  Excalidraw inlines subsetted Excalifont as `@font-face`.
- **PNG** (`exports/sketch.png`, 4706x2146 at 2x, 706 KB): the field SVG drawn to a canvas, then
  `exportToBlob(exportScale: 2)` drawn on top.
- **PDF** (`exports/sketch.pdf`, 245 KB): jsPDF with `svg2pdf.js` from the composite SVG. It is
  **vector** (406 drawing ops, 0 images, text is real and searchable). Fonts fall back to the
  standard PDF fonts (Times) because svg2pdf ignores `@font-face`. To get hand-drawn text in the
  PDF, register Excalifont and the field font with `doc.addFont`.

## 5. Bundle size and React compatibility

The production build (`vite build`, gzip -9) loads **552 KB gzip of JS on first load** (one
1.77 MB entry chunk) plus 21 KB of CSS. Of that, about 109 KB is jsPDF and 19 KB svg2pdf
(easy to lazy-load) and about 60 to 110 KB is React DOM, which leaves **about 360 KB gzip for
Excalidraw**. Another 165 chunks (2.7 MB gzip in total) load lazily: mermaid, the
text-to-diagram feature, locales, and html2canvas from jsPDF. The whole `dist/` is 8.6 MB on disk.

- Excalidraw's peer deps are React `^17.0.2 || ^18.2.0 || ^19.0.0`, and
  `apps/desktop/package.json` uses React `^19.0.0`. The spike ran on React 19.3.1 with no React
  warnings.
- **Fonts load from a CDN by default:** Excalifont came from `esm.sh` at runtime. For offline
  Electron, set `window.EXCALIDRAW_ASSET_PATH` and ship `dist/prod/fonts`.
- The export path logs `Failed to use workers for subsetting, falling back to the main thread`
  (the font-subsetting worker). It is harmless, but the worker asset path also needs wiring in
  Electron.

## 6. Collab over BroadcastChannel

`onChange` posts any elements whose `version` went up, plus any new files.
The receiver runs `reconcileElements(local, remote, appState)` and then
`updateScene({ captureUpdate: NEVER })`.

- An initial 9-element scene arrived in the other tab in about 1 to 3 ms, and applying it took
  about 1 ms.
- Concurrent edits (A moved one element while B recolored another, at the same instant)
  converged in both tabs (`x: 696`, `bg: #c2255c`, `v: 3` on both sides).
- Remote changes stay out of local undo.

Live collab looks cheap at the element level. What this spike leaves out: cursors (an
`onPointerUpdate` plus the `collaborators` map), z-order (fractional indices are already in 0.18),
a persistent transport, and auth.

## Risks

1. **Bundle and offline:** about 360 KB gzip for Excalidraw, fonts and the subsetting worker from
   a CDN by default, and many lazy chunks to package for Electron or the web editor.
2. **The custom fill rests on internals:** `fillStyle` passes straight through to rough.js, and
   rough.js looks up fillers by name. Both are stable in practice but not public API, so check on
   each upgrade (the build fails loudly if the patch target moves).
3. **UI fit:** Excalidraw's own panels (fill picker, background color, library, main menu) need
   hiding or replacing to match OpenMarch. `UIOptions` covers part of this; the rest is CSS.
4. **The field is outside the scene:** exports have to composite (done here), and anything that
   uses Excalidraw's built-in export dialog or `exportToClipboard` will leave the field out unless we
   switch to the image-element variant.
5. **PDF fonts** need explicit embedding.
6. Excalidraw is pre-1.0 (0.x), and releases have had breaking API changes (for example
   `CaptureUpdateAction`, which replaced `storeAction`).

## Screenshots (`shots/`)

| file | shows |
|---|---|
| 01-field-underlay.png | empty field underlay at fit zoom |
| 02-drawings-on-field.png | dots, staggered and even fills, a hachure diamond, arrow, sticky, mouse-drawn rectangle (staggered), freedraw |
| 03-field-style-nogrid-yellow.png | grid off, yellow lines |
| 04-zoomed-dots-detail.png | zoomed in on the fills |
| 05-after-load-from-table.png | scene after load from the localStorage table |
| 06-image-dropped.png | PNG dropped onto the canvas |
| 07-probe-static.png, 08-probe-after-zoom.png, 09-probe-mid-motion.png | alignment probes (blue underlay band, red Excalidraw line on its center) |
| 10-field-as-elements.png, 10-field-as-image.png | comparison modes |
| 11-pasted-in-second-tab.png | paste in a second tab |
| 12-collab-tab-A.png, 13-collab-tab-B.png | two tabs after concurrent edits |
| 14-pdf-export-rendered.png | the vector PDF rendered with PyMuPDF |
| 15-svg-export-rendered.png | the composite SVG export rendered alone |

Raw numbers: `scripts/results.json`.
