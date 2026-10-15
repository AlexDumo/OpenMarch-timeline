# Parity gate results (#208)

The automated half of the [parity gate](implementation-plan.md#parity-gate),
run on the fork branch `field-renderer` (with this ticket's tooling merged),
plus what the owner still has to do: the
[hands-on checklist](parity-checklist.md) and the
[benchmark on real hardware](#benchmark-on-real-hardware).

Every number here comes from this agent machine: Ryzen 5 3600 (12 threads),
no GPU. **Headless Chromium draws WebGL in software (SwiftShader)** and
Electron in a container uses software GL too, so every frame rate here is a
lower bound, and a comparison of the two fields here says nothing about real
hardware.

## Summary

| Gate item                                           | Result                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scenario suite, browser, new field               | SCENARIO_BROWSER_THREE                                                                                                                                     |
| 1. Scenario suite, browser, Fabric                  | SCENARIO_BROWSER_FABRIC                                                                                                                                    |
| 1. Scenario suite, Electron, new field              | SCENARIO_ELECTRON_THREE                                                                                                                                    |
| 1. Scenario suite, Electron, Fabric                 | SCENARIO_ELECTRON_FABRIC                                                                                                                                   |
| 2. Render comparisons (3 shows × 3 zooms × 4 times) | Every difference explained ([below](#2-render-comparisons)). One isn't decided yet: labels draw over dots on the new field. Prerelease `field-render-208`. |
| 3. Export diffs: drill charts and PDFs              | EXPORT_VERDICT                                                                                                                                             |
| 3. Export diffs: video                              | VIDEO_VERDICT                                                                                                                                              |
| 4. Owner's hands-on checklist                       | Not run yet: [parity-checklist.md](parity-checklist.md)                                                                                                    |
| 5. Benchmark, software GL here                      | BENCH_VERDICT                                                                                                                                              |
| 5. Benchmark, real hardware                         | Not run yet: [steps below](#benchmark-on-real-hardware)                                                                                                    |
| Open issues                                         | OPEN_ISSUES                                                                                                                                                |

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

| Show      | fit         | near        | close        |
| --------- | ----------- | ----------- | ------------ |
| Part 1    | 36.2–36.3%  | 11.6–11.7%  | 8.5–9.4%     |
| Daft Punk | 9.1–9.3%    | 6.6–9.4%    | 3.3–8.0%     |
| Stress    | 17.6–21.7%  | 24.2–32.3%  | 8.5–35.9%    |

Part 1's demo copy uses a dark theme with a white line every step, so at fit
nearly every pixel is next to a grid line that moved half a line. Marchers
stand in the same places at every time in every case, mid-move included.

Every difference, and where it's decided:

| Difference                                                                                          | Where it's decided                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Grid, dots and labels half a grid line up and left of Fabric's                                       | Rules table, Dot position (#199, #200)                                   |
| Lines pixel-snapped where Fabric smooths them over two pixels                                         | #200                                                                     |
| Yard numbers centered on their yard line, not 22 units left of it                                    | Export improvements (#206), #200                                         |
| Marcher labels in SDF glyphs (Courier New bold): about a pixel different                             | #192, #199                                                               |
| Labels fade out below a readable size (on Fabric they shrink to a smear)                              | Rules table, Labels                                                      |
| Dots at least 1.5 CSS px in radius at very low zooms                                                  | #192                                                                     |
| **Labels draw over neighboring dots; on Fabric (and in the export) every dot covers every label**     | **Not decided.** Visible only where marchers crowd: the stress show, and the Daft Punk front line at 6×. The new field draws all labels in one batch above all dots (render order 3 over 2). On the [checklist](parity-checklist.md) (items 14, 110). |

The timeline drawing (pathways, isolation, kept marks, collisions) and every
theme, variant and field image were compared in #201 and #200 (prereleases
`field-render-201`, `field-render-200`; marcher shapes in `render-diff-199`),
and their drawing hasn't changed since.
