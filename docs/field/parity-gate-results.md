# Parity gate results (#208)

The automated half of the [parity gate](implementation-plan.md#parity-gate),
run on the fork branch `field-renderer` (with this ticket's tooling merged),
plus what the owner still has to do: the
[hands-on checklist](parity-checklist.md) and the
[benchmark on real hardware](#benchmark-on-real-hardware).

Every number here comes from this agent machine: an AMD 6-core desktop CPU (12 threads),
no GPU. **Headless Chromium draws WebGL in software (SwiftShader)** and
Electron in a container uses software GL too, so every frame rate here is a
lower bound, and a comparison of the two fields here says nothing about real
hardware.

## Summary

| Gate item                                           | Result                                                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scenario suite, browser, new field               | SCENARIO_BROWSER_THREE                                                                                                                                                                        |
| 1. Scenario suite, browser, Fabric                  | SCENARIO_BROWSER_FABRIC                                                                                                                                                                       |
| 1. Scenario suite, Electron, new field              | SCENARIO_ELECTRON_THREE                                                                                                                                                                       |
| 1. Scenario suite, Electron, Fabric                 | SCENARIO_ELECTRON_FABRIC                                                                                                                                                                      |
| 2. Render comparisons (3 shows × 3 zooms × 4 times) | Every difference explained ([below](#2-render-comparisons)). One unlisted difference found (labels over neighboring dots) and fixed in #245 by owner decision. Prerelease `field-render-208`. |
| 3. Export diffs: drill charts and PDFs              | EXPORT_VERDICT                                                                                                                                                                                |
| 3. Export diffs: video                              | VIDEO_VERDICT                                                                                                                                                                                 |
| 4. Owner's hands-on checklist                       | Not run yet: [parity-checklist.md](parity-checklist.md)                                                                                                                                       |
| 5. Benchmark, software GL here                      | BENCH_VERDICT                                                                                                                                                                                 |
| 5. Benchmark, real hardware                         | Not run yet: [steps below](#benchmark-on-real-hardware)                                                                                                                                       |
| Open issues                                         | OPEN_ISSUES                                                                                                                                                                                   |

## 5. Benchmark on this machine (software GL)

`e2e/browser/render/benchmark.spec.mts` runs the in-app benchmark
(`window.fieldBenchmark.run()`) on the corpus, on a production browser build
in headless Chromium, 1600 × 1000 window (field 1206 × 699 CSS px at 1×), on
a quiet machine. **WebGL here is SwiftShader (software)**, so the new field
runs in low-quality mode, and Fabric's Canvas2D is software too. These are
lower bounds; they don't predict real hardware, where the prototype measured
the opposite (WebGL 60 fps at 1,925 marchers where Fabric managed about 1).

```sh
BENCHMARK_OUT=/tmp/bench FIELD=fabric pnpm exec playwright test --project=render benchmark
BENCHMARK_OUT=/tmp/bench FIELD=three pnpm exec playwright test --project=render benchmark
```

fps, Fabric / new field (p95 frame interval in ms in brackets):

| Show            | play                   | scrub                 | zoom                  | pan                   |
| --------------- | ---------------------- | --------------------- | --------------------- | --------------------- |
| Part 1 (95)     | 60.0 / 59.8 (17 / 19)  | 59.7 / 51.6 (17 / 22) | 53.8 / 60.0 (25 / 17) | 4.4 / 60.0 (232 / 17) |
| Daft Punk (385) | 60.0 / 27.9 (17 / 39)  | 60.0 / 26.8 (17 / 40) | 27.9 / 37.6 (58 / 35) | 4.2 / 30.9 (242 / 35) |
| Stress (1,925)  | 19.1 / 5.5 (155 / 187) | 16.5 / 5.5 (65 / 195) | 5.7 / 8.0 (304 / 175) | 3.5 / 5.7 (295 / 179) |

Main-thread time per frame: the new field 0.2–1.2 ms; Fabric 0.7–47 ms for
play and scrub and 9–283 ms for zoom and pan. Drag isn't measured yet.

What it shows: with no GPU, the new field is limited by single-threaded
SwiftShader filling pixels (its main thread is nearly idle), while Fabric
plays and scrubs from cached sprites and so wins on mid-size shows, as the
prototype found (385 marchers on SwiftShader: Fabric 60, prototype 29).
Fabric's pan is about 4 fps here because every pan frame redraws its grid
(its real trackpad pan measures the same). On real hardware the new field
should hold 60 fps; the rows below decide the gate.

How each field is measured: the frames each field draws (R3F's render on the
new field; Fabric's `before:render` to `after:render`), during the same
scenarios. Play and scrub drive the app's playhead; zoom is a pinch
(Ctrl+wheel) through each field's own input, so Fabric uses the grid cache
it keeps while zooming; pan moves each field's view as its trackpad pan
does.

## Benchmark on real hardware

Gate item 5: the in-app benchmark on a real low-end Chromebook (the lab web
build) and an integrated-GPU laptop (the desktop app), on both fields, with
no regression on the new field. The benchmark plays the show from the top,
scrubs back and forth across it, pinch-zooms in to 8× and out, and pans in a
circle, 4 s each, then shows a table. Dragging isn't measured yet (#208
follow-up). Since #208 it runs on the Fabric field too, so both fields can be
measured on the same machine. The lab build has that once #208's PR is
merged into `field-renderer` (the lab republishes on every push); before
that, "Run field benchmark" only exists on the new field.

### Shows

Download the three show files from the fork prerelease `field-render-208`
and open each with the app's Open file, so both builds open the same files:

- `part1-demo.dots` (95 marchers) and `lhb-daft-punk-pt2.dots` (385): the
  demo shows, already converted to timelines;
- `stress-1925.dots` (1,925): every Daft Punk marcher cloned four times.

### Before each run

1. Plug the machine in, close other apps and tabs, and leave it a minute to
   settle.
2. Make the window full size (not fullscreen), and leave the panels as they
   open.
3. Open the show and wait until the timeline has loaded (about 10 s for the
   stress show).
4. Don't touch the mouse or keyboard while it runs.

### Chromebook: the lab web build

1. Open `chrome://gpu` and note the first lines of "Graphics Feature Status"
   (WebGL: "Hardware accelerated" or not) and the GL renderer. If WebGL is
   software only, say so in the results: the new field runs in low-quality
   mode there.
2. Fabric: open <https://lab.openmarch.com/x/field-renderer/> (or the same
   build without the lab's sign-in:
   <https://field-renderer-openmarch-fork-preview-build.alexdumo.workers.dev/>),
   open the show, press Ctrl+K, type "field benchmark", press Enter, then
   **Run**.
3. When the table shows, press **Copy as Markdown** and paste it into the
   results table below (or a comment on #208).
4. New field: add `?field=three` to the address, reload, and repeat steps
   2–3 on the same show.
5. Repeat for the three shows. Run each one twice if the numbers look odd.

### Laptop with integrated graphics: the desktop app

The desktop app needs a production build of `field-renderer`:

1. `git fetch timeline field-renderer && git switch --detach timeline/field-renderer`
2. `pnpm install && pnpm --filter @openmarch/desktop build:electron`
3. Start the app from `apps/desktop/release/<version>/` (the unpacked app
   for your platform, e.g. `win-unpacked/OpenMarch.exe` or
   `mac/OpenMarch.app`).
4. Fabric: open the show, Ctrl/Cmd+K, "field benchmark", **Run**, then
   **Copy as Markdown**.
5. New field: View › Toggle Developer Tools, Console, run
   `localStorage.setItem("openmarch:dev:field", "three")`, then View ›
   Reload. Repeat step 4. To go back to Fabric, run
   `localStorage.removeItem("openmarch:dev:field")` and reload.
6. Also time a video export of the Daft Punk show (Export › Video, 1080p,
   30 fps) on each field: from pressing Export to "Export completed!". Here
   (software GL) the new field took about 3× as long as Fabric; the question
   is whether that holds with a real GPU.

### Results to fill in

fps (higher is better) per scenario; "p95" is the 95th-percentile time
between frames in ms (lower is better).

| Machine    | GPU / GL renderer | Show            | Field  | play fps | scrub fps | zoom fps | pan fps | play p95 ms | Video export |
| ---------- | ----------------- | --------------- | ------ | -------- | --------- | -------- | ------- | ----------- | ------------ |
| Chromebook |                   | Part 1 (95)     | Fabric |          |           |          |         |             | –            |
| Chromebook |                   | Part 1 (95)     | new    |          |           |          |         |             | –            |
| Chromebook |                   | Daft Punk (385) | Fabric |          |           |          |         |             | optional     |
| Chromebook |                   | Daft Punk (385) | new    |          |           |          |         |             | optional     |
| Chromebook |                   | Stress (1,925)  | Fabric |          |           |          |         |             | –            |
| Chromebook |                   | Stress (1,925)  | new    |          |           |          |         |             | –            |
| Laptop     |                   | Part 1 (95)     | Fabric |          |           |          |         |             |              |
| Laptop     |                   | Part 1 (95)     | new    |          |           |          |         |             |              |
| Laptop     |                   | Daft Punk (385) | Fabric |          |           |          |         |             |              |
| Laptop     |                   | Daft Punk (385) | new    |          |           |          |         |             |              |
| Laptop     |                   | Stress (1,925)  | Fabric |          |           |          |         |             |              |
| Laptop     |                   | Stress (1,925)  | new    |          |           |          |         |             |              |

The gate passes when no new-field row is slower than its Fabric row, and the
new field holds about 60 fps on play and scrub where the GPU is real.

## 1. The scenario suite

146 scenarios in 31 files (`e2e/browser/tests/`), each run three times
(`--repeat-each=3`) in the browser and twice in Electron, on both fields.
On Fabric, 22 scenarios are expected to fail (`test.fail`): the 19 `change:`
scenarios, the rules-table changes, plus 3 where Fabric has a known bug the
new field fixes. Skips are opt-in capture specs and target- or field-only
scenarios.

```sh
# from apps/desktop, after pnpm run build:browser
FIELD=three  pnpm exec playwright test --project=browser --workers=4 --repeat-each=3
FIELD=fabric pnpm exec playwright test --project=browser --workers=4 --repeat-each=3
# Electron (after pnpm run build), headless in Docker + Xvfb
FIELD=three  ~/om-capture/e2e --repo <worktree> --project=electron-scenarios --workers=3 --repeat-each=2
FIELD=fabric ~/om-capture/e2e --repo <worktree> --project=electron-scenarios --workers=3 --repeat-each=2
```

| Target, field       | Quiet machine                                                   | Under load           |
| ------------------- | --------------------------------------------------------------- | -------------------- |
| Browser, new field  | 411 passed, 0 failed, 27 skipped                                | LOAD_BROWSER_THREE   |
| Browser, Fabric     | 381 passed (66 of them expected failures), 0 failed, 57 skipped | LOAD_BROWSER_FABRIC  |
| Electron, new field | ELECTRON_THREE                                                  | ELECTRON_LOAD_THREE  |
| Electron, Fabric    | ELECTRON_FABRIC                                                 | ELECTRON_LOAD_FABRIC |

### Failures and their causes

FAILURE_LIST

## 2. Render comparisons

`e2e/browser/render/corpus-render.spec.mts` (project `render`): the Part 1
demo (95 marchers), Daft Punk pt. 2 (385) and the stress show (1,925, built
by `render/stressShow.mts`, the prototype's script), at three zooms (`fit`,
the opening view; `near`, 2.5×; `close`, 6×, pinched in at the marchers'
center) and four times (the first page, page 4, four beats into the next
move, and two beats past page 8): 36 cases. The new field picks the view and
Fabric is pointed at the same one, so the pairs line up in field units. Side
by sides, diffs and `summary.tsv` are in the fork prerelease
[`field-render-208`](https://github.com/AlexDumo/OpenMarch-timeline/releases/tag/field-render-208).

```sh
pnpm run build:browser
FIELD=three pnpm exec playwright test --project=render corpus-render
FIELD=fabric pnpm exec playwright test --project=render corpus-render
```

Changed pixels (no match within one pixel; most of it is the half-line
shift of every grid line):

| Show      | fit        | near       | close     |
| --------- | ---------- | ---------- | --------- |
| Part 1    | 36.2–36.3% | 11.6–11.7% | 8.5–9.4%  |
| Daft Punk | 9.1–9.3%   | 6.6–9.4%   | 3.3–8.0%  |
| Stress    | 17.6–21.7% | 24.2–32.3% | 8.5–35.9% |

Part 1's demo copy uses a dark theme with a white line every step, so at fit
nearly every pixel is next to a grid line that moved half a line. Marchers
stand in the same places at every time in every case, mid-move included.

Every difference, and where it's decided:

| Difference                                                                                    | Where it's decided                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid, dots and labels half a grid line up and left of Fabric's                                | Rules table, Dot position (#199, #200)                                                                                                                                                                            |
| Lines pixel-snapped where Fabric smooths them over two pixels                                 | #200                                                                                                                                                                                                              |
| Yard numbers centered on their yard line, not 22 units left of it                             | Export improvements (#206), #200                                                                                                                                                                                  |
| Marcher labels in SDF glyphs (Courier New bold): about a pixel different                      | #192, #199                                                                                                                                                                                                        |
| Labels fade out below a readable size (on Fabric they shrink to a smear)                      | Rules table, Labels                                                                                                                                                                                               |
| Dots at least 1.5 CSS px in radius at very low zooms                                          | #192                                                                                                                                                                                                              |
| Labels drew over neighboring dots; on Fabric (and in the export) every dot covers every label | Owner decision 2026-10-15: match Fabric. Fixed in #245 (labels at render order 1.9, under the dots); `label-stacking.spec.mts` pins it. The stress-show cases in `field-render-208` were captured before the fix. |

The timeline drawing (pathways, isolation, kept marks, collisions) and every
theme, variant and field image were compared in #201 and #200 (prereleases
`field-render-201`, `field-render-200`; marcher shapes in `render-diff-199`),
and their drawing hasn't changed since.

## 3. Export diffs

Fork prerelease
[`export-diff-208`](https://github.com/AlexDumo/OpenMarch-timeline/releases/tag/export-diff-208)
(README inside).

**Drill charts and PDFs.** `render/export-compare.spec.mts` exports drill
charts through the export dialog (full and individual), and the browser
harness writes each chart's SVG pages, the PDF's input. Before: `field-renderer`
at 04ce48876 (Fabric draws the charts, just before #206) with the current
harness copied in. After: this branch. `render/export-diff.mts` pairs them
as drawn, aligned for Fabric's half-pixel offset, and as PDF pages
(pdfkit + svg-to-pdfkit, as the PDF export draws them, read back with
pdf.js).

```sh
EXPORT_COMPARE=/tmp/ec EXPORT_COMPARE_LABEL=after pnpm exec playwright test --project=render export-compare
# the same with EXPORT_COMPARE_LABEL=before in a base worktree, then:
node e2e/browser/render/export-diff.mts /tmp/ec before after 3
```

| Show                                   | as drawn  | aligned    | PDF      |
| -------------------------------------- | --------- | ---------- | -------- |
| Part 1, 23 full + 69 individual charts | 21.9%     | 0.54–0.58% | 22.3%    |
| Part 1 with a field image              | 22.0%     | 0.68–0.78% | 21.6%    |
| Daft Punk, 18 full charts              | 9.9–10.5% | 1.12–1.39% | 8.2–8.9% |

Same content. Aligned, what's left is #206's approved list (centered drill
numbers and yard numbers, side labels, the closed border); Daft Punk has four
times as many labels. The demo copies used here have a dark theme with a line
every step, which is why the unaligned and PDF shares are higher than #206's
(9–12% and 3.6–6.8% on the default theme). Fabric didn't finish Daft Punk's
385 individual charts in 28 minutes, so individual charts are compared on
Part 1 only.

**Video.** #207's `video-compare` rerun (before: af5b9b441, Fabric's video
canvas; after: this branch). Every frame's PSNR is identical to #207's
reviewed run (`field-video-207`) to six decimals: the export draws exactly
what was approved there. 1080p export times here (software GL, a loaded
machine): Part 1 60 → 145 s, Part 1 with image 68 → 190 s, Daft Punk 129 →
262 s, so 2.0–2.8× Fabric's. To time on real hardware (benchmark step 6).
