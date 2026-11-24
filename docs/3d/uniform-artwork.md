# Uniform artwork: front/back flats and the hybrid wrap

<!-- cspell:words unitard tabard tabards paintable omasset -->

- Status: proposed 2026-11-24, pending owner review
- Decision record: [ADR 0010](../adr/0010-3d-view.md), amendment of 2026-11-24
- Replaces: the uniform Artwork bullet of [props-spec.md](props-spec.md) §8 (front/back
  projection) and package C5.2's scope in [phases/C5-artwork-uniforms.md](phases/C5-artwork-uniforms.md)
- Work: epic fork #971, under fork #975

This is how people put their own uniform designs on the marchers in the 3D View. Two kinds of
author have to be able to do it:

- **human artists:** band directors, designers and uniform companies working in Photoshop,
  Procreate or Illustrator
- **AI agents:** an agent is given a photo of a uniform and produces a uniform pack

The design comes from a study of 9 real uniforms (see [Evidence](#evidence)): West Point full
dress, The Cadets 2019, Carolina Crown 2015 and 2019, and five Fred J. Miller catalog designs.

## Summary

1. **One input: flats.** A flat is the uniform as a catalog page draws it: the figure seen straight
   from the front and straight from the back, arms hanging down, on a template in real inches.
2. **One renderer: the hybrid wrap.**
   - The front flat covers the front half of each body segment, and the back flat covers the back
     half. The split is by angle around the spine for the torso and around each limb bone for the
     limbs.
   - The middle of the chest, the back and each sleeve read like a front-on picture.
   - The sides compress smoothly instead of smearing.
   - Bands drawn across a sleeve or leg go all the way round and follow the limb when it moves.
   - No UVs are needed.
3. **Several ways in, one pack.** All of these become the same uniform pack:
   - an artist's PNG
   - an agent's SVG
   - a PDF from a uniform company
4. **Logos, numbers and crests are placed items,** not paint, so they keep their shape on every
   body type.
5. **A mode is a list of layers,** such as Cadets' plain, sash out, and sash out with the jacket
   unzipped. Uniform cues switch between modes.

## Flats template

The template is drawn for the median body (`neutral-average`) in real inches. It is downloadable as
PNG, SVG and PDF, together with `regions.json`. The downloads are named `uniform-template.png`,
`.svg` and `.pdf` and `uniform-regions.json`, so they are easy to find in a Downloads folder; this
document calls them the template and `regions.json`.

- **Page:** 105 × 88 in. The PNG is 32 px/in, which makes it 3360 × 2816 px.
- **Panels.** Coordinates are page inches, given as x, y, width × height:

  | Panel | x   | y   | Size (in)   |
  | ----- | --- | --- | ----------- |
  | front | 4   | 6   | 34 × 78     |
  | back  | 42  | 6   | 34 × 78     |
  | cape  | 80  | 10  | 20.7 × 17.9 |

  The centre line of the front and back panels is at x = 17 in panel inches.

- **Orientation:**
  - The front panel is seen as you face the performer, so their right is on your left.
  - The back panel is seen as you stand behind them, so their left is on your left.
  - Text drawn upright reads correctly on the body on both panels.
- **Regions** on each of the front and back panels:
  - `torso`, from the neckline down, with the yoke and the shoulder tops
  - `sleeve-L` and `sleeve-R`, with the elbow line marked
  - `hips`, from the belt to the crotch
  - `leg-L` and `leg-R`, with the knee line marked

  L and R are the performer's left and right. Each region's outline is the **side seam**, where the
  front flat meets the back flat. The figure is a front view widened a little at the sides: the
  torso about 11%, and the sleeves and legs about 23%. Arms and legs are spread apart so no two
  regions touch.
  - The torso's **top edge** runs round the neck and over the shoulders. The shoulder tops are
    drawn at their real length, so the shoulders rise above the neckline on the flats (up to about
    5 in at the outer corners), like a sewing pattern's front piece.
  - Each leg's outline starts at the crotch line, where the hips end. Its outer seam continues the
    hips' side seam, so a stripe down the side of the pants is one line on the flats.

- **Not paintable:** the head, neck, hands, shoes and hat. They are drawn grey for orientation and
  take palette colors only.

### Guides

The study's authors struggled with the first version of the template. Each of these guides fixes
one of those problems.

- A **shaded wrap band** inside each outline shows the strip that wraps round the side of the body
  and is squeezed there. It is about the outer 15% of each shape.
- **Seam ticks** on the outlines, numbered by height, so a stripe or sash drawn on the front flat can
  be met exactly on the back flat.
- **Edge labels** on every limb, "outside" and "inseam" (or "underarm"), on both panels. Left and
  right swap between the front and back panels, and authors lost track of which edge was which.
- The **neck** is outside every region. It used to be paintable, which hid the palette collar. Only
  the neck is cut out, by its girth: the yoke and shoulder tops round it are paintable, so
  epaulets and contrasting yokes work.
- The `hips` region is labeled "pants, belt to crotch", not just "pants".
- A **dashed safe area** for anything that must not be squeezed, and a 10 in scale bar.

### `regions.json`

This file is for agents: the download `uniform-regions.json` (format `openmarch-uniform-flats`,
`version` 1). Region outlines are given in **panel inches**, x right and y down from the panel's
top-left corner, so they can be used as clip paths with no offset arithmetic. It holds:

- the page (`page`, `pagePx`, `dpi`), each panel's rectangle and which way it faces (`panels`), and
  the front and back panels' centre line (`centreX`)
- for every region (`regions`): its `id` (`front-torso`, `back-sleeve-L`, … or `cape`), `panel`,
  `part`, `label`, outline `polygon`, `bbox`, its two `edges` named for the body ("outside",
  "underarm", "inseam", "right side", "left side") with the edge on the other panel each one
  meets, and `seams`: both side seams' x at every 0.25 in of height inside the region, as
  `{ y, left, right }`. The torso's polygon is its two side seams, then its top edge round the
  neck and over the shoulders; its seam rows start at its top, over the shoulders.
- `wrapBand` and `seams`: how wide the squeezed band at each side seam is, and how the seams meet
- guide heights (`guides`, by `id`):

  | Guide                   | `id`        | Height (in) |
  | ----------------------- | ----------- | ----------- |
  | neckline (centre front) | `collar`    | 18.84       |
  | chest                   | `chest`     | 25.32       |
  | jacket hem and belt     | `jacketHem` | 38.31       |
  | crotch                  | `crotch`    | 43.24       |
  | knee (legs only)        | `knee`      | 56.3        |
  | elbow (sleeves only)    | `elbow`     | 29.28       |

- `landmarks`: `chestCentre`, `backNumberCentre`, each limb's `centreLines` on both panels,
  `sleeveCuff` and `legHem`

The torso stops at the jacket hem, where the hips start; no two regions overlap.

The renderer reads the same file, at `apps/desktop/src/view3d/assets/uniform-flats/regions.json`. It
is generated with the lookup tables by `apps/desktop/scripts/view3d-assets/uniform-flats.mjs`, which
writes it with the template's own code (`regionsJson` in
`apps/desktop/src/view3d/core/artworkTemplates/uniform/regions.ts`), so it is exactly the download
plus two keys: `generatedBy`, and `figure`, the grey context figure (head, shako, visor and shoes
as triangles of `[x, y]` points, hands as ellipses) the template draws. Agents should use the
download.

## Rendering: the hybrid wrap

- **Segments.** Every jacket and pants point belongs to a segment with an axis:
  - the torso and the hips, around the spine
  - each upper arm, forearm, thigh and shin, around its bone

  The elbow and knee are split by the plane that bisects the joint.

- **Front or back.** Let ψ be the angle around the axis, measured from the segment's front.
  - Where |ψ| ≤ 90°, the point samples the front flat; elsewhere it samples the back flat.
  - The seam between the two is the region's outline.
- **Across a half** the flat coordinate is
  `U = 0.6 · x_projected + 0.4 · arc_from_centre`.
  - At the centre it matches a front-on picture.
  - Toward the sides it compresses by at most about 2.5×.
- **Down a segment** the flat coordinate is real height (torso and hips) or distance along the bone
  (limbs). Limb art therefore follows the limb in the stride.
- **Lookup tables.** The per-angle U comes from cross-sections ray-cast once per body type. A tool
  generates one small float table per body type and commits it as an asset:
  - 128 angles × 5 mm rows
  - smoothed over 7 rows
  - rows that catch a fold are refilled from their neighbours
  - channels: U front, U back and the row centre

  The fragment shader reads it. The 7 body models store their vertices in different orders, so the
  tables are built per body from geometry, never per vertex.

- **Cape (Overlay).** The cape is sampled from the cape panel by back projection.
- **Composed textures.** The flats layers and items of a look are composed into one atlas per (look,
  body type in use), with each region's edge pixels bled 1.5 in outward. Atlases are built when
  first needed and cached, and they count toward the texture budget (D-19).
  - The display atlas is 16 px/in at `low` and 32 px/in at `high`.
  - If memory runs too high, items move from the atlas into a shader decal pass.
- **Fallback.** If the shader costs too much on the web, the same mapping is baked into per-body UVs.
  The authoring format does not change.

### Fixes before anyone else uses it

The prototype has known artifacts. These are fixed before the first build reaches testers, in this
order:

1. Torso art leaks onto the top of the sleeve at the armhole, and the shoulder tops stretch
   vertically.
2. There is a jog where the hip meets the thigh, and spikes at the wrist.

## Grading across the 7 body types

All body types share one skeleton, so lengths are the same on every body; only girth differs. Each
body's table is rescaled row by row so its side seams land on the median outlines. The girth factor
`k` at a row runs from about 0.78 (slim forearms) to 1.35 (full thighs).

| What                              | Grade        | On a body with factor k                               |
| --------------------------------- | ------------ | ----------------------------------------------------- |
| Fabric, stripes, bands, checks    | stretch      | widens with girth, and stripe counts and heights hold |
| Logos, numbers, crests (items)    | proportional | scales by k and keeps its aspect (default)            |
| Real-size patches, buttons        | fixed        | exactly its real size                                 |
| Piping and braid lines            | fixed width  | keeps its line width while its length stretches       |
| All-over prints (script, sequins) | tile         | repeats at real tile size on every body               |

A logo painted straight into the fabric grades like fabric: on the full body it ends up about 1.24×
wider than tall. The preview warns about this (see [Preview](#preview-and-warnings)).

How the atlas draws each grade (step 4, fork #1258):

- **Proportional and fixed** items are drawn in strips 1/8 in tall, each `target / k(row)` as wide,
  where `target` is the k under the item's centre (proportional) or 1 (fixed). One scale per item
  isn't enough: on `neutral-full` k runs from 1.02 to 1.40 over the 7 in of a chest crest, which
  would leave it egg-shaped and about 1.3% wider than tall. With strips every row is within 1% on
  all 7 bodies.
- **Stretch** items are drawn as they are.
- **Tile** items repeat in each listed region, each tile `1/k` as wide with k at the region's
  middle (as the study's prototype did). So a tile is its real size at the region's middle row
  only: elsewhere in the region its row's k differs, and the tiles drift up to about 25% from their
  real width (measured over the back torso, a sleeve and a leg on all 7 bodies). The columns are
  centred on the region's centre line, and the rows line up with one centred on the item's `at`
  height, so a print continues from one region to the next.
- **Line** items (piping, braid) are drawn with their own height scaled by
  `√(k² cos² θ + sin² θ) / k`, so the line keeps its width at any angle θ while its length
  follows the fabric. The image's width is the line's length; a vertical line is rotated 90°.

An item whose image's shape makes a side over 120 in (or a tile with a side under 1 in) isn't
drawn, and the item list says so; a tile region that would need over 4000 copies is left plain.

Items are composed into the same atlas as the layers, so the atlas memory doesn't change. While
composing, the window also holds each item image decoded (at most 1024 px on its long side, so
at most 4 MB each).

The council split 2–1 on proportional against √k for items; see [Open questions](#open-questions).

## The uniform pack

The internal form is one **uniform pack**, stored as a show asset (ADR 0010, amendment of
2026-11-15) of kind `uniform`. It holds:

- **palette and options:** palette roles, pattern style, and part options such as hat, cape and
  plume
- **layers:** named flats images, each covering the whole page or one panel
- **items:** placed art, each with a file, a centre `at` in panel inches, a width or height, a
  rotation, an opacity and a grade. A tile item has a tile size and a list of regions.
- **modes:** named lists of layers, plus palette and option overrides
- **attachments:** built-in hanging pieces with their own art (see below)

### The pack file (format versions 1 and 2, a preview)

Built in step 3 (fork #1257), with items added in step 4 (fork #1258); ADR 0010's amendment of
2026-11-24 has the full contract.

- **One file:** a zip with the extension `.omasset`. It holds `manifest.json`, one transparent
  page-size PNG per layer under `layers/` and one PNG per item image under `items/`, and names
  nothing outside itself.
- **The manifest:**
  - the asset format and version, the kind `uniform`, the name and the page size in inches
  - the palette, the pattern style and the part options
  - the layers, bottom first
  - credits (license, author, source)
  - `items` (version 2): each with an `id`, a `name`, its `file`, a `panel` (front, back or cape),
    its centre `at` in panel inches, a `width` or `height`, `rotate`, `opacity` and a `grade`
    (proportional, fixed, stretch, tile or line). A tile also lists its `regions`, on its panel;
    its width and height are one tile's size, at least 1 in.
  - `modes`, `variants` and `attachments`, reserved for later steps. Both versions refuse anything
    in them and any key they don't know; a later field that changes what is drawn bumps the format
    version.
- **Versions.** Version 2 adds only `items`, so a pack is written as version 1 while it has no
  items: a step 3 build still reads it. A version 1 reader refuses a version 2 pack as newer.
- **The same bytes in a show.** A show stores the file as its asset of kind `uniform`, unchanged,
  and Save uniform file writes it back out. This is the first kind of the portable asset file in
  fork #1262.
- **Preview.** The format can still change until the human test (#1259).

### Ways in

| Author          | Hands the app                                                      | Notes                                                                                                |
| --------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Human artist    | One transparent page-size PNG per layer (3360 × 2816), fabric only | Painted over the template layer, which is then hidden. A wrong size is scaled, with a note.          |
| Human artist    | Logos and numbers as separate images, placed in the app            | Never painted into the fabric.                                                                       |
| Uniform company | SVG or PDF flats at page size                                      | They fit the template's landmarks.                                                                   |
| AI agent        | SVG flats drawn against `regions.json`, plus items                 | Photo crops only as tile textures for real prints (script, sequins), never warped onto whole panels. |
| AI agent        | A headless render command                                          | Renders the pack on all 7 bodies, so the agent can compare it with photos.                           |

Every way in produces the same pack. Nothing downstream knows which way a pack came in.

### Modes and variants

- **Mode.** A mode is an ordered list of layers plus overrides, inside one uniform. For example,
  Cadets 2019:
  - **plain:** base
  - **sash out:** base, then sash
  - **sash out, unzipped:** base, then sash, then open front

  The layer for a mode holds only what changes in that mode; it is not a full copy of the sheet.
  A mode is what a Uniform cue switches to (fork #976), so to a cue each mode of a pack is one
  uniform, as in props-spec §6.

- **Variant.** A variant is a separate uniform in the same pack, assigned to performers rather than
  switched by a cue. Guard, percussion and a full drum-major costume are variants. A pack shares
  layers between its variants and modes, so a sash is drawn once.

## Placing items

Built in step 4 (fork #1258). In the 3D View settings, under the band uniform, a **Logos and
numbers** section shows while the band wears a uniform imported into the show.

- **Add logo or number…** picks a PNG or SVG. It's read the way layers are: a PNG is decoded in the
  uniform pack worker; an SVG is drawn in the window as an image, then its pixels go to the worker.
  The worker trims it to its painted pixels and stores it at most 1024 px on its long side. A new
  item goes on the chest centre, 6 in on its longer side.
- Each item is a row:
  - **Place:** Chest center, Back number, Left sleeve or Right sleeve (the upper arm on the front
    panel, a fifth of the way down the sleeve). It says Custom once the item is moved by number.
  - **Side:** Front or Back. No look draws a cape yet, so Cape shows only for an item a file
    already put there.
  - **Across** and **Down:** the centre in panel inches.
  - **Size by** width or height, and **Size** in inches. Switching Size by keeps the item's
    size: the number becomes its other side's length.
  - **Rotation** in degrees.
  - **On other builds:** the grade.
  - **Repeat over** (a repeating print only): one toggle per region on its side. The last one
    on stays on and says why: a print needs a part to cover.
  - **Remove.**
- **Live view.** The 3D View draws each change at once from an item draft in the window
  (`itemDrafts.ts`), and the draft is saved a moment later (at once for adding and removing) as a
  new version of the same uniform asset.
- **Undo.** Edits less than 4 s apart are one burst and one undo step: Undo goes back to where
  the burst started, and the show keeps two versions, the start and the end. If the venue moves
  elsewhere before a change is saved (Undo, another uniform picked), the editor stores nothing and
  the unsaved change is dropped, so Undo wins.
- While a change composes, the marchers keep their previous art instead of showing the palette.

## Hanging pieces and other shapes

Paint cannot show anything that hangs or stands off the body. In the study that covered:

- sashes and tabards, which appeared in 7 of 9 uniforms
- coat tails
- flared gauntlets
- sheer layers
- standing collars
- crests and tall hats

These are attachments, not artwork:

1. **First: built-in parametric pieces.** A sash panel, a tabard and a coat tail, each hung from a
   joint at a fixed width, with their own front and back art from the same pack. These belong under
   fork #974.
2. **Later: rigged imported models,** per props-spec §8 Garments.
3. **Hats and plumes:** fork #1229.

## Preview and warnings

- The import shows the pack on all 7 body types: front, back, side and mid-stride. Not built yet:
  the 3D View has no way to line the 7 body types up side by side.
- Each of these gives a quiet note:
  - a logo-like shape painted into the fabric (suggests making it an item). Built in step 4: in
    each garment region, one sample per half inch; the region's commonest color (4 bits a
    channel) is the fabric; a 4-connected group of samples unlike it, 2.5 to 16 in on each side, no
    more than 2.5× longer than wide, filling at least a fifth of its box and touching neither the
    region's edge nor its top or bottom, is called a logo. Stripes, bands and sashes cross a
    region, so they don't count. It runs only on a layer that paints at least half the garment
    area, since anything on a mostly clear overlay layer would stand alone.
  - a template layer left visible in the export
  - a wrong image size
  - an item outside every region
  - art in the non-paintable zones

## Human test

Real artists test the PNG path in parallel with the renderer work, using the revised template:

- The PNG upload opens to testers only after at least one person has finished a uniform with it.
- The pack format is frozen only after that test.

The test also settles the open question on logo grading.

## Open questions

- **Logo grading:** proportional to k (two of three council members, built and self-tested), or √k
  (one member: logos grow less on fuller bodies). The human test decides.
- **Shader cost on the web:** the per-body lookup tables plus the atlases, with about 300 marchers
  and several looks. This is measured before choosing shader or baked UVs.
- **Hip region:** whether `hips` stays its own region or merges into the legs once the hip–thigh jog
  is fixed.

## Evidence

The study ran in a stand-alone render harness, outside the repo, on the GPU, using the app's body
models and uniform shader. Author and judge agents worked on 9 uniforms.

**Round 1** compared three methods, each scored by one blind judge per uniform (scores out of 5):

| Method            | Judges' picks | Likeness | Sides and limbs | Body types |
| ----------------- | ------------- | -------- | --------------- | ---------- |
| Planar projection | 6 of 9        | 3.4      | 2.8             | 3.3        |
| Wrap-shader       | 3 of 9        | 3.0      | 3.0             | 3.6        |
| UV layout         | 0 of 9        | 2.9      | 2.4             | 2.7        |

- The UV layout zig-zags on the low-poly mesh.
- Every author drew front/back flats and converted them by script.

**Round 2** compared the flats with the hybrid wrap (SVG by an agent, PNG by an agent imitating an
artist) against planar:

| Method      | Judges' picks | Likeness | Body types | Stands view |
| ----------- | ------------- | -------- | ---------- | ----------- |
| Hybrid, SVG | 4 of 9        | 3.6      | 4.0        | 3.8         |
| Planar      | 3 of 9        | 3.1      | 3.9        | 3.3         |
| Hybrid, PNG | 2 of 9        | 2.9      | 3.4        | 2.9         |

**Council.** Three different models then reviewed all five methods: GPT-5.6 Sol, Grok 4.7 and
Claude Opus 5.5.

- Each ranked the methods blind from shuffled sheets, then read the reports.
- Each critiqued the other two proposals anonymously.
- All three converged on this design, each with medium confidence.

**Caveats:**

- There was one judge per uniform per round.
- All authors were AI agents; no human has tried the PNG path yet.
- Arms were in a rest pose.

AI agents ran the whole study.
