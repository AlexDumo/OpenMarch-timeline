# 0006: Shapes are stored as recipes beside the positions they place

- Status: accepted
- Date: 2026-10-10
- Accepted: 2026-10-29
- Revision of 2026-11-22 (a shape is a formation at a count): proposed

## Context

The Shape tool (docs/timeline/research/shapes/README.md) places selected marchers on a shape at
one moment: the end of the move being edited, or their homes. It writes the positions through
the same path as a canvas drag (`moveMarchersInTarget`), so playback, the resolver, the file
format and older app versions see ordinary positions.

The owner wants shapes kept as re-editable records: "an equation that lays out how the marchers
are distributed, but we can have overrides". Reopening a placed arc should show the arc, with
its settings, and changing its radius should move its marchers again, keeping any marcher the
designer has since nudged by hand where it is relative to its spot.

The spec's own shapes (`timeline_shapes`, `dest_shape_id`) can't carry this. They have five
fixed kinds checked by the database, every new kind would be a spec, schema and resolver change,
and a group transition into a shape breaks UI-9's one-transition-per-marcher rule
(01-codebase.md §6). Shape kinds are meant to grow without schema changes (03-shape-model.md §3).

## Decision

1. **Positions stay the source of truth for motion.** Placing a shape writes positions exactly
   as today. Nothing the resolver reads changes.
2. **A recipe is stored beside them**, in two new app tables (not spec tables, no change-log
   triggers, with history triggers so undo and redo restore them with the positions):
   - `timeline_shape_recipes`: `id`, `timeline_id` (the move whose end it shapes, `NULL` for
     homes; deleted with the move), `kind` and `kind_version` (the shape kind's id and generator
     version), `params` (the kind's JSON parameters), `order_mode` and `reverse` (who goes where),
     `created_at`.
   - `timeline_shape_recipe_marchers`: a surrogate `id` (ADR 0012 C-2), `recipe_id` (deleted with
     the recipe), `marcher_id` (deleted with the marcher), `slot` (the marcher's spot in the
     recipe's slot order) and `x`, `y` (where the recipe put it when last placed). One row per
     marcher and recipe.
3. _(Revised 2026-10-14, see below.)_ **Overrides are the difference between where a member
   stands and where its recipe put it.**
   They are not stored separately: a member nudged after placement simply stands somewhere else,
   and reopening the recipe shows it as moved by hand. Editing the recipe moves each member to
   its new spot plus its override, unless the designer resets the overrides.
4. _(Revised 2026-10-29, see below.)_ **A marcher belongs to at most one recipe at a beat.**
   Placing marchers with a new shape removes them from the other recipes at the beat it's placed
   at; a recipe left with no members is deleted. Both happen in the same edit as the positions,
   so it is one undo step.
5. **Kinds own their parameters.** `params` is whatever the kind declares, read by kind id and
   version. An unknown kind or version (a file from a newer app) is shown as a plain group of
   positions: the recipe can't be reopened, but nothing is lost.

## Consequences

- New kinds and parameters never need a migration.
- A file opened in an older app keeps every position; the recipe tables are ignored there.
- Recipes can go stale when other edits move the move's end: they belong to the move by id, so
  resizing a move keeps them attached to it, and splitting or merging moves carries them to the
  move that holds those positions (Revision, 2026-10-29).
- Follow the leader can later use a recipe's path as its route (README decision 5).

## Verification

- Migration test: the tables exist after migrating an older file, with their foreign keys.
- History: placing a shape and undoing removes both the positions and the recipe; redo restores
  both, with the same ids.
- Deleting the move, or a marcher, deletes the recipe rows that hang off it.
- Unit tests for reopening: overrides computed from positions, edited recipes keep overrides.

## Revision, 2026-10-14: no overrides

The owner chose binary membership for placed boxes
(docs/timeline/research/shapes/07-placed-boxes.md). A member stands exactly on its spot or isn't
in the recipe. Moving some members takes them out, leaving their spots as holes (the box's params
store `spots`, the spot count with holes). Moving every member the same way moves the recipe.
Decision 3 is replaced: there are no overrides, and a reopened recipe always matches the field.

A recipe is shown at its move's end and at later moments while all its members stand on their
spots. Editing it at a later moment saves a copy on that later move.

## Amendment, 2026-10-20: the frame and pivot, and spots with marchers

The shape host (spec #344, owner grilling 2026-10-20) adds two points. Neither changes the schema.

1. **A recipe stores the shape's full frame**: its center, size, rotation, flip and pivot. They
   live in `params` beside the kind's own numbers. The center, size, rotation and flip are the
   kind's to store (a box keeps its center, spacings, rotation and flips; its size follows from
   them and the spot count). The **pivot** is the host's: `params.pivot` is one of the frame's 9
   points (`"nw"` … `"se"`), or a point of its own `{ x, y }` in the frame's terms (a multiple of
   the half size across and deep, or field units on an axis with no size), so it moves, turns
   and stretches with the shape. No `pivot` means the center, which every new shape starts at, so
   recipes saved before this amendment read as centered. Scaling is never stored as a factor: it
   becomes the new size and intervals. Reopening a recipe shows the shape turned, flipped and
   pivoted as it was left.
2. **A recipe is spots with marchers assigned to them.** The kind lays out the spots
   (`params.spots` counts them, holes included); `timeline_shape_recipe_marchers` says which
   marcher stands on which spot (`slot`). The two stay separate steps: a kind is given the spot
   count by the host and never reads the selection. A spot with no marcher is planned, not built:
   nobody is placed there, and it is kept only as a hole in a recipe whose members left
   (Revision, 2026-10-14). Shapes with spots that nobody stands on from the start come later
   (#358) and fit this model without a schema change.

Verification: the shape host's unit tests save a shape through `placementOf` and read it back
through `boxesAt` with its pivot (`shapePivot.test.ts`), and a browser scenario places a box with
a pivot of its own and finds it there when the box is selected again (`box-tool.spec.mts`).

## Amendment, 2026-10-20: saved shapes

Saved shapes (#353, spec #344) are named shapes a user keeps to use again. They need storage
beside recipes, following the Assets pattern of a user library ("My Library") with a copy in
each show that uses one ("This show"), so a show opens with its shapes on another computer.

1. **A saved shape is a kind, its intervals and how it's filled, under a name.** It stores the
   kind's id and version, each interval parameter's value in steps by the parameter's key, and,
   for a closed kind, its **distribution** (updated 2026-10-22, spec #385, #393): the recipe's
   `params.distribution` (amendment of 2026-10-22, below) without a Files layout's `files` or a
   spread's `seed` and `count`. It stores no size, count, center, rotation, flip, pivot or seed, so it fits any
   selection. Picking it opens its kind; drawing it, or turning an open shape into it, lays the
   spots out the saved distance apart in the saved mode, layout, stagger (when one is stored;
   nothing in the UI sets it since #408) and outline gap. The
   kind reads the saved distribution as it reads a recipe's, at the size it's drawn, and an even
   spread starts at seed 1. A mode the kind can't take or doesn't know leaves the kind's own
   fill. A shape placed from it is an ordinary recipe of its kind, with no reference to the saved
   shape, so it reopens without it.
   - It also keeps an optional **description** and the dates it was **created** and last
     **updated** (ISO 8601). Changing a saved shape sets its updated date. Library entries saved
     before these fields read without them.
   - Its preview is still generated from the kind's geometry, never stored (#378).
2. **The user's library is per-user app storage**, like shape stars: a JSON list in the
   renderer's localStorage (`openmarch:savedShapes`). The Assets Library's content-addressed
   store in the main process was not reused: a saved shape is a few numbers, not bytes, it has
   no versions or license, and the web editor has no Assets Library but does have shapes.
3. **The show's copy is the `saved_shapes` table** (migration 0028): `id` (the same id as in
   the user's library), `name`, `kind`, `kind_version`, `intervals` (JSON), `description`
   (NULL for none), `distribution` (JSON, NULL for an open kind) and `created_at` /
   `updated_at`. The copy takes the library entry's dates; an entry with none is dated when it's
   copied, and refreshing a copy keeps its created date. Migration 0028 hadn't reached `main`
   when these columns came, so it was regenerated with them rather than followed by another. Like
   `library_items` it has no history triggers: saving a shape isn't a drill edit, so undo
   doesn't change it. Saving writes the copy, and placing a shape picked from a saved one writes
   or refreshes it. The library lists the user's saved shapes, then copies the user's library
   doesn't have, which can be added to it. Deleting a saved shape deletes it from the user's
   library and the open show; other shows keep their copies.

Verification: `savedShapes.test.ts` saves a shape through the shape session and applies it to
other counts with the box and a fake kind, including a staggered box that keeps its layout
family and stagger, and a spread that keeps its mode but not its seed; the db-function
`savedShapes.test.ts` round-trips the description, distribution and dates through the show's
copy, and the library panel test through the user's library; the migration test checks 0028
adds only its table, with the new columns; a browser scenario in `box-tool.spec.mts` saves a box,
draws it on another selection at its spacing, and finds it listed from the show's copy after the
user's library is cleared, and another saves one with a description and finds it there.

## Amendment, 2026-10-22: how a closed shape is filled

Distribution modes (spec #385, owner grilling 2026-10-21/22) let a closed shape be filled in
Files, Outline or Even spread. The shape host owns the fill: a closed kind describes only its
region, and one shared distributor lays out the spots. This needs no schema change.

1. **The distribution is a host-owned object in `params`**, beside the kind's own numbers, as
   the frame and pivot are (amendment of 2026-10-20). Every closed kind stores it the same way:
   - `{ "mode": "files", "layout": { "family", "files", "byFile" }, "stagger": [p, q] }`: ranks
     and files at the kind's intervals. `family` names the layout (`"shortBack"`, today's box;
     the box's layout picker adds the others), `files` is the full rank's count and `byFile` turns
     the rows to run front to back. `stagger` is the signed offset of each rank as the fraction
     p/q of the across interval, so ⅓ round-trips exactly. It is stored and read, but since the
     stagger slider was removed (#408) nothing in the UI sets it, so new shapes store `[0, 1]`.
   - `{ "mode": "outline", "oddGap": { "side", "at", "style" } }`: spots around the edge at the
     intervals, one on every corner. An odd count leaves one spot between corners out: on `side`
     (`"back"`, `"front"`, `"left"` or `"right"`, the kind's own sides before any flip), `at`
     intervals from that side's start (left to right on the back and front, front to back on the
     sides), or its middle when `at` is null. `style` `"spread"` (the default, owner 2026-10-23)
     spreads that side's spots evenly between its corners; `"gap"` leaves the spot empty instead.
     A missing or broken `oddGap` reads as the back spread evenly, and an `at` the count no longer
     has reads as the middle of its side. A region with no corners (the circle) has no gap to leave and ignores
     `oddGap`.
   - `{ "mode": "spread", "seed", "generator", "count" }` (#391): a seeded scatter whose closest
     pair is the kind's interval. `seed` is a whole number from 1 (Reshuffle stores the next
     one), `generator` the algorithm (decision 4), and `count` the spot count the seed was laid
     out for. At another count the spots relax from that layout (new ones placed by best
     candidate, extra ones taken from the most crowded spots) instead of reshuffling, so adding
     or removing a marcher nudges the spread; reshuffling stores the count there is now. Without
     `count` the seed is laid out for whatever count there is.
2. **No `distribution` reads as Files, Short back, no stagger.** That is how every box recipe
   stored before this amendment reads, `pattern: "grid"` ones included, and it lays out exactly
   the spots they had, so the box's `kind_version` stays 1. `pattern`, `shortRank` and
   `shortRankAt` retire: a box no longer writes them. Recipes from before box v1 (short rank at
   the front or off center) still read by them. A distribution this version can't read (an
   unknown mode or broken fields) reads as the default too.
3. **The box's file count stays `params.files`**, as recipes have always stored it. Its Files
   layout's `files` is written beside it to match, and readers take the box's own when they
   differ. In Outline it is the spots across the back and front, which set the outline's
   proportions; the spots down each side follow from the count.
4. **An even spread is versioned by its `generator`**, apart from the kind's version, because its
   spots come from a seeded algorithm that may be improved later. A recipe whose generator this
   app doesn't have is shown as a plain group of positions, as decision 5 does for an unknown
   kind or version: it can't be reopened, but nothing is lost. A count or layout change is never
   stored as a generator change.
5. **The spots stay the kind's to generate**, through the distributor, in a fixed order, so the
   `slot` numbers of `timeline_shape_recipe_marchers` keep meaning the same spot.
6. **The circle tool's recipes are `circle`, version 2** (#389). Version 1 is the path circle of
   the old shapes panel (a radius and a spacing along the path); version 2's params are
   `center`, `interval` (the chord between neighbors), `rotation`, `flipX`, `flipY` and the
   distribution. Its radius follows the count, r = interval / (2 sin(π/n)), so it isn't stored.
   A circle is filled in Outline or Even spread; a distribution it can't be filled in reads as
   Outline. In Even spread its radius follows the spread instead, which fills the circle at the
   size its count and interval give.
7. **A spread keeps a box's proportions in files and ranks** (#391): a box in Spread keeps its
   `files`, and the spread fills a rectangle `files` by `ranks` cells, at the box's `across`
   interval (its one spacing in Spread). Switching back to Files gives the block it was, and a
   handle drag in Spread picks the file count nearest the dragged shape.
8. **Generator 1** (#391): Mitchell's best candidate from mulberry32, then a push-apart
   relaxation, then pairs closer than 95% of the median neighbor distance parted, scaled so the
   closest pair is exactly one interval. Each marcher keeps a seeded distance from the edge of
   0.15–0.85 of a spacing, so no rows form along straight edges. Up to 80 marchers, a layout is
   the most even of four tries of its seed. The layout reads the region only through its edge
   distance, area, perimeter and bounds, so it fills any closed region, and uses only + − × ÷ and
   `Math.sqrt` (which ECMAScript defines exactly; `Math.sin` and the like are approximated), so a
   seed gives the same spots in every engine. Any change to the spots a seed gives is a new
   generator.

Verification (#391): `spread.test.ts` checks the same spots for the same shape, count and seed;
the closest pair at the interval; neighbor distances within 10% of each other at 12–300 marchers
in boxes, a circle and an L; no row of 4 along a box edge; 300 marchers in under 300 ms; no
approximated `Math` function called; and a count change moving most marchers less than half an
interval. `spreadSession.test.ts` switches the box and the circle to Spread, reshuffles as one
undo step, reopens a placed spread exactly, and shows one from an unknown generator as plain
positions. A browser scenario in `box-tool.spec.mts` reshuffles with undo and redo, places the
spread and reshuffles the placed box.

9. **Box layouts (#387, 2026-10-23).** `family` is one of `"full"`, `"stagger"`, `"rounded"`,
   `"shortBack"` and `"notched"`; one this version doesn't know reads as `"shortBack"`. Each is a
   full block with a pattern of spots left out, every line centered. `files` is the count of a
   full line: across a full rank, or down a full file when `byFile`. With the family and the spot
   count it names one version. When the count changes, a recipe keeps its layout: it lays out as
   the family's version nearest its proportions, or, when the family can't make the count, as
   Short back as wide. Neither is written back, so the layout returns with the count. Only Full
   and Short back take `stagger` (a stored value; nothing in the UI sets it since #408); the
   other families center their lines and ignore it. The
   last-used family is the user's, kept in localStorage (`openmarch:shapeLastLayout`) like stars,
   not in the show.

Verification: `distributor.test.ts` checks the box's Files spots against the block generator for
every count from 1 to 120 and every file count, turned and flipped, as old and new recipes;
`distributionSession.test.ts` saves a staggered box through `placementOf` and reads it back
through `boxesAt`, reads an old `pattern: "grid"` recipe unchanged, and fills a fake closed kind;
a browser scenario in `box-tool.spec.mts` places a box and finds its distribution in the recipe.
`outlineMode.test.ts` (#390) round-trips an outline's gap through a recipe, checks it goes back to
its side's middle when its spot is gone, and reads a broken `oddGap` as the default; a browser
scenario places an outline on an odd count with its gap moved and finds it in the recipe.
`circleTool.test.ts` checks a circle's neighbors are one interval apart at every count from 2 to
120, and a browser scenario places a circle and finds `circle` version 2 in Outline in its recipe.
For layouts, `layoutCatalogue.test.ts` checks every version from 1 to 120 marchers against the
full-block-minus-pattern rule, `boxLayouts.test.ts` saves a Stagger box and reads it back, and a
browser scenario finds the picked layout in the recipe.

## Revision, 2026-10-29: membership at a beat, splits and merges

Accepted with the shape host (#363). The pre-main review (#462, #463) tightened decision 4 and
the consequence about splits. None of this changes the schema.

1. **A recipe lists only marchers whose positions are in its move.** A member placed by a
   selection over several moves is left out of a recipe whose move doesn't hold it.
2. **One recipe per marcher at a beat.** Saving a recipe takes its members out of the other
   recipes of every move **ending at** the beat it's placed at (a move split off a page's shares
   it, UI-25), not of a move that only passes over that beat: an Expert move on another layer
   keeps its shape. Decision 4 is replaced by this rule.
3. **Splits and merges carry recipes.** Splitting marchers off a move moves a recipe they make up
   the whole of to the new move, and drops them from any other recipe of the old move. Merging a
   move into another re-points its recipes to the target, and their members leave the target's
   other recipes.
4. **A later page gets its own copy on any edit there.** A recipe shown at a later moment
   (Revision, 2026-10-14) is saved as a copy on that later move by any edit made there that
   changes the box, a pivot change included (#492, #499); the earlier page keeps its recipe.
5. **Saved shapes match kind and version.** A saved shape whose kind version this app doesn't
   have is skipped, not migrated, and the library says how many need a newer OpenMarch.

Verification: the db-function `shapeRecipes.test.ts` covers rules 1 to 3, including the split
and merge cases (UI-25) with undo; `boxMembership.test.ts` and `box-tool.spec.mts` cover rule 4.

## Amendment, 2026-10-30: Line recipes

The Line shape (spec #522, #523) stores a new kind:

1. **Line recipes are `line`, version 2.** Version 1 is the old shape-model line. Version 2's
   params are `points` (two or more, each `x`, `y` and a `tension` from 0 to 2: 0 is a corner,
   above 0 a smooth point the line bends through, centripetal Catmull-Rom with its handles scaled
   by the tension, 1 the plain curve, #525), `closed` (open when absent), `corners`, `spacing`,
   `measured` and the host's `pivot`. `spacing` is `{ mode: "fit" }` (the interval follows from the drawn
   points; since decision 9 it may carry `groups`), `{ mode: "keep", groups }` (Keep interval) or `{ mode: "path", groups, anchor }`
   (Interval on the path, `anchor` one of `start`, `center`, `end`). A group is
   `{ interval, count? }`: the interval is the distance between neighbors in field units, as
   `measured` says, `count` a whole number of marchers from 1, and a group with no `count` is the
   rest; at most one group in a list is the rest (#526). The groups give the line's gaps in order
   from its first point. Recipes store the parsed groups, never the typed text, so the interval
   list's change of meaning (count × interval, from interval × gaps) changes no saved data.
   `measured` (#527) says what every interval measures. Absent is along the path: the length of
   line between neighbors (arc length), changed on 2026-11-01 (see below). `"straight"` is
   straight across, the distance from marcher to marcher (the chord), except across a corner
   that holds no marcher. `"x"` (↔) is how far neighbors are apart side to side, and `"y"` (↕)
   front to back. Each spot is then found where the line reaches its coordinate that way, so the
   line must go one way along that axis over its whole drawn path (curves included); a line that
   no longer does (a part turned back, or a straight part square to the axis) is laid out along
   the path until it does again. Measured ↔ or ↕, each neighbor's x (or y) is its gap from the one before,
   computed from the run's start as `start + i × gap` within each group rather than summed, so a
   spot on the step grid stays on it; every spot is on the grid that way only with intervals that
   are whole half steps, in Keep interval (whose start slides along the line onto the grid) and on
   the path from a start or end on the grid, or centered (the run's start rounded to a half step
   from the line's start). Fit, and other intervals, put only the start on the grid.
2. **Corners and stretches.** The two ends always hold a marcher, smooth or not; a smooth point
   between them never does. The line from an end or a corner to the next corner or end is a
   stretch, smooth points inside it. `corners` is false when the intervals run around the
   corners. Absent or true, every corner holds a marcher in Fit and Keep interval, as long as there
   is at least one gap per stretch; on the path, or with fewer gaps than stretches, the intervals
   run around the corners whatever it says (#524). With corners holding marchers, each stretch
   holds a whole number of the line's gaps, in order along it: in Fit and with one interval for
   everyone, in proportion to the stretches' lengths (measured ↔ or ↕, their lengths that way, so
   each stretch's gaps are even that way with a marcher on every corner); with groups, each corner at the seam between
   gaps nearest its share of the line. Keep interval makes each stretch as long as the gaps it
   holds, as `measured` says (a whole run of the groups, crossing group seams when they fall
   mid-stretch), a curved stretch scaled about its start, and a corner drag between two straight
   stretches lands where both are whole runs. A stretch left off its run (a corner dragged with
   `fine`) scales its gaps to fit, which is even spacing with one interval. In Fit with no groups,
   or one, each stretch's marchers spread evenly over it, as `measured` says; Fit's mixed groups
   keep their proportions (decision 9). On the path the
   run is laid from its anchor along the path itself: from the start, back from the end, or with
   as much path spare before it as after it.
3. **A Curve is a Line.** The Curve in the pickers is a preset whose points start smooth; it
   saves a `line` recipe and reads back as a Line.
4. **A Line stores no frame.** Its frame (center, size, turn) follows from its points, so the
   frame amendment's stored center doesn't apply. A kind whose frame follows from its own numbers
   declares a `readable` check, used instead of the stored-center check when a recipe is read.
5. **Version 2 grows without a new version.** A later setting is an optional field or a wider
   value of these. A build reads a Line only when it can lay out every field exactly as saved;
   anything newer reads as plain positions (decision 5), never as the nearest shape it
   understands. Each build widens its `readable` check as it learns a field: the first Line build
   read two straight points and a single group with no count; more points and `corners` came with
   #524, any number of groups, counted or with one rest, with #526, tensions from 0 to 2 with
   #525, `measured` (`"x"` or `"y"`, with any of these) with #527, `"straight"` with the
   change of 2026-11-01 below, `closed` with its
   `distribution` with #529, together with tensions and groups, a point's `marcher` with
   #569 (decision 7), and Fit's `groups`, `measured: "offset"` and `offset` with decision 9, and `turn` with decision 10. From #569 a point with any other field reads as plain positions. A closed line is never measured
   along an axis (it always turns back), so it's laid out along the path when its `measured`
   says `"x"` or `"y"`; `"straight"` applies to it as to an open line.
6. **A closed Line (#529).** `closed: true` joins the last point to the first: a closed line has
   three points or more and a gap for every marcher (n gaps, an open line n − 1), and its spacing
   is `fit` or `keep`, never `path` (a closed line has no ends to lay a run from). The closing
   segment runs from the last point to the first, and its curve is the same Catmull-Rom with the
   neighbors wrapping round (not the mirrored end points an open line has), so a smooth first or
   last point is smooth on the closing segment too. Its stretches wrap round: from corner to corner
   round from its first corner, the last back past the first point; with no corner, one stretch
   all the way round from the first point. In Outline its corners hold marchers and its smooth
   points never do, except that a line with no corner starts its run on its first point. Its
   groups run once round from the first corner (the first point when it is one), so the closing
   stretch holds the gaps that fall on it, and the closing gap (last marcher to first) is the
   seam between the last group and the first. Keep interval grows or shrinks the whole outline
   from its pivot to its gaps round (its stretches can't each be set on their own and still meet
   the first point), noting a corner left off its run. A closed line stores the host's
   `distribution` as a closed kind does (amendment of 2026-10-22), in Grid (`files`), Outline or
   Spread (with its `edge`); without one it's Outline. Outline is the line itself, its corners
   and spacing laid out as above, so it ignores `oddGap`. Grid and Spread fill the outline as
   drawn: a polygon of its points with each curved segment cut into 32 pieces of equal length
   along it, its corners only the points of tension 0 (where Edge's sides start; with none, one
   side all the way round from the first point). The fill's frame is round that polygon and
   doesn't depend on which point was clicked first or which way round: turned with its sides when
   sides square to each other make up most of the outline (their directions a quarter turn at a
   time, averaged by length, within an eighth of a turn of 0), else square to the field, so its
   ranks square to the field like a box's and the back rank is at the back. Grid is the widest
   square grid with room for every marcher, at the grid's phase with the fewest spots, extra
   spots left off its back rank and the spots left re-centred in the outline; it ignores `layout`
   and `stagger`. Grid's spots on the polygon are part of the format, like the spread
   generator's: any change to them, or to how a curve is cut into it, needs a new version. Spread
   fills the polygon, its spacing whatever fits. A `distribution` on an open line, one this build
   can't read, or `closed` that isn't a boolean reads as plain positions. Opening a closed line
   keeps its spots and its spacing, groups included, as far as an open line can lay them out the
   same; a new end inside a curved segment is as smooth as the smoother of its points. Opened at
   a point (its menu's Open here, #569), that point is the start and the end is one gap back
   along the closing stretch, so n marchers keep n spots with n − 1 gaps and none stacked. When
   the point holds a spot the spots stay, the corners switch turned over if that's what keeps
   them, except where an open line can't lay them out the same: Fit shares gaps between held
   points by their stretches' lengths, so a closed line whose shares were uneven can open with a
   marcher moved along a side, and a curve's new ends bend it a little differently, so its spots
   stay only nearly. When the point holds none (a smooth point, or one kept even through), the
   spots move along to start on it, the end its gap's width back. Keep interval is sized to its
   run again wherever the spots don't stay.

7. **A point's marcher (#569).** A point may store `marcher`, true or false, from its menu's
   Marcher | Even spacing, set over the line's setting with Follow line's marchers off (#568): true
   (Marcher) holds a marcher there whatever `corners` says, smooth or not; false (Even spacing)
   forces none, so the intervals run straight through it. Absent (following the line; switching
   Follow back on clears it) is decision 2's rule, so a Line saved before reads unchanged. It works
   either way round the switch: a corner can opt out of `corners` absent or true, and a point can
   opt in with `corners: false`. Decision 2's stretches then run between the points that hold a
   marcher (the ends, the points saying true, and the corners not saying false while the switch is
   on), and everything decision 2 says of corners holding marchers (Fit's shares, Keep interval's
   whole runs, measured ↔ or ↕, a closed line's stretches round from its first held point) is
   said of them. An open line's ends always hold a marcher, so their `marcher` means nothing and
   isn't written. On the path, and in a closed line filled as Grid (`files`), Edge (Spread with
   `edge`) or Spread, no point holds a marcher by its own answer, as no corner does. `marcher` is
   the only field a point has besides `x`, `y` and `tension`. Builds from before #569 (lab and
   nightly) don't recognise `marcher` and lay out such Lines as if every point followed the line:
   that is the accepted one-way door.

8. **Along the path by default (2026-11-01, owner decision on #527).** Until this change an absent
   `measured` meant straight across: each gap was the chord between neighbors. On a line with a
   sharp spike whose tip holds no marcher (the corners switch off, or the tip's own answer Even
   spacing), the next marcher went where the straight distance first reached the interval, far
   down the spike's other side, so the tip was skipped though the marchers looked evenly spaced.
   Now an absent `measured` is **along the path**: every gap is that much line, by arc length, and
   the Measured menu's first choice is Along the path. The old meaning is kept as `"straight"`
   (the menu's Straight across, once True distance) with one fix: a gap whose straight-across spot
   would lie past a corner holding no marcher (a point of tension 0 inside the run, between two
   held points, or anywhere on the path when no point holds a marcher there) goes on from that
   corner, straight across again, with what is left of it, so a gap never cuts across such a
   corner. And where a curve turns back toward the marcher before the gap is used up, the way
   back counts too (a gap is how much the straight distance from the marcher changes along the
   path), so a gap never jumps the part that curls back. Where a gap lands then moves on
   smoothly as it grows, which Fit's search for one even interval needs: with the first spot at
   the straight distance alone, a run could jump a curl and leave the last gap short. Within a stretch of straight segments
   straight across and along the path are therefore the same; they differ only round a curve,
   where a smooth point is never such a corner. ↔ and ↕ are unchanged: on a line that goes one way
   along the axis, the axis distance of a gap is the sum of the distances of the path between, so a
   gap can't cut a corner short. (A spike pointing across the axis can still leave its tip
   between two marchers, each an interval apart that way, which is what ↔ or ↕ asks for.)

   This is a one-way door taken while Line version 2 had not reached main (fork PR #568 open):
   no saved show depends on absent meaning straight across. Lines saved by lab or nightly builds
   from before this change read as along the path, so a Line with a curve or an un-held corner,
   saved with no `measured`, can lay out a little differently once reopened or edited. Builds from before this change don't
   recognise `"straight"` and show such Lines as plain positions (decision 5).

9. **The interval lock and Offset (2026-11-01, owner decisions on #522 and #527).** The floating
   editor has a lock beside a Line's interval (and beside its group menu, covering every group).
   It needs no field of its own: unlocked is `fit` and locked is `keep`; `path` counts as locked,
   pinned at its anchor, and unlocking it is `fit`. Typing an interval no longer switches to Keep
   interval. Unlocked, it sizes the line from its pivot as Keep interval would and stays `fit`,
   with the typed groups stored as `{ mode: "fit", groups }`: where the line started from, not a
   promise, since dragging an end then changes the interval (snapping to whole steps, or half steps
   zoomed in). With one group the layout ignores it, the interval coming from the drawn line as
   before. With mixed groups (#526) their proportions are kept: the gaps are scaled by one factor
   so the run reaches the drawn line end to end as `measured` says (a cornered line's stretches
   each fit their own share, decision 2), so unlocking mixed intervals doesn't lose them. Locking a
   `fit` line stores `keep` with the groups it lays out now, exactly as typed while the line is
   still the length they give. `fit` without `groups` reads as before.

   `measured: "offset"` is rise over run: `offset` is `{ x, y }`, how far each marcher is from the
   one before it side to side and front to back, in field units like a group's interval, signed
   from the first point, never both nought. `offset` is stored only with `measured: "offset"`, and
   always with it. It applies only to an open line of two points with no mixed groups, not on the
   path. There the spots are `first + i × offset` exactly, so offsets on half steps keep every spot
   on the grid. In `keep` the line is `n − 1` offsets long, grown from its pivot with its first
   point then moved onto the grid, its group's interval the offset's length. In `fit` the drawn
   line gives the offset, `offset` following a drag, and typing either number sizes the line as
   Keep interval would. A line that has more points, or mixed groups, keeps `measured: "offset"`
   and `offset` but is laid out along the path at its own spacing until it is one segment with one
   interval again. Its offset then applies again, as a line turned square to its ↔ or ↕ axis does
   (decision 1). Picking another measure drops `offset`. Builds from before this change refuse
   `"offset"` and `offset`, and show such Lines as plain positions (decision 5). They don't refuse
   Fit's `groups`: their check takes any `fit` spacing, so they read a Fit line with mixed groups
   as evenly spaced along its drawn line. Line v2 isn't released, so only lab and nightly builds
   meet that. Saved Lines read unchanged. A saved shape (amendment of 2026-10-20) keeps a Line's
   `offsetX` and `offsetY` only when it's measured as an offset, so a plain Line comes back plain
   and an Offset line comes back as Offset at the saved offset.

   Amended 2026-11-01 (owner feedback on #596), nothing stored changes shape: the editor shows the
   offset in screen directions, read from the line's pivot end (the end nearer the pivot, the
   first point on a tie): ↔ positive to the right, ↕ positive up the screen, toward the back,
   which is field y going down; either crosses 0. `offset` itself stays signed from the first
   point in field units. A new Line (drawn, or another kind turned into one) stores the host's
   `pivot` at its leftmost end or point, `"w"` or `"e"` for an end, the front end on an upright
   line, the center when closed. A saved Line without a `pivot` still turns about its center.

10. **A Line's turn (2026-11-01, owner on #596: "Why can it not follow the same rules as the
    box? … when I draw the line, why can't we just mark that state as 0°?").** A Line may store
    `turn`: how far the whole line has been turned since it was drawn, in degrees clockwise, from 0
    up to (not including) 360. Absent is 0. Its frame still points along it (decision 4: center
    between its ends, rotation its drawn direction, a closed line's square to its outline), since
    its handles, pivots and knob need that; `turn` is only what the editor reads and steps. So a
    new Line, dragged or clicked, Line or Curve, either way round, reads 0° and stores nothing new.
    Only turning the whole shape changes it: the knob (or a corner's ring), the degrees dragged or
    typed, and ↻. They work as a box's do, counted from the drawn 0°: 15° steps, whole degrees with
    `fine`, free with the Snap toggle off, ↻ exactly +90°, typed degrees setting the turn. Editing
    points (dragging ends or corners, adding, deleting, opening or closing) never changes it,
    and nor does a move. A flip mirrors it (30° becomes 330°): the mirror of a line turned 30° from
    how it was drawn is the mirrored line turned 30° the other way. A shape turned into a Line keeps
    the turn its frame had (a box at 30° makes a Line reading 30°, however the line lies in it). A
    closed Line follows the same rule; its frame's rotation stays the outline's square-to-the-field
    turn, and `turn` counts how far the outline was turned. A full turn round stores nothing.

    Saved Lines without `turn` read as 0°, their stored geometry taken as drawn, rather than
    showing their absolute direction: the readout then means the same thing for every Line, and no
    data changes. Builds from before this change refuse `turn` and show turned Lines as plain
    positions (decision 5).

    Turned square to the field, a Line goes back onto the grid as a box does: when snapping, after
    a turn or flip, a line whose points are a whole number of half steps apart each way, or an open
    line whose ends are level or plumb, is moved so the point nearest its pivot is on the grid. An
    open line in Fit with level or plumb ends is also stretched from that point, along itself, so
    its far end lands on the grid; locked (Keep interval, or on the path), its length is its
    intervals' and is kept. A new Line's pivot is at an end on the grid, so turning it a quarter
    keeps that end still. A line turned off square stays where it turned. Measured as an offset
    (decision 9), its `offset` turns with it: turned square to the field it's back on half steps,
    rid of the turn's float noise; turned off square it's stored exactly as turned, unrounded, so a
    locked line keeps its interval and points the way it was turned (a 2-step line turned 15°
    stays 2 steps at 15°, its offset reading about 1.93 and −0.52). Rounding it to half steps would
    change both.

    An end swung round its neighbor (an open line's end dragged, locked or not, wherever the drag
    used to round its direction to the half-step grid) points in the knob's steps, but counted from
    the field rather than from the drawn 0°: 15° from level, so level and plumb are always reachable
    whichever way the line was drawn, as when drawing. `fine` gives whole degrees, and the Snap
    toggle off leaves it free. Before, the direction was the pointer rounded to half steps, whose
    angles stepped by distance. The readout by the pointer shows the end's direction from its
    neighbor, clockwise from the right as the turn reads, before the length ("15° · 8 steps · 2
    apart").

Verification (2026-11-01, decision 10): `lineTurn.test.ts` reads 0° after a drag either way, a
slanted drag, a Curve and clicks; keeps the turn through end drags, an added point and a move;
steps the knob in 15° from the drawn 0° (whole degrees with `fine`, free with Snap off), the scrub
the same, ↻ +90° round to nothing stored, typed degrees relative; turns a closed line; mirrors the
turn on a flip and back; keeps a box's turn in a Line made from it; puts a level line turned about
its center back on the grid and lands a Fit line's far end on it, its pivot end still; swings an
end in 15° from level locked and unlocked, 1° with `fine`, free with Snap off, with the angle in
the readout; reads a Line saved without `turn` as 0°, places and reads back a turned Line, and
refuses a `turn` outside 0 up to 360. A browser scenario in `line-tool.spec.mts` draws a line right
to left, reads 0°, turns it with ↻ to 90° and finds `turn: 90` in its recipe.

Verification (2026-11-01, decision 9): `lineLockOffset.test.ts` drags ends and corners unlocked
onto whole and half steps (↔ by its side-to-side distance), with `fine` free; checks that typing
leaves the line unlocked and sized; locks and unlocks in one undo step each; locked, swings an end
along the path, moves an end only front to back under ↔ and side to side under ↕, and steps a
corner in whole intervals; lays out, types, drags and greys out Offset, falls back along the path
when a point is added and comes back when it's deleted; checks the modifiers (keep direction, from
center, nothing locked); places and reads back an Offset line; and refuses an `offset` without its
measure, a nought or wider `offset`, and Fit `groups` with two rests or none.
`IntervalLock.test.tsx` covers the button in the real floating editor.

Verification (2026-11-01): `lineAlongPath.test.ts` walks round a spike's un-held tip, along the
path and straight across, with the corners switch off and with the tip's own Even spacing; checks
equal arc gaps on a curve by default, equal chord gaps on it measured straight across, both the
same on straight segments, ↔ still exactly an interval apart in x round un-held corners, and that
`"straight"` is read and round-trips while along the path stores nothing. `lineMeasured.test.ts`
covers the menu's four choices and refuses any other `measured`.

Verification (#569): `linePointMenu.test.ts` opts a corner out with the switch on and in with it
off, in Fit, on a closed line both ways, measured ↔ with each stretch even that way, and in Keep
interval with the stretch a whole number of intervals; puts a marcher on a smooth point; ignores
the answer on the path; refuses a non-boolean `marcher` and an unknown point field; and reads a
placed Line's answer back as saved. Open here starts on the point with nothing stacked and checks
the spots: unchanged on a square in Fit (corners switch on or off), Keep interval and measured,
nearly unchanged on a smooth circle, moved along with even gaps from a point holding none, and a
marcher moved along a side where Fit's uneven shares can't open the same. A new end keeps no
`marcher`, from Open here or the ends switch.

Verification (#529): `lineClose.test.ts` closes a Line by a click on its first point, an end
dropped on the other and the editor's choice; checks a gap for every marcher; fills a square and
an L in Grid, Spread and Edge through the distributor; pins Grid's spots on two outlines; checks
the same outline clicked from different corners fills the same; opens a cornered outline and a
grid back to the outline's spots; places and reads back a closed Line in each mode; and refuses a
fill on an open line, an unknown fill, a closed run on the path and a closed line of two points.
The session tests close and reopen a Line with mixed groups. `lineClosedCurves.test.ts` closes a
Curve smoothly through its first point, lays Outline with groups on a closed curve with corners
(corners held, the smooth point not), puts Edge's spots on the drawn curve, pins Grid's spots on
a closed curve, and reopens closed curves. `clickPoints.test.ts` covers the host's
close-on-first-point with a fake kind, and a browser scenario in `line-tool.spec.mts` closes a
clicked line, fills it in Grid, places and reopens it.

## Amendment, 2026-11-01: ungrouping

**Ungroup** (Shift+⌘G on a Mac, Ctrl+Shift+G elsewhere; the field's menu; the floating editor)
turns a placed shape back into plain marchers. Nobody moves. It follows the same rules as editing
the shape (Revision, 2026-10-14), and it changes no schema. Both cases store a recipe of kind
`ungrouped` (version 1, empty `params`) with the shape's members. It describes no shape: it claims
its members from its move's end, wherever they go next, until a recipe placed later takes them
(decision 4). Against older recipes it keeps whichever members a later shape hasn't taken. Being
an ordinary recipe, it is deleted with its move, carried by splits and merges, and undone with the
positions.

1. **On the shape's own page** (or an edit window reaching back over its move), the shape's recipe
   becomes the `ungrouped` mark in place. Later pages that held the form follow. It isn't
   deleted, because an earlier recipe over the same spots would then show again: a later page's
   own copy of a box (a pivot changed there) sits on the earlier page's spots.
2. **On a later page the shape is carried onto**, the change belongs to that page. Its members are
   set there, as an edit that moves nobody sets them, and the mark is saved on that page's move.
   Earlier pages keep their shape.
3. Where no edit can be made (past the last page in Basic, the timeline not ready), Ungroup is
   refused as an edit is. While isolating a move, a shape from another move is
   refused with a toast: the isolated move can't take the change, and the shape's own move
   shouldn't lose it.
4. An app without the kind skips the recipe (decision 5), so it shows the earlier shape on later
   pages as it did before the ungroup, and a shape ungrouped on its own page disappears there
   too. Positions are unaffected.

Verification: `placedBox.test.ts` (ungrouped marchers) and the browser scenario "Ungroup on the
next page ends the box there" in `box-tool.spec.mts`.

## Amendment, 2026-11-01: groups

**Group** (#603; the field's menu and the command palette, no default key yet) makes the selected
marchers a shape where they stand. Nobody moves. It changes no schema.

1. **A recipe of kind `group`, version 1.** Its `params` are the frame (amendment of 2026-10-20):
   `center`, `rotation`, `flipX` and `flipY` (absent when false) and the host's `pivot`, plus
   `points`, each spot in the frame's own axes before any flip, in field units from the center,
   slot `i` being `points[i]`. `spots` is the spot count, as for every kind. A new group is square
   to the field, its center the middle of its marchers' bounds. Its size follows from the points,
   so it isn't stored; scaling rewrites the points.
2. **Its interval is the smallest gap between neighbors** (#356), each spot's neighbor being its
   nearest. A gap under half the median of those is left out, so a near-duplicate pair doesn't
   make it tiny; because the rule reads only proportions, scaling never picks another gap.
   Scaling sets the interval (half steps for Shrink and Expand, as any kind's spacing) and every
   point scales with it about the pivot. A group with no interval (stacked marchers) doesn't
   scale. Its handles stretch it as an ungrouped selection's do (owner on #606, 2026-11-02): a
   corner both ways and a side one way from the opposite side, constrain keeping the proportions
   and from center stretching about the middle. Only its points change; its turn, flips and
   pivot stay.
3. **It's placed as any shape is**, through `writePlacement` at the edit window, its members set
   there even though nobody moves (`setAll`), so later pages holding the form follow and it's one
   undo step. Its members leave the other recipes at that beat (Revision, 2026-10-29), and a shape
   carried from an earlier page ends there, as it does when a shape is placed over it. After
   that it's an ordinary placed recipe: it shows on later pages while its form is held, members
   who move leave holes (it has no Close up or Re-split, being no closed kind), and Ungroup
   (amendment above) works on it unchanged.
4. **Who stands where is part of it**, so it has no Recalculate, and it isn't saved to the
   library, which keeps a kind's intervals and fill, not spots.
5. An app without the kind shows a group as plain positions (decision 5).

Verification: `group/__test__/groupTool.test.ts` (the frame, turn, flip, move, interval and scale,
and reading groups back across pages) and the browser scenario "Group makes the selected marchers
a shape…" in `box-tool.spec.mts`.

## Revision, 2026-11-22 (proposed): a shape is a formation at a count

_Proposed for the owner's approval. Nothing below is built. No app code changes until it's
accepted._

A placed shape stops belonging to one move. **A shape is a set of marchers on its spots at one
count.** Members don't need to share a move to be in it: one can take 5 counts to get there and
another 10, or they can arrive at different times.

### Why

Today a recipe hangs off one move (`timeline_shape_recipes.timeline_id`, cascading when the move is
deleted), and rule 1 of the revision of 2026-10-29 lists only marchers whose rows are in that move
(`saveShapeRecipeInTransaction`, `moveMembers`). Membership therefore depends on how the timeline
happens to be cut, not on where marchers stand:

- In Basic, a mid-page position cuts one marcher's page into two moves, `[9, 13)` and `[13, 17)`.
  The marcher arrives at the flag in a different move from everyone else, so a shape placed at
  the flag can't list it, though it stands on its spot. Fork PR #1118 added toasts for this
  (`leftOutByOtherCounts`, `recipesFollowMembersInTransaction`, `shapes/placed/leftOutToast.ts`),
  and `basicDrift.test.ts` pins the wanted behaviour as an `it.fails` ("BUG 2").
- A marcher who arrived earlier and holds still has no row in the move, so rule 1 drops it too
  (homes are the one exception).
- Splits, merges and cuts each need their own rule to carry recipes between moves (rule 3, Split
  at playhead's re-pointing in `timelineSplitAtBeat.ts`, the merge in `moveShapeRecipesInTransaction`),
  and holds commands skip shape members until fork #504.

Pathways' order marks (step 4g) already work the way this revision proposes: they keep their own
beat (`params.beat`), are stored in no move, and keep members who stand still. This revision makes
every recipe do that.

It **supersedes** decisions 6, 9 and 10 of the ownership grilling of 2026-10-30
(`docs/timeline/research/ownership-model/`, branch `research/ownership-model`): recipes are not
re-keyed onto the transition (P1), fork #504 is closed as replaced by this revision, and marchers
split off into another move stay in their shape instead of becoming freeform. Decision 1 of
2026-10-26 ("a shape is a distribution; it has nothing to do with timing") is what this restores.

### 1. Storage

1. **A recipe is anchored to a count.** `timeline_shape_recipes.timeline_id` is replaced by
   `beat` (`REAL NOT NULL`, `CHECK (typeof(beat) IN ('integer', 'real') AND beat >= 0)`, indexed):
   the beat ordinal its formation is defined at, in the same units as `timelines.end_beat`
   (ADR 0012, `timelineRipple.ts`). `0` is the starting spots, which `NULL` meant before. A shape
   is always at a whole count; `REAL` is only for order marks, whose beat can fall partway through
   a count (`orderMarkPlace`). Order marks stop writing `params.beat`; the column holds it.
2. **Members are listed as now.** `timeline_shape_recipe_marchers` is unchanged: `recipe_id`,
   `marcher_id`, `slot`, `x`, `y`, one row per marcher and recipe. There is no move or arrival
   column: how a member gets to its spot is the timeline's business.
3. **A member is a marcher standing on its spot at the recipe's count** (binary membership,
   revision of 2026-10-14), however and whenever it got there: a move of its own ending at the
   count, in any move or layer, or standing still since an earlier arrival, Held or not (§2).
4. **One recipe per marcher at a count.** Rule 2 of 2026-10-29 becomes literal: saving a recipe
   takes its members out of every other shape recipe at the same count, and order marks out of
   other order marks at it. Shapes and marks don't take members from each other, as now. Recipes
   left with no member are deleted. Checked by the write functions; the database has no join
   constraint for it.
5. **Migration `0029_shape_recipes_at_count`** (the next number after `0028_timeline_route_sources`):
   - Rebuilds `timeline_shape_recipes` with `beat` in place of `timeline_id` (SQLite can't drop a
     column that has a foreign key). The rebuild runs with foreign keys off, as drizzle's rebuilds
     do, so dropping the old table doesn't cascade into `timeline_shape_recipe_marchers`.
   - Fills `beat` from, in order: an order mark's `params.beat`; the end of the recipe's move
     (`timelines.end_beat`); `0` for a recipe in no move.
   - Where two shape recipes now share a count and a marcher (possible only from data older than
     rule 2, or a bug), the newer recipe (higher id) keeps the marcher and the older loses it;
     recipes left empty are deleted. The same for two order marks.
   - Members that no longer stand on their spot convert as they are: the read side already treats
     a member off its spot as a hole.
   - Clears both undo and redo stacks in a file whose history names `timeline_shape_recipes`, as
     the kept-spots drop did (ADR 0012, amendment of 2026-10-29), since replaying an old step would
     write `timeline_id`. Other files keep their history.
   - The history triggers are recreated with the table, and `repair.ts`'s copy order no longer
     needs recipes after moves.
6. **Rollback.** `electron/database/__test__/migrationRollback.ts` registers how a test rolls 0029
   back: it rebuilds the table as 0017 made it, each recipe pointed at the move where most of its
   members have a row ending at its beat (`NULL` when none, or for beat 0), so a round trip (0029,
   roll back, 0029) keeps every recipe at the same count. `newFileSchema.test.ts` and `_blank.dots`
   are regenerated. No table is added, so `TABLES_AFTER_0018` in `convertOnOpen.test.ts` is
   unchanged.
7. **File version.** Builds before 0029 (fork builds and 0.2.0 betas 1 to 6) select
   `timeline_id` and would fail on every recipe query, not just play or edit one fact wrong. So a
   file is written as **15** (`SHAPE_AT_COUNT_USER_VERSION`) once 0029 has run on it, new files
   included, and older builds refuse it with the "made with a newer OpenMarch" message instead of
   breaking the Shape tool. This is ADR 0017 §9's rule, applied to a fact every file now has.
8. **Which files convert, and how:**
   - **v0.1.7 files** (page era, `user_version` 7) have no recipe tables, and the converter writes
     no recipes (it only reports curved page-era shapes). 0029 runs in the conversion's second
     stage, after `0018_drop_page_era`, on an empty table. Nothing converts, so the risk is only
     that 0029 must run inside the conversion's transaction without needing rows.
     `v017Files.test.ts` gains a check that every sample converts to a file with the new column.
   - **Fork files** are repaired to `0017_timeline_model` first (ADR 0011), then take 0018 to 0029
     as usual, so their recipes convert by the rules above. The repair needs no change.
   - **0.2.0 beta files** are ordinary 0017 files and convert the same way. They are released
     files, so their conversion gets the same tests as fork files.

### 2. Holding marchers

**Confirmed: a marcher holding still through the count is a member**, as the owner leans, because
membership is where a marcher stands at the count (1.3). How an edit treats it follows the holds
rules (ADR 0012, amendments of 2026-10-30), so a shape edit at the count is a drag at that count of
every member:

- **Held through the count** (a `timeline_held_marks` row covering it): editing the shape moves
  the member's arrival and the whole hold with it. It still gets there early, at its new spot.
- **Not set at the count** (standing since its last keyframe, nothing stored): placing the shape
  sets it there, as placing does today (`setAll`): the move of the edit's window ends on its spot
  at the count, though it doesn't move. That pins it, so an edit at an earlier count stops at the
  shape's count instead of carrying through and quietly pulling it off its spot. Editing the shape
  later then moves it inside that window, arriving at the shape's count.

Concerns:

- **A hold that covers two shapes' counts.** Editing the later shape moves the whole hold, so the
  marcher moves at the earlier shape's count too and leaves it (a hole), with the left-box toast
  naming the earlier shape's count. The alternative is to refuse the edit for that marcher.
  Proposed: leave and say so.
- **Arrival timing.** "Got there early" survives a shape edit only for Held members. A Not-set
  member's pinning move starts at the edit window's start, so an edit makes it travel until the
  shape's count. This matches what a drag at that count does today.
- **Starting spots.** A recipe at beat 0 is the starting spots, as `NULL` was. Placing a shape there
  still drops its members' holds from the starting spots (`dropShapeHomeHoldsInTransaction`).

### 3. Expert

A shape belongs to a count on the timeline, not to a clip.

- **Shows:** a small shape mark at its count on the page row, drawn like a flag's tick, with the
  shape's glyph. The field draws the shape from its count on, while all its members stand on their
  spots (unchanged). The clips holding members' arrivals at the count are not badged: a shape can
  span several of them.
- **Selects:** clicking a member on the field at the count selects the shape, as now. Clicking the
  mark selects its members and puts the playhead on the count.
- **Edits:** the floating editor writes a drag at the shape's count for every member, whichever
  move holds its arrival (a new edit target, `{ kind: "count", beat }`, the Expert form of Basic's
  point target): a row ending at the count is edited in place; a Held member moves its hold; a
  Not-set member gets its move in the selected window, or the page's window when none is selected.
  An edit at a later count the shape is carried onto still saves a copy there (rule 4 of
  2026-10-29), anchored at that count.
- **Isolates:** while one move is isolated, a shape shows when any member arrives at its count in
  that move. Members arriving elsewhere are ghosted like other marchers outside the move. Editing
  or ungrouping it is allowed only when every member arrives in the isolated move, and refused
  otherwise with a toast ("This shape has marchers in other moves. Edit it outside isolation.").
  Isolation promises edits stay in one move, and this keeps that promise. It generalises today's
  Ungroup refusal (`ungroupShape.ts`).
- **Carries:** a shape is shown at later counts while its members stand on their spots
  (revision of 2026-10-14), unchanged.

### 4. Edits and membership

Positions decide membership, so most edits need no recipe rule. After each edit, inside
`transactionWithHistory` and in the same undo step, an **upkeep** step (beside the Held marks'
upkeep, never during undo or redo replay) drops members that no longer stand on their spot at
their recipe's count and deletes recipes left empty. It replaces the foreign-key cascade from
moves.

| Edit | What happens to the shape |
| ---- | ------------------------- |
| Split marchers into a new move (UI-25) | Nothing. Members stay, whichever move they're in. Rule 3's carry goes. |
| Split at playhead, Basic mid-page positions, **+** / Split page | Nothing. Positions at the count don't change. Fixes BUG 2. |
| Merge moves over the same counts | Nothing. |
| Merge with a refit, clip drag, edge resize, flag drag | If the edit re-times the arrival of **every** member at the count to one new count, the recipe moves there. Otherwise members no longer on their spot at the count leave (holes), and the toast names them. |
| Delete a move | Members whose arrival went leave; a recipe with nobody left is deleted. Deleting a page's move with all members still deletes the shape, as the cascade did. |
| Insert or delete counts, tempo edits, page flag edits | The recipe's count ripples as an order mark's does (`orderMarkPlace`): with the page flag it's on, else with its count; a shape inside a deleted page goes. |
| Member dragged away at the count | Leaves, leaving a hole, with the left-box toast (`leftBoxToast.ts`), as now; found by count instead of move. |
| A member's earlier keyframe edited | No effect while the member is pinned at the count (§2). A Held member's hold follows its arrival; if that takes it off its spot, it leaves. |
| Remove keyframe, Clear this page at the count | The member leaves the shape (a hole). See 5.3. |
| Marcher deleted | Its member rows cascade, as now. |

- **Ungroup marks** (`UNGROUPED_RECIPE_KIND`) are stored at a count, like shapes: on the shape's
  own count the recipe becomes the mark in place; on a later count the mark is saved at that
  count. A mark claims its members from its count until a recipe at a later count takes them, as
  now. `dropUngroupedLeavers` reads "still at the count" instead of "still in the move".
- **Order marks** (`ORDER_MARK_KINDS`) keep their behaviour; their beat moves from `params.beat`
  to the column, and the fallback to their move's end for older marks is done once by 0029.
- **Trails** (`dealRecipesAgainInTransaction`) find the recipes at the trail move's end count
  instead of by its id.

### 5. What goes away

1. Rule 1 of 2026-10-29 (members must be in the move) and rule 3 (splits and merges carry
   recipes). Rule 2 is restated as 1.4. Rule 4 (later-count copies) stays.
2. In `shapeRecipes.ts`: `sameMove`, `moveMembers`/`moveMembersOf`, `moveHoldsAnyOf`,
   `placedBeatOf`, `movesEndingAtPlacedBeat`, `splitShapeRecipesInTransaction`, the shape half of
   `moveShapeRecipesInTransaction`, `keepOrderMarksBeat` and `orderMarkBeat`'s fallback; Split at
   playhead's recipe re-pointing; `readTimelineEndBeats` in `placedBoxStore.ts` and `endBeatOf` in
   `boxesAt` and `timelineCarried.ts`; the `own`-move test in `boxMembership.ts` and
   `writePlacement`, which compare counts instead.
3. Later, as a separate step that amends ADR 0012: the "shape members are skipped" interim in
   Clear this page, the drag back, Remove keyframe at a split, Hold from previous page and
   `timelineMoveCuts.ts` (until fork #504). A member a hold command takes off its spot simply
   leaves the shape.
4. From fork PR #1118: `leftOutByOtherCounts` and `showLeftOutToast`,
   `snapshotRecipesInTransaction`, `recipesFollowMembersInTransaction` and
   `showDroppedAtFlagToast`, their i18n keys (`shapes.placed.leftOut.*`,
   `shapes.placed.droppedAtFlag.*`) and the guide's lines about them; "BUG 2" becomes a plain
   `it`. `nameOf` stays for the left-box toast.

### 6. Risks

- **Membership needs positions.** Upkeep and the re-time rule need where members stand at a
  count, which comes from the resolver, not from rows. It must resolve only the members of
  recipes whose counts an edit touched, or big shows slow down. Measured in step 3.
- **Ripple coverage.** A shape's count used to ride along with its move's end for free. Every edit
  that moves beats must now ripple recipes, or shapes drift off their counts and show as holes.
  Mitigation: one ripple for order marks and shapes, and a test per beat-moving edit.
- **The rebuild.** If foreign keys are on when 0029 drops the old table, every member row cascades
  away. Tested on fork, beta and converted v0.1.7 files with members present.
- **Older builds** refuse migrated files (1.7). Beta testers who downgrade lose access, not data.
- **Undo history** is cleared once on files with recipe history.
- **Expert UI** is a new surface (the shape mark), needing owner design feedback in the lab.
- **Re-time ambiguity:** a clip drag that moves some members' arrivals and not others now splits a
  shape into leavers and stayers, where today the whole shape went with the clip.
- **Upstream:** recipes are in 0017, which 0.2.0 betas shipped, so 0029 must go to
  `prerelease/0.2` with the rest of the shape host.

### 7. Order of work

Each step is one PR with a lab build and things to try, and none changes behaviour beyond what it
names.

1. **Read seam, no behaviour change.** Every reader asks one function for a recipe's count
   (its move's end, a mark's `params.beat` or 0) and for the recipes at a count. Unit tests.
2. **Migration and writes at a count.** 0029, rollback, file version 15, writers and readers on
   `beat`, rule 1 and rule 3 removed, upkeep replacing the cascade. Tests: fork, beta and v0.1.7
   conversions, round trip, BUG 2 passing, split and merge keep members. Lab: a Basic mid-page
   position, then a shape at the flag.
3. **Re-times and ripple.** The re-time rule and the count ripple for shapes. Tests for clip drag,
   resize, flag drag, merge refit, inserting and deleting counts, and the timing of upkeep.
4. **Remove the #1118 stopgaps** (5.4) and update the guide.
5. **Expert:** the shape mark, selecting from it, the count edit target and the isolation rule.
   Lab with things to try.
6. **Holds:** lift the shape-member skips (5.3), amending ADR 0012.
7. Close fork #504 as replaced, and mark the ownership research's decisions 6, 9 and 10 as
   superseded.

### Verification

- Migration tests: 0029 on a 0017 file with recipes in moves, in no move and order marks, keeps
  every member and fills each `beat` as 1.5 says; duplicate members at a count go to the newer
  recipe; the history is cleared only when it names the table; v0.1.7 samples convert with the new
  column; the rollback round trip keeps every recipe at its count.
- `shapeRecipes.test.ts`: one recipe per marcher at a count; members from different moves and
  Held members are kept; upkeep drops leavers and deletes empty recipes in the same undo step.
- `basicDrift.test.ts` "BUG 2" passes as a plain `it`.
- Edit tests for each row of the table in §4, with undo and redo.
- Browser scenarios: Basic mid-page position then a shape at the flag lists everyone; in Expert,
  a shape whose members arrive in two moves is selected from its mark, edited, and refused while
  one move is isolated.
