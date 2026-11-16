<!-- cspell:disable -->

# Roster changes 06: adversarial review of 05

Status: independent review, 2026-11-16. The reviewer did not write 01 to 05.

- **CHECKED** = I read the code, file or issue cited. **REASONED** = a scenario, not run.
- No tests were run. The checkout has no `node_modules`.
- Paths are relative to `apps/desktop/` on fork main (`e5e2b3a30`) unless they say otherwise.
- "05 §n" is a section of `05-design-exploration.md`.

## Summary

| # | Rank | Finding |
| --- | --- | --- |
| B1 | Blocker | A part that is half-way through the review has no defined state. Close up cannot even run on it. |
| B2 | Blocker | The mechanical help covers only recipe-made sets. The bundled demo show and every v0.1.7 show have none. |
| B3 | Blocker | The 0.2.0 split rests on a freeze that does not exist. The open state is cheaper before 0.2.0 than after. |
| B4 | Blocker | A whole-show open flag cannot say the commonest in-season outcome: taught sets keep the part, later sets drop it. |
| S1 | Should-fix | The app can already hide a marcher from a page on. 05 calls this "not possible" and never mentions it. |
| S2 | Should-fix | "Open", "Fill", "Keep" and "Close up" already mean something else in the shape UI. |
| S3 | Should-fix | Close up is not mechanical for sections, joined shapes, cornered lines, trails or carried shapes. |
| S4 | Should-fix | Batch is a stored policy without the storage. It acts on stops the designer has not seen. |
| S5 | Should-fix | "Add next to" puts the new part on top of a neighbor in any regular formation. |
| S6 | Should-fix | Keep ticks stored per user by file path lose a multi-day review. |
| S7 | Should-fix | No "from this set on" hand-over, which is how designers move a hole in season. |
| S8 | Should-fix | No output that tells the band what changed. |
| S9 | Should-fix | Exports: one switch for charts and coordinate sheets is wrong for a kept hole. |
| S10 | Should-fix | Roster CSV import cannot fill or update parts. |
| S11 | Should-fix | Swap parts does nothing in a show with no names, and section does not travel. |
| S12 | Should-fix | The file-format row contradicts itself about older builds. |
| S13 | Should-fix | Prerequisite table errors: #358 milestone, #653 milestone, #357 cost. |
| S14 | Should-fix | The LLM verdict is right, but two of its four reasons do not hold. |
| N1–N8 | Nit | Listed at the end. |

---

## Blockers

### B1. A part in mid-review has no defined state

**Evidence (CHECKED).**

- `canCloseUp` needs `members.length < spots` (`src/shapes/placed/placedBox.ts:293-296`).
  05 §4 runs the review while T3 is still an open part, and 05 §3 says "an open part is still a
  member. The shape has no hole". So at every stop Close up is unavailable as built.
- To close up, the review must first take T3 out of that recipe. T3 keeps its own move ending at
  that set, so its dot still stands on the old spot. After the close-up, another marcher may
  stand there or walk through it.
- 05 §4 says the old position "shows as a ghost only while the review panel is open". 05 §3 says
  an open part is "a hollow dot with its label on every set". Both cannot be true for a set that
  has been closed up.

**Scenarios (REASONED).**

- The designer closes up 12 of 41 stops and stops for the week. T3 is still open. The Add dialog
  "leads with Fill T3 (open)" (05 §4, Adding). A new student is filled into T3 and stands on
  someone else in 12 sets.
- 05 §4 step 6 says an abandoned review loses nothing "but the close-ups already made (each
  undoable)". Undo is a stack (01 §1). After a week of other edits those close-ups cannot be
  undone. This is the same dishonesty 05 decision 11 uses to reject an archived state.
- With "include open parts" switched on, an export prints T3 inside a closed-up block.

**Fix.** Pick one and write it down before decision 1 is put to the owner:

1. **Per-set drop.** An open part can be "not in this set". It is not drawn, not exported and
   not checked there. Close up at a stop sets that. Fill is disabled with a reason while any set
   is dropped, or it opens the join review for exactly those sets. This also solves B4.
2. **Plan, then apply.** The review stores choices and writes nothing until Remove. Then the
   stored plan needs a home in the file and must survive later edits to those shapes.

Option 1 is smaller and matches what `deleteMarchers` already does to recipes.

### B2. Shows that already exist have no recipes

The owner's words were "shows that already exist".

**Evidence (CHECKED).**

- `web/public/demos/part1-demo.dots`: `user_version` 7, 95 marchers, 23 pages, no
  `timeline_shape_recipes` table. It is a page-era file.
- `electron/database/__test__/v017-files/realistic.dots`: the same, 76 marchers, 22 pages.
- 05 §2 admits a converted show is "hand-placed to the app" at every set, as an INFERENCE in
  one table row. It is not carried into the plan.

**Consequences.**

- Step 1's lab test is "Delete someone from the example show. Can you find every place it
  mattered?" On the shipped demo the list is empty and no ring is drawn.
- Step 7's test is "Cut three parts from the example show". Every stop is hand-placed, so every
  stop offers Keep only. That is a page stepper, which is what the owner said other tools do.
- The owner's stated migration risk is v0.1.7 files. The design gives them the open flag and
  nothing else.

**Fix.**

- Add a recipe-free mechanical option for a hand-placed stop: the designer selects the neighbors
  and the app spreads them evenly between the two ends, with the same preview and cost table.
- Or add "make this a shape" at a stop: fit a Line, Arc or Box to the selected dots and offer
  it as a recipe. Then Close up applies. This needs a spike to see how often real pages fit.
- Before either: measure. Count, on five real shows, how many of a part's sets are recipe-made.
  Put the number in 05 §1.
- Change the step 1 and step 7 lab tests to name a show that has recipes, and add a second test
  on the demo show.

### B3. The 0.2.0 split is based on a freeze that does not exist

**Evidence (CHECKED).**

- Fork issue #994, owner, 2026-11-15: "There is no general freeze on file-format changes."
- Migrations `0020_item_model_and_lock` and `0021_held_mark_style` both landed on 2026-11-15
  (`git log`). Both add columns. Neither bumped `user_version`.
- `MAX_SUPPORTED_USER_VERSION` is 8 (`electron/database/fileVersion.ts:28-31`). No release has
  shipped the fork's version 8 format yet.
- Milestone 0.2.0 has 45 open issues, 2 closed and no due date (`gh api .../milestones`).

**Why it matters.**

- 05 §6 blocker 3 says "0.2.0 ships: file-format changes land after it". That is not a rule.
- Before 0.2.0, one nullable column is a normal migration with no bump and no older release to
  stay compatible with. After 0.2.0 it needs a decision about older builds (see S12).
- The plan puts the cheapest, highest-value step (Mark as open, step 6) behind five steps and a
  release with no date. Steps 1, 2 and 4 are built on delete-first, which decision 1 replaces.
  Step 2 (the honest delete dialog) is mostly thrown away by step 7.

**Fix.**

- Ask the owner one question: may the open column be part of the 0.2.0 format? If yes, step 6
  goes first, then rings, then the review.
- If no, say why in the doc. "After 0.2.0" then needs the bump-or-no-bump answer from S12.
- Either way, drop step 2 as a separate lab build. Fold its dialog text into step 7.

### B4. A whole-show flag cannot express "kept until set 30, gone after"

**Evidence.** 05 §3 risk 3 states it: "Keep the hole in sets 1 to 30, close up after cannot be
said with a whole-show part... The identity is lost in those sets." 05 §4 step 4 then says
"From here on matters most" in season.

**Scenarios (REASONED).**

- Week 6. Sets 1 to 30 are taught, so they keep T3's hole. Sets 31 to 70 are closed up. To
  finish, the designer must press Remove T3. Now sets 1 to 30 hold anonymous empty spots in
  recipes and nothing at all in hand-placed sets. Two weeks later a student joins. There is no
  T3 to Fill. It is an "Add next to" job across 30 sets.
- Two half-parts joined into one person: Sam marches T3's drill in the opener and T7's drill in
  the closer, because that puts the holes where they hide best. Needs T3 open from set 20 on
  and T7 open before set 20.
- One part shared by two people (one in the opener, one in the closer). One name column.
- A performer who leaves the field at set 20 (05's L6, rated "rare" with no evidence).

The most common in-season use of the hard job (L4) is the first one. The model fails it.

**Fix.**

- The per-set drop from B1 option 1 covers the first scenario without option C. An open part is
  never exported or checked, so "not in this set" costs only the field and 3D drawing. The
  resolver, `.ompb` and the checks are untouched.
- Then Remove part is only tidying up, for a part that is dropped in every set.
- State plainly that the other three scenarios stay unsupported, and what the workaround is
  (S7's hand-over covers the second).

---

## Should-fix

### S1. The app can already hide a marcher from a page on

**Evidence (CHECKED).**

- `appearance_columns` has `visible` (`electron/database/migrations/schema.ts:34`).
- `tag_appearances` is keyed by `(tag_id, start_page_id)`: "What a tag looks like on a page and
  onward" (`schema.ts:225-245`).
- The field hides such a marcher (`src/field/three/marcherLooks.ts:47`). The drill chart export
  skips it (`src/components/exporting/utils/drillChartSvg.ts:170`).
- I found no `visible` check for marchers in `src/view3d`, and coordinate sheets still print
  them.

**Why it matters.**

- 05 §1 says L6 is "Not possible" and L5 has "Nothing". A designer can tag T3 and hide the tag
  from the ballad on today. It is display only, but it exists.
- An open column next to `visible` gives two ways to say "don't show this dot". 05 never says
  how they combine. The "every all-marchers loop" sweep (05 §3 risk 5) partly exists as the
  `look.visible` checks.
- A page-ranged state already has a storage pattern here. 05 §3 option C says a range needs the
  resolver and `.ompb`. That is true for motion, not for "nobody marches this from page N".

**Fix.** Add a row to 05 §3 comparing the open state with `visible`. Decide whether open is a
new column, or a page-ranged state stored like a tag appearance. The second gives B4 its range.

### S2. The proposed words collide with shape words

**Evidence (CHECKED in 05 itself and in 02).**

- "Open": 05 §2 has rows "Closed Line or Arc" and "Open Line, Curve, Arc". The review would say
  "An open line can't close up yet" beside "T3 (open)".
- "Fill": shapes have a fill mode (Outline, Grid, Spread). 05 §2 writes "Fill mode change".
- "Keep": the order mode `keep`, "Keep spacing even" (`CONTEXT.md:22-24`), Line spacing `keep`.
- "Close up" beside "closed shape".

**Fix.** Decision 3 should give the owner the collisions, not just a suggestion. Candidates to
test: "unfilled" or "vacant" for the part, "Assign" for Fill, "Leave the spot" for Keep.

### S3. "Mechanical" claims that are not

Each of these is deterministic. None is reliably what a designer wants.

| Claim in 05 | Problem | Evidence |
| --- | --- | --- |
| Close up is geometry the app already has (§2 point 3) | Least travel has no idea of section, part order or height order. A tuba can be moved into the trumpet rank. | CHECKED: `src/shapes/leastTravel.ts:8-12` says a better rule "that also weighs step size or drill order" could replace it. Nothing does. |
| Close up result is the shape's own | `closedUpParams` reads `env.pivot` from the user's tool settings. Two users can get different results from the same stop. | CHECKED: `placedBox.ts:318` |
| A stop is "one recipe" (§4 step 2) | Pictures are made of several recipes: a front of three lines, a block with a diagonal. Closing or shortening one opens a gap at the join. | REASONED; #583 (join shapes) is open |
| Open line: "Fit widens the interval, Keep shortens from the pivot" (§2) | With corners, "the two ends always hold a marcher" and each stretch needs a whole number of gaps. Which leg gives up a marcher is a choice. With counted groups, "too few drop from the end", so the hole moves to the last group. | CHECKED: ADR 0006 `:308`, `:344`; 02 §1 Line row (`spacing.ts:155-159`) |
| Trail: "Close the gap... Mechanical" (§2) | Moving everyone up one slot changes every later end spot. The shape at the next set shows only while every member is on its spot, so that recipe stops showing or must be closed up in step with the trail. | CHECKED: `boxesAt` rule in 02 §3 |
| A carried shape is "decided once, where it was placed" (§4 step 2) | A carried shape is its hold (#477). Closing up at the origin is fine. But the "from the playhead on" filter can land inside the carry. Then the edit writes a copy on a later page and about nine marchers who were standing still now move. | CHECKED: 02 §3 (edits on a later page save a copy) |
| Independent close-ups (§4 "A known limit") | 05 names the crossing problem and defers the fix to step 10, behind #960, which has no milestone. So steps 7 to 9 ship with it. | CHECKED: #960 milestone none |

**Fix.**

- Add columns to the cost table: "section order broken", "holds broken", "joins opened".
- Offer "shift within the file only" and "same section only" as Close up variants before
  free least travel.
- Make the stop the picture at a set: every recipe there, with the touched one highlighted.
- When the filter cuts a carried shape, show that as its own stop kind with the holds cost.
- Do not call the trail or cornered-line close-up mechanical in the doc. Call them built options
  with a default.
- Move a minimal "keep the same people in the same relative spots as the previous set" check
  into step 7, without waiting for #960.

### S4. Batch is a policy the designer has not read

**Evidence.** 05 §4 step 4: "Do the same for the 11 stops like this one. Like this means the
same kind, the same fill mode and the same options available." 05 decision 7 rejects stored
policy because it means "rules that act on sets the designer has not looked at". A batch does
exactly that, once.

**Scale (REASONED).** A 70-set show with three people leaving from different sections has
roughly 70 to 100 stops. With Keep preselected and batches by kind, that is about 10 to 20
decisions, not 200. So "no stored policy" is fine for clicks. The risk is the other way: the
batch applies 11 close-ups whose previews nobody saw.

**Fix.**

- The batch shows one summed cost row and a filmstrip of the stops.
- Any stop where the batch adds a collision, breaks section order or breaks a hold is left out
  and stays undecided, with the reason.
- "Like this" must also match the hole's place (edge, corner, interior). An interior hole and a
  corner hole are different decisions.

### S5. "Add next to" stands on a neighbor

**Evidence.** 05 §4 Adding: the new part "starts as a copy of that marcher's drill, offset by a
chosen interval". Default option: "Stay beside. Nobody else moves."

**Scenario (REASONED).** T5 stands in an 8 × 4 block at a 2-step interval. A copy of T5 offset
by one interval is exactly on T6, in every set where the block exists. The default produces a
collision at every regular formation, which is where job A2 lives. It only works for an edge
marcher, and only on the outside.

**Fix.**

- The default at each stop is undecided, not "Stay beside". The new part is parked off the form
  and flagged until the designer picks.
- "Add next to" asks for an end or edge marcher and a side, or says why it can't.
- Group stops by formation for several added parts, as the remove review does. A reused show
  that grows from 48 to 60 needs "grow this shape by 3", not twelve single joins.

### S6. Keep ticks per user by file path

**Evidence (CHECKED).** ADR 0009 D-5 stores dismissals in the show (`issue_dismissals`,
`docs/adr/0009-show-issues.md:151-160`). Only the "seen" state is per user and keyed by path
(`:204-206`). 05 §4 step 5 copies the "seen" pattern for a review decision.

**Why it matters.** A review "can span days". The ticks are lost when the file is renamed,
moved, sent to a co-designer, or opened in the web editor (shows live in OPFS, ADR 0002). The
designer reviews 30 Keep stops again.

**Fix.** A Keep is a decision about the show. Store it in the show. Under B1 option 1 it needs
no extra storage: a set where the part is still present is a Keep.

### S7. No "from this set on" hand-over

**Evidence.** 05 §1 L3 says moving a performer into the vacated part is "how designers choose
where the hole is". 05 gives only whole-show Swap parts (step 5). "From a set on" appears only
under pathways step 12 (05 §6).

**Why it matters (REASONED).** On main there are no lanes. Every app-made move is the marcher's
own one-slot transition (01 §1). Trading two marchers' moves, Held marks and recipe membership
from beat b on is row updates, with no file change. It is not a pathways job on main.

**Fix.** Add "Swap parts from here on" as a step on main, before the review. Refuse with a
reason on laned moves once pathways merges.

### S8. Nothing tells the band what changed

The owner said designers must "figure out what happened". 05 covers the designer's view only.

**Fix.** Add a mechanical output: per performer, the sets whose coordinates changed since a
chosen point, with old and new values, and "print only the changed coordinate sheets". It needs
a baseline, so tie it to a saved version or a copy of the file made when the review starts.
Add a line that a multi-day restage should start from a saved version (working-copy saves
exist on the fork; version history is listed as next).

### S9. One export switch is wrong for a kept hole

**Evidence.** 05 §3 and decision 6: coordinate sheets, PDFs, the mobile export and the 3D View
"skip open parts by default, with a switch".

**Scenario (REASONED).** Job L1 is "the band marches around a hole that travels". On a printed
drill chart with the open part skipped, the hole is unmarked. Marchers dress to their neighbors
and the hole closes on the field. Staff need the hole drawn.

**Fix.** Two defaults. Drill charts draw open parts hollow. Per-performer outputs (coordinate
sheets, the mobile export) skip them. The 3D View is a separate owner call.

### S10. Roster CSV import cannot fill or update parts

**Evidence (CHECKED).** A CSV row whose drill number exists is an error, `duplicateInShow`
(`src/components/marcher/csv/marcherCsv.ts:228`). Import only creates.

**Scenarios (REASONED).**

- A new season reuses the show. The director has a roster CSV. Under B2 the natural act is
  "put these names on these parts and mark the rest open". The import refuses every row.
- An open T3 keeps its number, so a CSV row "T3" is refused.

**Fix.** Add "update parts from CSV" to the plan near step 6: match by drill number, set the
name, year and notes, and offer to mark unmatched parts open. Say that it is out of scope if
the owner prefers.

### S11. Swap parts needs its fields defined

**Evidence (CHECKED).** `name`, `year` and `notes` are optional
(`schema.ts:156-163`). `section` drives the dot's look and the 3D uniform (section appearances,
03 §5). 05 §3 says Swap parts "trades two rows' people" and decision 5 keeps labels with the
drill.

**Problems (REASONED).**

- In a show with no names, trading the people changes nothing the designer can see.
- A mellophone player who takes a trumpet part carries an instrument. If section stays with the
  drill, the dot and the 3D figure are wrong.

**Fix.** List which columns belong to the person and which to the part. Say what Swap parts
does when names are blank (most likely: it is "make T7 the open one instead of T3", which
needs the open state and so cannot ship as step 5 before it). Decide whether section travels.

### S12. The file-format row contradicts itself

**Evidence (CHECKED).** 05 §3: the column "lands after 0.2.0 with a file version bump", and "an
older build reads an open part as an ordinary marcher... a safe failure". With a bump, an older
build refuses the file: `decideFileVersion` returns `refuse-too-new` above
`MAX_SUPPORTED_USER_VERSION` (`electron/database/fileVersion.ts:73-75`).

**Fix.** Pick one. No bump: old builds open the file and print the open part as a real marcher
on coordinate sheets, which is not obviously safe. Bump: old builds refuse it. Under B3's
"before 0.2.0" route the question goes away.

### S13. Prerequisite table errors

All CHECKED with `gh issue view`.

- #358 is in milestone **Later**, not 0.3. 05 §6 row 6 says "0.3 (as milestoned)". Steps 8 and
  9 depend on it, so they are further off than the plan shows.
- #653 is in milestone **0.2.0**, labelled ready-for-agent. 05 treats it as far-off pathways
  work and does not say so.
- #357 is in 0.3 and paused. 05 §5 says command integration "costs the roster work nothing
  extra". Taste says no feature lands without it. Commands with arguments (`close up stop 12`)
  need the tree. List it as a prerequisite of step 7 or state the interim (plain registered
  actions with no arguments).
- #960 has no milestone and waits on the owner. Steps 9 and 10 are blocked on a decision, not
  on work. Say so in the "When" column.
- Step 3 (Close up for open lines) is useful and independent. It is correctly not blocked.
- Empty moves left by a delete are in the bug list but in no step. Step 7's Remove leaves them
  too.

### S14. The LLM verdict: right answer, weak reasons

The verdict (no LLM in the app) holds. The price line is correct (CHECKED against the current
model table: Haiku 5.5 $0.10 and $0.50 up to 100K-token prompts, Haiku 4.5 $1 and $5).

- Reason 1, "a text model cannot see the picture", is weak. Coordinates are text, and vision
  models exist. The real reason is that the designer must check every proposal in the same
  preview anyway, so the model saves no review time.
- Reason 3 is circular: no rule editor, so nothing for a model to fill in.
- Reason 4 depends on #357, which is paused (S13). "One request is one undo step" also clashes
  with "each review decision is its own undo step" when an agent drives twenty stops.
- 05 never tests the one place a model might beat geometry: naming the formations in a
  hand-placed show (B2). I expect plain shape fitting to win there too, but that is the
  comparison to run, and it needs no model in the app to run it.

**Fix.** Rewrite reasons 1, 3 and 4 as above. State how an agent-driven review maps to undo.

---

## Nits

- **N1.** 05 names no audience cells, which taste asks for. The preview's "Enter places, Escape
  leaves" needs visible buttons on touch. The review is most useful on a tablet at rehearsal.
- **N2.** `deleteMarchers` is also used by props (`useItems.ts:102-111`), and the pit preset
  and the new-show wizard have their own deletes (01 §1). Say that these skip the review and
  that Mark as open is hidden for items.
- **N3.** No renumbering tool exists. After cutting three parts before the season, designers
  want T1 to T45 with no gaps. Out of scope is fine; say it.
- **N4.** 05 §4 does not say whether the review panel is modal. Hand-placed stops need normal
  field editing while it is open, and the preview keys must not clash with editing keys.
- **N5.** Selecting a section and placing a new shape includes the open part, so new sets get
  the hole baked in. That is right for L1. The placement preview should draw the open part
  hollow so it is a choice.
- **N6.** 05 §9 row 1 corrects 03 on shared transitions. I confirmed the writer on PH
  (`timelinePointMoves.ts:78-90`). The correction stands.
- **N7.** L6 is rated "Rare" and L1 "Most common in season" with no source. Label them
  INFERENCE or ask the owner.
- **N8.** Steps 1, 3 and 4 are built on move-keyed recipes, which #504 re-keys. 05 uses that
  argument against doing #358 early but not against its own steps. The ring drawing survives;
  the list query does not.

## What I checked and found correct

- `marchers` columns and the `type` precedent (`schema.ts:152-188`).
- History triggers cover `marchers` (`src/db-functions/historyTriggers.ts:10`).
- Editing a marcher in place keeps the row id (`MarcherForm.tsx:160-171`).
- Casting into a laned move refuses on PH (`timelineAssignmentEdits.ts:33-44`).
- #961's preview rule (Enter places, Escape cancels) and #358's eight decisions, as quoted.
- #504 clears undo history on conversion.
