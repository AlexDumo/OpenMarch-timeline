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

### #199 Marcher appearance

**Resolution is shared, not re-implemented.** `resolveMarcherLook` in
`src/entity-components/appearance.ts` (on top of `resolveAppearanceFromStack`)
is the one place a stack becomes fill, outline, shape, visible, label visible
and the X's line color. The drill-chart export (`drillChartSvg.ts`) and the new
field both call it. Which stack applies at a beat is the timeline rule in
`services/appearance/appearanceSteps.ts` (the last flag crossed), through
`useMarcherAppearanceSteps`, the same steps the Fabric field and
`SelectedMarchersContext` use.

**Where it lives on the new field:**

- `FieldMarchers` samples the appearance with the positions. After each
  `fill(beat)` it holds `stacks` (per index in `ids`, null for the theme's
  default), `hidden` (a `Uint8Array`, 1 per hidden marcher) and
  `appearanceVersion`. It re-samples only when the ids change or the beat
  crosses an appearance change (`changeIndexAtBeat`), so playback costs a
  binary search per frame. `ThreeField` hands it the steps
  (`setAppearanceSteps`) from `PlayheadDriver`.
- `marcherLooks.ts` writes the per-instance buffers (`writeMarcherLooks`) and
  which labels show (`labelsShown`).
- `MarchersLayer`: `aFill`, `aOutline` (rgba 0–1) and `aShape` (`MARCHER_SHAPE`,
  -1 hidden) per instance. Every shape is a signed distance in the fragment
  shader, sized as Fabric and the export draw them; the 1-unit outline
  straddles the edge with mitered corners, as Fabric strokes. Hidden instances
  collapse to a point off screen. **#201**: dimming can be one more
  per-instance attribute here (an opacity), written the same way.
- `LabelsLayer`: a hidden label lays out as no glyphs. All labels take the
  theme's label color, as on Fabric (no appearance sets a label color).

**For #193 (hit testing):** skip marchers with `fieldMarchers.hidden[i] === 1`.
The scenario `marcher-appearance` › "a click goes through a hidden marcher"
(hidden F2 stands on F1; a click selects F1) passes on Fabric and waits on
#193 on the new field.

**Field test API:** each marcher has a `look` (shape, fill, outline, label
color, visible, label visible), read from Fabric's objects and from the new
field's stacks. Hidden marchers stay in `marchers()` with `look.visible` false.

**Render comparisons** (`e2e/browser/tests/render-compare.spec.mts`, opt-in
with `RENDER_COMPARE=<folder>`, then `e2e/browser/render-compare.py <folder>`):
captures the converted demo shows from `view3d-web/public/demos` (the page-era
copies in `web/public/demos` open with every marcher at 0, 0 in the harness)
plus a part 1 variant with every shape, outlines, a hidden section and hidden
labels, at two window sizes and three times, and pairs them in field units.
It needs Pillow (`pip install pillow`, in a virtual environment). The fixture's new
`showFile` option starts a test from any show file. **#200 and #208** can add
regions or shows there. Differences it shows that aren't #199's: the grid sits
half a line off on Fabric (the dropped offset), yard numbers and label glyphs
differ by about a pixel (SDF fonts, #200), and Fabric's view differs until
#194. At very low zooms the new field's dots are larger than Fabric's, because
of #192's 1.5 CSS px minimum dot radius (Fabric has none).

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

**The image moves 0.5 field units relative to the lines, vs Fabric** (about
12 px at the maximum zoom of 25). Fabric draws its lines, background and
marchers half a grid line down and right in its plane, but not the image; the
new field draws all of them exactly on their coordinates, as the export does
(the spec's no-offset rule; accepted in review). Listed for the owner's
hands-on checklist (#208).

**Field test API.** `fieldImage()` returns where the image is drawn (field
units) and its opacity, or null. Because of the shift above, the Fabric
reading is half a field unit up and left of the new field's. `field-image.spec.mts` pins fit, fill and hidden on
both fields.

**Render comparisons.** `e2e/browser/render/` (Playwright project `render`;
see its README) captures every template, theme and variant on both fields at
the same view and writes side-by-side and diff PNGs. **#208** can extend its
case list to the demo shows and marchers. Differences it shows, all expected:
lines are pixel-snapped on the new field where Fabric smooths them over
two pixels; yard numbers are centered on their yard line (the export's rule)
where Fabric left-aligns them 22 units left of it; with a translucent
border color, Fabric's corners are darker, because its four border lines
overlap there and the new field's don't.
