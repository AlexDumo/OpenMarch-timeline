# Roster changes 01: what the app does today

Read-only fact-finding on fork main (`research/roster-changes`, e5e2b3a30), 2026-11-16. Each claim
is labelled **FACT** (read in code, a test or an ADR, with a citation) or **INFERENCE** (follows
from the code but was not run or tested). No tests were run: the checkout has no `node_modules`,
and every question below was settled by reading code and existing tests. Paths are relative to
`apps/desktop/src/` unless they start with `apps/`, `packages/` or `docs/`.

## Summary

1. The only way to delete a performer is the Marchers sidebar list: row menu, Delete, then a red
   confirm. There is no field key, context-menu entry or inspector button for it.
2. A delete is one undo step. It removes the marcher's own moves (their one-slot transitions) and
   then the marcher row. Cascades take its tags, Held holds, shape membership and item row.
3. No one else moves. Shared slots in converted shows are compacted without moving anyone. Moves
   (timelines) are never deleted, so a move whose only marcher is deleted stays as an empty clip.
4. A placed shape keeps a **hole** where the marcher stood. It does not lay itself out again.
   Closed shapes offer **Close up**. Open shapes (Line, Arc) keep the hole.
5. Undo brings everything back with the same ids. Redo deletes it again.
6. Adding a marcher (by hand or from CSV) gives it a home near the top-left of the field and no
   moves. It stands at home for the whole show. It joins no move and no shape.
7. The add form fills in the lowest free drill number. After deleting T3, a new trumpet defaults
   to T3, but it gets none of the old T3's part.
8. "Vacant slot" (spec D-13) and "hole" (placed shapes) both exist. Neither can be filled from
   the UI by a new marcher. The casting code that could fill vacant slots has no UI caller.
9. **Swap marchers** (`$mod+S`) only swaps two marchers' positions at the current moment. Nothing
   swaps or hands over a whole part.
10. Cues have no storage on fork main, so nothing cue-related is lost today. ADR 0015 will store
    cue performers by id (`cue_marchers`, cascade).

## 1. The delete path, end to end

### Entry points

| Entry point | What it does | Citation |
| --- | --- | --- |
| Marchers sidebar → row "⋯" → **Delete** | Marks the row for deletion and hides it locally. Nothing is written yet. | **FACT** `components/marcher/MarcherList.tsx:105-111`, `:434-444` |
| Marchers sidebar → red confirm dialog | "You are about to delete these marchers: T3. This can be undone with ⌘Z." Then `deleteMarchers` runs. | **FACT** `MarcherList.tsx:85-103`, `:173-224`; `apps/desktop/i18n/en.json:1094`, `:1157` |
| Props: delete an item | Same `deleteMarchers` (an item is a `marchers` row of type `item`). | **FACT** `hooks/queries/useItems.ts:102-111` |
| Front ensemble preset | Its own copy of the delete (`deleteRowsInTransaction`), same steps. | **FACT** `db-functions/pitPreset.ts:278-289` |
| New-show wizard | Deletes every existing marcher before creating the wizard's. | **FACT** `components/launchpage/newShowCompletion.ts:267-278` |
| Field keys, field context menu, inspector | No delete-marcher action exists. | **FACT** `field/three/FieldContextMenu.tsx:78-95` lists none; `shortcuts/definitions.ts` has no such action; `components/inspector/MarcherEditor.tsx` has no delete |

**FACT:** the list's Save sends deletions and edits as two separate mutations, so they are two
undo steps (`MarcherList.tsx:85-103`). **INFERENCE:** `await deleteMarchers(...)` awaits a
`mutate`, which returns nothing, so the update can start before the delete finishes. That is
harmless today but worth knowing.

### The write (`db-functions/marcher.ts:238-265`)

One `transactionWithHistory` edit named `deleteMarchers`, so one undo step (**FACT**). In order:

1. `removeDeletedMarchersFromTimelinesInTransaction` (`db-functions/timelineMarchers.ts:155-177`)
   selects every `timeline_assignments` row of the marchers and hands them to
   `removeAssignmentRowsInTransaction` with `compact: true`
   (`db-functions/timelineMembership.ts:451-630`). **FACT.**
2. The `marchers` rows are deleted one by one (`marcher.ts:201-236`). **FACT.**
3. If the file has shape recipes, every recipe left with no members is deleted
   (`marcher.ts:258-260`, `db-functions/shapeRecipes.ts:390`). **FACT.**
4. `transactionWithHistory` then runs Held-mark upkeep and the commit-time timeline checks in the
   same step (`docs/adr/0012-timeline-motion-model.md:489-512`). **FACT** (ADR); the deleted
   marcher's marks are already gone by cascade, so upkeep only matters for others. **INFERENCE.**

**FACT (doc drift):** the JSDoc at `marcher.ts:222-236` still says "In timeline mode (the file's
flag…)… In page mode the assignments go with the marcher through the foreign-key cascade". There
is no flag or page mode any more; the code always runs step 1. Likewise
`hooks/queries/useMarchers.ts:105` says new marchers get "a holding slot in each page move", which
ADR 0012's 2026-10-08 amendment removed (`docs/adr/0012-timeline-motion-model.md:160-172`).

### What `removeAssignmentRowsInTransaction` does to each transition

| Transition the marcher was in | Result | Citation |
| --- | --- | --- |
| Its own one-slot transition (every move made in the app since UI-9) | Deleted, with its slot destination. The move (timeline) stays, even if now empty. | **FACT** `timelineMembership.ts:531-534`, `:621-629`; test `db-functions/__test__/timelineMembership.test.ts:658-700` |
| Shared shapeless transition (a converted v0.1.7 page move) | Compacted: the marcher in the last slot moves into the vacated slot, taking its destination point, and `slot_count` drops. Nobody's position changes. | **FACT** `timelineMembership.ts:543-615`; test `db-functions/__test__/timelineMarchers.test.ts:439-537` checks positions at every flag and mid-move |
| Shape-backed transition (`dest_shape_id` set) | Slot left **vacant** (D-13). `slot_count` unchanged. | **FACT** `timelineMembership.ts:535-541`; test `timelineMarchers.test.ts:607-654` |
| Shared with a marcher in an inheriting follow-the-leader transition | Slot left vacant (slot order may matter, R-12). | **FACT** `timelineMembership.ts:497-502`, `:538`; test `timelineMarchers.test.ts:656` |

**INFERENCE:** no current UI flow creates shape-backed transitions. `createTrack`
(`db-functions/timelineCommands.ts:378`), which makes them, has no caller outside tests. So in
real shows, deletes compact or delete; vacancies come only from legacy or test data.

### Every table that references a marcher

From `apps/desktop/electron/database/migrations/schema.ts`.

| Table | FK on `marcher_id` | How it goes on delete | Undo history? |
| --- | --- | --- | --- |
| `timeline_assignments` | CASCADE (`:497-499`) | Deleted **explicitly first** (C-1), not by cascade | yes |
| `timeline_transitions`, `timeline_slot_destinations` | none (RESTRICT to parents, `:436-438`, `:544-548`) | One-slot ones deleted explicitly; shared ones compacted | yes |
| `timelines` (moves) | none | Never deleted by a marcher delete (`docs/adr/0012-timeline-motion-model.md:153-155`, `:234-235`) | yes |
| `timeline_held_marks` (Held holds and their style) | CASCADE (`:582-584`) | Cascade | yes |
| `timeline_shape_recipe_marchers` (shape membership) | CASCADE (`:653-655`) | Cascade; empty recipes then deleted explicitly | yes |
| `timeline_shape_recipes` | none (by `timeline_id`) | Deleted only when left with no members | yes |
| `marcher_tags` | CASCADE (`:251-253`) | Cascade; the tag itself stays | yes |
| `items` (when the row is a prop) | CASCADE (`:707-710`) | Cascade | yes |
| `view3d_cameras.json_data` (camera subjects `marcher` / `set`) | none (JSON) | **Not cleaned.** The id stays in the JSON; the 3D View filters unknown ids out (`view3d/window/cinema/subjectPoints.ts:99`, `:102`) | no (not in `tablesWithHistory`) |
| Sections, section appearances, drill numbers | none (on the row) | Go with the row. Other marchers keep their numbers; nothing renumbers. | yes |

All **FACT** except the camera row, where the cleanup gap is **FACT** and "a camera aimed only at
the deleted marcher frames nothing" is **INFERENCE**.

Not stored on fork main, so nothing to lose: cues (`cues`, `cue_marchers` are parked, ADR 0004
status lines 8-16; ADR 0015 lines 37-41), saved shapes (parked, `docs/adr/0011-collapse-fork-migrations.md:8-14`,
and they hold no marcher ids, `docs/adr/0006-shape-recipes.md:111-117`). **FACT.**

### Undo and redo

- **FACT:** history triggers cover marchers, tags, every timeline table, held marks, items and
  shape recipes (`db-functions/historyTriggers.ts:15-46`).
- **FACT:** undo and redo replay with `PRAGMA foreign_keys = OFF` (`db-functions/history.ts:693-755`).
  The marcher's `BEFORE DELETE` trigger logs it before SQLite cascades to its children, so undo
  re-inserts children first; this is safe only because FKs are off
  (`db-functions/__test__/timelineUndo.test.ts:260-282`).
- **FACT:** undo restores rows exactly and redo re-deletes them
  (`db-functions/__test__/timelineMembershipAdversarial.test.ts:790-830`); a shape whose last
  marcher was deleted comes back with undo (`db-functions/__test__/shapeRecipes.test.ts:272-304`);
  undo stays on the current page and selects the restored marcher
  (`db-functions/__test__/timelineHistoryFocus.test.ts:227-239`).
- **INFERENCE:** undo is a stack. After further edits, getting the part back means undoing those
  edits too. So in practice a delete is permanent once the designer keeps working.

## 2. What the show looks like after a delete

| Question | Answer | Label |
| --- | --- | --- |
| Does anyone else move? | No, at flags or mid-move. | **FACT** `timelineMarchers.test.ts:439-537`, `:539-578` |
| Does the resolver still know the marcher? | No. Field, 3D View and exports read the resolver or the marchers query, so the dot just disappears. | **FACT** test `timelineMarchers.test.ts:520`; `view3d/positions.ts:56`, `components/exporting/utils/exportPagePositions.ts:146` |
| Does a placed shape re-lay out? | No. Its recipe keeps `params.spots` (the spot count, holes included), and the member row is gone, so the shape reads back with one empty spot: a **hole**. | **FACT** `shapes/tool/shapePlacement.ts:58` stores `spots`; `shapes/placed/placedBox.ts:115-121` reads `max(spots, members)`. **INFERENCE** that it still shows: it shows while every *remaining* member is on its spot (`placedBox.ts:25-34`), which a delete doesn't change. No test covers delete → hole. |
| Can the hole be fixed? | A closed shape (Box, Circle, closed Line) with holes shows **Close up**: lays the remaining members out again by least travel, one undo step. An open shape (Line, Arc) keeps its holes. | **FACT** `shapes/placed/placedBox.ts:290-296`; `shapes/editor/editTargets.ts:286-316`; `shapes/editor/CloseUpButton.tsx:9-11` |
| Is the hole announced? | No. The "left the shape" toast that offers Close up / Re-split fires only when members *move off* their spots in a coordinate edit, not on delete. | **FACT** `shapes/placed/boxMembership.ts:35-37`; `deleteMarchers` never calls it (`marcher.ts:238-265`). The editor's count text does say "N empty" (`shapes/placed/placedBoxText.ts:77`). |
| A shape whose only member was deleted | The recipe is deleted. | **FACT** `shapeRecipes.test.ts:272` |
| Empty moves | A move whose only marcher was deleted stays as a stored, selectable, empty timeline (an empty clip). | **FACT** `timelineMembership.test.ts:658-700`; `docs/timeline/ui.md:272-274`. **INFERENCE:** it shows as an empty clip until deleted by hand. |
| Vacant slots | Only in shape-backed or FTL-shared transitions (see above). The resolver flags them as `D-VACANT` (`packages/core/src/timeline/resolver.ts:785-791`), but no UI shows resolver diagnostics today, and the P8.4 slot inspector (`TimelineAssignmentsEditor`, `docs/timeline/ui.md:1483-1495`) is no longer in the tree. | **FACT** (grep: no `diagnostics()` caller outside tests; no `TimelineAssignmentsEditor` file) |
| Refusals | None specific to delete. A delete that would break an invariant is rolled back by the commit check (`timelineMembership.ts:577-579` notes the one case). | **FACT** |
| Dangling references | Only camera subjects in `view3d_cameras` JSON (above). | **FACT** |

## 3. The add path

**Entry:** Marchers sidebar → **Add** (`components/marcher/MarchersModal.tsx:54-62`) opens
`MarcherForm` with two tabs, **Add manually** and **Import from CSV**
(`components/marcher/MarcherForm.tsx:487-506`). **FACT.**

- **Manual:** section, drill prefix, starting drill number, quantity. Numbers already taken are
  skipped (`MarcherForm.tsx:143-195`). The starting number defaults to the **lowest free number**
  for the prefix (`MarcherForm.tsx:240-272`), so a deleted marcher's number is offered again.
  **FACT.**
- **CSV:** the parsed rows go straight to the same create mutation (`MarcherForm.tsx:274-287`).
  **FACT.**
- **The write:** `createMarchers` (`db-functions/marcher.ts:125-149`) inserts the rows and calls
  `giveNewMarchersHomesInTransaction` in the same undo step (`db-functions/timelineMarchers.ts:117-148`).
  **FACT.**

Where the new marcher appears:

| Where | What happens | Label |
| --- | --- | --- |
| Field, every page | It stands at its **home** through the whole show. Homes start eight steps in from the field's top-left, one row per section in section order, two steps apart, skipping rows that already hold a home. | **FACT** `timelineMarchers.ts:20-38`, `:43-79`; tests `db-functions/__test__/timelineMarchers.test.ts:166`, `:262`, `:319`, `:359` |
| Timeline / moves | Joins **no** move, not even empty ones. No clip rows are written. | **FACT** `timelineMarchers.test.ts:386`; `docs/adr/0012-timeline-motion-model.md:160-167` |
| Shapes | Joins no shape. Recipes list only marchers placed by them. | **FACT** `db-functions/shapeRecipes.ts:5-17` |
| Later edits | Moving it on page 2 writes its own move; that position carries forward to later pages. | **FACT** test `timelineMarchers.test.ts:224` |
| Cues (future) | ADR 0015 accepts that "a marcher added to a section later doesn't inherit that section's earlier cues, and fixing them is by hand." | **FACT** `docs/adr/0015-cue-model.md:146-148` |

**Into an existing formation?** Nothing in the UI. **FACT:**
`castMarchersIntoTransition` puts marchers into a transition's **vacant slots** by nearest-slot
casting (`db-functions/timelineAssignmentEdits.ts:119-237`), but it has no caller outside tests,
and shapes never get vacant timeline slots in today's flows. A placed shape's holes can't be
filled with new marchers either: "a spot with no marcher is planned, not built … Shapes with spots
that nobody stands on from the start come later (#358)" (`docs/adr/0006-shape-recipes.md:92-99`).
**INFERENCE:** today a designer re-places the shape over the old members plus the new one, which
re-lays out the shape by least travel.

## 4. Vacancy, hole, placeholder, ghost, unassigned

| Term | Where | Meaning | Label |
| --- | --- | --- | --- |
| Vacant slot (D-13, `D-VACANT`) | `docs/timeline/spec.md:126`; core resolver | A transition slot with no assignment: "allowed, flagged, and not an error". Designed so designers can author slots before casting (D-4). Not shown in the UI today. | **FACT** |
| Hole | `shapes/placed/placedBox.ts:40-41`, `:242-255`; ADR 0006 2026-10-14 revision (`docs/adr/0006-shape-recipes.md:68-73`) | A placed-shape spot whose member left. Kept in `params.spots`. Filled only by **Close up** (fewer spots) or **Re-split** (box). | **FACT** |
| Line point "Keep spacing even" | `CONTEXT.md:22-24` | A Line point that holds no marcher. Geometry, not a vacancy. | **FACT** |
| Ghost | `components/timeline/TimelineIsolationBar.tsx:553`, `TimelineClipPeel.tsx:12` | Gray dots of other marchers in isolation, and a drag preview clip. Not a missing performer. | **FACT** |
| Hole (page flags) | `db-functions/pageFlags.ts:417`, `:559` | Beats a flag drag can't land on. Unrelated. | **FACT** |
| Placeholder / unassigned marcher | — | No such concept. Every marcher row is a real performer. | **FACT** (grep found none) |

### What `timelineCasting.ts` and `leastTravel.ts` offer a re-staging feature

- `timeline/timelineCasting.ts`: pure. `nearestSlots` gives each marcher a slot with least total
  distance and leaves extra slots vacant (`:66-96`); `castSlots` falls back to lowest-slot order
  for follow-the-leader or over 500 slots (`:112-131`, `MAX_CAST_SLOTS` `:35`). Used by
  `castMarchersIntoTransition`, `recastTransition` (`db-functions/timelineAssignmentEdits.ts:272-345`)
  and `createTrack`, none of which the UI calls. **FACT.** **INFERENCE:** it is the right tool for
  "who fills which vacated spot", but it works on timeline slots, which today's app no longer uses
  for formations (each marcher has its own one-slot transition).
- `shapes/leastTravel.ts`: `leastSquaredTravel` (Hungarian on squared distance, then untangles
  crossing walks, `:27-42`) for equal counts, and `leastTravelOnto` for more spots than marchers,
  leaving the unneeded spots empty (`:44-70`). It is the "one replaceable solver" for shapes
  (`:5-12`). **FACT.** **INFERENCE:** `leastTravelOnto` already answers "fill N−1 marchers onto N
  spots and leave a hole", and `leastSquaredTravel` answers "lay the shape out again for N±1". A
  re-staging feature over placed shapes would build on these and on `closedUpParams`
  (`shapes/placed/placedBox.ts:299-335`), not on timeline casting.

## 5. Swap or replace a marcher

| Feature | What it does | Label |
| --- | --- | --- |
| **Swap marchers** (`$mod+S`, `$mod+Shift+S` on the web; field context menu; inspector button) | With exactly two selected, each takes the other's position **at the current moment** via `updateCoordinates`. | **FACT** `shortcuts/definitions.ts:595-603`; `shortcuts/handlers/useAlignmentActionHandlers.ts:143-166`; `field/three/FieldContextMenu.tsx:89`; `components/inspector/MarcherEditor.tsx:772-781` |
| Later pages after a swap | Each marcher keeps its own later moves; the swap is one position edit that carries forward only to each marcher's next move (C-12). It is not a swap of parts. | **INFERENCE** from ADR 0012 `:160-172` |
| Trade slots in a transition | `setAssignmentSlot` trades two marchers' slots (`db-functions/timelineAssignmentEdits.ts:349-404`). No UI caller. | **FACT** |
| Give X's part to Y / replace a marcher | Nothing. The closest is editing X's name, section or drill number in place (`MarcherForm.tsx:158-170`), which keeps the part because the row id stays. | **FACT** (no code); **INFERENCE** that editing in place is today's workaround for "a new person takes this spot" |

## Risks and surprises

- **Delete is the only "this person left" tool, and it throws the part away.** Moves, holds and
  shape membership go with the row. After more edits, undo is the only way back. (**INFERENCE**)
- **Silent holes.** A delete leaves holes in placed shapes with no toast or prompt; the
  Close-up offer only appears when the designer selects the shape. (**FACT** for no toast)
- **Number reuse looks like a restore but isn't.** The add form offers the deleted marcher's
  drill number; the new marcher stands at home with no part. (**FACT**)
- **Empty moves linger** as empty clips after their only marcher is deleted. (**FACT** for the
  data; **INFERENCE** for how it looks)
- **Dangling camera subjects** in `view3d_cameras` JSON, outside undo. Filtered at read time, so
  no crash. (**FACT**)
- **Stale comments** in `marcher.ts:222-236` and `useMarchers.ts:105`. (**FACT**)
