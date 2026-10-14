# Phase 1: Foundation

Pin today's behavior, and get the new field drawing the show behind a dev
switch.

## Tickets

- **#190 ADR 0005 and the work-package plan.** This folder and
  [ADR 0005](../../adr/0005-three-field-renderer.md).
- **#191 Field test API over Fabric.** The read-only field test
  API (see [the plan](../implementation-plan.md#the-field-test-api)) over
  today's Fabric field. The browser scenario helpers and existing scenarios
  switch to it. Behavior doesn't change.
- **#192 Tracer bullet.** A hidden dev switch turns on the React Three Fiber
  field. It draws the field and every marcher and label at the playhead,
  driven by playback and scrubbing, and follows the renderer guard rails.
  Field geometry and marcher positions come from modules shared with the 3D
  View. The field test API gets its second implementation.
- **#206 SVG exports from show data.** Coordinate sheets and drill-chart SVGs
  are generated from show data with no canvas, so exports stop depending on
  Fabric. Dots sit exactly on their coordinates.

## Exit gate

- The scenario suite reads the field only through the field test API, and
  passes on Fabric.
- The same scenarios can be pointed at the new field behind the dev switch,
  even though most fail until phase 2.
- Coordinate sheets and drill charts no longer import Fabric. The video export
  still draws on a Fabric canvas (`exporting/video/videoCanvas.ts`) until #207.

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

- **#206:** `exporting/utils/drillChartSvg.ts` draws the field, dots, labels
  and individual-chart paths as plain SVG from `FieldProperties`, positions
  and appearance stacks; `svg-generator.ts` keeps `generateDrillChartExportSVGs`
  and adds `getFieldImageForExport`. It mirrors `createFieldGrid` element for
  element (minus Fabric's half-pixel offset), so #200 can lift its line and
  label layout if the new field wants a shared 2D field plan. The Fabric
  helpers the video export needs (`initializeCanvasForRendering`,
  `applyMarcherAppearancesForPage`, `getFieldPropertiesImageElement`) moved
  unchanged to `exporting/video/videoCanvas.ts`; #207 deletes them.
- **#206:** the lab web build can't open the page-era demos in dev or build
  (`Buffer` in `electron/database/backup.ts`, and `lab:dev` pre-bundles
  drizzle's migrator past the `fs` shim). The export diffs used converted
  copies of the demos.
