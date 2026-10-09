<!-- cspell:disable -->

# Defined coordinates: change catalog (branch `timeline/defined-coordinates`, fork PR #112)

Status: written 2026-10-09 against HEAD `e1cd9ea2`, compared with the fork's `timeline-try-2` tip
`5888850a` (the merge base: the branch already merged it in `97c8626b`). Source of truth for what
the branch changes before it merges into the app. Every entry is grounded in the code diff
(`git diff 5888850a e1cd9ea2`, 80 non-doc files); where the docs say something else, the entry says
so under **Doc vs code** and describes what the code does.

How to use this file:

- **Testers / QA:** section 5 is a runnable script per behavior; section 7 is what nobody has
  checked yet.
- **Docs writers:** section 2 has the exact strings and i18n keys; section 8 lists where the
  existing docs are stale.
- **Reviewers:** section 3 maps every changed file to the behaviors it carries.

Line numbers are at `e1cd9ea2`. "TL" = timeline mode (the file's timeline flag on), "PM" = page
mode (what every released user runs).

## Contents

1. [Summary](#1-summary)
2. [Behavior catalog](#2-behavior-catalog) (B-01 … B-35)
3. [File map](#3-file-map)
4. [Test map](#4-test-map)
5. [QA checklist](#5-qa-checklist)
6. [Data and compatibility](#6-data-and-compatibility)
7. [Coverage gaps](#7-coverage-gaps)
8. [Merge notes and doc discrepancies](#8-merge-notes-and-doc-discrepancies)

---

## 1. Summary

### The rule (ui.md UI-18, ADR 0001 C-12 amendment of 2026-10-08)

A marcher has a coordinate on a page only where the designer moved it there. Everywhere else it
holds where it last was (spec R-6). An edit carries forward, per marcher, to that marcher's next page
with its own move, and stops there.

### Scope by mode

| Mode                           | How the rule is implemented                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline mode** (dev flag)   | Already sparse (no move = hold). The branch stops every path that wrote rows on a page's behalf: page add/split/append holding moves, new-marcher stays, converter copies, set to previous/next stays, and no-op range writes. Delete page becomes the flag delete. Adds hold marks, an inspector line, Move them too, and new toast wording.                                                                                                                         |
| **Page mode** (released model) | Dense `marcher_pages` rows stay. An edit on page N also rewrites the following run of that marcher's rows that still equal the old position (within 1e-6), stopping at a different value, a page where the marcher is in a shape, or a row with its own pathway. Toast "Pages 3–4 followed (they were copies)" with **Only Page N**. Plus pre-existing fixes: new pages don't copy pathways, `pathways` is in undo history, undo focus works, followed pages refresh. |
| **Both**                       | Tag appearances on a deleted page move to the next page; hold marks on the page boxes for the selection; Move them too; selection box refits; Ctrl+A/Ctrl+S no longer nudge; one-line toast buttons; a pending page selection expires after 2 s.                                                                                                                                                                                                                      |

### What did NOT change

- **No schema change.** The only edit in `electron/database/migrations/schema.ts` is a comment on
  `tag_appearances.start_page_id` (the cascade stays; code now moves rows before it fires).
- **No file/user version change** and no migration. Existing files are read as they are.
- **The resolver (`@openmarch/core`) is untouched.** Positions at every flag of an unedited show are
  identical (real-app T7: max difference 0.0 across 8 files).
- **History format:** unchanged, except that `pathways` now has undo triggers (B-19).
- The `marcher_pages` rows stay frozen in timeline mode (P9.5).

### Owner decisions (all 2026-10-08 unless noted)

| #   | Decision                                                                                                                                                                         | Where recorded                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Sparse model adopted; amend ADR 0001                                                                                                                                             | README Decisions; ADR 0001 amendment |
| 2   | Page mode carries edits forward now, per marcher, with a tolerance, with Only Page N and the pre-existing fixes; no schema change                                                | README Decisions                     |
| 3   | Delete page in timeline mode keeps later pages' look (flag delete); "Delete page and its moves" is explicit                                                                      | README Decisions                     |
| 4   | Lock here / Keep later pages deferred (no stored kind)                                                                                                                           | README Decisions                     |
| 5   | Delete page and its moves keeps tracks (layer > 0) inside the box ("I think no" to deleting them)                                                                                | README; V-149                        |
| 6   | Page-mode shape edits carry forward ("I think so")                                                                                                                               | README; V-148                        |
| 7   | After the persona study (08): carry-forward is shown by hold marks, not toasts; toasts only for surprises, shorter                                                               | ui.md UI-18; V-146                   |
| 8   | 2026-10-09: hold-mark tooltips and **Move them too** built at the owner's request (PR #112 comment); renumbered UI-18 (UI-15/16 went to timeline edges, UI-17 to transport keys) | PR comment only (see section 8)      |

---

## 2. Behavior catalog

Entry template: **Mode** · **Before** (`5888850a`) → **After** (`e1cd9ea2`) · **Strings** ·
**Edges** · **Code** · **Tests** · **Real-app** (scenarios in `~/om-capture/scenarios/`) · **V-row** ·
**Limits / open**.

Index:

| Group                        | IDs         |
| ---------------------------- | ----------- |
| Timeline writes              | B-01 … B-07 |
| Delete                       | B-08 … B-13 |
| Page mode carry-forward      | B-14 … B-17 |
| Page mode pre-existing fixes | B-18 … B-21 |
| Move them too                | B-22, B-23  |
| Toasts                       | B-24 … B-26 |
| Hold marks and inspector     | B-27 … B-30 |
| Focus, selection, keys       | B-31 … B-35 |

### Timeline writes

#### B-01 Adding, splitting or appending a page writes no timeline rows

- **Mode:** TL.
- **Before:** the page ripple's step 7 (`addHoldingMoves`) gave every new page a holding transition
  (one slot per assignment ending at the page start, destination = position there, in a timeline
  over the page), so pages 3–4 added after page 2 froze page 2's _then_ position. Editing page 2
  later left pages 3–4 at the old spot (the owner's report).
- **After:** a new page writes only page rows. Marchers with no move over it hold (R-6), so a later
  edit to an earlier page carries through it until the marcher's next own move. Applies to every
  add path: UI-9 **+** flag, page-timeline **+** (Alt+T, add last page), Split, page-mode add
  `createPages` in TL, append.
- **Strings:** none.
- **Edges:** deleting an added page nobody moved on leaves timeline rows alone; a page added over a
  stored timeline writes nothing into it; a page added after a move stolen from a longer track
  leaves the marcher on the track.
- **Code:** `db-functions/timelineRipple.ts` module comment (lines ~50–60) and
  `rippleTimelineToPageGridInTransaction` (:459), `addHoldingMoves` deleted; doc of statement order
  now ends at step 6.
- **Tests:** `timelineNoAutoStays.test.ts` › "owner scenario S1 … pages added by ${how}" (each add
  path), "a page's own move stops the carry", "adding a page after a move stolen from a longer
  track…"; `timelineRipple.test.ts` › "splitting a page: … the marchers hold through the new page",
  "adding a last page writes no timeline rows", "adding a last page over a stored timeline writes
  nothing into it", "deleting an added page nobody moved on leaves the timeline rows alone";
  `p910Adversarial.test.ts` (C-11 structure with pages that get no timeline).
- **Real-app:** `dc-tl.mjs` T1 (page-timeline +), `dc-tl-flag.mjs` T1 (UI-9 + flag), `ux-f1.mjs`.
- **V-row:** V-140.
- **Limits:** files from earlier dev builds keep their holding rows (section 6).

#### B-02 New marchers get a home and no moves

- **Mode:** TL.
- **Before:** `joinNewMarchersToTimelinesInTransaction` gave each new marcher a home and its own
  one-slot transition holding the home in **every** stored timeline (skipping partial overlaps), so
  it was frozen at home on every page even after a later move.
- **After:** `giveNewMarchersHomesInTransaction` writes only the home (same free-spot search: four
  steps in from the top left, down two steps at a time, side by side two steps apart). The marcher
  stands at home until moved; a move then carries forward.
- **Strings:** none.
- **Edges:** nested/duplicate/partly overlapping timelines: still no rows; several new marchers
  side by side; the `TimelineMarcherAddResult` lost `joined` and `skippedTimelineIds`.
- **Code:** `db-functions/timelineMarchers.ts:giveNewMarchersHomesInTransaction` (:85);
  `db-functions/marcher.ts:createMarchers` (call site, ~:226).
- **Tests:** `timelineMarchers.test.ts` › "gives the new marcher a home and no moves…", "a new
  marcher moved on page 2 stays there on every later page", "places several new marchers side by
  side…", "joins no stored timeline, even empty or nested ones…";
  `timelineMembershipAdversarial.test.ts` › "new marchers: join no stored timeline, nested 4 deep…",
  "a new marcher stands at home at every beat in a converted show";
  `useMarchersTimelineMode.test.ts` › "a create with no settings loaded follows the file's flag";
  `timelineNoAutoStays.test.ts` › "a new marcher moved on page 2 stays there on pages 3 and 4".
- **Real-app:** none dedicated.
- **V-row:** none (ADR rule).
- **Limits:** undo focus for the add is B-31.

#### B-03 Range writes that move nobody write nothing

- **Mode:** TL.
- **Before:** a range (window/page box) write wrote a row for every marcher given, even one left
  where it was, so align/distribute on a held page planted zero-motion moves that froze those
  marchers; a write that moved nobody still opened an undo step and could create a timeline.
- **After:** compared with the resolver within `SAME_POSITION_TOLERANCE = 1e-6` (per axis, canvas
  units):
  - a marcher not yet in the range's timeline and already at the destination at `range.end` gets
    no row;
  - a marcher already in the timeline gets no destination write if unchanged (`skipUnchanged`,
    `changedPlans`; shape-backed slots are always written);
  - when nobody moves, no timeline is created and **no undo step** is recorded (`NothingWritten`
    rolls the transaction back and returns the empty result).
- **Strings:** none.
- **Edges:** applies to `{kind:"range"}` targets only (canvas drag, nudge, align, distribute,
  inspector X/Y when the selection is a page box or window). `{kind:"timeline"}` (an isolated
  move) and `{kind:"home"}` writes still write unchanged values (see Doc vs code).
- **Code:** `db-functions/timelineMoves.ts`: `SAME_POSITION_TOLERANCE` (:126),
  `moveMarchersInTimelineInTransaction` `skipUnchanged` (:426), `changedPlans` (:549),
  `moveMarchersInRangeInTransaction` (:745), `NothingWritten`/`wroteSomething` (:962–:974),
  `moveMarchersInTarget` (:981).
- **Tests:** `timelineSparseWrites.test.ts` › "align on an inherited page writes no row for a marcher
  it leaves still…", "distribute writes no row for the endpoints it keeps", "a write that moves
  nobody creates no timeline and no undo step", "a marcher already in the window's timeline moved to
  where it is writes nothing for it"; `timelineMovesByTimeline.test.ts` › "opens no edit when
  nothing moves".
- **Real-app:** `dc-tl.mjs` T2 (align/distribute on held page 3, then edit page 2: only movers get
  rows).
- **V-row:** V-140 (indirectly).
- **Doc vs code:** ui.md UI-18 says "A write that leaves a marcher where it already is writes nothing
  for that marcher"; the code does that for range writes only.
- **Limits:** a row that _becomes_ zero-motion after an upstream edit is kept (07c §1 "auto-block").

#### B-04 A drag back onto the start of an own page move clears that move

- **Mode:** TL.
- **Before:** dragging a marcher away and back on page 3 left a zero-motion move: an invisible block,
  so page 3 no longer followed edits of page 2 (07c T2).
- **After:** on a range that is exactly a page box, a marcher's **own page move** (one-slot,
  shapeless transition in a timeline over exactly the box, assigned over the whole box, and the
  marcher's only row over any beat of the box) is deleted when the edit moves the marcher to where
  the box starts (and that differs from where it arrives now). Its timeline goes when left empty.
  The result's `cleared` lists them.
- **Strings:** none.
- **Edges (all tested):** the timeline is kept while other marchers are still in it; a zero-motion
  ending is **kept** in a window that isn't a page box, in a transition shared with other marchers,
  and where a track sits underneath (the marcher has more than one row over the box); an own
  zero-motion move left still by an edit (not moved back) isn't cleared.
- **Code:** `timelineMoves.ts`: `isPageBox`, `ownPageMoves` (:621), `clearOwnPageMoves` (:680), the
  `back` test inside `moveMarchersInRangeInTransaction` (~:780–:800).
- **Tests:** `timelineSparseWrites.test.ts` › "sparse timeline writes: a drag back clears the move"
  (6 tests).
- **Real-app:** none dedicated (not scripted).
- **V-row:** V-143.
- **Limits:** only exact page boxes; Pyware users may expect a zero-motion "stay" to be a deliberate
  block (deferred "Lock here").

#### B-05 Set to previous / next page work on held pages

- **Mode:** TL (page mode's Shift+P/N write goes through B-14 instead).
- **Before:** both wrote through `moveMarchersOnPage`, which needs a move ending at the page's end
  beat: on a held page (no row) **Set to next page** was refused (E-ARGS toast), and set to previous
  wrote a frozen copy.
- **After:** planned with `copyPagePositions` (resolver at the neighbor page's end beat), written
  over the selected page's box with the range writer (`neighborPageTarget`; homes on the first
  page) through `moveMarchersAndOfferFollowUp`:
  - **Next** (Shift+N selected, Ctrl+Shift+N all) moves each marcher to its next-page position on
    the page; works on held pages.
  - **Previous** (Shift+P, Ctrl+Shift+P) sends every marcher with `clearOwn`: each marcher's own
    move over the box is deleted (so the page follows earlier pages again), even one that already
    goes nowhere. A marcher whose move there is shared with others, or longer than the page, is
    written to its previous-page position instead (a stay over the box).
  - Like any range write it can show the pass-through or Move them too toast (B-23).
- **Strings:** unchanged success/error messages (`MESSAGES` in `setMarchersToNeighborPage.ts:62`).
- **Edges:** previous on a page that already follows writes nothing; page 0 → next sets homes;
  previous from the last page / next from the second-to-last; no resolver yet → error, no write;
  shape-backed transition switches to individual destinations; follow-the-leader into a shape is
  refused (E-T5).
- **Code:** `utilities/setMarchersToNeighborPage.ts:setMarchersToNeighborPage` (:84, `clearOwn`
  :163); `timeline/timelineCoordinateWrites.ts:copyPagePositions` (:303, new `targets`),
  `neighborPageTarget` (:340); `hooks/queries/useMarcherPages.ts:moveMarchersToNeighborPageMutationOptions`
  (renamed from `moveMarchersOnPageMutationOptions`); `RegisteredActionsHandler.tsx` (~:611).
- **Tests:** `timelineSparseWrites.test.ts` › set to next/previous block (6 tests, :453–:565);
  `timelinePageCopy.test.ts` › "next on a page the marcher only holds through moves it there…" and
  the existing flag-on suite; `timelineToastPaths.test.ts`; `RegisteredActionsHandlerModes.test.tsx`
  › "set all marchers to the previous page copies every position".
- **Real-app:** `dc-tl-flag.mjs` T3 (Ctrl+Shift+N on a held page: base refused, branch works).
- **V-row:** V-145 (previous).
- **Limits:** set to previous inside a longer move writes a stay (tested), which is a block.

#### B-06 The converter writes only positions that change

- **Mode:** TL conversion (convert on open, dev convert).
- **Before:** one transition per timed page with a slot for every marcher with a row, so copied
  pages became stays (38–61% of slots in real files).
- **After:** a marcher whose point on page N is **bit-for-bit** equal to where it already stands
  (its previous slot's point, or its home) gets no slot; a page where nobody moves gets no
  timeline, and that is **not** reported as a loss. Gap glides (P6.7) are compared the same way.
- **Edges:** exact comparison (not tolerance) so every flag's positions are unchanged; a page
  "back to the opening set" after real moves still gets slots (its point differs from the previous
  slot); a page copied from the one before converts to no rows.
- **Code:** `timeline/convert/planPageConversion.ts:planPageConversion` (:313; `lastPoint` :413,
  `planMoves` :417).
- **Tests:** `planPageConversion.test.ts` › "a marcher whose point is exactly where it already
  stands gets no slot (C-12)"; `p910Adversarial.test.ts` › "many pages … held pages" (9 → 7
  timelines), others; `timelineNoAutoStays.test.ts` › "converting copied pages writes rows only where
  marchers move, and every position stays the same".
- **Real-app:** `dc-t7.mjs` (8-file corpus; positions at every flag and 0.2/0.5/0.8 seeks: max
  difference 0.0; rows 56→48, 32→16 on shows with copies).
- **V-row:** none.
- **Limits:** cannot tell a stale copy (left by the old app) from a deliberate "same spot": both
  convert to a hold; already-stale pages stay stale (README finding 7).

#### B-07 Page-delete ripple: merged boxes and next-row clamp

- **Mode:** TL (every page delete that goes through `withTimelinePageRipple`: Delete page and its
  moves, Yank, page-mode `deletePages` in TL, beat deletes that remove a page).
- **Before:** `isPageMove` matched only a transition over **exactly** the page's beats. After a
  flag delete merged two boxes, the merged page held two such moves, neither matched, and the
  delete was refused (E-A3, "E-A3 fix" in commits).
- **After:**
  - `isPageMove`: shapeless, all assignments layer 0 covering the transition, `end ≤ page.end`, and
    (`end == page.end` **or** `start ≥ page.start`). All such moves in the box go.
  - **Clamp:** a row that would stretch (following the page before into the deleted box) past the
    marcher's next row at the same layer ends where that row starts instead (a track or a move
    crossing the deleted page's flag); the stretched move then arrives partway ("catches up").
- **Edges:** tracks (layer > 0) inside the box stay (owner decision 5); a move crossing the deleted
  page's **end** flag stays; a move that starts **before** the page and ends **at** its flag now
  matches `isPageMove` and is deleted (see Limits).
- **Code:** `db-functions/timelineRipple.ts:isPageMove` (:281), clamp in `planTimelineRipple`
  (:324, the `prev[1] = cur[0]` at :434).
- **Tests:** `pageDelete.test.ts` › "deleting a page with its moves after a flag delete" (6 tests),
  `timelineRipple.test.ts` › "tracks that aren't page moves".
- **Real-app:** `dc-tl-merge.mjs` (converted show: flag delete page 2, then delete the merged page
  with its moves, Ctrl+Z ×2).
- **V-row:** V-149.
- **Limits / open:** a user's cross-page window move that ends at the deleted page's flag, starts
  before its box, and sits at layer 0 (possible when drawn over held pages with no rows underneath;
  over stored moves it lands on layer 1 and stays) is now deleted with the page; not covered by a
  test.

### Delete

#### B-08 Timeline Delete page is the flag delete

- **Mode:** TL.
- **Before:** the timeline page box menu said **Delete page flag** (already a flag delete). The page
  timeline shown while editing beats (`PageTimeline`, focused component "timeline") ran **In Place**
  as `deletePages`, a ripple that deleted the page's moves, so later held pages snapped back.
- **After:** page box menu item renamed **Delete page** (same command). `PageTimeline` in TL: **In
  Place** runs `deletePageFlags` (later pages keep their look) and selects the next page (which took
  the box), else the previous page. Tooltip in TL: "Delete this page. Later pages keep their timing
  and look." (`timeline.page.contextMenu.deleteInPlaceTimelineTooltip`). Order in TL: In Place,
  With Its Moves, Yank. PM order unchanged (Yank, In Place).
- **Strings:** "Delete page" (hard-coded in `TimelineRangeMenu.tsx:294`, not i18n);
  `deleteInPlaceTimelineTooltip` (en.json).
- **Edges:** last page (no next page): the page before becomes last (`last_page_counts`), selection
  goes to the previous page; a deleted page's tag appearances move (B-13); no toast.
- **Code:** `components/timeline/TimelineRangeMenu.tsx` (~:285–:310);
  `components/timeline/PageTimeline.tsx:handleDeletePage` (:309), menu (:605–:618);
  `TimelineModePanel.tsx` `onDeletePageFlag` → `selectAfterDelete`.
- **Tests:** `TimelinePageFlagControls.test.tsx` › "Delete page on a page box (UI-9)" (3 tests),
  "the selection after deleting a flag (lead decision)"; `TimelineMoveMenu.test.tsx` › "keeps Delete
  page alone on a page box…"; `pageDelete.test.ts` › "Delete page (the flag delete) keeps every later
  page's look" (2 tests).
- **Real-app:** `dc-tl.mjs` T4 (page box menu, page timeline In Place), `dc-tl-flag.mjs` T4.
- **V-row:** V-142.
- **Limits:** the deleted page's move now ends between flags (the next page's box covers both).

#### B-09 Delete page and its moves (explicit command)

- **Mode:** TL.
- **Before:** not offered (the page timeline's In Place/Yank did this silently, without a report).
- **After:** page box right-click menu: **Delete page and its moves** (red, trash icon, after Delete
  page). Page timeline (beat editing) menu: **With Its Moves** (TL only), and **Yank** in TL now uses
  the with-moves variant with the same report. Runs the page-mode delete through the timeline
  ripple as one undo step (`deletePagesWithMoves` / `deletePageYankWithMoves`), so the page's page
  moves go (B-07) and marchers that only held on later pages fall back. Toast: B-10. Selection
  after (page box menu): if the deleted page was selected, the box now covering it (previous page's
  box running to the deleted flag; after home, the next page's box); otherwise unchanged
  (`selectionAfterDeleteWithMoves`). Page timeline: selects the previous page.
- **Strings:** "Delete page and its moves" (hard-coded, `TimelineRangeMenu.tsx:309`); "With Its
  Moves" `timeline.page.contextMenu.deleteWithMoves`; tooltip "Delete this page and its moves. Later
  pages that held its positions change." `…deleteWithMovesTooltip`.
- **Edges:** home is skipped (deleting only home writes nothing); page 1 right after home: the next
  page takes its box; tracks stay (B-07); in PM `deletePagesWithMoves` deletes like Delete page and
  reports no look (`changedPages` always empty outside TL).
- **Code:** `db-functions/pageDelete.ts:deletePagesWithMoves` (:241), `deletePageYankWithMoves`
  (:289), `deleteAndCompare` (:162); `db-functions/page.ts:deletePageYankInTransaction` (:646,
  extracted from `deletePageYank`); `hooks/queries/usePageFlags.ts` (:93, :109);
  `TimelineModePanel.tsx` (:371, `selectionAfterDeleteWithMoves` :507);
  `PageTimeline.tsx:handleDeletePageWithMoves` (:328), `handleDeletePageYank` (:339).
- **Tests:** `pageDelete.test.ts` › "Delete page and its moves" (8 tests incl. yank, page 1, undo,
  page mode, home); `TimelinePageFlagControls.test.tsx` › "Delete page and its moves on a page box"
  (2), "the selection after Delete page and its moves" (3).
- **Real-app:** `dc-tl.mjs` T4, `dc-tl-flag.mjs` T4, `wp8-f5.mjs`, `ux-f5.mjs`.
- **V-row:** V-142, V-149.
- **Limits:** not run with the deleted page itself selected in the real app (section 7).

#### B-10 The delete-with-moves toast, with Undo

- **Mode:** TL.
- **After:** `toast.success`, 10 s: "Deleted Page 2 · Page 1 is now 32 counts · old Pages 3–4
  changed", with **Undo** (runs the app's normal undo, `usePerformHistoryAction("undo")`).
  - Parts: "Deleted Page N" / "Deleted Pages 2, 4"; one "… is now N counts" per page that grew;
    "Pages X–Y changed" for unrenamed pages and "old Pages X–Y changed" for renumbered ones, joined
    with " and "; or "No other page changed".
  - Page names are the **pre-delete** names (with the file's page number offset); runs of
    consecutive pages collapse to "3–5", others join with ", " (`pageRunsLabel`).
  - A page counts as changed when any marcher's resolved position at its own flag differs by more
    than 1e-6 from before (each page compared with its own flag before; home never).
  - No toast when nothing was deleted; no action when no undo callback is given.
- **Strings:** composed in English in `pageDeleteWithMovesMessage` (not i18n); action label
  `fileTab.undo` ("Undo").
- **Code:** `pageDelete.ts:changedFlagPageIds` (:129), `pageRunsLabel` (:318),
  `pageDeleteWithMovesMessage` (:349); `usePageFlags.ts:toastDeleteWithMoves` (:72).
- **Tests:** `pageDelete.test.ts` › "pageRunsLabel and the toast" (2), "owner S4: … the toast names
  every page whose flag changed", "a page no one moved on: … the toast says so", "a converted show
  with copied pages: reports exactly the flags that look different";
  `usePageFlags.deleteToast.test.ts` (2).
- **Real-app:** `dc-tl-flag.mjs` T4 (string + Undo), `wp8-f5.mjs`.
- **V-row:** V-142 (wording is a lead default from study 08).
- **Limits:** the Undo button is not invalidated by a later edit (unlike Delete move's toast, which
  closes on the next history change); clicking it after another edit undoes that edit instead.

#### B-11 The view stays on the merged page after a delete

- **Mode:** TL.
- **Before:** when the selected page was deleted, `StateInitializer` selected `pages[0]` (home),
  which moved the playhead to beat 0 and showed an "empty" field (study 08 bug 3).
- **After:** with no selected page in TL, it selects the page at the paused playhead
  (`pageAtPlayhead`), i.e. the page that took the deleted page's box; PM still selects the first page.
- **Code:** `components/singletons/StateInitializer.tsx` (~:76–:89).
- **Tests:** none direct (the selection helpers in B-08/B-09 are unit-tested).
- **Real-app:** `wp8-f5.mjs` (lands on merged page), `wp8-probe-f5.mjs`.
- **V-row:** none.
- **Limits:** the PR's "not scripted: delete when the deleted page itself is selected" still holds.

#### B-12 Delete move names the pages that change

- **Mode:** TL (UI-14's Delete move, merged from #106).
- **Before:** "Deleted Move 2" + Undo (8 s).
- **After:** marchers that held after the move fall back, so the toast appends the pages whose own
  flag now looks different: "Deleted Move 2 · Pages 2–3, 5 changed" ("Page 4 changed" for one).
  Undo and the close-on-next-history-change rule are unchanged.
- **Strings:** English in `moveDeletedMessage` (not i18n); "Undo" hard-coded there.
- **Code:** `db-functions/timelineCommands.ts:deleteTimelineAndCompare` (:550, uses
  `pageDelete.ts:changedPagesAround` :218); `components/timeline/useTimelineCommands.ts:moveDeletedMessage`
  (:170), `toastMoveDeleted` (:185), call (:292).
- **Tests:** `timelineMoveThemToo.test.ts` › "the delete-move toast: appends the pages that changed,
  as runs", "deleting a move names the pages that changed: later pages that held from it fall back…".
- **Real-app:** none (PR comment: "tests only, no screenshot").
- **V-row:** none.

#### B-13 Tag appearances move to the next page on any page delete

- **Mode:** both.
- **Before:** `tag_appearances.start_page_id` cascaded: a deleted page's appearances were lost, so
  later pages lost that tag look.
- **After:** before page rows go, each appearance on a deleted page moves to the next page that is
  not being deleted. Dropped when: that page already has one for the same tag (UNIQUE), or there is
  no later page. Of several deleted pages with the same tag, the latest (nearest the kept page) wins.
  Same transaction → one undo restores both. Tag queries are invalidated after every delete.
- **Paths:** PM `deletePages` and Yank (via `deletePagesInTransaction`), TL flag delete
  (`deletePageFlagsInTransaction`), TL Delete page and its moves / Yank.
- **Code:** `db-functions/tagAppearancePageDelete.ts:moveTagAppearancesOffPagesInTransaction` (:37);
  `page.ts:deletePagesInTransaction` (:547); `pageFlags.ts:deletePageFlagsInTransaction` (:251);
  `usePages.ts` (:219, :237), `usePageFlags.ts` (:64, :102, :117).
- **Tests:** `pageDelete.test.ts` › "tag appearances survive a page delete" (per path: "moves to the
  next page; one undo puts it back", "is dropped where the next page has its own…", "is dropped with
  the last page"; "several pages at once…", "several flags at once, in timeline mode", 2 history
  tests); `pageFlagsAdversarial.test.ts` › "a tag appearance on a deleted page moves to the next page,
  and undo restores it".
- **Real-app:** none.
- **V-row:** none.

### Page mode carry-forward

#### B-14 Page-mode edits carry forward through equal copies

- **Mode:** PM.
- **Before:** a page-mode write changed only the given rows; pages copied from it kept the old
  position (the owner's bug in page mode).
- **After:** `updateMarcherPagesInTransaction` (default `carryForward: true`): an edit that moves a
  marcher on page N from `v` to `w` also rewrites that marcher's later rows, in page (start beat)
  order, while they still equal `v` within `COORDINATE_TOLERANCE = 1e-6` (per axis, pixels). The run
  stops at the first later row that:
  - is somewhere else (the marcher's own move: recorded as an `OwnMoveStop`, B-22), or
  - is a page where the marcher is in a shape (`shape_page_marchers`), or
  - has its own pathway (`path_data_id` not the previous row's); that row's pathway **start** moves
    to `w`.
- **Also:** followed rows lose their copied pathway (`path_data_id = null`); writes are batched
  (500 ids); per marcher, so other marchers are untouched.
- **Which edits carry:** every `updateMarcherPages` caller: canvas drag, nudge, align, distribute,
  inspector X/Y, **swap** (both marchers), **set to previous/next page in PM** (Shift+P/N write
  through `updateMarcherPages`), shape edits (B-17), the new-show "previous dots" import onto the
  first page (`newShowCompletion.ts:323`), and Move them too (B-22).
- **Edges:** owner scenario fixed; "back to the opening set" (page 4 = page 1 after real moves)
  doesn't follow an edit of page 1; a marcher standing still for 41 pages moves on all of them; a
  page inserted inside a run joins it; deleting a copy inside a run keeps the run; the last page
  carries nowhere.
- **Code:** `db-functions/marcherPage.ts`: `COORDINATE_TOLERANCE`/`sameCoordinate` (:147–:150),
  `updateMarcherPagesInTransaction` (:317), `updateMarcherPages` (:540), result type
  `MarcherPagesWriteResult`.
- **Tests:** `marcherPageCarryForward.test.ts` › "page mode carries an edit forward" (owner
  scenario, back to the opening set, 41 pages, merge leak, tolerance, shape stop, carryForward:false,
  swap, inserting/deleting pages, pathways, undo/redo, 200×100 timing).
- **Real-app:** `dc-page.mjs` P1 (DB and field), P3 (undo/redo), P4 (playback mid page 3 holds);
  `dc-page-p56.mjs` P5–P6; `wp7-page.mjs`, `wp10-page.mjs`, `ux-f4.mjs`, `wp8-f4.mjs`.
- **V-row:** V-140, V-141.
- **Limits / open:**
  - **Merge leak** (known, tested): equality can't tell a copy from a page moved onto the same spot
    on purpose; such a page follows too. Way back: Only Page N, undo.
  - Undo cost: 200 × 100 edit 0.45–0.72 s, undo 2.3–4.0 s (logged, not asserted).
  - PM set to previous/next and the new-show import carrying forward are not separately tested.

#### B-15 Page-mode no-op writes are skipped (no undo step)

- **Mode:** PM.
- **Before:** every write, even one equal to the stored value, was written and opened an undo step.
- **After:** `updateMarcherPages` drops writes that change only x/y within 1e-6
  (`withoutNoOpWrites`); if none are left, no transaction and no undo step. Inside a transaction, a
  skipped write cannot break a later carry; if every write was skipped there, the first is written
  anyway so the caller's undo group isn't empty.
- **Edges:** a write that also changes another field (notes, pathway) is never skipped; fabric's
  ~1e-14 drift on a selection drag is ignored.
- **Code:** `marcherPage.ts:withoutNoOpWrites` (:509), skip logic in
  `updateMarcherPagesInTransaction` (~:345–:350, fallback ~:470).
- **Tests:** `marcherPageCarryForward.test.ts` › "a write within the tolerance is skipped, and drift
  doesn't break a run"; `timelineCoordinateWrites.test.ts` › "align vertically, flag off" (now
  `toBeCloseTo`).
- **Real-app:** `dc-page-p56.mjs` P6 (full `marcher_pages` dump equals base).
- **V-row:** none.

#### B-16 Page-mode toast: "Pages 3–4 followed (they were copies)" with Only Page N

- **Mode:** PM.
- **After:** after a write that carried, `toast.message` (no icon), 10 s, id `timeline-edit`:
  - "Pages {first}–{last} followed (they were copies)" (`marcherPages.carryForward.pages`) or "Page
    {page} followed (it was a copy)" (`…onePage`); first/last aggregated over all marchers.
  - Action **Only Page {page}** (`…only`) when one page was edited, **Only the edited pages**
    (`…onlyEdited`) otherwise. It runs `restoreCarriedRuns`: a **second** undoable edit that puts
    the followed rows back where they were (rows that changed since are left alone), restores the
    next page's pathway start, and refreshes those pages.
  - Not shown when nothing carried, or when the write also left own moves behind (then the Move
    them too toast is shown instead, without Only Page N; B-22).
- **Edges:** Ctrl+Z after Only Page 2 undoes only the restore (pages follow again); a second Ctrl+Z
  undoes the edit.
- **Code:** `utilities/carryForwardToast.ts:carryForwardMessage` (:48), `toastCarryForward` (:102);
  `marcherPage.ts:restoreCarriedRuns` (:617); wired in `useMarcherPages.ts` (:152, :217, :375).
- **Tests:** `marcherPageCarryForward.test.ts` › "Only Page N puts the followed pages back as its own
  undoable edit", "Only Page N leaves a page alone that changed since", "Only Page 2 (no carry) leaves
  a shared pathway's start alone", `carryForwardMessage` (3).
- **Real-app:** `dc-page.mjs` P2 (toast text, Only Page 2, Ctrl+Z after it), `wp8-f4.mjs`, `ux-f4.mjs`.
- **V-row:** V-141.
- **Doc vs code:** README Recommendation says Only Page N "redoes the edit without carrying it
  forward"; the code restores the followed rows as a separate edit (same end state, two undo steps).
- **Limits:** study 09: users didn't know what Only Page 2 would do; with a partial follow the toast
  doesn't say "6 of 8 followed" (09 rec. 2, not built).

#### B-17 Page-mode shape edits carry forward, without a toast

- **Mode:** PM.
- **After:** shape edits write through `updateMarcherPagesInTransaction` (`shapePages.ts:156`), so
  they carry to later copies where the marcher isn't in a shape. No toast (the shape mutations don't
  call `toastCarryForward`). Shape mutations and new shapes invalidate every marcher-page, pathway
  and coordinate query (`invalidateAllMarcherPages`).
- **Code:** `db-functions/shapePages.ts` (:156, unchanged call, new default);
  `hooks/queries/useShapePages.ts` (:122, :165); `canvasObjects/MarcherShape.ts` (:276);
  `sharedInvalidators.ts:invalidateAllMarcherPages` (:73).
- **Tests:** `marcherPageCarryForward.test.ts` › "a shape edit carries forward to later pages that
  aren't in a shape (lead default)", "a page where the marcher is in a shape stops the run".
- **Real-app:** none.
- **V-row:** V-148.

### Page mode pre-existing fixes

#### B-18 A new page doesn't copy the previous page's pathway; a shared one is detached on edit

- **Mode:** PM.
- **Before:** `_createMarcherPages` copied `path_data_id`, `path_start_position`, `path_end_position`
  onto the new page, so the copy replayed the previous page's curve and editing either page bent the
  other's curve.
- **After:** the new page copies x, y, notes only (holds). Editing a row whose pathway equals the
  previous row's (a copy from older files) writes `path_data_id = null` on it instead of moving that
  pathway's end, so the previous page's curve is untouched.
- **Code:** `db-functions/page.ts:_createMarcherPages` (:193, comment :219);
  `marcherPage.ts:updateMarcherPagesInTransaction` (`sharesPreviousPathway`).
- **Tests:** `marcherPageCarryForward.test.ts` › "pathways" (5 tests).
- **Real-app:** none.
- **V-row:** none.

#### B-19 `pathways` is in undo history

- **Mode:** PM (table also exists in TL files).
- **Before:** pathway end moves weren't recorded; undo restored marcher pages but not curve ends.
- **After:** `schema.pathways` added to `tablesWithHistory`; undo triggers are created for it, also
  in existing files that lack them.
- **Code:** `db-functions/historyTriggers.ts` (:22).
- **Tests:** `marcherPageCarryForward.test.ts` › "undo puts back every carried row and both pathway
  ends in one step; redo reapplies", "a file without pathway history triggers gets them".
- **Real-app:** none.

#### B-20 Page-mode undo/redo goes to the earliest changed page and selects its marchers

- **Mode:** PM.
- **Before:** `rowIdFromSql` parsed `match[0]` ("WHERE rowid=5") → NaN, so no changed page was found
  and undo/redo never moved the page or selection; the intended rule picked the highest page id.
- **After:** `rowIdFromSql` reads the capture group; `earliestChangedPage` (one query per 500 rows)
  picks the page with the lowest start beat among changed `marcher_pages` rows and selects the
  marchers changed on it.
- **Code:** `db-functions/history.ts:rowIdFromSql` (:982), `earliestChangedPage` (:990),
  `performHistoryAction` (:1064).
- **Tests:** `marcherPageCarryForward.test.ts` › "rowIdFromSql reads the row id";
  `RegisteredActionsHandlerModes.test.tsx` › "undo restores a nudge, goes back to its page and
  selects the moved marchers"; `timelineHistoryFocus.test.ts` › "with the flag off, the page-mode
  rule applies…".
- **Real-app:** `dc-page.mjs` P3 (undo/redo restores pages 2–4).
- **V-row:** V-148 ("is the jump on undo welcome?").
- **Limits:** a user-visible change for all page-mode users (undo now jumps pages); study 09 listed
  "Undo jumps to another page" as a base complaint.

#### B-21 Followed pages and pathways refresh after a page-mode write

- **Mode:** PM.
- **Before:** only the written page's queries were invalidated, so followed pages showed stale
  positions until reloaded.
- **After:** `invalidateAfterMarcherPagesWrite`: written pages + followed pages + pages whose pathway
  end moved, plus every carried marcher's `byMarcher` query and all pathway queries. Used by update,
  swap, selected-marchers update, Only Page N, Move them too.
- **Code:** `hooks/queries/sharedInvalidators.ts:invalidateAfterMarcherPagesWrite` (:49);
  `useMarcherPages.ts` (:147, :212, :374).
- **Tests:** indirect (`PageHoldMarks.test.tsx` page strip after an edit).
- **Real-app:** `dc-page.mjs` P1 (field shows page 2's positions on pages 3–4).

### Move them too

#### B-22 Move them too, page mode

- **Mode:** PM.
- **Before:** not present (proposed by study 09, G4).
- **After:** when a write moved marchers whose run stopped at a later page that is somewhere else
  (their own move; not a shape page, and not a page the same write also edits for that marcher), a
  toast (`toast.info`, 10 s, id `timeline-edit`) names them in drill order and replaces the
  "followed" toast:
  - one page, one marcher: "{names} has its own move on Page {page}, so it kept its spot"
    (`marcherPages.moveThemToo.oneMarcher`);
  - one page, several: "{names} have their own move on Page {page}, so they kept their spot"
    (`…onePage`);
  - several pages: "{names} have their own later moves, so they kept their spots" (`…laterMoves`);
  - names: "OT1", "OT1 and OT8", "OT1, OT2 and OT3", past three "{first}, {second} and {count}
    others" (`…namesAndOthers`; the "and" lists are English-only).
  - Action **Move them too** (`…action`) → `moveLaterMovesToo`: shifts each stop row by the offset
    the edit moved that marcher (read from where the stop is **now**), as its own undo step; it
    carries forward to copies of the stop page; rows that are gone are skipped.
- **Edges:** no toast for an edit that moves nobody / only within tolerance, for Only Page N
  (`carryForward:false`), or for undo; a stop on a shape page isn't listed.
- **Code:** `marcherPage.ts` (`OwnMoveStop`, stop recording in the carry loop, filter at end of
  `updateMarcherPagesInTransaction`; `moveLaterMovesToo` :580); `carryForwardToast.ts:toastMoveThemToo`
  (:145); `utilities/moveThemToo.ts` (`moveThemTooMessage` :67, `marcherNamesList` :45).
- **Tests:** `moveThemToo.test.ts` › "the message" (3), "page mode: Move them too" (6).
- **Real-app:** screenshots only, `~/ux-study/wp11/pm*` via `ux-replay.mjs` (no assertions).
- **V-row:** **none** (see section 8).
- **Limits / open (important):** the stop is recorded whenever the next differing row exists. In a
  fully written show, where every page has its own positions, **every ordinary page-mode drag or
  nudge** shows this toast naming each moved marcher. That contradicts V-146 "ordinary edits and
  nudges are silent" (the P6 "no toast" checks ran before wp11). Needs an owner decision and a test.

#### B-23 Move them too, timeline mode

- **Mode:** TL.
- **After:** every canvas/coordinate edit and set to previous/next goes through
  `moveMarchersAndOfferFollowUp`: positions at the edit's end beat are read just before the write
  (`onStart`), and after the resolver settles, for each moved marcher whose offset exceeds 1e-6, its
  **next own move** (first non-hold span ending after the edit end) is taken if it starts at or after
  the edit end and **ends on a page flag**; shape-backed transitions are dropped. Same strings and
  10 s toast as B-22, same id, so it **replaces** the pass-through toast. **Move them too** →
  `shiftSlotDestinations`: each slot's destination moves by the offset, one undo step; later pages
  holding from it follow.
- **Edges:** next move ending between flags → not offered; next page holds → nothing; within
  tolerance → nothing; edits of homes (beat 0) and isolated moves (`editEndBeat`) are handled;
  errors finding them are logged, never thrown (the edit has committed).
- **Code:** `timeline/timelineMoveThemToo.ts` (`readEditStart` :74, `laterOwnMoves` :98,
  `findLaterOwnMoves` :154, `toastLaterOwnMoves` :192, `moveMarchersAndOfferFollowUp` :226);
  `timelineMoves.ts:shapeBackedTransitionIds` (:1054), `shiftSlotDestinations` (:1084), `onStart`
  in `moveMarchersInTarget`; wired from `timelineCoordinateWrites.ts:transformMarchersInSelection`
  (:244) and `useMarcherPages.ts` mutations.
- **Tests:** `timelineMoveThemToo.test.ts` › "timeline mode: Move them too" (6 tests incl. "with a
  window passing a flag, the one toast becomes Move them too (same id)").
- **Real-app:** screenshots only, `~/ux-study/wp11/tl*` (`ux-replay.mjs`).
- **V-row:** none.
- **Limits / open:** same as B-22: on a converted show every page has a move per marcher, so nearly
  every edit offers it. When both apply, the pass-through toast's **Keep as a stop** becomes
  unreachable (replaced by id).

### Toasts

#### B-24 Pass-through toast: "Page 3 is no longer a stop" · Keep Page 3 as a stop

- **Mode:** TL.
- **Before:** shown only when the drag overrode or ran into stored moves, naming marchers ("OT1, OT2,
  OT3, OT4 and 4 others now move straight through Page 3."); action "Only change Page N" / "Only
  change from Page N's set" / "Only change from beat N"; no id, 10 s.
- **After:** the range write reports every page flag strictly inside the range (`flags`), and every
  added marcher passes them, stored moves or not. Toast (`toast.info`, id `timeline-edit`, 10 s with
  an action, 6 s without):
  - "Page {page} is no longer a stop" / "Pages {first}–{last} are no longer stops" / "The sets
    inside this move are no longer stops" (flag with no named page) (`timeline.edit.passThrough.noLongerStop.*`);
  - no flag inside (crossed only moves): "Moves straight through {through}, then catches up to
    {caughtUp}'s set" / "Moves straight through {through}" / "Catches up to {caughtUp}'s set by its
    end" (`…throughAndCatchUp`, `…through`, `…catchUp`);
  - action "Keep Page {page} as a stop" / "Keep Pages {first}–{last} as stops" / "Keep them as stops"
    (`…keepStops.*`): `moveMarchersFromFlagInstead` from the last flag inside (unchanged
    semantics), and **the window follows** to `[flag, end)` when it was still on the drag's range
    and nothing is isolated; the result may toast again.
- **Edges:** a window inside one page passes no flag and says nothing; a marcher already in the
  window's timeline passes nothing; a window the user left keeps its selection; Keep works with no
  rows underneath.
- **Code:** `timeline/timelinePassThrough.ts` (`passedPages` :75, `passThroughMessage` :91,
  `keepStopsLabel` :140, `keepPassedFlagsAsStops` :173, `toastPassThrough` :198);
  `timelineMoves.ts` `TimelinePassThrough.flags`.
- **Tests:** `timelinePassThrough.test.ts` (5); `timelineSparseWrites.test.ts` › "the pass-through
  toast" (3); `timelineCarryForward.test.ts` › "a window passing a flag says only…", "Keep as a stop
  restores the passed flag, and the window follows…", "a window the user has left keeps its
  selection…"; `timelineMovesByTimeline.test.ts` › the "Start from Page N" tests (named after an
  earlier label).
- **Real-app:** `dc-tl-flag.mjs` T5 (+ "(e) Keep Page 3 as a stop": flag 3 shows page 3's set again),
  `wp8-f2.mjs`, `ux-f2.mjs`.
- **V-row:** V-144.

#### B-25 Ordinary timeline edits show no toast

- **Mode:** TL.
- **Before:** none existed in the base either; the branch's first build (wp5) added "Also moves Pages
  3–4 · stops at Page 5", removed in wp8.
- **After:** no carry-forward toast. `editCarryForward`/`summarizeCarryForward` remain in
  `timelineCarryForward.ts` but have **no production caller** (tests only).
- **Tests:** `timelineCarryForward.test.ts` › "an ordinary edit that carries forward shows no toast"
  (checks `toastPassThrough` only, not Move them too).
- **Real-app:** wp8 scenarios; `dc-page-p56.mjs` P6 (page mode).
- **V-row:** V-146.
- **Limits:** see B-22/B-23: Move them too can still fire on ordinary edits.

#### B-26 Toast action buttons stay on one line

- **Mode:** both (global `Toaster`).
- **After:** `content: min-w-0 flex-1`; `actionButton`: `shrink-0 self-center whitespace-nowrap
rounded-6 px-8 py-4 text-body text-accent hover:underline` + focus-visible ring. Affects every
  toast with an action in the app.
- **Code:** `components/ui/Toaster.tsx` (:20–:24).
- **Tests:** `Toaster.test.tsx` › "keeps an action's label on one line, with a focus ring".
- **Real-app:** wp8/ux screenshots.

### Hold marks and inspector

#### B-27 Hold marks on the timeline's page boxes

- **Mode:** TL.
- **After:** with marchers selected, each page box after home shows, for the selection:
  - **moves** (every selected marcher with a state has its own move ending in the box,
    `(previous flag, flag]`): a 10×7 px diamond at the bottom right (`data-hold-mark="moves"`);
  - **holds** (every one holds): a 3 px bar along the bottom, subtitle color;
  - **mixed**: the same bar, dashed (4 px on, 3 px off).
  - Marchers partway through a move at the flag count as neither; nothing when none has a state.
    Nothing without a selection. Computed per selection, page list and resolver version (not per
    playback frame). Never takes the pointer.
- **Code:** `timeline/pageHoldMarks.ts` (`timelineMarcherPageStates` :70, `classifyPage` :141);
  `timeline/usePageHoldMarks.ts:useTimelineHoldMarks` (:39); `components/timeline/PageHoldMark.tsx`
  (`PageHoldMarkView` :35); `TimelinePrimitives.tsx` (`TimelinePageBox`), `TimelineModePanel.tsx`
  (:329), `Timeline.tsx`, `TimelineVariants.tsx`, `TimelineViewModel.ts`.
- **Tests:** `pageHoldMarks.test.ts` (pure: 15; resolver: "owner scenario: … until undo");
  `PageHoldMarks.test.tsx` › "the timeline's page boxes" (2).
- **Real-app:** `wp7-tl.mjs`, `wp10-tl.mjs`.
- **V-row:** V-146.
- **Limits:** first-time users didn't notice them unprompted (09); "show for the whole band with no
  selection" is an open owner question.

#### B-28 Hold marks on page mode's page strip

- **Mode:** PM (`PageTimeline`; disabled in TL's beat-editing view).
- **After:** same marks; a marcher holds on a page whose position equals the previous page's within
  1e-6 (since the page it last moved on); a page without a row is unknown and breaks the run. Reads
  every page's marcher rows (one query per page) only while something is selected.
- **Code:** `pageHoldMarks.ts:pageModeMarcherPageStates` (:107); `usePageHoldMarks.ts:usePageModeHoldMarks`
  (:77); `PageTimeline.tsx` (hold marks wiring ~:90–:110, box ~:440–:520).
- **Tests:** `pageHoldMarks.test.ts` › "one marcher's states, page mode" (4);
  `PageHoldMarks.test.tsx` › "page mode's page strip: owner scenario…".
- **Real-app:** `wp7-page.mjs`, `wp10-page.mjs`.
- **V-row:** V-146.
- **Limits:** page-mode "holds" means "equal to the previous page", so a deliberate move back onto the
  same spot reads as a hold (same blind spot as B-14); query fan-out on 100+ page shows not measured.

#### B-29 Hold-mark tooltips and accessible descriptions

- **Mode:** both.
- **Before:** native `title` only (wp7), invisible to headless capture.
- **After:** a Radix tooltip above the box (`HintTooltip`: 500 ms hover delay, 300 ms skip delay,
  opens on keyboard focus; a press closes it and keeps it closed until the pointer leaves, so
  clicks, scrubs, drags and right-clicks are undisturbed; no tooltip without a mark). Label + hint:

  | Mark  | Label (key `timeline.holdMarks.*`)                                                                                                                  | Hint                                                                                                                      |
  | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | moves | "Selected marchers move on this page" (`moves`)                                                                                                     | "They have their own move here" (`movesHint`)                                                                             |
  | holds | "Selected marchers hold from Page {page}" (`holds`) · "…hold from the start" (`holdsFromStart`) · "…hold on this page" (`holdsHere`, mixed origins) | "They stand where Page {page} left them" · "They stand where they started" · "They stand where their last move left them" |
  | mixed | "Some selected marchers hold from Page {page}" (`mixed`) · "…from the start" (`mixedFromStart`) · "…on this page" (`mixedHere`)                     | "Some have their own move here" (`mixedHint`)                                                                             |

  The box gets `aria-describedby` pointing at an `sr-only` span "{label}. {hint}".

- **Code:** `components/timeline/HintTooltip.tsx` (:15, :34); `PageHoldMark.tsx` (`HoldMarkTooltip`
  :89, `useLabeledHoldMarks`); `pageHoldMarks.ts` (`pageHoldMarkLabel` :197, `pageHoldMarkHint`
  :243).
- **Tests:** `PageHoldMarks.test.tsx` › "the hold mark's tooltip on the timeline's page boxes" (6);
  `pageHoldMarks.test.ts` › "words each mark…", "gives each mark a hint line…".
- **Real-app:** `wp10-tl.mjs`, `wp10-page.mjs`.
- **V-row:** none (V-146 covers the marks, not the tooltips).
- **Limits:** `HintTooltip` is a stand-in for transport-keys' `ShortcutTooltip` (section 8).

#### B-30 Inspector line: "Hold from Page 2 →" / "Moves on this page"

- **Mode:** TL only (renders nothing in PM).
- **After:** in the marcher inspector, under Step Size (single selection) and in the multi-select
  panel: for the selected page (which follows the paused playhead):
  - "Moves on this page" (plain text) when a move of each marcher's own ends in the page's box;
  - "Hold from Page {page}" or "Hold from the start" with an arrow, an underlined button; title
    "Go to Page {page}" / "Go to the start"; click seeks the playhead to that page's flag;
  - nothing on the first page, partway through a move passing the flag, off a flag, with no
    selection, or when the selection disagrees.
- **Strings:** `inspector.marcher.timeline.movesOnThisPage`, `holdFrom`, `holdFromStart`,
  `goToPage`, `goToStart`.
- **Code:** `components/inspector/TimelineHoldLine.tsx` (`useSelectionHoldState` :27);
  `timeline/timelineHoldState.ts` (`marcherHoldState` :36, `sharedHoldState` :61);
  `MarcherEditor.tsx` (:784, :1039).
- **Tests:** `TimelineHoldLine.test.tsx` (6); `timelineHoldState.test.ts` (7);
  `pageHoldMarks.test.ts` › "agrees with the inspector's marcherHoldState on every page".
- **Real-app:** `dc-tl.mjs` T6, `wp8-f3.mjs`, `ux-f3.mjs`, `wp10-tl.mjs` ("Hold from the start").
- **V-row:** V-147.
- **Limits:** the inspector doesn't follow playback (base); no PM equivalent.

### Focus, selection, keys

#### B-31 Undoing "add marcher" keeps the current page

- **Mode:** TL.
- **Before:** a marcher insert/delete in a change batch belonged to the first page, so undo/redo of
  an add jumped to page 1 (home).
- **After:** a marcher row inserted or deleted by the action belongs to the current page (first page
  when none); home-only changes still belong to the first page.
- **Code:** `db-functions/timelineHistoryFocus.ts` (`addedOrRemovedMarchers` :93/:129, `changedPages`
  :170/:215, `timelineHistoryFocus` :264).
- **Tests:** `timelineHistoryFocus.test.ts` › "a marcher add: undo and redo stay on the current page
  and select the new marcher".
- **Real-app:** none.

#### B-32 A page selection waiting for its page expires after 2 s

- **Mode:** both.
- **Before:** `setSelectedPageFromId` for a page not in the list was dropped with a warning (unless
  the list was empty); a page restored by undo and selected before the list updated was never
  selected.
- **After:** the request waits for the page to appear; it lapses after 2 s (`PENDING_SELECTION_MS`)
  unless the list hasn't loaded yet (then no deadline). A later choice wins over a waiting one. The
  setter reads the latest page list (stable callback).
- **Code:** `context/SelectedPageContext.tsx` (:30, :32–:95).
- **Tests:** `SelectedPageContext.test.tsx` › "selects a page that isn't in the list yet once it is
  (an undo's restored page)", "a later choice wins…", "a waiting choice lapses if its page doesn't
  appear soon".
- **Real-app:** `dc-tl-flag.mjs` (page selection after undo of a delete; one flaky failure once,
  section 7).

#### B-33 The selection box refits after a render moves selected marchers

- **Mode:** both.
- **Before:** after a render that moved selected marchers (undo, Only Page 2, another page), the
  fabric `ActiveSelection` box stayed where the dots had been (study 08 bug 1).
- **After:** `fitActiveSelectionToMarchers` (`addWithUpdate`) after the three marcher-refresh paths,
  except during a drag/transform.
- **Code:** `global/classes/canvasObjects/OpenMarchCanvas.ts` (:1211, :1265, :1279, :1319).
- **Tests:** `activeSelectionFit.test.ts` (3).
- **Real-app:** `dc-page.mjs` check "(d) after Only Page 2: selection box contains every selected
  dot".

#### B-34 Ctrl+A and Ctrl+S no longer nudge (Ctrl/Cmd + W/A/S/D)

- **Mode:** both.
- **Before:** only Meta+WASD was excluded, so on Linux/Windows Ctrl+A (select all) and Ctrl+S also
  ran the A/S nudges: a marcher moved, and "No marchers selected" could appear.
- **After:** `(e.metaKey || e.ctrlKey) && code.includes("Key")` skips the WASD switch. Identical to
  upstream #1044's hunk.
- **Code:** `utilities/RegisteredActionsHandler.tsx` (:1566).
- **Tests:** `RegisteredActionsHandlerModes.test.tsx` › "Ctrl+A and Ctrl+S don't nudge the selection;
  A alone does".
- **Real-app:** `~/ux-sim/wp9/` base vs branch replays (`ux-replay.mjs`, screenshots).
- **V-row:** none.

#### B-35 Timeline write API renames (internal, visible through errors)

- **Mode:** TL.
- **After:** `moveMarchersOnPageMutationOptions` → `moveMarchersToNeighborPageMutationOptions`;
  `TimelineMoveRequest` → `TimelineNeighborPageRequest` (`{target, moves, clearOwn}`);
  `TimelineWritePage` removed; `marcherList`, `NarrowingFlag`, `narrowingLabel` removed from
  `timelinePassThrough.ts`; `joinNewMarchersToTimelinesInTransaction` renamed. Refusal messages for
  set to previous/next now come from the range writer (E-T5, E-ARGS for positions) instead of
  `moveMarchersOnPage`'s "no move ending on page N".
- **Tests:** `timelineToastPaths.test.ts`.
- **Limits:** any other branch calling the old names breaks at compile time (merge note).

---

## 3. File map

Non-doc files changed (`git diff --stat 5888850a e1cd9ea2 -- apps`), one line each.

| File (under `apps/desktop/`)                          | What changed                                                                                                   | B-IDs                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `electron/database/migrations/schema.ts`              | Comment only on `tag_appearances.start_page_id`                                                                | B-13                                    |
| `i18n/en.json`                                        | 56 new keys (inspector timeline, marcherPages, passThrough, holdMarks, delete menu); other locales not updated | B-08–B-10, B-16, B-22, B-24, B-29, B-30 |
| `src/components/inspector/MarcherEditor.tsx`          | Renders `TimelineHoldLine` under Step Size (two places)                                                        | B-30                                    |
| `src/components/inspector/TimelineHoldLine.tsx` (new) | Inspector hold/move line, link seeks the playhead                                                              | B-30                                    |
| `src/components/singletons/StateInitializer.tsx`      | TL: no selected page → page at playhead, not home                                                              | B-11                                    |
| `src/components/timeline/HintTooltip.tsx` (new)       | Label + hint Radix tooltip; press closes it                                                                    | B-29                                    |
| `src/components/timeline/PageHoldMark.tsx` (new)      | Mark drawing, tooltip wrapper, labeled marks hook                                                              | B-27–B-29                               |
| `src/components/timeline/PageTimeline.tsx`            | TL delete menu (In Place = flag delete, With Its Moves, Yank with report); PM hold marks and tooltips          | B-08, B-09, B-28, B-29                  |
| `src/components/timeline/Timeline.tsx`                | `onDeletePageWithMoves`, `holdMarks` props                                                                     | B-09, B-27                              |
| `src/components/timeline/TimelineModePanel.tsx`       | Hold marks, delete with moves + Undo, `selectionAfterDeleteWithMoves`                                          | B-09, B-10, B-27                        |
| `src/components/timeline/TimelinePrimitives.tsx`      | Page boxes draw marks, tooltips, `aria-describedby`                                                            | B-27, B-29                              |
| `src/components/timeline/TimelineRangeMenu.tsx`       | "Delete page flag" → "Delete page"; new "Delete page and its moves"                                            | B-08, B-09                              |
| `src/components/timeline/TimelineVariants.tsx`        | Passes `holdMarks`                                                                                             | B-27                                    |
| `src/components/timeline/TimelineViewModel.ts`        | `holdMarks` prop type                                                                                          | B-27                                    |
| `src/components/timeline/useTimelineCommands.ts`      | Delete move toast names changed pages                                                                          | B-12                                    |
| `src/components/ui/Toaster.tsx`                       | One-line action buttons                                                                                        | B-26                                    |
| `src/context/SelectedPageContext.tsx`                 | Pending page selection with 2 s expiry; latest-pages ref                                                       | B-32                                    |
| `src/db-functions/history.ts`                         | `rowIdFromSql` fix; earliest changed page focus                                                                | B-20                                    |
| `src/db-functions/historyTriggers.ts`                 | `pathways` in history                                                                                          | B-19                                    |
| `src/db-functions/marcher.ts`                         | Calls `giveNewMarchersHomesInTransaction`                                                                      | B-02                                    |
| `src/db-functions/marcherPage.ts`                     | Carry-forward, no-op skip, pathway detach, `restoreCarriedRuns`, `moveLaterMovesToo`, `OwnMoveStop`            | B-14–B-18, B-22                         |
| `src/db-functions/page.ts`                            | No pathway copy on new page; tag move on delete; `deletePageYankInTransaction` extracted                       | B-09, B-13, B-18                        |
| `src/db-functions/pageDelete.ts` (new)                | Delete with moves / yank with report; changed-flag comparison; toast text; `changedPagesAround`                | B-09, B-10, B-12                        |
| `src/db-functions/pageFlags.ts`                       | Flag delete moves tag appearances                                                                              | B-13                                    |
| `src/db-functions/tagAppearancePageDelete.ts` (new)   | Moves/drops tag appearances off deleted pages                                                                  | B-13                                    |
| `src/db-functions/timelineCommands.ts`                | `deleteTimelineAndCompare`                                                                                     | B-12                                    |
| `src/db-functions/timelineHistoryFocus.ts`            | Added/removed marchers belong to the current page                                                              | B-31                                    |
| `src/db-functions/timelineMarchers.ts`                | New marchers: home only                                                                                        | B-02                                    |
| `src/db-functions/timelineMoves.ts`                   | No-op skip, drag back/clearOwn, flags in pass-through, `NothingWritten`, `onStart`, `shiftSlotDestinations`    | B-03–B-05, B-23, B-24                   |
| `src/db-functions/timelineRipple.ts`                  | `addHoldingMoves` removed; `isPageMove` widened; next-row clamp                                                | B-01, B-07                              |
| `src/global/classes/canvasObjects/MarcherShape.ts`    | New shape invalidates all marcher pages                                                                        | B-17                                    |
| `src/global/classes/canvasObjects/OpenMarchCanvas.ts` | `fitActiveSelectionToMarchers`                                                                                 | B-33                                    |
| `src/hooks/queries/sharedInvalidators.ts`             | `invalidateAfterMarcherPagesWrite`, `invalidateAllMarcherPages`                                                | B-17, B-21                              |
| `src/hooks/queries/useMarcherPages.ts`                | Carry toast + invalidation; TL writes through `moveMarchersAndOfferFollowUp`; neighbor-page mutation           | B-05, B-16, B-21–B-23                   |
| `src/hooks/queries/usePageFlags.ts`                   | Delete-with-moves mutations + toast + Undo; tag invalidation                                                   | B-09, B-10, B-13                        |
| `src/hooks/queries/usePages.ts`                       | Tag invalidation after deletes                                                                                 | B-13                                    |
| `src/hooks/queries/useShapePages.ts`                  | Invalidate all marcher pages after shape edits                                                                 | B-17                                    |
| `src/timeline/convert/planPageConversion.ts`          | Skip unchanged points                                                                                          | B-06                                    |
| `src/timeline/pageHoldMarks.ts` (new)                 | Per-marcher states (both modes), page classification, words                                                    | B-27–B-29                               |
| `src/timeline/timelineCarryForward.ts` (new)          | Carry-forward spans; `editedMarcherEnds` used by Move them too; summary functions unused in production         | B-23, B-25                              |
| `src/timeline/timelineCoordinateWrites.ts`            | `copyPagePositions.targets`, `neighborPageTarget`; edits via `moveMarchersAndOfferFollowUp`                    | B-05, B-23                              |
| `src/timeline/timelineHoldState.ts` (new)             | Inspector state per marcher / selection                                                                        | B-30                                    |
| `src/timeline/timelineMoveThemToo.ts` (new)           | TL Move them too                                                                                               | B-23                                    |
| `src/timeline/timelinePassThrough.ts`                 | New wording, flags, Keep as a stop, window follows, toast id                                                   | B-24                                    |
| `src/timeline/usePageHoldMarks.ts` (new)              | Hooks for TL and PM marks                                                                                      | B-27, B-28                              |
| `src/utilities/RegisteredActionsHandler.tsx`          | Ctrl+WASD fix; neighbor-page mutation                                                                          | B-05, B-34                              |
| `src/utilities/carryForwardToast.ts` (new)            | PM carry toast and PM Move them too toast                                                                      | B-16, B-22                              |
| `src/utilities/moveThemToo.ts` (new)                  | Shared message, names, toast id/duration                                                                       | B-22, B-23                              |
| `src/utilities/setMarchersToNeighborPage.ts`          | TL writes over the page box; previous clears own moves                                                         | B-05                                    |

Test files are in section 4.

---

## 4. Test map

### How to run

From `apps/desktop`, with Node 24 on `PATH` (`node` is not on the default `PATH` of this box:
`export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`). Use the desktop's own vitest binary:

```bash
cd apps/desktop
FILES="<test files from the table>"
./node_modules/.bin/vitest run --silent=true $FILES                                   # normal
VITEST_TIMELINE_MODE=true ./node_modules/.bin/vitest run --silent=true $FILES         # fixtures converted, flag on
VITEST_ENABLE_HISTORY=true ./node_modules/.bin/vitest run --silent=true $FILES        # undo/redo checks (testWithHistory)
VITEST_ENABLE_HISTORY=true VITEST_TIMELINE_MODE=true ./node_modules/.bin/vitest run --silent=true $FILES
npx tsc --noEmit -p .
```

The package scripts are the same: `pnpm --dir apps/desktop run test:focused|test:timeline|test:history|test:timeline-history <file>`.

**Env trap ("Invalid Chai property").** In this worktree the root `node_modules/vitest` links vitest
**3.2.3** while `apps/desktop/node_modules/vitest` is **4.1.2**. `@testing-library/jest-dom/vitest`
resolves `vitest` from the root, so it extends the wrong `expect`, and every DOM matcher
(`toBeInTheDocument`, `toHaveAttribute`, …) fails with "Invalid Chai property: …". It hits
`PageHoldMarks.test.tsx` and `TimelineHoldLine.test.tsx` (10 failures in normal mode, 9 in timeline
mode on 2026-10-09). Workaround: make the root link match the desktop version (run `pnpm install`
at the repo root, or point `node_modules/vitest` at the `vitest@4.1.2…` entry in
`node_modules/.pnpm`), or run those two files from a checkout whose root link is 4.1.2 (the main
checkout's is). Check with `ls -l node_modules/vitest apps/desktop/node_modules/vitest`.

**Known load-only timeouts.** In a full or large parallel run, `timelineRender`,
`timelineSelection`, `useTimelinePlaybackDriver`, `TimelineContainerMode` and `useTimelinePlayback`
can time out; they pass when run alone. They are not touched by this branch.

### Runs on 2026-10-09 (this catalog's author, HEAD `e1cd9ea2`)

| Run                                               | Result                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| 31 changed test files, normal                     | 407 / 417 passed; the 10 failures are the env trap (2 jsdom files) |
| Same, `VITEST_TIMELINE_MODE=true`                 | 408 / 417 passed; 9 failures, same env trap                        |
| 13 DB/history files, `VITEST_ENABLE_HISTORY=true` | 217 / 217 passed                                                   |
| Same 13, history + timeline mode                  | 217 / 217 passed                                                   |
| `tsc`, eslint, full `test:history`, e2e           | not run by the author                                              |

The 13 history files: timelineNoAutoStays, timelineSparseWrites, pageDelete, marcherPageCarryForward,
timelineCarryForward, timelineHistoryFocus, timelineRipple, moveThemToo, timelineMoveThemToo,
pageFlagsAdversarial, timelineMarchers, timelineMembershipAdversarial, RegisteredActionsHandlerModes.

### Files

| Test file (under `apps/desktop/src/`)                              | New/changed  | Covers                           | Notes                                                             |
| ------------------------------------------------------------------ | ------------ | -------------------------------- | ----------------------------------------------------------------- |
| `db-functions/__test__/timelineNoAutoStays.test.ts`                | new          | B-01, B-02, B-06                 | Owner scenario per add path; converted copies                     |
| `timeline/__test__/timelineSparseWrites.test.ts`                   | new          | B-03, B-04, B-05, B-24           | No-op writes, drag back, set to previous/next, pass-through flags |
| `db-functions/__test__/pageDelete.test.ts`                         | new          | B-07, B-08, B-09, B-10, B-13     | Flag delete, with moves, merged boxes, tags, history              |
| `db-functions/__test__/marcherPageCarryForward.test.ts`            | new          | B-14–B-20                        | Includes 200×100 timing (logged); history tests                   |
| `timeline/__test__/timelineCarryForward.test.ts`                   | new          | B-24, B-25 (+ dead summary code) | Keep as a stop; window follows                                    |
| `timeline/__test__/timelineMoveThemToo.test.ts`                    | new          | B-12, B-23                       |                                                                   |
| `utilities/__test__/moveThemToo.test.ts`                           | new          | B-22                             |                                                                   |
| `timeline/__test__/pageHoldMarks.test.ts`                          | new          | B-27, B-28, B-29 (words)         | Pure + one resolver test                                          |
| `components/timeline/__test__/PageHoldMarks.test.tsx`              | new          | B-27, B-28, B-29                 | jsdom: hit by the env trap                                        |
| `components/inspector/__test__/TimelineHoldLine.test.tsx`          | new          | B-30                             | jsdom: hit by the env trap                                        |
| `timeline/__test__/timelineHoldState.test.ts`                      | new          | B-30                             |                                                                   |
| `hooks/queries/__test__/usePageFlags.deleteToast.test.ts`          | new          | B-10                             |                                                                   |
| `global/classes/canvasObjects/__test__/activeSelectionFit.test.ts` | new          | B-33                             |                                                                   |
| `components/ui/__test__/Toaster.test.tsx`                          | new          | B-26                             |                                                                   |
| `context/__test__/SelectedPageContext.test.tsx`                    | changed (+3) | B-32                             |                                                                   |
| `utilities/__test__/RegisteredActionsHandlerModes.test.tsx`        | changed (+2) | B-20, B-34                       |                                                                   |
| `components/timeline/__test__/TimelinePageFlagControls.test.tsx`   | changed      | B-08, B-09                       |                                                                   |
| `components/timeline/__test__/TimelineMoveMenu.test.tsx`           | changed      | B-08 (label)                     |                                                                   |
| `db-functions/__test__/timelineRipple.test.ts`                     | changed      | B-01, B-07                       | Expectations flipped from holding moves to no rows                |
| `db-functions/__test__/timelineMarchers.test.ts`                   | changed      | B-02                             | Join tests replaced                                               |
| `db-functions/__test__/timelineMembershipAdversarial.test.ts`      | changed      | B-02                             |                                                                   |
| `db-functions/__test__/timelineHistoryFocus.test.ts`               | changed      | B-31                             |                                                                   |
| `db-functions/__test__/pageFlagsAdversarial.test.ts`               | changed      | B-13                             |                                                                   |
| `db-functions/__test__/timelineMovesByTimeline.test.ts`            | changed      | B-24                             | Test names still say "Start from Page N"                          |
| `hooks/queries/__test__/useMarchersTimelineMode.test.ts`           | changed      | B-02                             |                                                                   |
| `timeline/__test__/planPageConversion.test.ts`                     | changed      | B-06                             |                                                                   |
| `timeline/__test__/p910Adversarial.test.ts`                        | changed      | B-01, B-06                       |                                                                   |
| `timeline/__test__/timelinePageCopy.test.ts`                       | changed      | B-05                             |                                                                   |
| `timeline/__test__/timelinePassThrough.test.ts`                    | changed      | B-24                             | Message tests rewritten                                           |
| `timeline/__test__/timelineCoordinateWrites.test.ts`               | changed      | B-15                             | `toBeCloseTo` for PM align                                        |
| `timeline/__test__/timelineToastPaths.test.ts`                     | changed      | B-35                             | Rename only                                                       |

---

## 5. QA checklist

### Setup

- **Builds:** branch at `e1cd9ea2`; base `timeline-try-2` at `5888850a` for comparisons. The real-app
  harness is Docker + Xvfb (`~/om-capture`, see the `validate` skill); fixtures in
  `~/om-capture/fixtures/`.
- **Page-mode show:** a new blank show, or `ux-starter-page.dots` / `page-marchers-and-pages.dots`.
- **Timeline-mode show:** `timeline-blank.dots`, `ux-starter-timeline.dots`, or a page show converted
  (`OPENMARCH_CONVERT_ON_OPEN=1`). In timeline mode the bottom panel is the timeline with page boxes
  and flags; the page strip reappears only while editing beats.
- **Undo/redo for every edit:** after each step that edits, press Ctrl+Z once and confirm the whole
  edit reverts in one step (positions, rows, page selection), then Ctrl+Shift+Z and confirm it
  reapplies. "U/R" below means this check.
- Keys: Shift+P / Shift+N set selected to previous/next page; Ctrl+Shift+P / Ctrl+Shift+N set all.

### Timeline writes

| ID   | Steps                                                                                                                                                                              | Expected                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | TL blank show. Move everyone on page 1. Add pages 2, 3, 4 with the **+** after the playhead (also repeat with Alt+T and with Split). Drag everyone on page 2. Visit flags 3 and 4. | Pages 3–4 show page 2's new set. Base: page 1's set. U/R on the drag. Adding pages writes no timeline rows (DB: `timeline_transitions` count unchanged by the adds).             |
| B-02 | TL show with pages 1–4. Add a marcher. Visit every page. Then move it on page 2 and visit 3–4.                                                                                     | It stands at its home on every page; after the move it stays at the new spot on 3–4. U/R of the add keeps the current page (B-31).                                               |
| B-03 | TL: pages 1–4, page 1 moved. Select 3 marchers on page 3 (held) and align so one doesn't move; distribute. Then drag everyone on page 2.                                           | Only marchers that moved on page 3 have rows there; the unmoved ones follow page 2. A drag that moves nobody (drop in place) adds no undo step.                                  |
| B-04 | TL: on page 3 drag a marcher away, then back to exactly where page 3 starts (snap to grid). Edit page 2.                                                                           | Page 3 follows page 2 again (its move was cleared). U/R restores the move. Repeat in a cross-page window: the zero-motion move is kept.                                          |
| B-05 | TL: pages 1–4, page 1 moved, 2–4 held. On page 3 press Ctrl+Shift+N. Then on page 3 press Shift+P with a marcher selected, and edit page 2.                                        | Next works (base: refused toast) and page 3 shows page 4's set. Previous clears page 3's move so page 3 follows the page-2 edit. U/R each.                                       |
| B-06 | Convert a page show with copied pages (e.g. `page-marchers-and-pages.dots`). Compare every flag with page mode, then edit an early page.                                           | Same positions at every flag as page mode; held pages have no rows; an edit carries through held pages.                                                                          |
| B-07 | TL converted show: Delete page on page 2 (flag delete); then on the merged page choose Delete page and its moves. Ctrl+Z twice.                                                    | No error toast; later flags keep their look; two undos restore the original. Also: draw a window over the merged box, then delete with moves: the window's move (a track) stays. |

### Delete

| ID   | Steps                                                                                                                            | Expected                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-08 | TL: marchers 3–5 move on page 2, hold on 3–4. Right-click page 2's box.                                                          | Menu: **Delete page**, **Delete page and its moves** (both red). Delete page: flags 3–4 look the same; page 3 takes page 2's box. U/R. Also via beat editing's page strip **In Place** (tooltip "Delete this page. Later pages keep their timing and look."). |
| B-09 | Same show: **Delete page and its moves** on page 2, first with page 2 selected, then with another page selected.                 | Page 2's move goes; held pages fall back; selection: the merged box if page 2 was selected, else unchanged. U/R. Beat-editing strip: **With Its Moves** and **Yank** give the same toast.                                                                     |
| B-10 | After B-09.                                                                                                                      | Toast "Deleted Page 2 · Page 1 is now N counts · old Pages 3–4 changed" (exact pages depend on the show) with **Undo**; Undo restores page, move and later look in one step. On a page nobody moved: "… · No other page changed".                             |
| B-11 | TL: select page 2's box, delete it (either command).                                                                             | The view stays on the merged page (no jump to home / beat 0). **Not yet scripted.**                                                                                                                                                                           |
| B-12 | TL: make a move (window) that later held pages rely on; right-click its clip → Delete move.                                      | "Deleted Move N · Pages X–Y changed" + Undo; with no page affected just "Deleted Move N". Undo restores.                                                                                                                                                      |
| B-13 | Both modes: add a tag with an appearance starting on page 3; delete page 3 (PM: In Place and Yank; TL: Delete page, with moves). | The appearance now starts on the next page (later pages keep the tag look). If the next page already has one for that tag, the deleted one is dropped. Last page: dropped. U/R restores it.                                                                   |

### Page mode

| ID   | Steps                                                                                                                                                    | Expected                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-14 | PM blank show: add pages 2–4 (copies). Drag everyone on page 2. Visit 3 and 4; play through page 3. Then set page 4 to a new spot and edit page 2 again. | Pages 3–4 follow (playback holds on page 3). Second edit: page 3 follows, page 4 keeps its own spot. U/R restores all rows in one step. Also try: nudge, align, swap two marchers, Shift+P: each carries.         |
| B-15 | PM: click a marcher without moving it; nudge right then left back.                                                                                       | The click adds no undo step; nothing on later pages changes.                                                                                                                                                      |
| B-16 | After B-14's first drag.                                                                                                                                 | Toast "Pages 3–4 followed (they were copies)" with **Only Page 2**; clicking it puts 3–4 back; Ctrl+Z then makes them follow again; second Ctrl+Z undoes the drag. Edits on two pages: **Only the edited pages**. |
| B-17 | PM: make a line shape on page 2 with copies on 3–4 (not in shapes); edit the shape.                                                                      | Pages 3–4 follow; no toast. U/R.                                                                                                                                                                                  |
| B-18 | PM: give page 2 a curved pathway, add page 3. Play page 3; edit page 3; edit page 2.                                                                     | Page 3 holds (no replayed curve); editing page 3 doesn't bend page 2's curve.                                                                                                                                     |
| B-19 | PM: edit page 2 when page 3 has its own pathway; Ctrl+Z.                                                                                                 | Page 3's curve start moves with the edit and comes back on undo.                                                                                                                                                  |
| B-20 | PM: edit page 2 (with copies 3–4), go to page 5, Ctrl+Z; Ctrl+Shift+Z.                                                                                   | Undo jumps to page 2 and selects the changed marchers (base: stayed on page 5).                                                                                                                                   |
| B-21 | PM: after B-14, without reloading, visit 3–4 and check the canvas and coordinate sheet panel.                                                            | Followed pages show new positions immediately.                                                                                                                                                                    |

### Move them too

| ID   | Steps                                                                                                                                                 | Expected                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-22 | PM: 8 marchers in a line; page 2 everyone forward; page 3 only OT1 and OT8 step out; page 4 copy of 3. Shorten the page-2 move (drag all back a bit). | Toast "OT1 and OT8 have their own move on Page 3, so they kept their spot" + **Move them too** (no Only Page 2). Click: OT1/OT8 shift by the same offset on page 3, page 4 follows. Ctrl+Z reverts only the shift. **Also check:** a fully written show (every page different): does every drag show this toast? (expected per code: yes; open question) |
| B-23 | Same in TL (`ux-starter-timeline.dots`).                                                                                                              | Same message and action; one Ctrl+Z reverts the shift only. With a window passing a flag, only one toast (Move them too). Next move ending between flags: no offer.                                                                                                                                                                                      |

### Toasts

| ID   | Steps                                                                                                            | Expected                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-24 | TL: pages 1–5, only page 1 moved. Ctrl+drag a window from inside page 3 to the end of page 4; drag all marchers. | One toast "Page 4 is no longer a stop" (two flags: "Pages 3–4 are no longer stops") with **Keep Page 4 as a stop**; click: flag shows its earlier set again and the window moves to the last part. U/R. A window inside one page: no toast. |
| B-25 | TL: ordinary drags and arrow nudges on held pages.                                                               | No toast (unless Move them too applies).                                                                                                                                                                                                    |
| B-26 | Any toast with an action, at a narrow window width.                                                              | The button stays on one line beside the text; keyboard focus shows a ring.                                                                                                                                                                  |

### Hold marks and inspector

| ID   | Steps                                                                                                                   | Expected                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-27 | TL: page 1 moves everyone; marchers 3–5 move on page 2. Select 3–5; then 5+6; then nothing; then compact mode.          | 3–5: diamond on page 2, bars on 3–4. 5+6: dashed bar where one moves and one holds. Nothing selected: no marks. Marks never block clicks, scrubs or the playhead.                                         |
| B-28 | PM: pages 0–4 copies; select all on page 2 and drag.                                                                    | Page 2 diamond, pages 3–4 bars; before the drag, bars from the start.                                                                                                                                     |
| B-29 | Hover a marked box ~0.5 s; Tab to a box; press on a box; right-click; start a scrub on a box.                           | Tooltip with label + hint (table in B-29) on hover and focus; a press closes it and still selects; no tooltip on right-click or mid-scrub; none without a selection. Screen reader reads the description. |
| B-30 | TL: select a held marcher on page 4; click the line. Then page 2 (moves). Then a mixed selection. Then page 1; then PM. | "Hold from Page 2 →" (link; click seeks to page 2's flag); "Moves on this page"; nothing for mixed, page 1, and in PM. Never-moved marcher: "Hold from the start".                                        |

### Focus, selection, keys

| ID   | Steps                                                                        | Expected                                                                                  |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| B-31 | TL: go to page 3, add a marcher, Ctrl+Z, Ctrl+Shift+Z.                       | Stays on page 3 both times; redo selects the new marcher.                                 |
| B-32 | TL: delete a page with moves while it is selected, then Undo from the toast. | The restored page becomes selected once it appears; nothing selects it later by surprise. |
| B-33 | PM: select all on page 2, drag; Only Page 2; Ctrl+Z; go to another page.     | The selection box always surrounds the dots (no empty box left behind).                   |
| B-34 | Linux/Windows: select a marcher, Ctrl+A, Ctrl+S; then A alone.               | Ctrl+A selects all, nothing moves, no "No marchers selected"; A alone nudges.             |
| B-35 | TL: a refused set to previous/next (e.g. follow-the-leader into a shape).    | A friendly refusal toast; nothing written.                                                |

---

## 6. Data and compatibility

- **No schema, user-version or file-format change; no migration.** Older and newer builds open the
  same files.
- **Page-mode files (user version 7, released):** read unchanged. Behavior changes start on the next
  edit (carry-forward). Pages already left stale by the old app stay stale; the fix is a manual
  Shift+P or re-edit (README finding 7). Rows that share a pathway with the previous page (copied by
  the old add-page) are detached the first time they are edited (B-18).
- **Undo triggers:** the first time a file is opened by this build, history triggers are created for
  `pathways` (B-19). An older build opening that file afterwards keeps them; its history code
  replays them generically. Not tested against an older build.
- **Timeline files made by earlier dev builds (user version 8, unreleased):** keep their holding
  moves, new-marcher stays and converter copies. Those rows are now read as **designer intent**
  (zero-motion moves = blocks), so the owner's bug persists in them. Per ADR 0001's amendment they
  are **converted again by hand**, as for C-11: open the page-mode original and convert with this
  build. `isPageMove` matches the old holding moves (over exactly a page box, layer 0), so Delete page
  and its moves removes them with the page.
- **Converter output:** fewer rows (no slot for unchanged positions; no timeline for a page nobody
  moves on; not a loss). Positions at every flag are bit-identical to before (exact comparison).
- **What older builds see** in a file edited by this build:
  - TL: sparse rows are valid for older dev builds (they already resolved "no move = hold"), but an
    older build's page add would write holding moves again.
  - PM: carried rows are ordinary rows; nothing to read differently.
  - Tag appearances moved to another page are ordinary rows.

---

## 7. Coverage gaps

Behaviors with no automated test, or checked only by reasoning or screenshots; checks never run.
This list should drive the next testing pass.

### Behaviors

1. **Move them too on ordinary edits in written shows (B-22, B-23).** By code, any edit whose
   marchers have an own move on the next page (nearly every edit in a written or converted show)
   shows the toast, contradicting V-146's "ordinary edits silent". No test, no real-app check, no
   owner decision. Also untested: Move them too replacing the pass-through toast hides **Keep as a
   stop**.
2. **Move them too in the real app** was captured as screenshots only (`~/ux-study/wp11`, replay); no
   scripted assertions; no V-row.
3. **Delete with the deleted page selected (B-09, B-11)** in the real app: not scripted (PR says so).
   `StateInitializer`'s page-at-playhead fallback has no unit test.
4. **Delete move's changed pages (B-12):** tests only; no real-app run.
5. **Cross-page window move ending at a deleted page's flag (B-07):** now matched by `isPageMove` and
   deleted with the page; no test.
6. **Page-mode carry from set to previous/next page (Shift+P/N), and from the new-show "previous
   dots" import (B-14):** not tested.
7. **Page-mode Move them too after Move them too, or Only Page N after Move them too:** not tested.
8. **Delete toast Undo after another edit (B-10):** the button isn't invalidated; behavior not
   tested.
9. **Tag appearances (B-13):** unit tests only; no real-app check, no check of the tag UI refresh.
10. **New marchers (B-02), undo focus for marcher add (B-31), drag back (B-04):** no real-app run.
11. **Hold marks performance:** page mode loads every page's rows while something is selected
    (B-28); timeline marks recompute per resolver version. Not measured on 100+ page shows.
12. **`HintTooltip` inside other overlays** (fullscreen, compact, playback) beyond the scripted cases.
13. **#111 page-flag drag on sparse rows** (a held page's flag moved): no dedicated test on this
    branch.
14. **Pathway history triggers in an older build** (section 6): reasoning only.
15. **i18n:** "Delete page", "Delete page and its moves", the delete toast and the delete-move toast
    are hard-coded English; the name lists in Move them too use English "and"; es/fr/ja/pt-BR have
    none of the 56 new keys (they fall back to the defaults).

### Checks never run

- Full `test:history` and full `test:timeline-history` suites (only the 13 files above).
- The Playwright e2e suite and the browser harness.
- Coordinate sheet and PDF export, and the "Hold" wording on coordinate sheets (deferred).
- Live playback value comparison in timeline mode (paused seeks only, T7).
- Convert on open through the app's dialog (each build's own converter was used).
- `tsc` and eslint at `e1cd9ea2` by the author of this file (the PR reports them clean at earlier
  heads).
- The jsdom tests `PageHoldMarks.test.tsx` and `TimelineHoldLine.test.tsx` at `e1cd9ea2` (blocked by
  the env trap here; they passed at wp10 per the PR).
- Two once-only real-app failures on the branch (dc-tl-flag page box selection after undoing a
  delete-with-moves; dc-page-p56 final DB after a missed Ctrl+A, before B-34): not reproduced in
  reruns, cause not proven.

---

## 8. Merge notes and doc discrepancies

### Interplay with other work

- **#106 (edit moves, UI-14):** already merged into the base. This branch extends its Delete move
  toast (B-12) and keeps both page box menu sets. Under the sparse model, deleting a move makes later
  held pages fall back, hence the changed-pages text.
- **#111 (timeline edges: drag a page flag, resize a move) and #113:** merged into the base via
  `97c8626b`; no code conflict left. Flag drags on sparse rows have no dedicated test (gap 13).
- **Transport keys (UI-17, fork branch `timeline/transport-keys`):** `HintTooltip.tsx` is a stand-in
  for its `ShortcutTooltip`; replace both with the shared one when it lands. Expect a small conflict
  in timeline components that both touch.
- **Upstream OpenMarch #1044** (merged upstream): contains the identical Ctrl/Cmd+WASD hunk (B-34).
  Merging main should apply cleanly or as a no-op; keep one copy.
- **Renamed exports (B-35):** any open branch calling `moveMarchersOnPageMutationOptions`,
  `joinNewMarchersToTimelinesInTransaction`, `marcherList` or `narrowingLabel` must be updated.
- **UI numbering:** this feature is **UI-18**. UI-15 and UI-16 belong to timeline edges (#111),
  UI-17 to transport keys. VALIDATION rows are V-140..V-149.

### Doc vs code discrepancies found

| Doc                                                               | Says                                                                                                                    | Code at `e1cd9ea2`                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| README "Built" table                                              | Lists wp1–wp6 only                                                                                                      | wp7 (hold marks), wp8 (text and bugs), wp9 (Ctrl+A), wp10 (tooltips), wp11 (Move them too) are merged too                                         |
| README Recommendation 5                                           | Toast "Also pages 3–7 · stops at Page 8"; "Holding since Page X" / "Moves here"                                         | Superseded by study 08: no carry toast; "Hold from Page X →" / "Moves on this page"; README doesn't mark it superseded                            |
| README Recommendation (page mode)                                 | Only Page N "redoes the edit without carrying it forward"                                                               | `restoreCarriedRuns` puts the followed rows back as a second undo step                                                                            |
| PR #112 body                                                      | UI-15; "Also moves Pages 3–4 · stops at Page 5"; "Start from Page N"; "Holding since Page X"; "Also moved on Pages 3–4" | UI-18; no carry toast; "Keep Page N as a stop"; "Hold from Page N"; "Pages 3–4 followed (they were copies)" (the PR's later comments are current) |
| ui.md UI-18, VALIDATION                                           | Silent on Move them too, hold-mark tooltips, "Hold from the start", Delete move's changed pages                         | All built (B-12, B-22, B-23, B-29, B-30); no V-row for Move them too or the tooltips                                                              |
| ui.md UI-18 / V-146                                               | "Ordinary edits and nudges show no toast"                                                                               | True for carry-forward, but Move them too can fire on ordinary edits (B-22, B-23)                                                                 |
| ui.md UI-18                                                       | "A write that leaves a marcher where it already is writes nothing for that marcher"                                     | Only for range writes; isolated-move (`{kind:"timeline"}`) and home writes still write unchanged values                                           |
| ADR 0001 amendment                                                | "Deleting a page in timeline mode deletes its flag only"                                                                | The default does; "Delete page and its moves" and Yank (beat-editing strip) still delete moves, as explicit commands                              |
| `timelineMovesByTimeline.test.ts`, `timelineSparseWrites.test.ts` | Test names say "Start from Page N"                                                                                      | The action is "Keep Page N as a stop"                                                                                                             |
| ui.md UI-18 page mode                                             | Carry stops "at a different value, a page shape or the marcher's own pathway"                                           | Matches; additionally, when the write left own moves behind, the toast is Move them too and Only Page N is not offered                            |
