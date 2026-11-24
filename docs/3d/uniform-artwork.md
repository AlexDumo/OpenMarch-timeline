# Uniform artwork: front/back flats and the hybrid wrap

<!-- cspell:words unitard tabard tabards paintable -->

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

This file is for agents. Region outlines are given in **panel inches**, so they can be used as
clip paths with no offset arithmetic. It holds:

- for every region: its outline polygon, its bounding box, and the side seam's x at every 0.25 in
  of height for both edges (`seams.rows`). The torso's polygon is its two side seams, then its top
  edge.
- guide heights:

  | Guide                                | Height (in) |
  | ------------------------------------ | ----------- |
  | neckline (centre front; id `collar`) | 18.84       |
  | chest                                | 25.32       |
  | jacket hem and belt                  | 38.31       |
  | crotch                               | 43.24       |
  | knee                                 | 56.3        |
  | elbow                                | 29.28       |

- landmarks: chest centre, back number centre, and each limb's centre line and cuff
- the grey context figure (head, shako, visor and shoes as triangles, hands as ellipses), for
  drawing the template

It is generated with the lookup tables by `apps/desktop/scripts/view3d-assets/uniform-flats.mjs`,
and lives at `apps/desktop/src/view3d/assets/uniform-flats/regions.json`.

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

- The import shows the pack on all 7 body types: front, back, side and mid-stride.
- Each of these gives a quiet note:
  - a logo-like shape painted into the fabric (suggests making it an item)
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
