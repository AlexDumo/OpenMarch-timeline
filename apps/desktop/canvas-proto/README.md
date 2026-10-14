# Canvas prototype: three.js field editor (throwaway)

> **PROTOTYPE. Never merge.** Lives on branch `proto/three-canvas` only. It
> answers one question: can a three.js orthographic scene replace Fabric for
> the 2D field: dots, labels, pathways, playback, scrubbing and basic editing,
> with smooth frames on real shows and on a 2,000-marcher stress show, and on
> weak machines?

## Run

From `apps/desktop`:

```bash
pnpm run canvas-proto:dev     # http://localhost:5190
```

URL parameters: `show=part1|lhb|stress2000|stress5000`, `aa=0` (no MSAA,
"potato mode"), `dpr=1|1.5|2|3` (pixel-ratio cap).

## What's in it

- `render/`: the WebGL side. `scene.ts` owns one `WebGLRenderer` and draws
  the whole field in about 10 draw calls whatever the marcher count:
  - `fieldLayer.ts`: grid, half lines, yard lines and hashes as
    `LineSegments2` (one call per stroke style), labels and yard numbers;
  - `dotLayer.ts`: every dot in one instanced call, drawn as a distance
    field so edges stay smooth without MSAA, with the selection ring in the
    same call;
  - `sdfText.ts`: SDF glyph atlas built in the browser, every label in one
    instanced call, sharp at any zoom;
  - `view.ts`: the orthographic camera and screen↔field mapping, shared by
    the SVG overlay.
- `editor.ts`: time, playback, selection (click, Shift-click, marquee),
  drag with step snapping, scale/rotate handles, arrow nudges, undo/redo,
  zoom/pan, and the benchmark runner. No React in the per-frame path.
- `App.tsx`: toolbar, transport, the SVG overlay (marquee, selection box,
  handles) and the benchmark table.
- `realShow.ts`: opens a `.dots` file in the browser with sql.js (the 3D
  preview's host) and samples positions from the same timeline resolver the
  editor uses. `source.ts`: the stress show generator.

Edits are in-memory offsets per page and are never saved.

## Keys

Space play/pause · Q/E (or [ ]) previous/next page · arrows nudge one step
(Shift: four) · Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z undo/redo · Ctrl/Cmd+A select
all · Esc deselect · F fit · hold H (or Alt, or middle button) and drag to pan.
Drag snaps the grabbed marcher to the step grid (Shift: free). Rotation snaps
to 15° with Shift.

## Benchmarks

"Run benchmarks" (or `await __proto.bench("play"|"scrub"|"zoom"|"pan"|"drag", ms)`
in the console) records rAF intervals, CPU time per frame and GPU time
(timer queries, where available) in the page.
