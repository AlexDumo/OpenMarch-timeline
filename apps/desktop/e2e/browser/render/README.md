# Field render comparisons

`field-render.spec.mts` draws the field alone (no marchers) for every built-in
field template, a dark theme, the field variants (no hashes, hidden labels,
other half-line intervals), the grid and half line settings, and the field
image (fit, fill, opacity), on Fabric and on the new field (#200, ADR 0005). It
isn't a pass/fail suite: it writes images for a person to review.

```bash
pnpm run build:browser
FIELD=three pnpm exec playwright test --project=render --workers=4
FIELD=fabric pnpm exec playwright test --project=render --workers=4
```

Run the new field first. Its pass saves each screenshot and the view it was
taken at (`*.view.json`, the field test API's `viewport()`). The Fabric pass
points Fabric at the same view (through `window.canvas`: this is a capture
tool, not a scenario), takes the same screenshot and composes:

- `<case>-<size>.three.png` and `.fabric.png`: the field element only, with
  whatever the app draws over it hidden;
- `<case>-<size>.compare.png`: Fabric, the new field and the diff side by
  side. The diff shows Fabric faded, and in red (new field darker) or blue
  (lighter) the pixels with no match within one pixel in the other image, so
  a line antialiased one pixel over isn't counted;
- `summary.tsv`: how many pixels differ per case.

Sizes are `fit` (1600 × 1000, the field small) and `large` (3600 × 2200,
lines and labels readable). Output goes to `RENDER_OUT`, default
`$TMPDIR/openmarch-field-render` (not `playwright-report`, which each run
clears).

When the new field's view rules change (#194), the tool still works: the
Fabric pass copies whatever view the new field chose.

`timeline-render.spec.mts` does the same for the timeline's drawing on a
converted demo show (#201): pathways, warnings, isolation, kept marks and
collision markers, plus a baseline with none of them. Run it the same way, three
first:

```bash
FIELD=three pnpm exec playwright test --project=render timeline-render
FIELD=fabric pnpm exec playwright test --project=render timeline-render
```
