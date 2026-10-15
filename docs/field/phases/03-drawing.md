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

### #200 Field themes and background image

**One 2D field plan.** `apps/desktop/src/field/fieldPlan.ts` (`planField2d`)
lays out the flat field in field units: today's `createFieldGrid`, element
for element, minus Fabric's half-pixel offset. It was lifted from #206's
`drillChartSvg.ts`, which now renders it to SVG (byte-identical output for
every template, variant and option); `three/fieldGeometry.ts` turns the same
plan into rectangles and SDF labels. The new field no longer uses the 3D
View's `planField`: its `theme` plan is in meters, clipped to the checkpoint
footprint (wrong for fields whose checkpoints aren't centered), has no
outside labels and puts the border inside the edge. The 3D View keeps
`planTheme` for its surface. Unifying the two (planTheme from `planField2d`)
would change how the 3D View looks; that's a separate ticket if wanted.

**Settings.** `FieldLayer` reads the grid lines and half lines settings from
`useUiSettingsStore` and rebuilds when they change. Fonts are named as Fabric
names them: yard numbers `"Times New Roman"`, checkpoint labels `"mono"` (a
family that doesn't exist, so both fields get the platform fallback), each
in its own glyph atlas; marcher labels keep bold Courier New. `TextLabel`
gained `letterSpacing` (em, between characters) for the yard numbers'
`charSpacing`.

**Field image.** `layers/BackgroundImageLayer.tsx` draws it at render order
-1, between the background (its own one-rectangle draw at -2) and the lines
(0). The bytes come from the 3D View's `useFieldImage` (decoded once per
image). Placement is `planFieldImage`, Fabric's fit/fill rule; like Fabric a
filled image isn't cropped to the field. Render order so far: background -2,
image -1, lines 0, field text 1, marchers 2, labels 3. **#201**: put timeline
overlays between 1 and 2, or above 3, as they sit in Fabric.

**Field test API.** `fieldImage()` returns where the image is drawn (field
units) and its opacity, or null. The Fabric reading is half a field unit up
and left of the new field's: Fabric draws its lines half a grid line into its
plane but not the image. `field-image.spec.mts` pins fit, fill and hidden on
both fields.

**Render comparisons.** `e2e/browser/render/` (Playwright project `render`;
see its README) captures every template, theme and variant on both fields at
the same view and writes side-by-side and diff PNGs. **#208** can extend its
case list to the demo shows and marchers. Differences it shows, all expected:
lines are pixel-snapped on the new field where Fabric smooths them over
two pixels; yard numbers are centered on their yard line (the export's rule)
where Fabric left-aligns them 22 units left of it.
