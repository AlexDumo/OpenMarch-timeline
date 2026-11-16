<!-- cspell:disable -->

# Roster changes 05: design exploration (draft 2)

Status: exploration for the owner, 2026-11-16. Nothing here is decided. It builds on reports 01 to
04 in this folder, on the review in 06, and on code read on fork main (`e5e2b3a30`) and
`pathways/host` (`38be62da0`, "PH"). Draft 1 is kept as `05-design-exploration-draft1.md`.

**FACT** = I read it in code, a file, an ADR or an issue. **INFERENCE** = reasoned, not run.
**SPIKE** = a throwaway script I ran once; method in section 2. No app tests were run.

No drill-writing software is used as a precedent.

## Changes from draft 1

1. **The state is by set, not for the whole show.** A part is _marching_, _unfilled_ or _out_,
   from a page onward. Draft 1 had one whole-show flag. It could not say "kept through set 30,
   gone after", and a part halfway through a review had no defined state (06 B1, B4).
2. **Recipe-less shows are the main case.** The bundled demo and every v0.1.7 file have no shape
   recipes (06 B2, confirmed). Stops are now found from the dots themselves, and a hand-placed
   stop has real options: move the hole to the end of its line, or spread the line evenly.
3. **The 0.2.0 split is re-derived.** There is no freeze on file changes (owner, #994,
   2026-11-15). The storage is cheapest _before_ 0.2.0. I now put the storage and the first
   command in 0.2.0, and the review in 0.2.x.
4. **Step 1 changed.** It was a list of empty spots in shapes, which is empty on the demo show.
   It is now **Mark as unfilled** and **Assign**.
5. **Delete is no longer the end of every review.** Remove is tidying up for a part that is out
   of every set. A part can stay half in and half out for good.
6. **Swap parts became Swap drill**, whole show or from a set on. It runs on main with no
   pathways work (06 S7). Labels and people stay with the row.
7. **Working words changed** because open, fill and keep already mean things in the shape UI
   (06 S2): _unfilled_, _out_, **Assign**, **Leave the spot**.
8. **Close up is no longer called mechanical** where it isn't. The cost table gained columns,
   and "shift within the line" comes before free least travel (06 S3).
9. **Batch got guards**, **Add next to** no longer defaults onto a neighbor, review state lives
   in the show, exports have two defaults, and a "what changed" output and a CSV name update are
   in the plan (06 S4 to S10).
10. **Prerequisite errors fixed**: #358 is in Later, #653 is in 0.2.0, #357 is paused in 0.3,
    #960 waits on the owner (06 S13). The LLM reasons are rewritten (06 S14).

Every 06 finding is answered in section 9.

## The recommendation in one screen

1. **Stop making delete the first step.** "Jordan quit" becomes **Mark as unfilled**: the part
   stays, nobody marches it, nothing moves. It never depends on the undo stack.
2. **A marcher row stays the part.** No performers table. Add one small table that says, from a
   page onward, whether the part is marching, unfilled or out.
3. **Restaging is a review of stops.** A stop is a stretch of sets where the part's neighbors
   hold the same arrangement. The app finds them from positions, so it works on shows with no
   shapes. At each stop the designer picks from a preview. The app does the geometry and never
   picks an option that moves people.
4. **In season, one command does most of the work: Swap drill from here on.** It moves the hole
   to a part where it hides better.
5. **No LLM in the app.**
6. **In 0.2.0:** the storage, Mark as unfilled, Assign, hollow dots. **In 0.2.x:** out from a
   set on, Swap drill, then the review. **Later:** shape spot rules, adding into forms, pathways.

---

## 1. The problem, precisely

"Delete a marcher" hides several jobs. Today's app has one tool for all of them. The frequency
column is my **INFERENCE** from how bands work; the owner should correct it.

### Jobs when someone leaves

| #   | Job                                                    | What the designer wants                                                                            | How common (INFERENCE)                                               | Today                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **The person left, the part stays, nobody marches it** | Every set keeps its spacing. The band marches around a marked hole.                                | Most common in season                                                | Delete. Spacing stays, the part is destroyed, and nothing marks where it was.                                                                                                                                                   |
| L2  | **Someone else takes the part**                        | Same dot, same drill, new name.                                                                    | Common                                                               | Edit the row's name in place. It works because the row is the part (**FACT**, `MarcherForm.tsx:158-170`). Nothing says so.                                                                                                      |
| L3  | **The hole moves to another part**                     | T7's person marches T3's drill, often only from the next untaught set. T7's part becomes the hole. | Common. This is how designers choose where the hole is.              | Nothing. Swap marchers trades one moment (**FACT**, 01 §5).                                                                                                                                                                     |
| L4  | **The part is removed and the drill restaged**         | Set by set: leave the spot, close up, or lay out again.                                            | Common before the season. In season, usually only for untaught sets. | Delete, then fix every set by hand.                                                                                                                                                                                             |
| L4b | **Taught sets keep the part, later sets drop it**      | Sets 1 to 30 keep T3's hole. Sets 31 on are restaged without T3.                                   | The usual in-season form of L4                                       | Not possible in one file.                                                                                                                                                                                                       |
| L5  | **Temporary absence**                                  | Print and show without that person. Change nothing. Bring them back.                               | Common, short                                                        | A tag with a hidden look hides the dot on the field and the drill chart (**FACT**, `marcherLooks.ts:47`, `drillChartSvg.ts:170`). 06 reports coordinate sheets still print it. I found no check in the 3D View (**INFERENCE**). |
| L6  | **A performer leaves the field partway**               | On in the opener, off from the ballad.                                                             | Unknown                                                              | The same tag look, from a page onward (`tag_appearances` is keyed by tag and start page, **FACT** `schema.ts:225-245`). Display only.                                                                                           |

Draft 1 said L5 and L6 had nothing. That was wrong: a display-only form exists, and it is the
storage pattern this draft reuses.

Still unsupported after this design, stated plainly:

- **One part shared by two people** (one in the opener, one in the closer). A row has one name.
  Workaround: put both names in the name field.
- **True off-field motion** (walking to a sideline spot and waiting). An out part simply isn't
  drawn. Its stored motion is ignored, not edited.

### Jobs when someone joins

| #   | Job                                                                                    | Today                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **Take an unfilled part**                                                              | Edit a name, if the row still exists. If it was deleted, Add offers the old number and the new marcher stands at home with no drill (**FACT**, 01 §3). |
| A2  | **Insert into existing forms** (one more trumpet; or 48 grows to 60 for a reused show) | Add, then re-place every form by hand.                                                                                                                 |
| A3  | **A new part from scratch**                                                            | Add. Fine as it is.                                                                                                                                    |
| A4  | **A new season's roster on last year's show**                                          | The CSV import refuses every row whose drill number exists (**FACT**, `marcherCsv.ts:228`).                                                            |

### How much of a real show is hand-placed

**FACT:** `web/public/demos/part1-demo.dots` is a page-era file (`user_version` 7, 95 marchers,
23 pages) with no shape recipe tables. Every v0.1.7 file is the same. The owner's stated
migration risk is exactly these files.

So the common case for "a show that already exists" is: **no recipes at all**. Anything that only
helps recipe-made sets helps new shows written in the fork, and nobody else. Section 2 designs
for the hand-placed case first.

---

## 2. What a spot is made of, per set

### Finding stops without recipes

A **stop** is a run of consecutive sets where the part's nearest neighbors, and their offsets
from it, are the same. The form may travel; it is still one stop while the local picture holds.
One decision covers the run.

At a stop, the app looks for the **line** the part stands in: a chain of dots through its spot
at an even interval, allowing a steady bend (an arc). It may find none, one, or two that cross
(a file and a rank in a block).

**SPIKE** (one show, the demo; thresholds picked by me, results not checked by eye):

| Measure, over 95 marchers × 23 pages                                 | Demo show                      |
| -------------------------------------------------------------------- | ------------------------------ |
| Marcher-sets standing in an evenly spaced line or curve of 4 or more | 74%                            |
| ... and not at its end                                               | 52%                            |
| Standing in two crossing lines (block-like)                          | 32%                            |
| In no line of 3 or more                                              | 11%                            |
| Stops per marcher (same 3 nearest neighbors, same offsets)           | mean 8.8 of 23 pages (3 to 11) |
| Marcher-sets where the marcher did not move from the page before     | 61%                            |

Method: for each neighbor within 1.6× the nearest distance, step along that direction, accepting
the next dot within 0.3 of an interval of the expected place and within 25% of the same length.
The script is `spike/chains.py` in this folder.

What this suggests, and no more: on this show, removing one part is about 9 decisions, not 23,
and about three in four of them have a line the app can work with. It is one show. Before the
review is built, run the same count on five real shows and look at the misses (hard blocker 5).
The synthetic test fixture `realistic.dots` gave 22 stops of 22 pages, because its generator
moves everyone every page; it says nothing about real drill.

### What each kind of moment can offer

Working words:

- **Leave the spot**: the part stays unfilled here. Nobody moves. The hole is drawn.
- **Move the hole to an end**: everyone between the hole and one end of the line steps one spot
  toward it. Only existing spots are used. No new coordinate is invented.
- **Spread evenly**: the two ends stay; the dots between them are spaced evenly.
- **Close up**: a recipe shape laid out for one fewer, with its own settings.
- **Lay out again**: a new layout for the new count.
- **By hand**: the part is taken out here and the designer edits the set as usual.

| How the moment was authored                           | Leave the spot                                                                                                                            | Options with a default the app can compute                                                                                                                                                                                      | Needs the designer                                                                                                    | Impossible today                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Hand-placed, in one detected line**                 | Yes                                                                                                                                       | Move the hole to either end. Spread evenly.                                                                                                                                                                                     | Which end. Whether the detected line is the right one (the app highlights it; the designer can change the selection). | All of it. Nothing finds the line.                                                                                |
| **Hand-placed, in two crossing lines** (block)        | Yes                                                                                                                                       | Move the hole to the end of its file, or of its rank.                                                                                                                                                                           | Which line. Anything that reshapes the block.                                                                         | All of it.                                                                                                        |
| **Hand-placed, no line**                              | Yes                                                                                                                                       | None.                                                                                                                                                                                                                           | By hand.                                                                                                              | —                                                                                                                 |
| **Box, Files** (recipe)                               | Yes                                                                                                                                       | Move the hole within its file (new). Close up (built; takes the family's version for n, or Short back as a stand-in).                                                                                                           | Awkward counts. Section order.                                                                                        | Choosing which spot is empty.                                                                                     |
| **Box Outline or Spread; Circle; closed Line or Arc** | Yes                                                                                                                                       | Close up (built).                                                                                                                                                                                                               | Section order round the outline.                                                                                      | —                                                                                                                 |
| **Open Line, Curve, Arc**, no corners or groups       | Yes                                                                                                                                       | Move the hole to an end (new). Spread evenly: Fit widens the interval (new).                                                                                                                                                    | Which end.                                                                                                            | Close up is not offered (**FACT**, `placedBox.ts:289-296`).                                                       |
| **Open Line with corners or counted groups**          | Yes                                                                                                                                       | A default exists, but it is a choice: which leg gives up a marcher, and "too few drop from the end" moves the hole to the last group (**FACT**, ADR 0006; `spacing.ts:155-159` via 02).                                         | Yes                                                                                                                   | Same.                                                                                                             |
| **Group, "as is"**                                    | Yes                                                                                                                                       | None by design. Treated as hand-placed: the line finder runs on its points.                                                                                                                                                     | Yes                                                                                                                   | —                                                                                                                 |
| **Several shapes that make one picture**              | Yes                                                                                                                                       | Per shape, but closing one opens a gap at the join (#583 is open). The stop shows every shape at that set, with the touched one highlighted.                                                                                    | Yes                                                                                                                   | Joined close-up.                                                                                                  |
| **Carried shape**                                     | Yes, decided where it was placed                                                                                                          | Close up at the origin covers the carried pages. A range filter that starts _inside_ the carry is its own stop kind: the edit writes a copy on the later page, and marchers who were standing still now move (**FACT**, 02 §3). | Yes, when cut                                                                                                         | —                                                                                                                 |
| **Drawn path lane** (PH)                              | Yes. Nothing is removed, so the lane and Adjust stay.                                                                                     | None: point moves on a laned row refuse (**FACT**, `timelinePointMoves.ts:251` on PH).                                                                                                                                          | —                                                                                                                     | Close up; hand-over (casting refuses).                                                                            |
| **Follow-the-leader trail** (PH)                      | Yes (a deleted member already leaves a gap, AP-T6)                                                                                        | "Close the gap" is not built. It also changes every later end spot, so the shape at the next set stops matching its recipe. A choice, not a mechanical step.                                                                    | Yes                                                                                                                   | Closing the gap.                                                                                                  |
| **Hold**                                              | Held marks stay with the row.                                                                                                             | —                                                                                                                                                                                                                               | —                                                                                                                     | After #1015, a part added to a Held-whole shape makes it partly Held, which refuses edits (**INFERENCE**, 03 §3). |
| **Converted v0.1.7 page**                             | As hand-placed.                                                                                                                           | As hand-placed.                                                                                                                                                                                                                 | —                                                                                                                     | —                                                                                                                 |
| **Prop or equipment item**                            | Out of scope. Items skip all of this; Mark as unfilled is hidden for them. The pit preset and the new-show wizard keep their own deletes. | —                                                                                                                                                                                                                               | —                                                                                                                     | —                                                                                                                 |

Three points:

1. **Leave the spot works everywhere**, so it is the default, and it must be drawn. Today a
   shape's holes are a number in its label; I found no code that draws one (**INFERENCE**).
2. **The most useful new option uses no new geometry.** Moving the hole to the end of a line
   reuses spots that already exist. It works on hand-placed sets and it is what a designer does
   by hand today.
3. **Nothing here is "what the designer wants" by default.** Least travel knows nothing about
   section, part order or height (**FACT**, `leastTravel.ts:8-12` says a better rule could
   replace it). Every computed option is a proposal with its costs shown.

---

## 3. The central model question: performer vs part

**FACT:** a `marchers` row holds the drill label (`drill_prefix`, `drill_order`), `section`, a
home, and three optional text fields about a person: `name`, `year`, `notes`
(`schema.ts:152-188`). Everything else hangs off the row id. So the row is the part.

| Belongs to the part (the row)                                        | Belongs to the person   |
| -------------------------------------------------------------------- | ----------------------- |
| Drill label, home, moves, holds, shape membership, lanes, cues, tags | `name`, `year`, `notes` |
| `section` (it drives the dot's look and the 3D uniform)              | —                       |

`section` stays on the row. When a mellophone player takes a trumpet part, the designer edits
the row's section, as today.

### Options

**A. Keep delete; add a review after it.** After a delete, hand-placed sets leave no trace of
the part, and those are most sets. The review would have nothing to stand on. Rejected, more
firmly than in draft 1.

**B1. Separate `parts` and `performers` tables.** Every reader of `marcher.name` changes, for
nothing the designer sees. Rejected.

**B2 (draft 1). One whole-show "open" flag.** Rejected by 06 B1 and B4, and I agree:

- It cannot say L4b, the usual in-season outcome.
- Mid-review it contradicts itself: the part is "a hollow dot on every set" and also gone from
  the sets already closed up. A student assigned to it then stands on someone in those sets.
- Close up could not even run, because the part was still a member of the shape
  (`canCloseUp` needs members < spots, **FACT** `placedBox.ts:293-296`).

**B3. The row stays the part; its presence is stored by set.** (Recommended.)

One new table, shaped like `tag_appearances`: a marcher, a start page, and a state that holds
from that page onward.

| State                 | Meaning                             | Field                  | Drill chart                       | Per-performer outputs | Checks  | 3D View                 |
| --------------------- | ----------------------------------- | ---------------------- | --------------------------------- | --------------------- | ------- | ----------------------- |
| **marching** (no row) | Someone marches it                  | Normal                 | Normal                            | Normal                | Normal  | Normal                  |
| **unfilled**          | Nobody marches it; the spot is held | Hollow dot, label kept | **Hollow**, so staff see the hole | Skipped               | Skipped | Owner call (decision 6) |
| **out**               | The part is not in this set         | Not drawn              | Not drawn                         | Skipped               | Skipped | Not drawn               |

- "Jordan quit" = unfilled from the first page.
- L4b = unfilled from page 1, out from page 31.
- L5 = unfilled for the show, name kept; Assign puts it back.
- L6 = marching, then out from the ballad.
- The resolver is untouched. An out part still has stored motion; it is ignored. `.ompb` is
  untouched: the exporter writes only parts that are marching for the whole show, and says which
  it left out.

**C. Parts with real time ranges in the motion model.** Needed only for true off-field motion.
Parked. B3 does not block it.

### Why not reuse the tag look

The reviewer pointed at `tag_appearances.visible`. I checked it.

|                                  | A tag with a hidden look                   | Presence state (B3)               |
| -------------------------------- | ------------------------------------------ | --------------------------------- |
| What it says                     | How a dot looks                            | Whether anyone marches the part   |
| Scope                            | Everyone with the tag, from one page       | One part, from a page             |
| Who reads it today               | The field and the drill chart              | Nobody yet                        |
| Survives                         | Until the user deletes or restyles the tag | Until changed by a roster command |
| Checks and per-performer outputs | Unaffected                                 | Skipped                           |

They are different facts, so they stay separate. A hidden look on a marching part still means
"marching, drawn hidden". The storage pattern is what B3 borrows: keyed by start page, with the
page-delete upkeep that `moveTagAppearancesOffPagesInTransaction` already does for tags. One
open point for the ADR: ADR 0009 D-5 argues beat ids survive page splits and flag drags better
than page ids. The ADR should pick one on purpose.

### B3 against each concern

| Concern                  | B3                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data model               | One new table. No table rebuild. History triggers added like any timeline table.                                                                                                                                                                                                                                                                                                                                                              |
| Undo                     | Each command is one step. None _needs_ undo to be reversed later: a state row can always be changed back.                                                                                                                                                                                                                                                                                                                                     |
| File format              | A new table. Before 0.2.0 it is an ordinary migration with no version bump and no older release to stay readable by: migrations 0020 and 0021 landed that way on 2026-11-15, and no release has shipped version 8 (**FACT**, `fileVersion.ts:20-31`). After 0.2.0 it needs a bump, and 0.2.0 then refuses the file (`refuse-too-new`). Without a bump, 0.2.0 would print unfilled parts as real marchers. That is why it should go in before. |
| v0.1.7 files             | Open as today. No rows, so every part is marching.                                                                                                                                                                                                                                                                                                                                                                                            |
| Exports                  | Two defaults, not one switch: drill charts draw unfilled parts hollow; coordinate sheets and the mobile export skip them. Out parts are skipped everywhere for those sets.                                                                                                                                                                                                                                                                    |
| `.ompb`                  | Not a blocker (above).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cues                     | `cue_marchers` rows stay. Whoever is assigned inherits the part's cues.                                                                                                                                                                                                                                                                                                                                                                       |
| Shapes                   | An unfilled part is still a member. No hole, Recalculate works. When a review option takes it out of a set, it is also taken out of that set's recipe in the same step, so Close up can run.                                                                                                                                                                                                                                                  |
| Pathways                 | Nothing is removed, so the lane and Adjust stay. The owner's "empty spot keeps path and Adjust" holds without pathways step 12.                                                                                                                                                                                                                                                                                                               |
| Selection and new shapes | Selecting a section includes its unfilled parts, so a new form keeps the hole. The placement preview draws them hollow so that is a visible choice.                                                                                                                                                                                                                                                                                           |
| What the designer sees   | Hollow dots. A count in the Marchers list ("48 marchers, 2 unfilled"). On the timeline, a thin bar per selected part showing where it is unfilled and where it is out.                                                                                                                                                                                                                                                                        |

### Two kinds of emptiness

|                      | Empty spot                            | Unfilled part         |
| -------------------- | ------------------------------------- | --------------------- |
| What                 | A place in one shape nobody stands on | A part nobody marches |
| Lives in             | The recipe (#358, #504)               | The presence table    |
| Identity across sets | No                                    | Yes                   |

#504's "an empty spot is a recipe slot with no marcher, not a separate concept" stays true. No
decided position is reversed. "Leaving a shape leaves a hole, filling is an explicit command" is
what happens when a part goes out of a set and the designer picks no layout change.

### Risks of B3

1. **Every all-marchers loop must decide** what unfilled and out mean to it. The `visible` checks
   in the field and the drill chart are the two places that already branch; the rest is a sweep.
2. **A part that is out of some sets and assigned later** marches only the sets it is in. The
   Assign dialog must say so in words ("T3 is out of sets 31 to 70. Sam will march sets 1 to 30
   only."). Putting a part back into a set that was closed up is a join job, not an undo.
3. **A hole that vanishes and returns** (out at one stop, unfilled at the next) looks odd on
   playback. It is correct, and the timeline bar shows it.
4. **Words.** See decision 3.

---

## 4. The restaging workflow

Audience: a designer at a desk with mouse and keyboard first. Mark as unfilled and Assign must
also be easy on a tablet at rehearsal, where the news arrives. Every preview has visible Place
and Cancel buttons; Enter and Escape are the fast path.

### The commands, smallest first

| Command                                  | What it does                                                                                                                 | Writes                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Mark as unfilled**                     | From the first page, or from the current set on                                                                              | One state row                                               |
| **Assign…**                              | A name goes on the part; unfilled stretches become marching                                                                  | The row and its state rows                                  |
| **Take out from here on** / **Put back** | The part is out of the sets from the playhead, or back                                                                       | One state row                                               |
| **Swap drill with…**                     | Two parts trade their drill, for the whole show or from the current set on. Labels, names and sections stay with their rows. | Assignments, Held marks and recipe members from that set on |
| **Review…**                              | The stop-by-stop review below                                                                                                | Per decision                                                |
| **Remove part**                          | Deletes a part that is out of every set. Disabled with the reason otherwise.                                                 | Today's delete, plus its emptied moves                      |

All are in the Marchers list row menu, the inspector, the field right-click menu and the command
palette. Remove has no shortcut. Until the command tree (#357, paused) exists, they are plain
registered actions with no arguments.

**Swap drill from here on** deserves its own line. From set b on, each part takes the other's
moves that end at or after b. The move into set b becomes the walk to the other's spot, so
nobody jumps. On main every app-made move is the marcher's own one-slot transition (**FACT**,
`timelinePointMoves.ts:85`), so this is row updates (**INFERENCE**: not built or tested). It is
refused with a reason on laned moves once pathways merges. It is how L3 is done in season, and
with an unfilled part it moves the hole without touching anyone else's drill.

### The review, from "Jordan quit" to done

**Before anything changes**, the panel says what the part touches, and for how long each stop
lasts:

> T3 stands at 9 stops over 23 sets. At 6 it is in a line the app can work with. At 2 it is in a
> shape. At 1 it stands alone.

The panel is not modal. The field stays editable, because some stops need hand work. Review keys
work only while the panel has focus.

**At each stop** the field shows the whole picture at that set, the part's spot ringed, the line
the app found highlighted, and each option as a preview with lines from where people stand now.
Nothing is written until Place.

| Option                    | Moves | Longest    | Step size in / out    | New collisions | Section order broken | Now move during a hold | Crossings vs the set before | Gaps opened at a join |
| ------------------------- | ----- | ---------- | --------------------- | -------------- | -------------------- | ---------------------- | --------------------------- | --------------------- |
| Leave the spot            | 0     | —          | same                  | 0              | no                   | 0                      | 0                           | 0                     |
| Move the hole to the back | 3     | 1 interval | 6.2 → 6.4 / 7.0 → 7.1 | 0              | no                   | 0                      | 0                           | 0                     |
| Spread evenly             | 7     | 0.5 steps  | …                     | 0              | no                   | 3                      | 0                           | 0                     |
| Close up (shape)          | 9     | 2 steps    | …                     | 0              | **yes: 1 tuba**      | 0                      | 1                           | 1                     |

- **Leave the spot is first and preselected.** No option that moves people is ever preselected.
- Options run in this order: within the line or file, then within the section, then free least
  travel. The last is offered, never led with.
- A shape's Close up uses the shape's own pivot. Today it reads the user's tool setting
  (**FACT**, `placedBox.ts:318`), so two users could get different results. That is fixed first.
- Options that cannot run are shown disabled with the reason. No toast.
- Placing an option that moves people does three things in **one undo step**: the part goes out
  for that stop's sets, it leaves that set's recipe if there is one, and the others move.
- **By hand** takes the part out for the stop and leaves the designer on the field.

**State lives in the show.** A stop where the part is still unfilled is a kept spot. A stop
where it is out has been restaged. There are no ticks. The only per-user thing is the cursor
(which stop was last visited), and losing it loses nothing.

**Batching, with guards.** "Do the same for the stops like this one" is a one-time policy, and
draft 1 was wrong to pretend otherwise. So:

- "Like this" means the same kind of line or shape, the same options available, and the hole in
  the same kind of place (end, edge, corner, interior).
- The batch shows a strip of small pictures of every stop it will touch, and one summed cost row.
- Any stop where the option adds a collision, breaks section order, makes someone move during a
  hold, or opens a gap at a join is **left out** and stays for the designer, with the reason.
- A batch is one undo step.
- A filter narrows the list: whole show, from the playhead on, a page range. A filter that
  starts inside a carried form shows that stop as "cuts a hold" with its cost.

**Several parts at once.** Stops are grouped by picture, so a block that loses three is restaged
once.

**Stopping halfway is a valid end state.** The part is unfilled where its spots were kept and
out where the sets were restaged. That is L4b. Nothing forces Remove. Each placed option was an
ordinary edit: it can be undone while it is on the undo stack, and after that, reversing it is a
join job (below). Draft 1 called an abandoned review lossless; it is not, and the panel should
say so before the first Place.

**Before a long restage**, the panel offers to save a copy of the show first. It is the baseline
for the next item.

### Telling the band

The owner's words were that people have to "figure out what happened". The designer's view is
not enough. A mechanical output closes the loop:

- **What changed**: per performer, the sets whose coordinates differ from a baseline file,
  matched by drill label, with old and new values. And "print only the changed coordinate
  sheets".
- The baseline is a file the designer picks (the copy saved above). Version history is planned
  on the fork and would replace the picker.

### Where Issues (ADR 0009) fits

ADR 0009 is proposed and #599 is not started (milestone 0.3) (**FACT**).

- The review is a task with a start. Issues is a standing report. Two panels.
- Later, Issues can carry "unfilled part" and "empty spot" as heads-up checks. Nothing in the
  review waits for that: its cost columns run the existing collision and step-size checks on
  trial positions.

### A limit that ships with it

Each stop is restaged from where people stand in that set, not from the set before. After
several in a row, two marchers may cross who did not before. The "crossings vs the set before"
column measures it at each stop, so it is seen. The fix is **Reassign** from the previous set,
which waits on the owner's rule in #960 (no milestone).

### Adding

| Job                          | Flow                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A1 Take an unfilled part** | Add leads with the section's unfilled parts: "Assign to T3 (unfilled)". If T3 is out of some sets, the dialog says which.                                                                        |
| **A3 New part**              | Today's Add.                                                                                                                                                                                     |
| **A4 New season**            | **Update names from CSV**: match rows by drill label, set name, year and notes, and offer to mark the unmatched parts unfilled.                                                                  |
| **A2 Insert**                | **Add at the end of…**: the designer picks an end or edge marcher and a side. The new part starts as that marcher's drill, one interval outside. Then the review runs over that marcher's stops. |

Draft 1's "Add next to" copied a neighbor at one interval, which lands exactly on the next
marcher in any regular form (06 S5). So:

- The anchor must be at an end or edge at the stop, or the stop starts **undecided**: the new
  part is parked just outside the form and flagged. Nothing is preselected.
- Options per stop: **Extend the line** (one more spot past the end), **Take the empty spot**
  (#358 decision 2, not built), **Grow by one** (the shape laid out for n + 1; needs the
  generate path from #961 / PR #984).
- Several new parts are grouped by picture: "grow this by 3", not three joins.
- Putting a part back into sets it is out of is this same review, for exactly those sets.

Out of scope, said once: renumbering labels to close gaps after cutting parts (T1 to T45).

---

## 5. An LLM (for example Haiku)

Verdict unchanged, and 04 agrees: **no LLM feature in the app for this.** The reasons are
rewritten after 06 S14.

1. **It saves no review time.** Whatever a model proposes, the designer must look at it in the
   same preview with the same cost row before placing it. The slow part is looking, and the
   owner wants that part kept. Draft 1 said a text model cannot see the picture; that was weak.
   Coordinates are text and vision models exist. Seeing was never the issue.
2. **Everything it would estimate, the app can measure**: moves, step size, collisions, section
   order, where the hole sits.
3. **The one place a model might beat geometry is naming the form in a hand-placed set.** The
   spike found a line for about three in four marcher-sets on the demo with a 60-line script.
   The honest comparison is that script against a model on five real shows, scored by a
   designer. It needs no model in the app to run, and I expect the script to win on cost,
   speed and repeatability.
4. **An agent can still drive it later.** If the review's actions are commands, an outside agent
   can call them. That depends on #357, which is paused, so it is a later option, not a free
   one. Undo would follow the commands: each placed stop or batch is its own step, and how an
   agent's run is grouped is #612's question.

04's prices are correct (**FACT**: Haiku 5.5 $0.10 in, $0.50 out per million tokens up to
100K-token prompts; Haiku 4.5 $1 and $5). Cost was never the issue.

---

## 6. What must be finished first

### Why the split is where it is

There is **no freeze** on file changes (owner, #994). The real grounds:

- **Format cost.** Before 0.2.0 the table is free: no bump, no older release. After, it costs a
  bump and locks 0.2.0 out of those files.
- **Risk.** Mark as unfilled moves nobody and adds one table. The review edits many sets; it
  needs the stop finder checked on real shows first.
- **Load.** Milestone 0.2.0 has 45 open issues and no date (**FACT**). Only small things should
  be added to it.
- **Who it helps.** 0.2.0 is the first release v0.1.7 users upgrade to. Their shows have no
  shapes. The one thing that helps them on day one is not destroying a part.

So: **the table and Mark as unfilled / Assign go in 0.2.0. Everything else is 0.2.x or later
and changes no format.**

### Hard blockers, in order

| #   | Prerequisite                                                                                                      | Why                                           | Issue | When          |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----- | ------------- |
| 1   | Owner picks the model, the words, and whether the table may join the 0.2.0 format                                 | Everything depends on it                      | new   | now           |
| 2   | An ADR for the presence table (page or beat keyed; history; what each reader does)                                | Persistent data                               | new   | before step 1 |
| 3   | A sweep of every all-marchers loop                                                                                | Exports, checks, 3D, counts, selection, CSV   | new   | with step 1   |
| 4   | Swap drill: a test that positions match the other part's from the set on, on a converted show and an app-made one | It is an INFERENCE today                      | new   | step 3        |
| 5   | The stop finder measured on five real shows, with the misses looked at                                            | The review rests on it; the spike is one show | new   | before step 4 |
| 6   | Close up reads the shape's pivot, not the user's                                                                  | Two users must get the same result            | new   | before step 5 |

### Needed for later steps only

| Prerequisite                                           | For                                                          | Issue, milestone                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #504 recipes onto the transition, then #358 spot rules | Choosing which spot in a shape is empty; Take the empty spot | #504 is 0.3. **#358 is Later**, so these steps are further off than draft 1 showed. #504 also re-keys recipe queries, so the review's shape step should be written against a small seam. |
| #960 the assignment rule                               | Reassign; who goes where in Grow by one                      | No milestone. **Blocked on an owner decision, not on work.**                                                                                                                             |
| #961 / PR #984 paste keeps spacing                     | Grow by one                                                  | #961 is 0.2.0                                                                                                                                                                            |
| #357 command tree                                      | Commands with arguments; agents                              | 0.3, paused. Interim: plain registered actions.                                                                                                                                          |
| `pathways/host` merged; step 12                        | Hand-over on laned moves                                     | #640; **#653 is milestoned 0.2.0** and ready for an agent, but its text covers only "rejoin after a takeover". The wider scope is in the plan on PH.                                     |
| Step 17                                                | Restaging where members arrive on a group path               | #658                                                                                                                                                                                     |
| #1015 Held shapes                                      | Where a carried shape's edit lands                           | PR open                                                                                                                                                                                  |
| #599 Issues                                            | Standing checks for unfilled parts                           | 0.3                                                                                                                                                                                      |
| Version history                                        | Replaces the baseline file picker                            | planned on the fork                                                                                                                                                                      |

### Housekeeping

- **ADR numbers (FACT):** main has `0014-desktop-updates` and `0015-cue-model`; PH has
  `0014-moves-follow-drawn-paths` and `0015-lanes-on-slots`. Cite pathways ADRs by name.
- **File versions (FACT, 03):** PH and its open PRs use 11 to 17.

### Bugs and gaps worth fixing regardless

| Item                                                                                         | Label                      |
| -------------------------------------------------------------------------------------------- | -------------------------- |
| Delete leaves empty spots with no notice, and they are not drawn                             | FACT / INFERENCE           |
| The Add form offers a deleted marcher's number, which looks like a restore                   | FACT                       |
| Close up reads `env.pivot` from the user's tool settings                                     | FACT (`placedBox.ts:318`)  |
| Re-split is reachable only from an 8-second toast and uses the last-used layout              | FACT (02)                  |
| No Close up for an open Line or Arc                                                          | FACT                       |
| A move whose only marcher was deleted stays as an empty clip. Remove part must delete these. | FACT                       |
| `view3d_cameras` keeps a deleted marcher's id, outside undo                                  | FACT                       |
| Stale comments: `marcher.ts:222-236`, `useMarchers.ts:105`                                   | FACT                       |
| The CSV import can only create marchers                                                      | FACT (`marcherCsv.ts:228`) |
| The 3D View and coordinate sheets ignore a hidden look                                       | INFERENCE / reported by 06 |
| Swapping two members of a placed shape may drop both from it                                 | INFERENCE; needs a test    |

---

## 7. A phased plan, one lab build per step

Each lab test runs on **the demo show** (no shapes) unless it says otherwise.

| Step   | What ships                                                                                                                                                                                                                                                                                                               | The lab test asks                                                                                                         | Needs                      | Target                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------- |
| **1**  | **Mark as unfilled and Assign.** The presence table and its ADR. Hollow dots on the field and the drill chart. Coordinate sheets, the mobile export and the checks skip unfilled parts. Add leads with Assign. The delete confirm says what a delete destroys and points to Mark as unfilled. Whole-show only in the UI. | Jordan quit on Monday. A new student took the spot on Friday. Was anything lost?                                          | Blockers 1 to 3            | **0.2.0**                          |
| **2**  | **Take out from here on, and Put back.** The timeline bar for a selected part.                                                                                                                                                                                                                                           | T3 is off the field from the ballad. Print the charts.                                                                    | Step 1                     | 0.2.0 if there is room, else 0.2.x |
| **3**  | **Swap drill**, whole show and from here on.                                                                                                                                                                                                                                                                             | Move the hole from T3 to T7 from set 12 on. Does anyone jump?                                                             | Blocker 4                  | 0.2.x                              |
| **4**  | **The review on hand-placed sets.** The stop finder, the highlighted line, Leave the spot, Move the hole to an end, Spread evenly, By hand, the cost table, visible Place and Cancel.                                                                                                                                    | Take T3 out of the second half of the demo show. How many decisions was it, and was the line the app found the right one? | Blocker 5                  | 0.2.x                              |
| **5**  | **Shapes in the review.** Rings for a shape's empty spots. Close up from a stop, with the shape's own pivot. Move the hole within a file. Open lines: to an end, or spread. Re-split as a real option.                                                                                                                   | On a show written in the fork: cut one part from a block and one from a line.                                             | Blocker 6                  | 0.2.x                              |
| **6**  | **Batch with guards, the range filter, several parts at once, Remove part.**                                                                                                                                                                                                                                             | Cut three parts from different sections before camp. Which stops did the batch leave for you, and was it right to?        | Steps 4, 5                 | 0.2.x                              |
| **7**  | **What changed**, against a baseline file; print only changed sheets.                                                                                                                                                                                                                                                    | Hand the changes to a section leader.                                                                                     | —                          | 0.2.x                              |
| **8**  | **Update names from CSV.**                                                                                                                                                                                                                                                                                               | Put this year's roster on last year's show.                                                                               | Step 1                     | 0.2.x, if the owner wants it       |
| **9**  | **Add at the end of…** and the join review (Extend the line; Grow by one for shapes).                                                                                                                                                                                                                                    | One more trumpet joined.                                                                                                  | #984; #960 for shapes      | after #960                         |
| **10** | **Choose the empty spot in a shape**; Take the empty spot.                                                                                                                                                                                                                                                               | Put the hole in the back corner of a box.                                                                                 | #504, #358                 | 0.3 or later                       |
| **11** | **Reassign at a stop.**                                                                                                                                                                                                                                                                                                  | Fix a crossing after three restaged sets in a row.                                                                        | #960                       | after #960                         |
| **12** | **Pathways.** Swap drill and restaging on laned moves; a trail's gap.                                                                                                                                                                                                                                                    | —                                                                                                                         | PH merged, steps 12 and 17 | later                              |
| **13** | **Issues checks** for unfilled parts and empty spots.                                                                                                                                                                                                                                                                    | —                                                                                                                         | #599                       | 0.3                                |

Draft 1's step 2 (a separate "honest delete" build) is folded into step 1. Draft 1's step 1 (a
list of empty spots in shapes) is part of step 5, because it shows nothing on the demo show.

---

## 8. Owner decisions needed

Recommendation first on each line.

1. **The model: the row stays the part, and its presence is stored by set (marching, unfilled,
   out). Yes.** Yes means "Jordan quit" destroys nothing and a part can be kept in taught sets
   and dropped from later ones. No means delete stays first, and on a show with no shapes the
   app can offer nothing after it.
2. **The presence table is part of the 0.2.0 file format. Yes.** Yes means an ordinary migration
   now and step 1 in 0.2.0. No means it lands after with a version bump, and 0.2.0 cannot open
   files that use it.
3. **Words.** I suggest _unfilled_ and _out_ for the states, **Assign** and **Leave the spot**
   for the actions, and "empty spot" only for shapes. Open, fill and keep are taken: open and
   closed lines, a shape's fill, Keep order and Keep spacing. _Vacant_ is free in the UI but is
   the spec's word for a slot. The owner picks; nothing ships with a word before this.
4. **Unfilled parts are drawn hollow on the field and on drill charts, and left off coordinate
   sheets and the mobile export. Yes.** No means one switch for all outputs, and either staff
   charts hide the hole or performers get a sheet for nobody.
5. **Swap drill trades the drill; labels, names and sections stay with their rows. Yes.** Yes
   means Sam keeps "T7" on his sheet with new coordinates from set 12. No means labels follow
   the drill, which cannot work for a swap that starts partway through the show.
6. **The 3D View does not draw unfilled parts. Yes.** No means it draws a marker in the spot.
7. **No stored restaging policy; a batch is a one-time choice with guards that leave risky stops
   out. Yes.** No means a rule editor, and rules that act on sets nobody looked at.
8. **Stopping a review halfway is a valid end state, and Remove part is optional tidying. Yes.**
   No means every review must end in a delete, which loses the kept spots' identity (draft 1).
9. **Putting a part back into sets that were restaged is a join job, and the app says so before
   the first change. Yes.** No means promising a restore that undo cannot deliver after other
   edits.
10. **Adding into a form: nothing is preselected; a new part that is not at an edge starts
    parked and flagged. Yes.** No means added parts change forms, or stand on neighbors, without
    being asked.
11. **Each placed option is one undo step, and a batch is one. Yes.** No means one undo group
    for a whole restage.
12. **Remove has no shortcut; review navigation and Place do. Yes.**
13. **No LLM feature for this. Yes.** No means first building the review, then scoring a model
    against the line finder on five real shows.
14. **Update names from CSV is in scope (step 8). Yes, low priority.** No means a new season on
    an old show is renamed by hand.
15. **True off-field motion and one part shared by two people stay unsupported. Yes.** No makes
    this a motion-model project.
16. **Order: #504 before #358's spot rules, and both after the hand-placed review. Yes.** No
    means building shape-only help first, which the demo show and v0.1.7 files cannot use.

One position to look at again, not reverse: **"empty spot keeps path and Adjust" (pathways
Q1).** As built it applies only to stored-shape and follow moves; in app-made shows a deleted
marcher's transition and lanes go with it. Keeping the part gives Q1's intent with no new work.

---

## 9. Where I disagree with the inputs, and the answer to each 06 finding

### 06, finding by finding

| Finding                            | Answer                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** mid-review state undefined  | **Accepted.** The per-set state is the fix (section 3, B3). I took the reviewer's option 1 over a stored plan, for the reviewer's reason and one more: a plan goes stale as the show is edited under it.                                                                                                                                                         |
| **B2** shows have no recipes       | **Accepted.** Stops come from positions; hand-placed stops have two computed options; the spike gives a first number; five real shows are a hard blocker. I took "move the hole along the line" over "make this a shape" as the first option because it invents no coordinates. Fitting a shape is still available: it is the Line tool on the highlighted dots. |
| **B3** no freeze                   | **Accepted.** Section 6 re-derives the split.                                                                                                                                                                                                                                                                                                                    |
| **B4** whole-show flag             | **Accepted.** Same fix as B1. Scenario 2 (two half-parts) is Swap drill from here on. Scenarios 3 and 4 are named as unsupported, with the workaround.                                                                                                                                                                                                           |
| **S1** hidden look exists          | **Accepted.** Section 1 corrected; section 3 compares the two and borrows the storage pattern.                                                                                                                                                                                                                                                                   |
| **S2** word collisions             | **Accepted.** Decision 3 lists them.                                                                                                                                                                                                                                                                                                                             |
| **S3** not mechanical              | **Accepted**, all rows: cost columns added; line and section options before least travel; the stop is the whole picture; a cut carry is its own stop kind; trails and cornered lines are called choices; the pivot bug is a blocker; crossings are measured from step 4 without waiting for #960.                                                                |
| **S4** batch is a policy           | **Accepted.** Guards, a strip of pictures, the hole's place in "like this". Decision 7 says it plainly.                                                                                                                                                                                                                                                          |
| **S5** Add next to                 | **Accepted.** Edge anchors only, otherwise parked and undecided; grouped adds.                                                                                                                                                                                                                                                                                   |
| **S6** ticks per user              | **Accepted**, and removed: state is derived from the presence table. Only the cursor is per user.                                                                                                                                                                                                                                                                |
| **S7** from-a-set hand-over        | **Accepted.** Step 3, on main. My draft 1 filed it under pathways, which was wrong for main. It needs the test in blocker 4.                                                                                                                                                                                                                                     |
| **S8** telling the band            | **Accepted** as step 7, with a baseline file until version history exists.                                                                                                                                                                                                                                                                                       |
| **S9** exports                     | **Accepted.** Two defaults (decision 4).                                                                                                                                                                                                                                                                                                                         |
| **S10** CSV                        | **Accepted as optional** (step 8, decision 14). It is not needed for a leaver.                                                                                                                                                                                                                                                                                   |
| **S11** Swap parts undefined       | **Accepted.** Replaced by Swap drill; the column table is in section 3; section stays on the row.                                                                                                                                                                                                                                                                |
| **S12** format contradiction       | **Accepted.** Resolved by going before 0.2.0; the after case is stated honestly.                                                                                                                                                                                                                                                                                 |
| **S13** table errors               | **Accepted.** Milestones corrected; #357 interim stated; empty moves cleaned by Remove.                                                                                                                                                                                                                                                                          |
| **S14** LLM reasons                | **Accepted.** Section 5 rewritten; the comparison to run is named.                                                                                                                                                                                                                                                                                               |
| **N1** audiences                   | Accepted (section 4 opening).                                                                                                                                                                                                                                                                                                                                    |
| **N2** items and other deletes     | Accepted (section 2 table).                                                                                                                                                                                                                                                                                                                                      |
| **N3** renumbering                 | Out of scope, said in section 4.                                                                                                                                                                                                                                                                                                                                 |
| **N4** modal or not                | Not modal.                                                                                                                                                                                                                                                                                                                                                       |
| **N5** new shapes include the part | Accepted (section 3 table).                                                                                                                                                                                                                                                                                                                                      |
| **N6**                             | No change needed.                                                                                                                                                                                                                                                                                                                                                |
| **N7** unsourced frequencies       | Accepted; labelled INFERENCE.                                                                                                                                                                                                                                                                                                                                    |
| **N8** #504 re-keys the list       | Accepted. The hand-placed review does not read recipes, which is another reason it comes first.                                                                                                                                                                                                                                                                  |

**One place I go further than 06.** The reviewer kept Remove as the end of the flow ("only
tidying up"). I make it optional: a part that is unfilled in some sets and out of others is a
finished state.

**One place I am less sure than 06.** The reviewer says the per-set state "costs only the field
and 3D drawing" for an out part. It also costs every count, export and selection path, and the
page-delete upkeep. It is still the right design.

### 01 to 04

| Report            | Claim                                                                  | My reading                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03 §1             | App-made shapes write shared transitions that are compacted on delete. | 01 and the code say each marcher has its own one-slot transition (`timelinePointMoves.ts:85`; 06 N6 confirmed it on PH). The outcome 03 reports is the same; the mechanism is not. |
| 03 §2             | Step 12 is blocking.                                                   | Only for hand-over on laned moves. On main, Swap drill needs none of it.                                                                                                           |
| 03 §2             | "A decision on compaction vs Q1" is needed.                            | Not if the part is kept.                                                                                                                                                           |
| 03 §5             | `.ompb` cannot express a placeholder.                                  | True and not needed: the exporter leaves such parts out and says so.                                                                                                               |
| 03, the brief     | #653 is "pathways step 12".                                            | The ticket's text is narrower than the plan row on PH. It is also milestoned 0.2.0.                                                                                                |
| 04 summary 4      | OpenMarch already separates role and person.                           | In the data, yes. In no command.                                                                                                                                                   |
| 04 pattern 4      | Stored policies by scope.                                              | No. A guarded batch instead.                                                                                                                                                       |
| 04, end of Part A | One undo group per roster change.                                      | No. One step per placed option or batch.                                                                                                                                           |
| 04 pattern 1      | Both verbs with keys.                                                  | Place and navigation, yes. Remove, no.                                                                                                                                             |
| 04 pattern 9      | Keep the leaver's motion to revive later.                              | Yes where the part is unfilled. Where a set was restaged, the old spot no longer fits; coming back is a join.                                                                      |
| 04 Part B         | A sentence-to-rules LLM job later.                                     | It depends on a rule editor this design does not have.                                                                                                                             |
| 01 §2             | A shape "keeps a hole" after a delete.                                 | Agreed from the code, but the hole is a number in a label, not a mark on the field.                                                                                                |
| 02 §4             | N − 1 is deterministic for most kinds.                                 | Deterministic is not the same as wanted (section 2, point 3; 06 S3).                                                                                                               |
| 02 summary 5      | Re-split is built.                                                     | Reachable only from a toast, and tied to the user's last-used layout.                                                                                                              |
| 01 to 04 together | The reports treat shapes as the main case.                             | The demo show and every v0.1.7 file have none. This was the largest gap in the inputs and in my draft 1.                                                                           |
