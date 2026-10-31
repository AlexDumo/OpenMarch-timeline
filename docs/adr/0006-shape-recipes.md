# 0006: Shapes are stored as recipes beside the positions they place

- Status: accepted
- Date: 2026-10-10
- Accepted: 2026-10-29

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
   - `timeline_shape_recipe_marchers`: a surrogate `id` (ADR 0001 C-2), `recipe_id` (deleted with
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
   points), `{ mode: "keep", groups }` (Keep interval) or `{ mode: "path", groups, anchor }`
   (Interval on the path, `anchor` one of `start`, `center`, `end`). A group is
   `{ interval, count? }`: the interval is the straight distance between neighbors (the chord) in
   field units, `count` a whole number of marchers from 1, and a group with no `count` is the
   rest; at most one group in a list is the rest (#526). The groups give the line's gaps in order
   from its first point. Recipes store the parsed groups, never the typed text, so the interval
   list's change of meaning (count × interval, from interval × gaps) changes no saved data.
   `measured` (#527) says what every interval measures: absent is the straight (true) distance
   above; `"x"` (↔) is how far neighbors are apart side to side, and `"y"` (↕) front to back. Each
   spot is then found where the line reaches its coordinate that way, so the line must go one way
   along that axis over its whole drawn path (curves included); a line that no longer does (a
   part turned back, or a straight part square to the axis) is laid out by the true distance
   until it does again. Measured ↔ or ↕, each neighbor's x (or y) is its gap from the one before,
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
   holds, measured straight across or, measured ↔ or ↕, that way (a whole run of the groups, crossing group seams when they fall
   mid-stretch), a curved stretch scaled about its start, and a corner drag between two straight
   stretches lands where both are whole runs. A stretch left off its run (a corner dragged with
   `fine`) scales its gaps to fit, which is even spacing with one interval. In Fit the groups
   don't apply: each stretch's marchers spread evenly over it, straight across. On the path the
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
   #525, `measured` (`"x"` or `"y"`, with any of these) with #527, `closed` with its
   `distribution` with #529, together with tensions and groups, and a point's `marcher` with
   #569 (decision 7). From #569 a point with any other field reads as plain positions. A closed line is never measured
   along an axis (it always turns back), so it's laid out by the true distance whatever its
   `measured` says.
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
