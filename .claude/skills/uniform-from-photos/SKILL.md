---
name: uniform-from-photos
description: Turn photos of a marching uniform into an OpenMarch uniform pack (.omasset) of SVG flats, placed items and modes, render it on all 7 body types, and compare the renders with the photos. Use when given photos of a uniform to recreate in the 3D View, or asked to make a uniform pack.
---

<!-- cspell:words omasset camo paintable -->

# Uniform from photos

You turn photos into a **uniform pack**: front and back **flats** (the uniform as a catalog page
draws it, on a template in real inches), **items** (logos, numbers, crests, buttons, prints placed
over the flats) and **modes** (the ways it is worn). The 3D View wraps the flats round 7 body types.
Background: `docs/3d/uniform-artwork.md`. Commands and the `uniform.json` format:
`apps/desktop/scripts/uniform-pack/README.md`. Read both before step 1.

Work in a folder outside the repository, called `<work>` below; write it as an absolute path in
every command. A real uniform is someone else's design: its pack, art and renders stay in
`<work>`, out of every commit.

Run commands from `apps/desktop`. Once per checkout: `pnpm install`, then
`pnpm --filter @openmarch/core build`.

Keep a stopwatch: note the time you start and finish each step, for the report.

## 1. Learn the template

```bash
pnpm uniform:image template <work>/template
```

Open `uniform-template.png` and read `uniform-regions.json`. All coordinates are **panel inches**:
x right, y down from the panel's top-left corner, so a region's `polygon` is a clip path as it
stands.

Look these up in the file rather than guessing:

- `panels`: each panel's size and place on the page.
- `regions`: each region's `id`, `polygon`, `bbox` (`{x, y, w, h}`: its top is `y`, its bottom
  `y + h`) and `edges`.
- `guides`: heights such as `collar`, `chest`, `elbow`, `jacketHem`, `crotch`, `knee`.
- `landmarks`: `chestCentre`, `backNumberCentre`, `sleeveCuff`, `legHem` and each limb's
  `centreLines`.

Facts the numbers don't say:

- **Mirror:** on the front panel the performer's right is on your left; on the back panel their
  left is on your left. Region ids name the performer's side: `front-sleeve-L` is on your right.
- **Seams:** each region's outline is the side seam where front meets back, and its `seams` gives
  both seam x's every 0.25 in of height. A band drawn at the same heights on both panels closes
  round the limb. The cape has no seams.
- **Shoulders:** the torso's first seam rows run over the shoulder tops, from the neck out to the
  sleeve; a sleeve's `bbox` top is the shoulder point.
- **Not paintable:** head, neck, hands, shoes and hat are outside every region: palette colors
  only.
- **Wrap band:** the outer 15% of each half-width squeezes round the side of the body. Keep logos
  and text inside the dashed safe areas.
- **Neck:** the jacket's mesh reaches a little up the neck, above every region, and takes the
  palette's `primary` in every mode: a small V at the front and a spike up the back of the neck,
  whatever its color. Choose `primary` for how the neckline should read (usually the jacket
  fabric); a skin neckline can't be shown.
- **Proportions:** torso and hips heights are height on the body, but sleeves and legs run along
  the limb, from the shoulder and the crotch. The template's elbow sits well above its jacket hem,
  unlike a standing person's.

Done when you can say, without looking, which panel and which side of it the performer's left
sleeve is on (the template's own labels say it too), and you have read the elbow and knee heights
from `guides`.

## 2. Inventory the photos

For each photo, make a grid copy and look at it with the grid:

```bash
pnpm uniform:image grid <photo> <work>/grid-<name>.png --step 50
```

When the uniform is small in the photo (under about 400 px tall), crop it and scale it up first,
then grid and sample the crop. Coordinates are always in the pixels of the image you pass:

```bash
pnpm uniform:image crop <photo> 20,40,200,400 <work>/figure.png --size 600x1200
```

Measure positions on the most front-on, standing figure; arms raised to hold a horn hide the
chest and pull the sleeves. The best photo to measure on and the best to sample colors from are
often different photos: a front-on studio shot can be too dark, and a daylit figure too small.

Write `<work>/inventory.md`: one row per **garment element** (jacket body, yoke, each braid row,
sash, buttons, cummerbund, pants, stripes, gauntlets, hat, …):

| Element | Where (regions, heights in inches) | Hex | Modes | How |
| ------- | ---------------------------------- | --- | ----- | --- |

- **Where:** convert photo positions to template heights part by part, each from its own
  landmarks, and never carry one scale from one part to another:

  | Part        | Landmarks to measure between                              |
  | ----------- | --------------------------------------------------------- |
  | torso, hips | `collar`, `chest`, `jacketHem`, `crotch`                  |
  | sleeves     | the sleeve's `bbox` top (shoulder), `elbow`, `sleeveCuff` |
  | legs        | `crotch`, `knee`, `legHem`                                |

- **Hex:** sample each color in 3 or more evenly lit boxes, away from highlights and shadows, and
  take the median. `--mark` draws the numbered boxes on the image: open it and drop any box that
  missed (background, skin, another person):

  ```bash
  pnpm uniform:image sample <photo> 212,340,6,6 230,410,6,6 198,455,6,6 --mark <work>/marks.png
  ```

  A `spread` over about 25 means the box mixes colors or texture: move it or shrink it. When photos
  disagree, trust the one in even daylight over a stage or studio shot, whose lights crush darks
  and burn out sheen. Record the photo's hex here; step 5 may paint a different hex so the render
  reads like the photo.

- **Modes:** every way it is worn in the photos (zipped, sash out, unzipped, …). Each mode's change
  becomes its own layer. If the builder refuses `modes` (a checkout before pack format 3), build
  the first mode only and keep the others in the inventory, with what each would change.
- **How**, one of:
  - _fabric_: painted on a layer, filling its regions
  - _detail_: painted on a layer (bands, stripes, yokes, piping, braid)
  - _item_: a logo, number, crest, patch, button or frog knot, placed with a grade (step 3)
  - _print_: a real all-over print (sequins, script, camo), as a `tile` item from a photo crop
  - _palette_: collar, cuffs, gloves, shoes, hat, plume (`palette` and `options`)
  - _can't_: hangs or stands off the body (sashes, tabards, coat tails, flared gauntlets),
    sheer layers, hat shapes, standing collars, fabric sheen or texture (velvet, satin, metallic),
    gloves that cover only part of the hand, a skin neckline. For a hanging piece, paint the part
    that lies on the body of a marcher standing at attention, and list the rest under _can't_.
- **Unseen** parts (often the back): pick the likeliest and mark the row _guessed_.

Done when every element visible in every photo is a row, and every row has a hex, its modes and a
how.

## 3. Draw the flats and items

Write a generator script, `<work>/draw.mjs`, that reads `uniform-regions.json` and writes the SVGs
into `<work>/pack/`. `apps/desktop/scripts/view3d-assets/uniform-flats-sample.mjs` is a worked
example: clip paths from the region polygons, bands, and seam stripes from the seam table. The
sample leaves its fabric to the palette's `primary` and `pants`; a pack from photos fills the
fabric itself, so its color is exact.

- **Base layer:** `front.svg` and `back.svg`, each `viewBox="0 0 34 78"`. Fill every region the
  garment covers, on both panels, clipped to its polygon, in the fabric hex. A jacket that covers
  the hips fills `hips` too. Bare skin inside a region (the arm below a cap sleeve) has to be
  painted, in one skin hex for every marcher, so it won't match each marcher's own face and hands:
  paint it a mid skin tone and list it under _can't_ in the report.
- **Details:** paint anything that is part of the cloth and follows it: bands, stripes, yokes,
  braid rows. Draw anything that goes round a limb or across a side on both panels at the same
  heights. A stripe down a side seam follows the seam rows.
- **Mode layers:** one more layer per mode change, holding only what changes (the sash, the open
  front); everything else transparent. A layer names only the panels it changes: `front`, `back`
  and `cape` are each optional.
- **Items that move between modes** (frogs pushed outward when the jacket opens): items draw over
  every layer, so a moved item is two items, each listed in its own modes' `items`.
- **Items:** each in its own SVG, outside the flats. The builder trims the image to its painted
  pixels, and `at` is the centre of that trimmed art, in panel inches; `rotate` turns it about
  that centre. So to land one point of the art (a frog's button) somewhere, work out where it sits
  in the art's own bounding box. Grades:
  - `proportional`: logos, numbers and crests, which grow with the body
  - `fixed`: buttons, patches, frog knots and other trims that keep their real size
  - `line`: one thin braid or piping line that must keep its width (the image's width is the
    line's length; turn it 90° for a vertical line)

  At most 32 items.

- **Prints:** crop a clean, flat swatch from the photo and place it as a `tile` item over its
  regions, at the tile's real size (at least 1 in):

  ```bash
  pnpm uniform:image crop <photo> 300,420,64,64 <work>/pack/sequins.png --size 256x256
  ```

  A photo crop goes into the pack only as a tile, so it repeats at real size on every body.

- **Transparency:** everything outside the regions stays clear.

Then write `<work>/pack/uniform.json`: name, style, all ten palette roles (the jacket fabric as
`primary`, the pants as `pants`, the rest from the inventory), the options as the photos show them
(`hat: false` for a bare head), the layers bottom first, the items and the modes. Format:
the README's `uniform.json` section. A pack without modes renders as one mode named `default`.

Done when every inventory row whose how is fabric, detail, item, print or palette is in the pack.

## 4. Build

```bash
pnpm uniform:build <work>/pack --out <work>/out/<name>.omasset
```

Fix every refusal and build again. Done when it exits 0 and each warning is fixed or noted in
`<work>/rounds.md` with why it stays.

## 5. Render and compare, at most 3 rounds

```bash
pnpm uniform:render <work>/out/<name>.omasset <work>/renders/round-<n> --save-atlas
```

Exit 3 means no GPU: stop and say so; there is no CPU fallback.

Open every `contact-<mode>.png`, and for each mode `stand-neutral-average-front.png`,
`stand-neutral-average-back.png` and `atlas-neutral-average.png` at full size. Read `report.json`:
each mode's `errors` and `warnings`. They catch the mistakes the app warns about (a template left
in, a painted logo, an item not drawn), never likeness: the images are the check. In the atlas,
each region's edge colors are smeared 1.5 in outward so filtering never reaches the empty page;
judge only what lies inside the outlines.

Then compare with the photos, row by row of the inventory:

- **present** in the right modes, and on the right side of the body
- **height** against the photo's landmarks, and **size** against the scale bar (1 in blocks)
- **color:** does the render read like the photo, in value and in hue? The venue's daylight and
  the shader darken paint, the blue sky light cools neutrals, and nothing shows sheen, so a dark
  fabric can go black, a grey can go blue, and a satin band can vanish into velvet. Sample the
  render PNGs with `uniform:image sample` and compare the numbers with the photo's. Adjust the
  paint until the render reads like the photo, and note the hex you chose in `rounds.md`.
- **seams:** bands close round limbs; front and back meet
- **body types:** logos stay round, stripe counts hold, nothing slides off a slim or full body
- **stands view:** from 40 m it reads like the uniform in the photos

Append the round to `<work>/rounds.md`: each difference, and its fix or why it can't be fixed.
Fix what paint and placement can fix, build, and render the next round. Stop after round 3, or
sooner when no fixable difference remains.

Done when every inventory row has a verdict: _matches_, _fixed in round n_, or _can't_, with the
reason.

## 6. Report

- the pack file and each mode's contact sheet
- how close it is to the photos, mode by mode, from your verdicts, including what you guessed
- what paint can't show: every _can't_ row (hanging pieces, hats and plumes, sheer layers,
  standing collars, …) and what the pack shows there instead
- the time each step took
- anything in this skill or the tools that was unclear or got in the way
