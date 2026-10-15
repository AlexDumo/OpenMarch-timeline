# Phase 3: Drawing

Make the new field look like today's in every show, and keep it working on
weak machines.

## Tickets

- **#199 Marcher appearance.** The appearance cascade from tags, sections and
  the field theme, and every dot shape, in the one instanced marcher draw.
  Dots sit exactly on their coordinates. Labels scale with the field and fade
  out below a readable size.
- **#200 Field themes and background image.** Every theme and field variant,
  and the background image with its fit or fill and opacity.
- **#201 Timeline visuals.** Pathways, previous and next positions,
  midpoints, step-size warnings, dimmed marchers, the isolation focus layer,
  kept marks, collision markers and "zoom to collisions". Needs #199 and
  #200.
- **#205 Weak machines.** Low-quality mode on software or missing WebGL with
  a one-time explanation, the Performance mode setting, the GPU blocklist
  override with a crash fallback, context-loss recovery, and the in-app
  benchmark ported from the prototype.

## Exit gate

- Render comparisons against Fabric on the demo shows show only the listed
  changes (dot offset, label fade).
- The in-app benchmark runs on production builds. Software-GL numbers are
  lower bounds; real hardware is checked in #208.

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

### #205 Weak machines

**Quality.** `src/field/fieldQuality.ts` (plain TypeScript) classifies the
WebGL renderer string (`hardware`, `software` or `none`), decides the mode
(`fieldQuality`: no WebGL, then a GPU crash, then software GL, then the
Performance mode setting) and holds what low quality changes in one table,
`QUALITY_SETTINGS`: DPR 1 instead of `[1, 2]`, labels hidden below 8 CSS px
per em instead of 4 (and not drawn at all when hidden), and field lines under
30% of a device pixel skipped instead of faded. MSAA is off in both modes.
`src/field/three/useFieldQuality.ts` has `useFieldQuality()` for React and
`currentFieldQuality()` for frame hooks.

- **#199, #201 and other layers:** read `currentFieldQuality().settings` in
  the frame hook for anything worth cheapening (e.g. skip pathways' dashes or
  midpoints in low quality), and add the knob to `QUALITY_SETTINGS` rather
  than checking the mode.
- The setting is `fieldPerformanceMode` in `UiSettings`, shown in Settings,
  Appearance only while the dev switch picks the new field. **#209:** drop
  that condition and add `settings.general.performanceMode` to the
  Appearance section's `searchKeys`.

**What's on screen.** `FieldQualityNotice.tsx`: the one-time toast for
software GL (remembered in `localStorage` under
`openmarch:field:qualityNoticeSeen`) and for a GPU crash (once a session),
and `FieldUnavailable`, shown in place of the field without WebGL. The
default export of `ThreeField.tsx` is now an error boundary around
`ThreeFieldView`, so a canvas that can't get a context shows the
explanation instead of the app's error boundary.

**Context loss.** `fieldRecovery.tsx`'s `ContextLossGuard` (inside the
Canvas) asks for a frame when the browser restores the context (three
rebuilds its GPU state; the on-demand loop would otherwise never draw), and
starts the field over on a new canvas (a new `key`) if it isn't back within
2 s. Anything that holds GPU objects outside the layers' `useMemo` (like the
glyph atlases' textures) is re-uploaded by three on its own; keep CPU-side
copies of anything you upload.

**Desktop.** `ignore-gpu-blocklist` and the `gpu:crashed` /
`gpu:process-gone` channels: see ADR 0005 D-3, "How #205 built it".

**Benchmark.** "Run field benchmark" in the command palette (only with the
new field) opens `src/field/benchmark/FieldBenchmark.tsx`; scripts call
`await window.fieldBenchmark.run()` for the same report as JSON
(`benchmarkMarkdown` turns it into the table). Each scenario runs 4 s and
measures every drawn frame through R3F's `addEffect`/`addAfterEffect`.
Scenarios are in `fieldScenarios.ts`:

- **#194:** zoom and pan write `useFieldViewStore` directly, bypassing the
  limits. That's fine for measuring; keep the store's shape or update them.
- **#196:** `drag` is a stub (reported as skipped). Make it select every
  marcher and drag them in a circle through the editor's move gesture, as
  the prototype's `bench("drag")`, and undo afterwards.
- **#208:** run it on production builds only (the dialog warns on a
  development build). Real-hardware rows come from there; software-GL rows
  are lower bounds.

**Scenarios.** `e2e/browser/tests/weak-machines.spec.mts` (new field only):
low-quality mode and its one-time notice under software GL, DPR 1 on a 2×
screen, no WebGL (browser only, through the new `initScript` fixture
option), a lost context restored and one never restored (simulated with
`WEBGL_lose_context`, checked on screen pixels), a killed GPU process
(Electron only, `show.killGpuProcess()`), and the benchmark from the command
palette. The fixture now marks the software-GL notice as already shown,
unless a test sets `fieldQualityNotice: true`, so the toast covers nothing
in other scenarios.
