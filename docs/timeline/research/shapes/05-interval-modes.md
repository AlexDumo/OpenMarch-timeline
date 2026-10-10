<!-- cspell:words SOLIDWORKS -->

<!-- cspell:words Onshape Altair sinc -->

# Shape tools 05: interval modes (locked vs. flexible spacing)

Status: research and proposal, 2026-10-10. Nothing here is decided. Answers owner decision 11 in
[README.md](README.md). Builds on [02-prior-art.md](02-prior-art.md) (Pyware padlocks, Fixed
Interval Float, Blender Array, Illustrator Blend) and [03-shape-model.md](03-shape-model.md).

**Question.** Drill writers disagree. One camp sets an interval and wants it **forced**: the shape
gives way so the marchers stay, say, 2 steps apart while the designer drags. The other camp wants
the spacing to **flex** as the shape is edited. Today OpenMarch has:

- **Fit**: the shape is as drawn, the interval is derived (`spacing.ts` `sampleAlong`, `fit`).
- **Interval**: a fixed run is laid along the drawn shape from Start, Center or End. The shape
  stays as drawn; the unused part is drawn faint (`pathGuide`), or the run overflows past the end
  (`Path.at` continues the end segment).

What's missing is the first camp's mode: **interval locked, the shape follows.**

**Evidence labels** (as in 02): **[V]** read on the cited page during this research; **[V-02]**
verified in 02 (some via search snippets, because Adobe and Blender pages return HTTP 403 to the
fetcher); **[I]** inferred; **[K]** general product knowledge, not re-read.

## 1. The core observation: in OpenMarch the count is fixed

Every tool below juggles three quantities: **count**, **spacing** and **size**. Lock two and the
third is derived. Most tools let the **count** flex. A drill writer can't: the count is the
selected marchers, so it is always locked. That leaves exactly two quantities, related by one
equation:

```text
size (path length L) = sum of the gaps   (n − 1 gaps open, n gaps closed)
```

So there are only three meaningful states, and each has a clear precedent:

| State                     | Interval | Size           | What drags do                                           | Precedent                                                                                        |
| ------------------------- | -------- | -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Fit**                   | derived  | free (handles) | handles change the size, the interval follows           | Pyware Positions lock; Illustrator Specified Steps; Figma Fixed width + Auto gap                 |
| **Keep interval** (float) | locked   | derived        | handles change direction and bend, the length stays put | Pyware Fixed Interval Float "Lock Intervals"; Figma Hug + fixed gap; CAD driving dimension       |
| **Interval on the path**  | locked   | locked (drawn) | handles change the guide path, the run sits on it       | Pyware Alignment (needs both locks); Figma Fixed width + fixed gap + alignment; today's Interval |

Today OpenMarch has rows 1 and 3. This doc proposes adding row 2 with as little new UI and contract
as possible.

## 2. Prior art: which value is locked, which is derived, and how the UI shows it

### 2.1 Pyware 3D and 3DX (drill)

- **Padlocks on Positions and Interval [V].** 3D Line tool: "Entering an interval … will lock the
  interval and the line will maintain the interval while you move its editing handles." "When
  locked, the value cannot be recalculated by the computer if the size or shape of the form is
  modified." With the interval locked, "the line would grow or shrink by changing the number of
  positions" ([Line tool](https://www.pyware.com/guide/3d/9.0/en/topic/line-tool)). The Arc tool
  says the same ([Arc tool](https://www.pyware.com/guide/3d/9.0/en/topic/arc-tool)).
- **Typing a value locks it [V].** No separate "lock" step: entering a number is the lock.
- **Both locked means alignment [V].** "To align a form, both positions and interval options must
  be locked." Then Left, Center or Right places the fixed run inside the longer drawn line. This is
  exactly today's OpenMarch Interval mode with its anchor.
- **3DX keeps the same model [V].** Position Lock: "When locked the interval will be adjusted to
  fit the performers to the shape." Interval Lock: "When the interval is locked the form positions
  are increased or decreased when the form is changed." Interval Options: Free, Horizontal,
  Vertical, Mixed, Random ([3DX Line tool](https://www.pyware.com/guide/3dx/1/en/topic/line-tool)).
- **Fixed Interval Float [V]** is a separate editing tool for an existing form: red Editing
  Handles reshape the form, and a **Lock Intervals** checkbox makes performers "maintain their
  intervals in the form". It also has Curved Shape, Delete Half, Revert and Reset to Hold
  ([FIF](https://www.pyware.com/guide/3d/11.0/en/topic/fixed-interval-float-tool)). The page
  doesn't say how the form resolves a drag that would break the intervals [I: the handle outline
  acts like a chain of fixed length].
- **Lesson.** Pyware's draw tools can't "keep the interval and change the shape", because their
  third variable is the count. Only FIF does it, as a separate tool, which is the "unrelated
  tools" problem the owner wants to avoid. In OpenMarch the count is fixed, so "keep the interval"
  in a draw tool _has_ to mean "the shape follows", and it can live in the same Spacing section.

### 2.2 EnVision and Ultimate Drill Book

- **EnVision (Box5)**: no public documentation of an interval lock or form tool was found
  ([Halftime review](https://halftimemag.com/gear-up/envision-visual-performance-design.html)
  covers the product only). 02 found form tools with a "stretch" slider [V-02]. Treat EnVision as
  unknown here.
- **Ultimate Drill Book**: search finds it as a drill _reader_ that imports Pyware files
  ([Illinois State catalog](https://help.illinoisstate.edu/software-catalog/software-catalog-a-z/software-catalog-ultimate-drill-book-pro)),
  not a design tool [I]. No spacing model to compare.

### 2.3 Illustrator Blend and Blender Array (count flexes)

- **Illustrator Blend [V-02]**: **Specified Steps** (count locked, spacing derived from the spine)
  or **Specified Distance** (spacing locked, count derived). Editing or replacing the spine keeps
  whichever is specified [K]. The spine never resizes to match.
- **Blender Array [V-02]**: Fit Type **Fixed Count** (count locked; with Constant Offset the
  array's length is derived, the closest thing to "shape follows"), **Fit Length** and **Fit
  Curve** (length locked, count derived). One dropdown names which quantity is fixed; the derived
  one isn't shown at all [K].
- **Lesson.** A single dropdown naming "what is fixed" is enough UI for a 3-state model, but both
  products hide the derived value, which drill writers need to see ("Length 14 steps").

### 2.4 Figma auto layout (closest 3-state analogue)

- Each axis of a frame is **Fixed**, **Hug contents** or **Fill container**; dragging an edge or
  typing a width switches that axis to Fixed automatically
  ([Figma help, auto layout properties](https://help.figma.com/hc/en-us/articles/360040451373)) [V,
  via search snippet].
- The gap between items is a number or **Auto**, "the largest distance possible between objects"
  (space-between) [V, same page via snippet]. A Figma community thread notes the old "spacing
  mode" control was removed in favor of typing Auto in the gap field
  ([forum](https://forum.figma.com/t/restore-spacing-mode-option-on-auto-layouts/46091)) [V].
- Mapping: **Fixed width + Auto gap = Fit**; **Hug + fixed gap = Keep interval**; **Fixed width +
  fixed gap + alignment = Interval on the path** (Figma's left/center/right alignment is our
  anchor).
- **UI lesson.** No padlocks. The mode is implied by _what you typed_: a number in the gap field
  fixes the gap, "Auto" derives it, and resizing by hand flips Hug to Fixed. Very low chrome.

### 2.5 CAD dimensions: driving vs. driven

- **Onshape [V]**: "Dimensions are driving by default." Driven dimensions "reflect the value of
  the implied dimension; it does not change geometry." "Driving dimensions appear black and can be
  edited. Driven dimensions appear light gray and cannot be edited." Over-defining a sketch makes
  the new dimension driven automatically; right-click toggles driving/driven
  ([Onshape help, Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm)).
- **Fusion 360 and others [V]**: driven (reference) dimensions show in **parentheses** and can't be
  edited ([Autodesk forum](https://forums.autodesk.com/t5/fusion-design-validate-document/dimensions/m-p/6711713));
  Altair documents the same parenthesis convention
  ([Altair](https://2022.help.altair.com/2022/form/en_us/topics/shared/parametric/sketching/dimension_c.htm)).
  A SOLIDWORKS user complains that without a marking "I have no way of knowing which one is driven
  and which is driving" ([forum](https://forum.solidworks.com/thread/13309)) [V, snippet].
- **Dragging [K]**: in a sketch with a driving length, dragging an endpoint can only rotate the
  segment about its fixed end; the solver moves whatever is still free.
- **Lesson.** Mark derived values visibly (gray, or parentheses, or "="), and let the user flip
  which one drives. Unlike CAD, never refuse an edit: in OpenMarch both-locked is a valid state
  (Interval on the path), so there is no over-constrained case.

### 2.6 Summary

| Tool              | Locked/derived control          | Derived value shown?       | Where "shape follows" lives   |
| ----------------- | ------------------------------- | -------------------------- | ----------------------------- |
| Pyware 3D/3DX     | Padlock per field; typing locks | Yes, in the unlocked field | Separate FIF tool             |
| Illustrator Blend | Spacing dropdown                | No                         | Nowhere (count flexes)        |
| Blender Array     | Fit Type dropdown               | No                         | Fixed Count + Constant offset |
| Figma auto layout | Implied by what you type        | Yes (Hug width is shown)   | Hug                           |
| Onshape / Fusion  | Driving/driven toggle           | Gray or (parentheses)      | The solver, on every drag     |

## 3. Proposal: one spacing model, two locks, every kind

### 3.1 The model

Keep the existing `Spacing` and add one field, so the three states are explicit:

```ts
export type Spacing =
  | { readonly mode: "fit" }
  | {
      readonly mode: "interval";
      readonly runs: readonly IntervalRun[];
      readonly anchor: "start" | "center" | "end";
      /** follow: the shape resizes so the run fills it; keep: the run is laid on the drawn shape */
      readonly size: "follow" | "keep";
    };
```

- **Fit**: unchanged.
- **Interval, size follow ("Keep interval")**: after every drag or typed change, the shape is
  resized so its length equals the run's length `S`. The anchor says **which point stays put**
  when the length changes (typing a new interval, adding a run): the start, the middle or the end.
- **Interval, size keep ("Interval on the path")**: today's behavior. The anchor says where the run
  sits on the drawn shape.

The anchor keeps one meaning in both interval states, "what is pinned", and needs no new control.

Mixed runs (`5x3,10x2`) need nothing special: `S` is the sum of `gapsInSteps(runs, gaps)`. The
runs are laid from the shape's start, so Reverse (Order) and the start marker on the field still
say where `5x3` begins. **Closed paths use `n` gaps**, so the last gap closes the loop: a circle
of 16 at 2 steps has `S = 32` steps and `r = 32 / 2π ≈ 5.09` steps. (Today `sampleAlong` lays
`n − 1` gaps on closed paths in interval mode. Follow mode must lay `n`, or the circle has a seam.)

### 3.2 One generic mechanism: scale about a pivot

The length of any path scales linearly with a uniform scale: `L(k·P) = k·L(P)`. So "make the shape
length `S`" is exact in one step for every path kind, with no solver:

```text
p1 = kind.drag(base, key, to, mods, n, ctx)        // the kind's ordinary drag, unchanged
L  = kind.path(p1).length
p2 = kind.transform(p1, scaleAbout(pivot, S / L))   // only when spacing is interval + follow
```

Pivot rule, the same for every kind:

- **Dragging an end handle** (a `point` handle at the path's start or end): pivot at the **other**
  end. The far end stays put and the dragged end **aims**: it lands on the ray toward the cursor,
  at the distance the interval allows.
- **Everything else** (bulge, interior curve points, the radius handle, typing in the panel):
  pivot at the **anchor point** (`path.at(0)`, `path.at(L/2)` or `path.at(L)`).
- **Move and rotate handles** don't change the length, so nothing is rescaled.

Contract changes, all optional, so kinds that don't add them simply don't offer follow mode:

1. `path?(params): Path` on path kinds. Every path kind already builds one (`linePath`, `arcPath`,
   `circlePath`, `curvePath`); exposing it also lets `outline`, `guide`, `generate`, `orderKey`
   and `readouts` become generic later.
2. `transform?(params, m: Affine): P` — apply a similarity transform to the params. This is the
   same hook the deferred Rotate/Scale/Mirror transforms need (decision 4), so it is not
   float-only work.
3. `float?(params, length, pivot, dragged, n, ctx): P` — an override for kinds where uniform scale
   is the wrong feel (arc ends, spiral). Default: the generic scale above.
4. `HandleDef.end?: "start" | "end"` to mark end handles for the pivot rule (`start: true` exists
   already; add the other end).
5. `Measure.size?: true` on the one measure that is "the size" (Length, Radius, Circumference),
   so the panel can put its lock beside the Interval (§3.4).

`session.dragHandle` gains the three lines above; `ShapeKind.drag` stays as is in every kind.

### 3.3 What each handle does, per kind and mode

`S` = the run's length from the interval. "Aim" = the far end stays put and the dragged end lies on
the ray toward the cursor.

**Line** (`a`, `b`, move)

| Handle   | Fit                        | Keep interval (follow)                                            | Interval on the path  |
| -------- | -------------------------- | ----------------------------------------------------------------- | --------------------- |
| `a`, `b` | moves the end; length free | aims about the other end; length stays `S`                        | moves the guide's end |
| move     | moves                      | moves                                                             | moves                 |
| typing   | Length sets `b`            | Length is derived "= 14 steps"; Interval resizes about the anchor | Length sets the guide |

Shift still snaps the angle to 45°. Snapping applies to the cursor; the derived end is wherever the
interval puts it, usually off-grid. That is the point of the mode, but say so in a hint.

**Arc** (`a`, `b`, bulge, move)

| Handle   | Fit                                 | Keep interval (follow)                                                                                  | Interval on the path |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| `a`, `b` | moves the end, bulge scales with it | default: aims, keeping the arc's proportions (sweep) and the far end; option: **bend to reach** (below) | moves the guide      |
| bulge    | sets the sagitta                    | bends a fixed-length wire: the sweep grows, radius `= S / sweep`, the anchor point stays                | sets the guide       |
| typing   | Radius or Sweep set the bulge       | Radius typed → sweep `= S / r`; Sweep typed → `r = S / sweep`; Length derived                           | as today             |

**Bend to reach** (a kind `float` override, worth an A/B): the dragged end goes exactly under the
cursor and the arc's curvature solves for length `S` over the new chord `c`. With sweep `θ`,
`c / S = sin(θ/2) / (θ/2)`, which falls monotonically from 1 to 0 as `θ` goes from 0 to 2π, so a
bisection gives one answer. Pulling the ends apart straightens the arc; pushing them together bends
it into a C and then nearly a circle. If the cursor is farther than `S`, the arc goes straight and
the end stops at `S` along the aim. This feels like Pyware FIF's fixed-length chain [I] and keeps
the handle under the cursor, which the generic aim doesn't.

**Circle** (center/move, radius-and-start rim handle)

| Handle | Fit                         | Keep interval (follow)                                           | Interval on the path  |
| ------ | --------------------------- | ---------------------------------------------------------------- | --------------------- |
| rim    | sets radius and start angle | **only turns the start**; `r = S / 2π` is derived                | sets the guide circle |
| move   | moves                       | moves                                                            | moves                 |
| typing | Radius                      | Radius derived "= 5.09 steps"; Interval resizes about the center | Radius sets the guide |

The generic scale with pivot = anchor point would move the center; for a closed path the pivot
must be the **center** (the circle's `float` override is one line: `r = S / 2π`).

**Curve** (control points `p0…pk`, move)

| Handle            | Fit             | Keep interval (follow)                                                   | Interval on the path |
| ----------------- | --------------- | ------------------------------------------------------------------------ | -------------------- |
| `p0`, `pk` (ends) | moves the point | the curve takes the new shape, then scales about the other end to `S`    | moves the point      |
| interior `pi`     | moves the point | the curve takes the new shape, then scales about the anchor point to `S` | moves the point      |
| move              | moves           | moves                                                                    | moves                |

Risk: after the rescale, the dragged interior point is no longer under the cursor. The alternative
is **trim/extend**: keep the drawn points and extend past the end along the tangent, or trim the
end, which is what Interval on the path already does. So for curves the two interval states may be
one in practice; the A/B should decide whether curve "follow" is scale or trim (§4).

**Block** (fill; across, deep, rotate, move)

`across` and `deep` are already typed intervals, so a block is natively "interval locked":

| Handle      | Fit (interval unlocked)                | Keep interval (locked, the default for blocks)                                                                          |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| across edge | stretches: `across` is derived (today) | changes **Files**: the edge snaps to whole files at the locked interval; ranks follow `⌈n / files⌉`                     |
| deep edge   | stretches: `deep` is derived (today)   | ranks are fixed by `⌈n / files⌉`, so this handle sets Files from the depth instead (deeper = fewer files), or is hidden |
| typing      | Across/Deep typed lock them            | Files typed; size readout derived                                                                                       |

This is the Pyware Block idea with the count moved from "positions" to "files", the one count a
block can trade. "Interval on the path" has no meaning for a block in v1.

**Future kinds**

- **Polyline, hollow box, wedge outline, diamond outline**: closed or open polylines; the generic
  scale works unchanged (pivot at the other end or at the centroid when closed).
- **Spiral**: override `float` to add or remove **turns** at a fixed pitch rather than scale, as 03
  suggested ("Interval grows turns").
- **Filled wedge, filled circle, region fill**: intervals already locked as in blocks; the
  "size" handles change the count of rows or rings.

### 3.4 Panel: how locked and derived values look

Follow Pyware's vocabulary (padlocks, typing locks) with Onshape's display (derived is gray):

```text
Spacing
  Interval   [ 2            ] 🔒      ← locked: typed, driving
  Length     = 14 steps       🔓      ← derived: gray, "=" prefix
  Keep       ( Start | Center | End )  ← shown only while Interval is locked

Spacing (fit)
  Interval   = 2.4 steps      🔓
  Length     [ 16          ] steps    ← the handles drive it
```

- **Two locks, at most.** One on Interval, one on the kind's size measure (`Measure.size`). No
  other measure gets a lock in v1.
- **Typing a value locks it** (Pyware). Typing into a derived Interval switches to Keep interval;
  typing into a derived Length while the Interval is locked switches to Interval on the path.
  Clicking a padlock unlocks, which hands that value back to the handles.
- **Derived values are gray with "="** and stay selectable for copying. Parentheses read as
  "optional" to non-CAD users [I], so prefer "=".
- **The two locks give the three states**: Interval 🔓 = Fit; Interval 🔒 + Size 🔓 = Keep
  interval; both 🔒 = Interval on the path. (Size 🔒 with Interval 🔓, a fixed-length line whose
  ends only aim, falls out of the same code via `Measure.set` after a drag, but hide it in v1
  unless the owner wants it.)
- **On the field**: while a drag is clamped by the locked interval, show a small lock badge by the
  dragged handle and the derived length ("🔒 2 steps · 14 steps"). The faint guide stays for
  Interval on the path only.
- **The anchor control's label** changes with the state: "Keep … fixed" in follow mode, "Lay from"
  on the path. Same three buttons.

Alternative UI for the A/B (Figma style, no padlocks): the Interval field accepts **Auto**
("Auto · 2.4 steps") for Fit; a number means Keep interval; a "Fit to drawn length" checkbox under
it means Interval on the path. Same model, one field fewer.

### 3.5 Code impact

- `types.ts`: `Spacing.size`, `ShapeKind.path?`, `transform?`, `float?`, `HandleDef.end?`,
  `Measure.size?`. All optional.
- `spacing.ts`: `requiredLength(runs, n, closed)`; `sampleAlong` lays `n` gaps on closed paths in
  follow mode.
- `session.ts` `dragHandle` and the panel's `setMeasure`/spacing change: apply the follow step.
- `ShapeToolPanel.tsx`: locks and derived styling on Interval and the size measure; show the
  anchor in both interval states.
- Kinds: `path` and `transform` for line, arc, circle, curve; `float` for circle (center pivot)
  and optionally arc (bend to reach); block's `drag` reads the lock to choose stretch vs. files.
- Recipes: store `size` with spacing; an absent `size` reads as `"keep"`, today's behavior.
- Tests are pure: for each kind, a drag in follow mode keeps `path.length === S` and the far end or
  anchor point fixed; a closed path has `n` equal gaps.

## 4. Default and the A/B

**Recommended default.**

- **The tool opens in Fit.** `fit()` lands the preview on the marchers' current spots, so opening
  the tool moves nobody (03's "nothing moves far").
- **Typing an interval locks it and the shape follows** (Keep interval). The owner's own reply on
  [#566](https://github.com/OpenMarch/OpenMarch/issues/566) ("adjust the shape's scale so the
  marcher's distance matches") and [#728](https://github.com/OpenMarch/OpenMarch/issues/728)
  ("the intervals should automatically be locked and not fluctuate") both describe this state.
  Interval on the path is one more click (lock the size).
- **Sticky**: the last lock state per kind carries to the next use (03's sticky defaults), so the
  "forced interval" camp sets it once.

**Simulated-user study.** Personas: a veteran Pyware writer (expects padlocks and FIF), a
band-director hobbyist (thinks "make it fit between the 30 and the 40"), and a new staff member who
has never used drill software. Arms:

- **A**: padlocks (§3.4), typing an interval → Keep interval.
- **B**: Figma-style Auto field, typing an interval → Keep interval.
- **C** (control): today's Fit / Interval (on the path) only.

Tasks:

1. **Arc at an interval, ends on landmarks.** "Put these 12 trumpets in an arc 2 steps apart,
   bowing toward the front, starting on the 30 yard line front hash." Then "make it 2.5 steps."
   Within arms A and B, also compare arc end drag = aim vs. bend to reach.
2. **Circle with a start.** "16 marchers in a circle 1.5 steps apart, centered on the 50, drill
   number 1 at 12 o'clock." This checks the rim handle that only turns the start.
3. **Fit then lock.** "Make a line from the left 35 to the right 35 front hash, note the interval,
   round it to the nearest half step, and keep the first marcher on the left 35." This checks the
   anchor as "what stays fixed" and the hand-off from Fit to Keep interval.
4. (Optional) **Block wider.** "Make this 4-file block 6 files wide at the same 2-step interval."

Measure per task and arm:

- success (final positions within ¼ step of the target), time, drags, undo presses and lock toggles;
- **surprise count**: the simulated user states what it expects before each drag, and the
  mismatches with the result are counted (the main signal for aim vs. bend and for curve
  scale vs. trim);
- **comprehension**: after the task, "if you drag this end now, what will change?" asked for 3
  handles, scored right/wrong;
- whether the user ever noticed or read the derived "=" value.

## 5. Open questions for the owner

1. **Default for a typed interval**: shape follows (recommended) or today's "on the drawn path"?
2. **Locks UI**: padlocks on Interval and size, or the Figma-style "Auto" interval field? (A/B
   either way.)
3. **Arc end drag with a locked interval**: aim (keep the arc's shape, simple) or bend to reach
   (end under the cursor, curvature solves)?
4. **Curve with a locked interval**: scale the whole curve, or keep the drawn points and
   trim/extend at the end (which makes it the same as "on the path")?
5. **Block**: with the interval locked, should dragging the across edge change Files?
6. **Size lock without an interval lock** (fixed-length line or fixed-radius arc whose ends only
   aim): wanted in v1, or later?
7. **Snapping**: in follow mode the derived end is off-grid by design. Acceptable, or should the
   interval instead flex to the nearest snapped end (which would break the lock)?
