# Sketchpad engine research

Researched 2026-10-18. Facts come from npm registry metadata (`npm view`), the published
tarballs (types and `dist/` inspected directly), GitHub repos and API, and official docs.
Version numbers are as of that date. This is not legal advice; the license sections say
what the licenses say and flag the questions to put to a lawyer or the vendor.

## What the Sketchpad needs (from the brief)

Excalidraw/FigJam feel; football field background that stays re-stylable (grid toggle, line
colors); free draw, lines, connected polylines, arrows, curves, ellipses, rects, text,
sticky notes, images; copy/paste; undo separate from the show's undo; JSON doc stored in the
`.dots` SQLite file; PNG/SVG/PDF export; templates (duplicate a doc); fills: none, lines,
cross lines, dots, staggered dots, evenly distributed dots; real-time collab later;
packageable as its own static site. OpenMarch is AGPL-3.0, React 19 (lockfile resolves
`react@19.2.4`), Electron 40, Vite 7.

Useful existing asset: `apps/desktop/src/field/fieldPlan.ts` exports `planField2d()`, a
renderer-free 2D field plan (lines with role `grid | halfLine | yardLine | hash | yLine`,
texts, images, in field units). It already drives the three.js field and the drill-chart
SVG export, so the Sketchpad field layer can draw from it in Canvas2D or SVG with very
little code, and restyling is just re-planning with other options.

---

## 1. Excalidraw (`@excalidraw/excalidraw`)

| Fact             | Value                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| License          | MIT (package and repo)                                                                                                                                                                                    |
| Latest stable    | `0.18.1`, published 2026-04-21. Previous stable `0.18.0` was 2025-03-10. Stable releases are rare; `@next` snapshots publish often (latest `0.18.0-43a92e6`, 2026-10-12)                                  |
| Repo activity    | ~134k stars, pushed daily (2026-10-18)                                                                                                                                                                    |
| React peer       | `^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0` (fits OpenMarch)                                                                                                                                                      |
| Unpacked size    | 46.8 MB (prod + dev builds + 13 MB of fonts + locales)                                                                                                                                                    |
| Prod JS, gzipped | `index.js` ~155 KB + core chunk ~152 KB; a separate ~743 KB gz chunk is the lazily loaded HarfBuzz/woff2 font-subsetting worker used when exporting SVG with embedded fonts. Locales are lazy `import()`s |
| Notable deps     | `roughjs 4.6.4`, `perfect-freehand 1.2.0`, `jotai`, `fractional-indexing`, `@excalidraw/mermaid-to-excalidraw`, Radix popover/tabs, `sass` (a runtime dependency, oddly)                                  |

### Embedding API (verified in 0.18.1 `dist/types`)

Props: `initialData`, `onChange(elements, appState, files)`, `excalidrawAPI(api)`,
`isCollaborating`, `onPointerUpdate`, `onPaste`, `onDuplicate`, `renderTopRightUI`,
`renderCustomStats`, `UIOptions` (hide canvas actions, tools, etc.), `viewModeEnabled`,
`zenModeEnabled`, `gridModeEnabled`, `objectsSnapModeEnabled`, `theme`, `langCode`,
`onLibraryChange`, `generateIdForFile`, `onLinkOpen`, `onPointerDown/Up`,
**`onScrollChange(scrollX, scrollY, zoom)`**, `validateEmbeddable`, `renderEmbeddable`,
`children` (for `MainMenu`, `Footer`, `Sidebar`, `WelcomeScreen` slots). `@next` adds
`renderTopLeftUI` and an `onExport` hook.

Imperative API: `updateScene({elements, appState, collaborators, captureUpdate})`,
`resetScene`, `getSceneElements(IncludingDeleted)`, `getAppState`, `getFiles`, `addFiles`,
`history.clear`, `scrollToContent`, `registerAction`, `setActiveTool`, `setCursor`,
`toggleSidebar`, `updateLibrary`, `refresh`, and subscription methods `onChange`,
`onPointerDown/Up`, `onScrollChange`, `onUserFollow`.

Package exports include `exportToSvg`, `exportToBlob`, `exportToCanvas`,
`exportToClipboard`, `serializeAsJSON`, `restore*`, `loadFromBlob`, **`reconcileElements`**
(the collab merge used by excalidraw.com), `convertToExcalidrawElements` (skeleton API for
creating elements programmatically), `CaptureUpdateAction` (`IMMEDIATELY` / `EVENTUALLY` /
`NEVER`, which keeps programmatic changes out of undo), `getCommonBounds`,
`sceneCoordsToViewportCoords`/`viewportCoordsToSceneCoords`, `mutateElement`,
`newElementWith`.

Element types in 0.18.1: rectangle, diamond, ellipse, line, arrow (elbow, curved,
straight, with bindings), freedraw, text, image, frame, embeddable, iframe. Lines and
arrows are multi-point, so connected polylines and curves are covered. **Sticky notes**: a
`stickynote` element exists on `master` and in `@next` but not in stable 0.18.1.

Undo history is Excalidraw's own store, separate from the host app's; `CaptureUpdateAction.NEVER`
keeps background or sync updates out of it. 0.18.0 added multiplayer-aware undo/redo.

### Field background options

`viewBackgroundColor: "transparent"` is supported. On `master`, `bootstrapCanvas` clears the
canvas and skips the fill when the value is `"transparent"`.

- **A. Own layer beneath (recommended).** Set `viewBackgroundColor: "transparent"`. Render the
  field from `planField2d()` into a Canvas2D or SVG layer behind the Excalidraw container, and
  apply the scene transform from `onScrollChange` / `appState.scrollX/scrollY/zoom.value`
  (screen = (scene + scroll) × zoom). The field is never an element, so it can't be selected,
  copied or undone, and restyling is a re-render. Costs: the two layers can be a frame apart
  during fast pans (test this; schedule the field draw in the same rAF), dark theme must be
  handled ourselves (Excalidraw applies `applyDarkModeFilter` to its own colors), and exports
  have to be composed (below).
- **B. Locked image element at the bottom.** Insert the field as an SVG `image` element with
  `locked: true`, added with `CaptureUpdateAction.NEVER`. Exports include it for free. But
  restyling means replacing a file, "unlock all" and lasso can reach it, it travels through
  copy and collab like any other element, and SVG-in-`drawImage` can blur or cost memory at
  high zoom.
- **C. Fork the renderer** to draw the field in `renderStaticScene` before the elements.
  Cleanest result, but it's a fork patch.

Export composition with A: call `exportToSvg({elements, appState: {exportBackground: false,
…}, files, exportPadding})`, compute the scene bounds with `getCommonBounds`, and prepend a
`<g>` with the field SVG (the drill-chart export already builds one from `planField2d`) at the
matching offset. PNG export can use `exportToCanvas` and draw the field first, or rasterize the
composed SVG.

### Custom fills

`FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag"`, the same on master and @next.
Rough.js 4.6 itself supports `hachure, solid, zigzag, cross-hatch, dots, dashed,
zigzag-line`, with `hachureGap`, `hachureAngle` and `fillWeight`. With `roughness: 0`, hachure
and cross-hatch are clean parallel lines, which covers the brief's **lines** and **cross
lines** with no patch.

Rough's `dots` places dots along hachure lines with jitter. It is not a regular grid,
staggered or evenly distributed, so the **dot fills need custom code** either way.
Excalidraw has no plugin point for fills or custom element renderers. Options:

1. **Patch or fork** (pnpm `patchedDependencies` on the built package is brittle; a source
   fork is sane): add `FillStyle` values, generate them in `element/src/shape.ts` (the
   `options.fillStyle = element.fillStyle` path) and in the SVG export path, add buttons to
   the fill picker action, and make `restore` accept the new values. The cost is a
   long-lived fork, but there's precedent: `@zsviczian/excalidraw` (Obsidian Excalidraw
   plugin) is an MIT fork that ships continuous patch releases (`0.18.143`, 2026-10-12).
2. **No fork:** store the fill in `customData.omFill` with Excalidraw's own `fillStyle`
   set to none/transparent, and draw dot fills on our own synced layer. This breaks z-order
   (an overlay can't sit between elements), and exports need the same composition. It's fine
   for a prototype, wrong for a product.

### Custom element types

There are no officially supported custom shapes. `embeddable` (with `renderEmbeddable`) puts
arbitrary React/DOM over the canvas, but it isn't part of the canvas render or export. Custom
behavior otherwise means `customData` on existing types plus a fork.

### Collaboration

- excalidraw.com uses a dumb socket relay (`excalidraw-room`, MIT, last pushed 2024-07) with
  end-to-end-encrypted broadcasts. Clients merge with `reconcileElements`: per-element LWW on
  `version`, with `versionNonce` as the tiebreak, ordered by fractional `index` since 0.18.
  Scenes persist to Firebase. This is essentially **server-free element-level LWW**, which maps
  naturally onto OpenMarch's preferred server-authoritative LWW: the server keeps a row per
  element and accepts higher versions.
- `y-excalidraw` (MIT): last release 2.0.12 in 2024-12, peer `@excalidraw/excalidraw ^0.17.6`.
  Stale; don't depend on it.
- Self-hosted collaboration is entirely ours. Excalidraw ships no backend.

### Electron/offline and fonts

It works offline once the fonts are self-hosted. Copy `dist/prod/fonts` (13 MB, which is
mostly Xiaolai CJK) into served assets and set `window.EXCALIDRAW_ASSET_PATH`; by default the
fonts load from a CDN. The fonts can be trimmed, but CJK text then falls back. The container
needs non-zero dimensions. It's ESM, and the CSS must be imported.

### Known pain points

- Slow stable cadence (13 months between 0.18.0 and 0.18.1), so `@next` is often needed.
- Global keyboard handling and focus fights with a host app; use `handleKeyboardGlobally={false}`.
  It also brings its own Radix/jotai copies.
- The UI is opinionated, with limited restyling beyond CSS variables. Hiding the Excalidraw
  menus and help is supported; deep changes need a fork.
- SVG export embeds fonts as woff2 subsets, which svg2pdf/jsPDF can't use. Vector PDF needs
  TTFs registered with jsPDF, or Electron's `printToPDF`.
- The "hand-drawn" look is the default; set `roughness: 0` and `fontFamily` to Nunito or
  Helvetica to get a cleaner FigJam look.
- Note: another agent's spike is already in `prototypes/sketchpad` (untracked, Excalidraw
  0.18.1 + jsPDF + svg2pdf).

---

## 2. tldraw

| Fact       | Value                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest     | `tldraw 5.5.2` (2026-10-02), very active (~51k stars)                                                                                                                        |
| React peer | `^18.2.0 \|\| ^19.2.1`                                                                                                                                                       |
| License    | "tldraw SDK license" (`SEE LICENSE IN LICENSE.md`). `@tldraw/store` and `@tldraw/state` are MIT; `tldraw`, `@tldraw/editor`, `@tldraw/sync(-core)` are under the SDK license |
| Deps       | tiptap 3 for rich text, radix-ui, idb                                                                                                                                        |

### License (the deciding factor)

- The default terms permit use **only in development**. Quote: "Under its default terms, the
  tldraw SDK license permits use only in development." LICENSE.md: you agree "Not to use the
  Software in Production Environments" unless you have a trial or commercial license.
- Without a key in production, the SDK logs errors and "after five seconds, stops rendering the
  editor". Trial keys stop at expiry; annual keys get a 30-day grace period.
- **Hobby license**: free, discretionary, non-commercial, and the "made with tldraw" watermark
  is required.
- **Commercial**: "value-based" pricing through sales. No prices are published, and older
  public figures aren't confirmed for 2026. Startup discounts exist. No OSS/nonprofit tier is
  listed.
- Open-source projects may include it, but "the SDK must stay under its original license", and
  **downstream users need their own license for production use**. The license page says the SDK
  is "not Open Source by any definition". LICENSE.md forbids interfering with key enforcement or
  watermark display.
- **AGPL fit: poor.** AGPL §7 / §10 forbid imposing further restrictions on recipients. Linking
  a dev-only, key-enforced, non-free library into the distributed app means a fork or
  redistribution of OpenMarch can't legally run in production without its own tldraw deal. The
  OpenMarch copyright holders (there's a CLA) could add a linking exception for their own
  distribution, but every web-editor deployment (lab, preview, forks) would still need a key,
  and the project would depend on tldraw's discretion. Treat it as a blocker unless tldraw grants
  an explicit OSS license in writing.

### Technical fit (excellent, if the license weren't an issue)

- Custom shapes via `ShapeUtil` (React component, geometry, `toSvg` for export), custom tools via
  `StateNode`, custom style props via `StyleProp.defineEnum` (so a custom `om:fill` enum is
  first-class), and UI overrides for every component, including `Background`, `Grid` and
  `OnTheCanvas`. A field background is a natural `Grid` or `Background` override. Built-in fills
  are `none, semi, solid, pattern, fill, lined-fill`.
- Export: `editor.getSvgString` / `toImage`, where custom shapes export through their `toSvg`.
- Sync: `@tldraw/sync` + `sync-core`, self-hosted. There's a Cloudflare Durable Objects
  template, or Node. `SQLiteSyncStorage` is recommended in production (better-sqlite3 or
  node:sqlite). Server and client must share the schema and migrations. This sits under the same
  SDK license.

---

## 3. Build our own

| Library                                                                                         | Version / license                            | Notes                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Konva + react-konva                                                                             | `konva 10.9.0` MIT; `react-konva 19.3.2` MIT | Mature scene graph, `Transformer` handles, hit-testing, `fillPatternImage`, custom `sceneFunc`. **react-konva 19.3 peers `react ^19.3.0`** (monorepo is on 19.2.4, so it would need a React bump). **No native SVG export** (canvas only), so vector SVG/PDF means a parallel SVG serializer |
| Fabric.js                                                                                       | `7.4.0` MIT                                  | Has `toSVG`, patterns, free-draw brushes, selection/transform. OpenMarch just **removed Fabric** for the field (ADR 0005, three.js renderer), so reintroducing it is a step back for maintainers                                                                                             |
| Paper.js                                                                                        | `0.12.20` MIT                                | Strong vector/path math (boolean ops, hit tests), `exportSVG`. Old API style, no React story, weak text editing                                                                                                                                                                              |
| Plain Canvas2D/SVG + `perfect-freehand` (1.2.3, MIT) + `roughjs` (4.6.6, MIT, last pushed 2024) | n/a                                          | Full control: dot fills are trivial (clip to shape, then lay dots on a grid, staggered or Poisson-disk). The field reuses `planField2d`. SVG export is native if the model renders to SVG                                                                                                    |
| Leafer UI                                                                                       | `leafer-ui 2.3.1` MIT, active                | Fast canvas engine plus an `@leafer-in/editor` plugin. Docs are mostly Chinese, and the ecosystem is small                                                                                                                                                                                   |

Effort for an Excalidraw-feel editor from scratch: selection, marquee, transform handles with
rotation, snapping, multi-point lines/arrows with curve handles, arrow binding, in-place text
editing (IME!), sticky notes, images, clipboard (internal + system + images), undo/redo,
z-order, grouping, zoom/pan with trackpad and touch, keyboard shortcuts, exports, and file
format and migrations. Realistically **3–5 engineer-months** to reach parity feel, then
ongoing polish. Text editing and touch alone are weeks. Use Excalidraw's element model
(flat array, `version`/`versionNonce`, fractional `index`, `boundElements`) as the
inspiration if we go this way, because it's collab-friendly by construction.

---

## 4. Others

- **Drawnix** (MIT, ~15k stars, pushed 2026-09) is a whiteboard app built on **Plait**
  (`@plait/core 0.94.1`, MIT, ~700 stars). It does mind maps, flowcharts and freehand, uses
  Slate for text, and has React and Angular bindings. Export is PNG plus `.drawnix` JSON; SVG
  isn't documented. Collab isn't described. Plait is still pre-1.0, and the community and docs
  are largely Chinese. It could serve as inspiration, but it's a weaker base than Excalidraw.
- **BlockSuite / AFFiNE edgeless**: `@blocksuite/blocks` is MPL-2.0, and the packages
  (`0.22.x`) haven't been published to npm since mid-2025. The work now lives in the AFFiNE
  monorepo. Too coupled to adopt.
- **Penpot** (MPL, a full design tool) and **Mermaid** (diagrams-as-code) are out, as briefed.
- **`@excalidraw/utils`** (0.1.5, MIT) offers export helpers without the editor, which is
  useful for headless export or thumbnails.

---

## 5. Collaboration and data model

| Option                                                | Version                                | Storage in SQLite                                                                                                            | Offline-first                                                          | Fit                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plain JSON + server-authoritative per-element LWW** | n/a                                    | `sketch_element(doc_id, id, json, version, version_nonce, index, deleted)` table, or one JSON blob per doc for v1            | Yes: queue local ops, server accepts newer versions, client reconciles | Matches Excalidraw's own model and OpenMarch's collab research (field-level LWW, server broadcast). Concurrent edits to the _same_ element lose one side, which is acceptable for sketches. Freedraw points are atomic per element anyway |
| **Yjs**                                               | `yjs 13.6.33` MIT, `y-websocket 3.1.0` | `Y.encodeStateAsUpdate(doc)` → one BLOB, plus optional append-only `updates` rows merged with `Y.mergeUpdates` and compacted | Excellent                                                              | Fine-grained merges (text, arrays), big ecosystem. But no maintained Excalidraw binding, a second source of truth beside the element array, tombstone growth, and a doc that isn't human-readable JSON                                    |
| **Automerge 3**                                       | `3.5.0` MIT                            | `save()` → BLOB; `saveIncremental()` chunks; `automerge-repo` storage adapters                                               | Excellent                                                              | JSON-like docs with history. Heavier wasm; 3.x cut memory a lot                                                                                                                                                                           |
| **Loro**                                              | `loro-crdt 1.16.4` MIT                 | `doc.export({mode:"snapshot"})` / `"update"` BLOBs, shallow snapshots to trim history                                        | Excellent                                                              | Fastest and has a movable tree/list. Younger ecosystem, wasm                                                                                                                                                                              |

Recommendation for the data model: store the **Excalidraw-shaped element array as JSON**
(per-element rows, or a blob in v1) with `version`/`versionNonce`/`index`. Collaboration then
uses the same server-authoritative LWW path as the main show, applied per sketch element, and
merges with `reconcileElements`. Revisit a CRDT only if co-editing a single text box or a
single freedraw stroke becomes a real need. Templates are a row copy. Images live in a
`sketch_file(id, mime, data BLOB)` table keyed by Excalidraw `FileId`, deduplicated by hash.

---

## 6. PDF export

| Lib                               | Version                               | Vector?                            | Notes                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jspdf`                           | `4.2.1` MIT, active                   | Yes (path API)                     | 4.0 was a security major (Node fs access off by default; fixes for CVE-2025-68428). Upgrade to latest 4.x                                                                                                                                                                           |
| `svg2pdf.js`                      | `2.8.1` MIT, active (2026-08)         | Yes                                | Converts an SVG DOM to jsPDF vector. It supports "only a limited part of the SVG specification", needs a real DOM, and fonts beyond the base set must be registered (TTF) with jsPDF, so it can't use Excalidraw's embedded woff2. Keep the exported SVG simple (paths, no filters) |
| `pdf-lib`                         | `1.17.1` MIT, **last published 2022** | Low-level drawing only             | Good for merging or assembling pages, not for SVG → PDF                                                                                                                                                                                                                             |
| Electron `webContents.printToPDF` | built in                              | Yes, full fidelity incl. web fonts | Desktop only. Render the composed SVG in a hidden window. The web/static build falls back to jsPDF + svg2pdf                                                                                                                                                                        |

Suggested path: compose one SVG (field `<g>` + `exportToSvg` output, with Excalidraw text
rendered as text using registered TTFs, or a `"Helvetica"` family that jsPDF has built in) →
`svg2pdf` → jsPDF for both builds, with `printToPDF` as the desktop high-fidelity option if
fonts become a problem. PNG uses `exportToBlob` / canvas compose.

---

## 7. Recommendation matrix

Scores 1–5 (5 is best). Effort is to a credible v1.

| Option                                       | Feel/fit           | Custom fills                                                | Field background                                    | License fit (AGPL)                                      | Collab path                           | Effort to v1                               |
| -------------------------------------------- | ------------------ | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| **Excalidraw (thin fork)**                   | 5                  | 4 (fork adds dot fills properly; line and cross fills free) | 4 (transparent bg + synced layer; or fork renderer) | 5 (MIT)                                                 | 4 (element LWW + `reconcileElements`) | **~4–6 wks**                               |
| Excalidraw (no fork)                         | 5                  | 2 (dot fills on an overlay, z-order breaks)                 | 4                                                   | 5                                                       | 4                                     | ~3–4 wks                                   |
| tldraw                                       | 5                  | 5 (custom StyleProp + ShapeUtil)                            | 5 (`Grid`/`Background` override)                    | **1** (dev-only without key; downstream needs licenses) | 4 (tldraw sync, same license)         | ~3–5 wks + license                         |
| Own: Canvas2D/SVG + perfect-freehand + rough | 3 (until polished) | 5                                                           | 5                                                   | 5                                                       | 5 (designed for it)                   | 3–5 months                                 |
| Own: Konva                                   | 3                  | 4                                                           | 5                                                   | 5                                                       | 4                                     | 3–4 months (+ SVG serializer, React bump)  |
| Fabric                                       | 3                  | 4                                                           | 4                                                   | 5                                                       | 3                                     | 3 months (and reverses ADR 0005 direction) |
| Drawnix/Plait                                | 3                  | 2                                                           | 3                                                   | 5                                                       | 2                                     | unclear; pre-1.0 core                      |

## 8. Top pick: Excalidraw, as a maintained thin fork

Reasons:

- It's the feel the brief names, and most tools are already done: freedraw, lines and
  polylines, arrows with binding, curves, shapes, text, images, frames, copy/paste, libraries
  (useful as "templates" for formations), and its own undo with `CaptureUpdateAction`.
- MIT, React 19-compatible, and works offline with self-hosted fonts. It also runs fine as a
  standalone Vite static site, since excalidraw.com itself is one.
- Its element model already _is_ per-element LWW (`version`/`versionNonce`/fractional
  `index`, `reconcileElements`), which lines up with OpenMarch's server-authoritative LWW
  direction, so no CRDT is needed.
- The field stays out of the document. A transparent `viewBackgroundColor` plus a
  `planField2d` layer synced from `onScrollChange` gives instant restyling and reuses the
  drill-chart SVG for exports.
- Fills: lines and cross lines work today (hachure / cross-hatch at `roughness: 0`). The three
  dot fills are a small, contained fork patch in the shape generator, the SVG path, the picker
  and restore.

Plan: start unforked (prototype the field layer, export composition and SQLite save). Fork
only when the dot fills land, and keep the fork as a small rebased patch series on upstream
`master`, the way `@zsviczian/excalidraw` does.

Risks:

- **Fork upkeep**: upstream moves daily and stable releases are rare. Keep patches minimal and
  in a few files, and pin to a known `@next` commit.
- **Layer sync jitter** between the field layer and the Excalidraw canvas during pinch-zoom or
  pan. Measure it early (see feel-testing notes). The fallback is drawing the field inside the
  forked static renderer.
- **Dark theme**: Excalidraw transforms colors in dark mode, so the field layer must follow the
  same rule or opt out.
- **PDF text fidelity** with svg2pdf (fonts must be TTF-registered). `printToPDF` covers
  desktop.
- **Same-element concurrent edits** lose one side under LWW. That's acceptable for freeform
  sketches, and the reason to keep CRDTs as a later option.
- **Bundle**: ~300 KB gz eager plus a lazy ~740 KB font-subsetting chunk, plus 13 MB of fonts
  on disk (trim the CJK fonts if needed). Lazy-load the Sketchpad route.
- tldraw would be the technically easiest extensible option, but its license is incompatible in
  practice with a freely redistributed AGPL app unless tldraw grants an explicit written
  exception.

## Sources

- npm registry metadata and tarballs: `@excalidraw/excalidraw@0.18.1` and `@next`, `tldraw`,
  `@tldraw/sync`, `konva`, `react-konva`, `fabric`, `paper`, `perfect-freehand`, `roughjs`,
  `yjs`, `y-websocket`, `y-excalidraw`, `@automerge/automerge`, `loro-crdt`, `jspdf`,
  `svg2pdf.js`, `pdf-lib`, `@plait/core`, `leafer-ui`, `@blocksuite/*`, `@zsviczian/excalidraw`
- https://github.com/excalidraw/excalidraw (master `packages/element/src/types.ts`,
  `packages/excalidraw/renderer/helpers.ts`, `packages/element/src/renderElement.ts`), releases API
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation
- https://github.com/excalidraw/excalidraw-room, https://github.com/RahulBadenkal/y-excalidraw
- https://tldraw.dev/community/license, https://github.com/tldraw/tldraw/blob/main/LICENSE.md,
  https://tldraw.dev/pricing, https://tldraw.dev/sdk-features/license-key, https://tldraw.dev/docs/sync,
  `packages/tlschema/src/styles/TLFillStyle.ts`
- https://github.com/plait-board/drawnix, https://github.com/worktile/plait
- https://github.com/yWorks/svg2pdf.js, jsPDF 4.0.0 release notes (CVE-2025-68428)
- OpenMarch: `apps/desktop/src/field/fieldPlan.ts`; collab research
  `~/GitHub/OpenMarch-collab/docs/collaboration/REPORT.md` (field-level LWW recommendation)
