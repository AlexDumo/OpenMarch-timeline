# Phase 4: Timeline interactions, tools and exports

Port the remaining field behavior and the outputs that draw the field.

## Tickets

- **#202 Timeline interactions.** The kept-mark hover tooltip, Escape leaving
  isolation (except during an alignment event, overlay or clip gesture), the
  first press after a paused preview only clearing it, and dimmed marchers
  that still can't be selected, including while a tool is active.
- **#203 Line tool.** The line tool (L) as today, with its previews in the
  overlay.
- **#204 Box shape tool.** Rebuilt on the editor and overlay from box v1's
  design (fork PR #181): its state machine and geometry. #181 stays held and
  isn't merged on Fabric.
- **#207 Video export and field previews.** Video frames rendered through
  the new field off screen, at today's quality or better. Field previews
  (such as the launch page's) use the new field.

## Exit gate

- Each ticket's scenarios pass on the new field.
- Video export and previews no longer need Fabric.

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

### #207 Video export and field previews

**The video export draws through the new field, whichever field is on
screen.** `src/field/three/offscreenField.tsx` (`createOffscreenField`) mounts
the on-screen field's layers (field, image, marchers, labels) in their own
React Three Fiber root (`createRoot`, `frameloop: "never"`) on a canvas that's
never in the page. `draw(beat)` fills a `FieldMarchers` from the export's own
resolver (`ResolverFrameSampler.source`) and runs `advance` for that root
only, synchronously, so the canvas holds the frame when it returns
(`preserveDrawingBuffer`). `videoFrameRenderer.ts` copies it onto the 2D frame
canvas and draws the overlay and branding there, as before. Fabric's video
canvas (`videoCanvas.ts`) is gone.

- **View and quality reach the layers through `fieldDrawContext.ts`**
  (`useFieldDraw()`): by default the one view store and the machine's quality
  mode, as before; the export provides its own view store and
  `EXPORT_QUALITY` (full quality on any machine, labels never fade, as
  Fabric's export drew them). **New layers must read the zoom and quality
  through `useFieldDraw()`, not `useFieldViewStore` or
  `currentQualitySettings()`, or they'll draw exports at the screen's zoom.**
- **Resolution.** Video frames are drawn at DPR 1, one field pixel per video
  pixel (`computeFieldView`: the field fitted with 40 units of margin, then
  the user's framing). The dialog's preview draws at the screen's DPR
  (`pixelRatio`), so it's sharp.
- **Appearance** comes from the field's appearance steps
  (`useMarcherAppearanceSteps`, the last flag crossed), the same rule the old
  per-page map applied by time. `getPlaybackPageForTimeMs` went with it.
- **No WebGL.** `createOffscreenField` rejects with `NoWebGLError`
  (`fieldQuality.ts`). The dialog then says the export needs WebGL and
  disables Export. This holds on the Fabric field too: a machine with no
  WebGL loses video export, which drew on Canvas2D before (no Canvas2D
  fallback, per the spec).
- **three.js stays lazy:** `createVideoRenderContext` imports
  `offscreenField` dynamically (`fieldChunk.test.ts` would fail otherwise).
- The export draws no pathways, collisions or dimming, as before. A later
  export option can add `OverlayLayer`s with a plan and a render order.
- **Speed** (software GL, headless, a busy machine): the three demo exports
  at 1080p took 3.6 / 3.9 / 5.1 min against Fabric's 1.2 / 1.5 / 2.2 min.
  Software GL is the bottleneck, as everywhere on the new field; #208's
  real-hardware runs should time an export too.

**Previews.** `components/field/FieldPreview.tsx` (the new show wizard's field
step) is an SVG image from `fieldSvg` (`drillChartSvg.ts`); the launch page's
show previews were already SVG (#206). Nothing outside
`components/canvas/`, `global/classes/canvasObjects/` and the frozen timeline
hooks constructs an `OpenMarchCanvas` now, apart from the editor's own
`Canvas.tsx`.

**Scenarios.** `video-export.spec.mts` exports a short seeded show and reads
frames with ffmpeg (size, length, marchers where the show file puts them),
and checks the no-WebGL explanation (browser only). The harness gained the
export's IPC (`host/index.ts`), `show.videoExportPath`, and the `webgl`
option (Electron software GL on the Fabric field).
`render/video-compare.spec.mts` + `video-compare.sh` produce before/after
frame pairs; the #207 run is fork prerelease `field-video-207`. **#208:**
rerun it for the export diffs; the differences are the field drawing's
(pixel-snapped grid, no half-line offset, centered yard numbers, image shift,
SDF label glyphs). **#209:** `staticGridExport.test.ts`'s comment refers to
the old static field cache; it goes with Fabric.
