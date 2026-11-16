# Roster changes: the shape system as it exists

Fact-finding for "delete or add a marcher in an existing show" (fork main `e5e2b3a30`, 2026-11-16).
Paths are from the repo root; `shapes/` means `apps/desktop/src/shapes/`. **FACT** is read from code,
an ADR or an issue. **INFERENCE** is reasoned from the code and not run.

## Summary

1. A placed shape is a recipe: `params` JSON (with `spots`, holes included) plus member rows (`marcher_id`, `slot`, `x`, `y`), keyed by **move** (`timeline_id`). Positions stay the truth.
2. Kinds today: box (`block` v1), circle (v2), Line and Curve (`line` v2), Arc (`arc` v2), group (`group` v1, "as is"), and the `ungrouped` mark. Older v1 kinds read as plain positions.
3. Membership is binary. A member off its spot leaves the shape and its spot becomes a **hole**. The spot count does not shrink.
4. There is **no stored Hole / Close up / Re-split setting**. It was decided 2026-10-26 (#436 decision 4) and **reversed 2026-10-30** (decision 8, #358 decision 4): leaving always leaves a hole, and filling it is an explicit command.
5. **Close up** is built (#392 → #407) for closed shapes only (box, circle, closed Line or Arc). **Re-split** is built for the box only, in the toast only. Open Lines, Arcs and groups keep holes for good.
6. Nothing adds a marcher to a placed shape. The open shape always has one spot per selected marcher. #358's "a joiner takes the nearest empty spot" is decided but not built.
7. Deleting a marcher removes it from every recipe (FK cascade). Its spots stay as holes on every page, and no toast appears.
8. Holds' remove-for-a-range refuses shape members on main. PR #1015 (open) would let them leave holes.
9. Carry-forward is derived: a recipe shows on later pages while every member stays on its spot. An edit on a later page saves a copy there, and earlier pages keep theirs.
10. Re-layout for N±1 is mechanical for circle, outline, spread, Line and Arc. A Files box needs a judgment call at awkward counts (e.g. a lone back-rank marcher). A group has no rule at all.

## 1. Shape kinds

Storage for every kind is the same two tables (FACT, `apps/desktop/electron/database/migrations/schema.ts:614-664`):

- `timeline_shape_recipes`: `id`, `timeline_id` (the move whose end it shapes, NULL for homes, cascade on move delete), `kind`, `kind_version`, `params` (JSON), `order_mode` (`nearest`/`keep`, older `drill`), `reverse`.
- `timeline_shape_recipe_marchers`: `recipe_id`, `marcher_id` (cascade on marcher delete), `slot`, `x`, `y`. Unique per (recipe, marcher).
- `params.spots` is the spot count, holes included. It is written on every placement (`shapes/tool/shapePlacement.ts:57-58`, `shapes/placed/commitBox.ts:162,210`). A reader takes `max(spots, members)` (`shapes/placed/placedBox.ts:117-121`).
- The kinds that can be read back are the drawable kinds plus group (`shapes/placed/placedBox.ts:64-67`, `shapes/tool/shapeTools.ts:18-24`). An unknown kind or version reads as plain positions (ADR 0006 decision 5).

| Kind (id, version) | Params (FACT) | What a spot is a function of (FACT) | Fill / distribution |
| --- | --- | --- | --- |
| **Box** (`block` 1; `kinds/block.ts:254`) | `center`, `rotation`, `flipX/Y`, `files`, `across`, `deep`, `pivot`, `distribution`, `spots` (ADR 0006:229-239, `kinds/block.ts:21-49`) | **Count n** plus params. Files: the layout family, `files` and n pick the lines (`distribute/layouts.ts:512-539`). Slots carry row and col (`placed/liveBox.ts:340`). | Files (layout families Full, Stagger, Rounded, Short back, Notched; `byFile`; `stagger [p,q]` stored but not settable since #408), Outline (`oddGap` side/at/style), Spread (`seed`, `generator`, `count`, `edge`). `distribute/distribution.ts:36-160` |
| **Circle** (`circle` 2) | `center`, `interval` (chord), `rotation`, flips, `distribution` (`circle/circleGeometry.ts:32-40`) | **n**: radius = interval / (2 sin(π/n)), not stored (ADR 0006:199-205) | Outline or Spread only (`circle/circleGeometry.ts:43`) |
| **Line / Curve** (`line` 2; the Curve is a preset) | `points` (`x`, `y`, `tension`, optional `marcher`), `closed`, `corners`, `spacing` (`fit` / `keep` / `path`, with `groups` `{interval, count?}`), `measured`, `offset`, `turn`, `pivot` (ADR 0006:279-513) | **n** along the drawn path. Fit: the interval follows the length. Keep: the length follows the n−1 gaps from the pivot. Groups: counted groups first, the rest group absorbs, else the last grows, too few drop from the end (`spacing.ts:155-159`). | Open: none. Closed: Outline, Grid, Spread, Edge (ADR 0006:343-383) |
| **Arc** (`arc` 2) | A Line of two points, the first bent (`arc/arcGeometry.ts:38-52`, `arc/arcShape.ts:12-20`) | As a Line | Open, or closed by its chord or round to a full circle, then filled as a closed Line (`arc/arcTool.ts:364-366`) |
| **Group** "as is" (`group` 1, #603) | Frame plus `points[i]` = slot i (`group/groupGeometry.ts:18-30`) | **Fixed points**, not a count. Interval = smallest neighbor gap, used for scaling (ADR 0006:595-624) | None. No Close up, no Re-split, no Recalculate, not saveable (ADR 0006:619-623) |
| **Ungrouped** (`ungrouped` 1) | `{}` | No spots. It claims its members from its move on (`placed/placedBox.ts:72-83,151-155`) | n/a |
| Dormant | Page-era `shapes`, spec `timeline_shapes` / `dest_shape_id`, old v1 line/arc/circle | Not readable as placed shapes. #505 removes them. | n/a |

Expand and Shrink are by interval, in half steps. They never change the count (spec 08 "Transforms"). Box − / + changes the file count at the same spot count (`placed/liveBox.ts` `liveFiles`).

## 2. Holes, Close up, Re-split

**The stored setting (FACT).** The ownership research (#436, branch `research/ownership-model`, README decision 4) proposed `params.onLeave: hole | closeUp | resplit`. The owner reversed it on 2026-10-30 (decision 8). #358's decided rules now apply, and they are **not built** (#358 and #504 are open):

1. A spot count can exceed the marchers.
2. A joiner takes the nearest empty spot, and nobody else moves.
3. A marcher dragged onto an empty spot fills it, and onto a taken spot swaps.
4. Leaving always leaves an empty spot. Close up and Re-spread are commands.
5. Recalculating keeps who is where. Only Reassign, Close up and Re-spread change assignments.
6. A shape can't shrink below its marcher count.
7. Spots keep identity by row and column (box), or by side and order (outline).
8. Reassign acts only on the selected marchers.

The code has no `onLeave` field.

**What is built (FACT):**

- **Leaving:** a coordinate edit that moves some members off their spots saves the recipe without them, with `spots` unchanged (`placed/placedBox.ts:194-215,242-255`, `placed/boxMembership.ts:46-127`). If every member moves the same way, the shape moves instead.
- **The toast** "OT3 left the box" (8 s) shows **Close up** for a closed kind and **Re-split** for a box. Ignoring it keeps the hole (`placed/leftBoxToast.ts:85-160`).
- **Close up** is also a button in the floating editor while there are holes (`editor/CloseUpButton.tsx:8-46`, `editor/editTargets.ts:286-314`). It works only on a closed shape (`placed/placedBox.ts:289-296`):
  - It keeps the mode and settings and re-lays out for n = members (`placed/placedBox.ts:298-330`).
  - Files takes the family's version for n, or Short back as wide as a stand-in (the stored family is kept and the chip notes it).
  - Outline goes round again at the same spacings.
  - Spread keeps the count it was seeded for, so it relaxes into the gap.
  - The pivot stays where it was with every spot filled.
  - Who goes where is least travel **from the current spots**, not from the start flag.
- **Re-split** (box only): `drawBox` runs again inside the old edge-marcher rectangle for n (`placed/placedBox.ts:346-377`). It uses the user's **last-used layout family** (`env.layout`, localStorage), not the box's own, because no `previous` is passed (`box/boxGeometry.ts:682-702`, `tool/toolEnv.ts:103`). The file count comes from the evenness rule `splitFor` (`box/boxGeometry.ts:476-500`), and the intervals spread to the old edges.
- **A new layout on a holed shape closes the holes.** A file count or mode change re-lays out for the members only (`placed/liveBox.ts:235-316`).
- **Recalculate** is disabled with holes, with the tooltip "close up the empty spots first" (`placed/liveBox.ts:329`, `editor/ShapeEditorBar.tsx:1219`).
- **Open Line or Arc:** Close up is never offered, and a Line's order picks keep holes (`leastTravelOnto`, `placed/liveBox.ts:276-285`).

**Other ways the member count changes today:**

| Event | Effect on the recipe |
| --- | --- |
| Delete marcher | FACT: member rows cascade and empty recipes are deleted (`db-functions/marcher.ts:258-260`). `spots` is untouched, so INFERENCE: a hole on every page that recipe or its copies cover, with no toast. |
| Add marcher | FACT: creating marchers doesn't touch recipes (only delete references them in `db-functions/marcher.ts`). The new marcher is in no shape. |
| Holds remove-for-a-range, Clear this page | FACT: shape members are skipped and named (ADR 0012:357-368,563-574, `db-functions/timelineMoveCuts.ts:63-68`). PR #1015 (open) would take them, leave holes and pin the spot count. |
| Split by marchers (UI-25) | FACT: a recipe they make up the whole of moves with them; from any other recipe they are dropped (`db-functions/shapeRecipes.ts:263-319`). INFERENCE: that leaves holes, since `spots` is kept. #436 decision 10: split-off marchers become freeform. |
| Merge moves | FACT: recipes are re-pointed, and their members leave the target's other recipes (`db-functions/shapeRecipes.ts:209-261`). INFERENCE: holes in those. |
| Placing a new shape or Group over members | FACT: they leave every other recipe ending at that beat, and empty recipes are deleted (`db-functions/shapeRecipes.ts:62-151`). INFERENCE: holes in partial ones (#629 asks the owner about Group on a carried shape). |
| Ungroup | FACT: the recipe becomes the `ungrouped` mark, either in place or on the later page (ADR 0006:566-593, `placed/ungroupShape.ts`) |

## 3. Carry-forward

- FACT: `boxesAt` shows a recipe at any beat at or after its move's end while **every** member stands on its spot (within 0.01). The latest recipe wins per marcher, and an ungrouped mark claims its members (`placed/placedBox.ts:124-178`).
- FACT: the owner ruled on 2026-11-01 (#477) that a carried shape is its hold (`timeline/timelineCarried.ts:13-17`).
- FACT: any edit on a later page saves a **copy** on that page's move. The earlier page keeps its recipe (ADR 0006:270-272). Exceptions where the shared recipe changes instead: #501.
- FACT: PR #1015 (open) would reverse this. Shapes would be Held whole, and an edit would change the recipe where the hold grows out of, with no copy.
- FACT: saved shapes store kind, intervals and distribution with no count, so they apply to any n (ADR 0006:105-150).
- INFERENCE on propagation:
  - A drag-off on page N writes page N's copy with a hole. Earlier pages are unchanged, and later pages carry page N's copy while its members hold.
  - A deletion hits every recipe and copy.
  - A new marcher joins none.
  - A recipe whose members later walk off is simply not shown from there on. It is not edited.

## 4. Can N−1 or N+1 re-lay out without the designer?

Today there's no N+1 path on a placed shape. Re-drawing with one more selected makes a new recipe. The deterministic primitive is `shape.generate(params, n)`, which paste (#961, PR #984 open) uses for "keep spacing".

| Kind | N−1 | N+1 | Verdict |
| --- | --- | --- | --- |
| Box, Files | Hole at (r, c); Close up re-lays out by family | `generate` for n+1 by family | Deterministic, but judgment at awkward counts |
| Box, Outline | Same spacings, odd count uses `oddGap` | Same | Deterministic |
| Box or circle, Spread | Relaxes (stored `count`) | Relaxes | Deterministic, small nudges |
| Circle | Radius shrinks at the same chord | Radius grows | Deterministic |
| Line or Arc, Fit | The interval widens over the same drawn path | It narrows | Deterministic, but which slot is "the hole" in an ordered line is a judgment (none is offered) |
| Line, Keep or path | The line shortens or grows from the pivot or anchor; groups follow `layGroups` | Same | Deterministic |
| Group (as is) | Hole only | No rule: where does a new point go? | Needs the designer |
| Ungrouped or plain | n/a | n/a | Nothing to re-lay out |

**Worked example: an 8 × 4 Short back box (32), one marcher gone.**

- **Hole:** FACT. `spots` stays 32 and 31 members keep their slots. Spot (r, c) shows empty, and the label counts empty spots (`placed/placedBoxText.ts:77`).
- **Close up:** FACT. `resolveLayout(shortBack, 8, 31)` gives lines `[7, 8, 8, 8]`, back first: "8 × 4, 1 short". The 7 sit half an interval in, and the intervals and pivot are kept. INFERENCE: least travel moves the hole's file forward and re-centers the back rank, roughly 8 to 11 marchers. A 5 × 4 test asserts at most 5 move (`__test__/closeUp.test.ts:161-179`). For a Full 8 × 4, 31 has no near-square Full version, so Short back stands in and the chip notes it (`__test__/closeUp.test.ts:150-159`).
- **Re-split:** INFERENCE, hand-computed from `splitFor`. The 14 × 6-step rectangle with n = 31 also gives 8 files at 2 steps, the same block as Close up. It can differ for other shapes or counts, and when the user's last-used layout isn't Short back.
- **N+1 = 33:** FACT. `shortBackLines(8, 33)` gives `[1, 8, 8, 8, 8]`, a lone back-rank marcher. The picker's `noLonely` filter (`distribute/layouts.ts`) doesn't apply to `resolveLayout`. A Full 8 × 4 with 33 has no near-square Full version and falls back the same way. This is where a judgment call is needed.

## 5. Marcher assignment

- FACT, `shapes/leastTravel.ts`: least total **squared** travel (Hungarian), then crossing walks swapped apart (lines 18-41, 75-101). `leastTravelOnto` assigns onto more spots than marchers, so empty spots are free stand-ins and holes survive (lines 43-70). It's the one replaceable solver.
- FACT, `shapes/assign.ts`: `nearest` uses the solver from where each marcher starts the move (`from`, the start flag) up to 500 marchers, then falls back to keep order (lines 68, 107-111).
  - `keep` follows the marchers' order along one placed Line when they all come from it (`along`), else their order round a ring, else a projection onto the kind's `orderKey` with drill rank breaking ties (lines 113-152).
  - `reverse` flips the slot order.
  - Only the Line, Curve and Arc offer Keep and Reverse (`orderOn`, line 24). Keep is offered only when every selected marcher is in one placed Line (`placed/placedOrder.ts:13-48`, `editor/OrderMenu.tsx`). Drill order was removed (#429).
- FACT: Close up and Re-split use `nearest` from the current spots, not from the start flag (`placed/placedBox.ts:258-287`, `editor/editTargets.ts:298-314`).
- FACT, #960 (open, owner decision pending): one app-wide rule. Triage found two rules: shapes and paste use squared least travel, and timeline casting uses plain distance (`timelineCasting.ts`). The suggested picks are shortest walk as the default, Keep and Reverse only where order matters, and moving casting onto the shared solver. Paste chose shortest walk (#961); picking spots by hand is #982.

## Open or unbuilt items (Shapes epic #942 and related)

- **#358** (open): its decisions are recorded, but nothing is built. That covers spots without marchers, joining the nearest empty spot, drag to fill or swap, Reassign, shrink limits and spot identity. "How empty spots draw" is still open.
- **#504** (open): recipes re-keyed to `transition_id`, with an empty spot as a slot with no marcher.
- **#1015** (open PR): Held shapes, and holds that take shape members and leave holes.
- **#961 / #984, #982** (open): paste keeps spacing for a new count, and picking which spots stay empty.
- **#356** (Freeze as shape): Group shipped as #603. #629 has open questions on grouping part of a carried shape.
- **#583** (join shapes), **#864** (locking), **#501** (pivot on a carried page leaks back).
- Gaps found in the code:
  - No Close up for an open Line or Arc, or a group, so their holes are permanent.
  - Recalculate's "close up first" tooltip still shows there (INFERENCE).
  - Re-split is only reachable from an 8 s toast.
  - Deleting a marcher leaves silent holes.
  - Short back can produce a lone back-rank marcher at n+1.
