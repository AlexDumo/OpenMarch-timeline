---
phase: 7
title: Parity with page workflows
status: in-progress
owner: timeline-worker
branch: none
pr: none
depends_on: [6]
updated: 2026-09-29
---

# Phase 7: Parity with page workflows

Follow the protocol in [../README.md](../README.md). Claim a work package before you start, and append to the progress log as you go.

## Goal

In timeline mode, every existing page workflow works. Pages survive as named time labels over beats but stop storing coordinates. "Marchers on page N" means `positionsAt(end beat of N)`. "Move a marcher on page N" means editing that marcher's slot destination in the transition ending at N (D-16).

## Read first

- Spec R-E1, §6.1 (U-1 to U-3), §11, Q-1, Q-2
- Phase 6 handoff notes (page semantics)
- `docs/conventions/database-transactions.md` (ripple procedures are multi-table writes)

## Work packages

Each field is on its own line so that concurrent claims merge cleanly. Edit only the Owner, Status and PR lines of packages you own.

### P7.1: Inventory page-coordinate code

- Owner: timeline-worker (no code branch)
- Status: done
- PR: none
- Parallel: no
- Depends on: —

Inventory every reader and writer of `marcher_pages`, `shape_pages` and the pathway and midset tables. Put the list as a checklist in this file's handoff notes. Later work packages come from it; add rows for anything missing below.

### P7.2: Selection, drag and alignment

- Owner: timeline-worker (timeline/p7-drag-align)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/20
- Parallel: yes
- Depends on: P7.1

Selection, drag and alignment tools write slot destinations.

### P7.3: Marcher add and delete

- Owner: timeline-worker (timeline/p7-marchers)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/22
- Parallel: yes
- Depends on: P7.1

Marcher add and delete: the home position, plus a vacant or filled slot in each transition.

### P7.4: Page ripple procedures

- Owner: timeline-worker (timeline/p7-ripple)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/26
- Parallel: yes
- Depends on: P7.1

Page insert, delete and resize as **ripple procedures** in app code, ordered so every intermediate state is valid (U-1 to U-3), with `test:history` for each. This settles Q-1 and Q-2 for pages.

### P7.5: Beat ripple procedures

- Owner: timeline-worker (timeline/p7-ripple)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/26
- Parallel: yes
- Depends on: P7.4

Beat insert and delete ripple timeline rows (same rules as P7.4).

### P7.6: Copy and paste

- Owner: timeline-worker (timeline/p7-copy-paste)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/28
- Parallel: yes
- Depends on: P7.1

Copy and paste of positions.

### P7.7: Coordinate sheets and PDF

- Owner: timeline-worker (timeline/p7-coordinate-sheets)
- Status: in-review
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/35
- Parallel: yes
- Depends on: P7.1

Coordinate sheets and PDF export sample the resolver at page beats.

### P7.8: Video export and appearances

- Owner: timeline-worker (timeline/p7-exports)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/23
- Parallel: yes
- Depends on: P7.1

Video export and `exportAppearances` sample the resolver.

### P7.9: Keyframe export

- Owner: timeline-worker (timeline/p7-exports)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/23
- Parallel: yes
- Depends on: —

§11 keyframe export from the resolver (never read back as state).

### P7.10: Pathways, midpoints, step size and collisions in timeline mode

- Owner: timeline-worker (timeline/p7-pathways)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/33
- Parallel: yes
- Depends on: P7.1

Path, midpoint and endpoint drawing, step-size warnings, the inspector's step size and collision detection still read page rows in timeline mode, so they can disagree with the drawn marchers. Derive them from the resolver at page end beats, or gate them off and say so. Decide what to do with the dormant pathway writers. See the P7.10 items in the handoff notes.

### P7.11: Shapes and shape pages in timeline mode

- Owner: unassigned
- Status: open
- PR: none
- Parallel: yes
- Depends on: P7.1

Shape create, edit, delete, copy to another page and the shape lock rules. Today they write shape pages, shape marcher rows and marcher pages. Map them to timeline shapes and the transition into the shape. Coordinate with P7.2, which owns the plain selection and drag writes.

### P7.12: Mobile and performer exports

- Owner: timeline-worker (timeline/p7-mobile-exports)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/30
- Parallel: yes
- Depends on: P7.1

The mobile app payload and the performer appearance export read every page row. Build them from the resolver at page end beats. If the payload moves to keyframes, reuse P7.9's generator, and log the format change as a decision for a person.

### P7.13: Undo, redo and query invalidation in timeline mode

- Owner: timeline-worker (timeline/p7-undo-redo)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/29
- Parallel: yes
- Depends on: P7.1

After undo or redo the app jumps to a page and selects marchers based on page-row statements only, and several page-mode queries keep running in timeline mode. Make undo and redo navigate and select for timeline table changes, add the timeline query keys that the other packages introduce, and stop the page-mode fetches in timeline mode. Needs `test:history` cases.

### P7.14: Per-marcher-per-page appearance, rotation and notes

- Owner: project owner (decision)
- Status: done
- PR: none
- Parallel: no
- Depends on: P7.1

`marcher_pages` carries appearance overrides, rotation and notes with no timeline home, and the converter copies only x and y. First log a blocker asking a person to choose: drop them, keep them in the frozen page-era table, or add timeline fields (a schema and file format decision). Then P7.8 and P7.12 can finish their appearance work.

### P7.15: Refresh views on edits outside the change log

- Owner: timeline-worker (timeline/p7-15-refresh-views)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/32
- Parallel: yes
- Depends on: P7.13

Edits to `timelines` rows alone (name, range) and shape renames produce an empty change batch, so the resolver store version doesn't move and `useTimelineTracks` (and anything else keyed on that version) shows stale rows. See the handoff note from the P7.13 review. Spec 10.2 fixes the change log at five tables, and these edits don't affect resolution, so don't add tables to the change log or bump the resolver version for them. Instead, add a separate view signal: after any `transactionWithHistory`, undo or redo that touched `timelines` or `timeline_shapes`, bump a display version that the tracks and inspector views also follow. Cover undo and redo of a ripple that only moves a timeline's range, and a shape rename.

## Exit gate

Tick an item only after running its check, and paste the command and result into the log.

- [x] Every item in the P7.1 inventory is checked off (handoff notes, grouped by P7.2 to P7.14) (dropped: never implemented, owner decision 2026-09-30)
- [ ] Each feature's existing tests pass in timeline mode
- [ ] `test:history` passes for every ripple procedure
- [ ] Manual pass over editing, playback and export on a converted real show (human)

## Handoff notes

Kept current by the phase lead: where things stand, surprises, and what not to redo.

- This is the long pole. Split P7.1's inventory into more work packages if it's large.
- From the PR #14 review, the `marcher_pages` writers still reachable in timeline mode (only canvas drag is blocked), a head start for P7.1's inventory: keyboard nudges, snap/round, align, distribute and flip (`RegisteredActionsHandler.tsx` ~876 to 1213); the transform mutation in `useMarcherPages.ts` (~281); the alignment and line tools (`LineListeners.ts` ~262 → `setGlobalNewMarcherPages` → `AlignmentEditor.tsx`); the inspector x/y fields (`MarcherEditor.tsx`); `editablePath.tsx` and shape edits. Canvas drag (`DefaultListeners.ts` ~159, `updateMarcherPagesFunction`) reads `coordinate.page_id`, which is stale in timeline mode.

- From the P7.2 review (PR #20): in timeline mode, "set all/selected marchers to the previous/next page" is refused with a toast ("This isn't available in timeline mode yet.") and writes nothing, because it would copy stale `marcher_pages` rows. P7.6 (PR #28) replaced that refusal with a resolver-based version (`setMarchersToNeighborPage` in `src/utilities/setMarchersToNeighborPage.ts`, planning with `copyPagePositions`); `refuseInTimelineMode` no longer exists. The P7.2 coordinate tools read only the resolver in timeline mode, never `marcher_pages`, so they keep working once P7.3 stops writing those rows.

- Open item (from the P7.4/P7.5 review, PR #26): page and beat edits made while the timeline flag is OFF don't ripple the timeline rows (`withTimelinePageRipple` only runs in timeline mode). Turning the flag back on then shows rows over the wrong beats. Out of scope for P7.4/P7.5; it needs a policy before the flip (Phase 9), for example always ripple once a file has timeline rows, or re-convert on toggle.

- Unowned follow-up (from the P7.13 review, PR #29): some edits don't advance the resolver store version, so `useTimelineTracks` (and anything else that reloads on that version) keeps showing stale rows until a later batch arrives. These are edits to `timelines` rows alone (name, range) and shape renames. Cause: the change log (`timeline_change_log`, spec §10.2) covers only five tables (marchers, shapes, transitions, assignments, slot destinations), and a shape's row image has no name. So these writes give an empty batch, `notifyTimelineBatch` delivers nothing, and the version stays put. Not caused by P7.13. The lead routes it.

### P7.1 inventory of page-coordinate code

Written by P7.1 on 2026-09-30 against `timeline-try-2` at `e429b97c`. Paths are under `apps/desktop/` and line numbers are approximate. Tick an item when its owning package has either made it work in timeline mode or shown it needs no change. Legend: R reads page-era data, W writes it. "P5" means timeline mode already handles it. Re-run the searches in the P7.1 log entry before trusting this list after big merges.

Facts that change how to read the PR #14 note above:

- The inspector x/y fields are read-only: the inputs are `disabled` and `handleCoordsSubmit` (`src/components/inspector/MarcherEditor.tsx` ~464) does nothing. The inspector's writers are the distribute buttons (~171 to 246), which go through the same transform mutation as the keyboard actions.
- The `midsets` table has no reader or writer in app code (`src/hooks/queries/index.ts:5` has its hooks commented out). Only test mocks (`src/__mocks__/generators.ts`) mention it.
- The `pathways` table is written only by dormant code: `useEditablePath` (`src/components/canvas/hooks/editablePath.tsx`) installs create and update handlers, but nothing builds an editable path, because pathways are drawn as straight lines between page positions (`OpenMarchCanvas.ts` ~1422, "simple pathway method"). Writers reachable from the UI today: none. Readers are live (page-mode motion in `useCoordinateData.ts`).
- Collision detection does not run in either mode today: its trigger in `src/hooks/useAnimation.ts` ~140 to 146 is commented out ("TODO make collisions a query"), so the store stays empty.
- `marcher_pages` also holds per-marcher-per-page appearance columns, `rotation_degrees` and `notes`, which have no timeline home yet (see P7.14).
- There is no clipboard copy and paste of positions anywhere. P7.6 covers the nearest features (set marchers to previous or next page positions).
- Nothing in `packages/*`, the website or the CMS touches these tables.

#### P7.2 Selection, drag and alignment (writers of positions on the selected page)

- [x] `src/components/canvas/listeners/DefaultListeners.ts` ~144 to 159 · W · canvas drag and rotate; reads the stale `coordinate.page_id` · P5 blocked it (`Canvas.tsx` ~238 to 244 snaps back) · re-enable by writing the slot destination of the transition ending at the selected page's end beat (D-16) (P7.2: drag routed through `canvasCoordinateWriter`, which ignores `page_id` in timeline mode)
- [x] `src/components/canvas/Canvas.tsx` ~238 to 244 · W gate · the drag callback is swapped for a refresh in timeline mode · replace with the timeline write path (P7.2: replaced by the timeline write path)
- [x] `src/global/classes/canvasObjects/OpenMarchCanvas.ts` ~125 (the drag callback type), ~1150 (`renderMarcherPositions` copies the last page render's `coordinate`, so `page_id` is stale) · W plumbing · P5 partial · give timeline-mode marchers a real page id, or drop `page_id` from the drag path (P7.2: drag path drops `page_id`; `renderMarcherPositions` stamps the drawn page id)
- [x] `src/hooks/queries/useMarcherPages.ts` ~133 to 146 (`updateMarcherPagesMutationOptions`), ~222 to 312 (`useUpdateSelectedMarchers`, call at ~281, and the selected-page wrapper) · W · the one mutation behind nudges, align, distribute, flip, circle and the inspector · not handled · route to timeline slot edits; this is the main seam for the whole package (P7.2: `useUpdateSelectedMarchers` has a timeline branch; `moveMarchersOnPageMutationOptions` added. `updateMarcherPagesMutationOptions` is unchanged; its remaining timeline-mode caller is the dormant `editablePath` (P7.10); set-to-previous/next stopped using it in timeline mode in P7.6)
- [x] `src/db-functions/marcherPage.ts` ~141 to 228 (`updateMarcherPagesInTransaction`, `updateMarcherPages`) · W `marcher_pages`, and W `pathways` through `updateEndPoint` (~170 to 196) · not handled · the timeline equivalent edits a destination, with no pathway fix-up (P7.2: the timeline equivalent is `moveMarchersOnPage` in `src/db-functions/timelineMoves.ts`; the page function stays for page mode)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~995 to 1070 (nudge up, down, left, right via `updateSelectedMarchersAsync` at ~1007, 1026, 1045, 1064) · W · not handled (P7.2)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~1073 to 1097 (snap to nearest fraction, `updateMarcherPages` at ~1096) · W · not handled (P7.2)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~1111 to 1141 (align and evenly distribute; `updateMarcherPages` at ~1115, 1122, 1131, 1140) · W · not handled (P7.2)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~1143 to 1156 (flip horizontal and vertical; ~1147, 1154) · W · not handled (P7.2)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~1271 to 1291 (create circle through `updateSelectedMarchers`) · W · not handled (P7.2)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~541 to 554, ~604 to 620 (`getSelectedMarcherPages`) · R · selected-page coordinates feed the actions above · not handled · read from `positionsAt(end beat)` (P7.2: `withTimelinePositions`)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~1157 to 1170 with `src/db-functions/marcherPage.ts` ~230 to 365 (`swapMarchers`, `swapMarchersInTransaction`, `_swapSpms`) and `src/hooks/queries/useMarcherPages.ts` ~148 to 165 · W `marcher_pages` and `shape_page_marchers` · swap two marchers' positions on a page · not handled · in timeline terms, swap slot assignments or destinations (P7.2: swaps the two marchers' positions on the page through `moveMarchersOnPage`; slot assignments are not swapped)
- [x] `src/utilities/CoordinateActions.ts` (rounding ~58, vertical and horizontal align ~184 and ~217, distribute ~252, flip ~317) · pure helpers typed on `MarcherPage` and `ModifiedMarcherPageArgs` · not handled · loosen the input and output types so timeline code can reuse them (P7.2: no change needed; timeline code passes `MarcherPage` objects with resolver x/y)
- [x] `src/components/canvas/listeners/LineListeners.ts` ~150 to 262 (`setGlobalNewMarcherPages` at ~262) → `src/components/canvas/Canvas.tsx` ~360 → `src/stores/AlignmentEventStore.ts` ~12 to 67 → `src/components/inspector/AlignmentEditor.tsx` ~12 to 23 → the apply-quick-shape action at `RegisteredActionsHandler.tsx` ~1212 to 1223 · W (preview, then apply) · line and alignment tool · not handled · the apply step is the write (P7.2: preview reads the drawn positions; the apply step is routed)
- [x] `src/components/inspector/MarcherEditor.tsx` ~171 to 246 (horizontal and vertical distribute buttons) · W through the shared mutation · not handled (P7.2)
- [ ] `src/components/inspector/MarcherEditor.tsx` ~433 to 452 and `src/components/inspector/ShapeSelector.tsx` ~19 to 31 · R of the `isLocked` flag, which comes from shape membership · not handled · lock rules must come from timeline shapes
- [x] `src/components/inspector/MarcherEditor.tsx` ~487 to 500 (the x/y display from `ReadableCoords.fromMarcherPage`) and `src/global/classes/ReadableCoords.ts` ~94 · R · not handled · display from the resolver (P7.2: the display uses `usePositionAt` at the page's end beat in timeline mode)
- [x] `src/components/canvas/hooks/canvasListeners.selection.ts` ~29 to 30, ~263 · R · selection reads the page's marcher pages · not handled (P7.2: no change needed; the page query is only an effect dependency, no coordinates are read)
- [x] `src/components/canvas/Canvas.tsx` ~70 to 78, ~364 to 400, ~566 to 596 · R · page-mode static render, skipped once the resolver is ready · P5 (`drawFromResolver`, `useTimelineStaticRender`); the queries still run (P5; gating the queries is P7.13)
- [x] `src/hooks/useAnimation.ts` ~44 to 52, ~140 to 200 · R · page-mode playback from `useManyCoordinateData`; the timeline branch (~210 to 227) bypasses it · P5 · the page-mode queries still run in timeline mode (see P7.13) (P5; gating the queries is P7.13)
- [x] `src/timeline/timelineCanvas.ts` ~115 to 135 and `src/timeline/useTimelineStaticRender.ts` · R of the resolver at the page end beat · P5 done · keep as the model for "marchers on page N" (P5)

#### P7.3 Marcher add and delete (home position plus slot rows)

- [x] `src/db-functions/marcher.ts` ~92 to 195 (`createMarchersInTransaction` inserts one `marcher_pages` row per marcher per page, starting at a free spot) · W · not handled for timeline rows (the P6 fixture loader calls it at `src/timeline/fixtures/loadTimelineFixture.ts` ~107) · add the home position and a vacant or filled slot in each transition (P7.3: `createMarchers({ timelineMode: true })` adds a home and a holding slot in each page move through `addMarchersToTimelineInTransaction`; `createMarchersInTransaction` is unchanged, so the fixture loader is unaffected)
- [x] `src/db-functions/marcher.ts` ~290 to 315 (`deleteMarchers`; cascades to `marcher_pages` and `shape_page_marchers`) · W · not handled · also remove timeline assignments and slot rows (P7.3: `deleteMarchers({ timelineMode: true })` deletes the assignments first and compacts shapeless transitions through `removeMarchersFromTimelineInTransaction`)
- [x] `src/db-functions/marcherHome.ts` ~7 to 30 (`updateMarcherHomesInTransaction`) · W of the marcher home · exists · confirm it is the right write for "move a marcher on page 0" (P7.3: confirmed; P7.2's page 0 move and P7.3's add both write homes through it)
- [x] `src/hooks/queries/useMarchers.ts` ~84 to 150 (create and delete mutations; invalidate `marcher_pages` keys at ~94, 125, 144, and coordinate data at ~101, 148) · invalidation · not handled · add timeline query keys (P7.3: the mutations read the flag when they run (`readTimelineMode`). No timeline React Query keys exist; the resolver store picks up marcher and timeline changes from each edit's change batch. Evidence: `timelineMarchers.test.ts` calls `timelineResolverSettled()` after each add, delete, undo and redo, then reads the new or removed marcher from the running store)
- [x] `src/components/marcher/MarcherForm.tsx` ~178 and `src/components/marcher/MarcherList.tsx` ~74 · UI callers · not handled (P7.3: no change needed; the mutations read the flag themselves when they run, waiting for the settings if they are still loading)
- [x] `src/components/launchpage/newShowCompletion.ts` ~249 to 262 (delete, then create marchers on import) · W · new-show import · not handled (P7.3: no change; a new show starts with the flag off, so it is page mode, and conversion later takes homes from page 0)
- [x] `src/components/launchpage/newShowCompletion.ts` ~276 to 318 (`applyPreviousDotsCoordinates` writes page 0 `marcher_pages`) · W · new show from previous dots · not handled · in timeline mode this is the home position (P7.3: no change, for the same reason: new shows are page mode until converted)
- [ ] `electron/main/services/previous-dots-import-service.ts` ~85 to 114 · R of the source file's last-page `marcher_pages` · import of a previous show · not handled · if the source is a converted show its page-era rows are frozen and stale; read home or the resolver instead
- [x] `electron/database/repair.ts` ~235 to 241, ~303 (`removeOrphanMarcherPages`) · W cleanup · repair · likely no change until Phase 10, since the page-era tables stay; confirm it deletes nothing the converter relies on (P7.3: confirmed; it deletes only page rows whose marcher or page no longer exists, which the converter never reads)

#### P7.4 Page ripple procedures (insert, delete, resize pages)

- [x] `src/db-functions/page.ts` ~196 to 250 (`_createMarcherPages` copies the previous page's rows to each new page), called at ~302 · W · page insert · not handled · pages stop owning coordinates; a new page means a new time label plus valid timeline rows (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/db-functions/page.ts` ~264 to 335 (`createPagesInTransaction`, `createPages`), ~694 to 1065 (`createLastPage`, `_fillAndGetBeatToStartOn`, `canCreateLastPage`, `createLastPageInTransaction`, `getNextBeatToStartPageOn`), ~1112 (`createTempoGroupAndPageFromWorkspaceSettings`) · W · page and last-page creation · not handled (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/db-functions/page.ts` ~299 to 302, ~522 to 600 (`deletePagesInTransaction`, deletes `marcher_pages` at ~545), ~629 (`deletePageYank`) · W · page delete and delete-with-shift · not handled · must not leave timeline rows outside valid ranges (U-1 to U-3) (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/db-functions/page.ts` ~340 to 425 (`updatePagesInTransaction`), ~178 (`updateLastPageCounts`), ~471 (`ensureSecondBeatHasPage`) · W · page resize and rename · not handled · resize is a ripple (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/hooks/queries/usePages.ts` ~56 to 62 (invalidates `marcher_pages` keys), ~176 to 260 (mutations) and `src/hooks/queries/sharedInvalidators.ts` ~15 to 37 (`invalidateByPage`) · invalidation · add timeline keys (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/components/timeline/PageTimeline.tsx` ~35 to 45; `src/components/timeline/PageTimeline.utils.ts` ~103; `src/components/inspector/PageEditor.tsx` ~16; `src/components/inspector/PageNotesSection.tsx` ~17 · UI callers of the page mutations · not handled (PageNotesSection edits notes only and likely needs no change) (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [ ] `src/db-functions/shapePages.ts` ~347 to 372 and the foreign key on `shape_pages.page_id` · W cascade · deleting a page deletes its shape pages · see P7.11

#### P7.5 Beat ripple procedures (insert, delete, change the timing of beats)

- [x] `src/db-functions/beat.ts` ~178 (`shiftBeats`), ~259 (`flattenOrder`), ~345 (`createBeatsInTransaction`), ~440 (`updateBeatsInTransaction`), ~508 (`deleteBeatsInTransaction`) · W beats (they do not touch coordinates today) · not handled · timeline rows hold beat indexes, so each of these must ripple them (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/db-functions/measures.ts` ~152 to 270 (create, update, delete measures), ~284 (`createMeasuresAndBeatsInTransaction`), ~387 (`deleteMeasuresAndBeatsInTransaction`) · W beats and measures · music and measure tools · not handled (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/hooks/queries/useBeats.ts` ~69 to 150 and `src/hooks/queries/useMeasures.ts` ~59 to 215 · mutation wrappers and invalidation · add timeline keys (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)
- [x] `src/components/timeline/audio/BeatOrMeasureContextMenu.tsx` ~140, ~229, ~335 to 341, ~470 to 477 · UI callers: add, remove and change the timing of beats and measures · not handled (P7.4/P7.5: handled by `withTimelinePageRipple`, `src/db-functions/timelineRipple.ts`, PR #26)

#### P7.6 Copy and paste of positions

- [x] `src/utilities/RegisteredActionsHandler.tsx` ~857 to 986 (set all or selected marchers to the previous or next page's positions: four actions, `updateMarcherPages` at ~876, 913, 946, 981) · R neighbor page rows, W the current page · the only "copy position" features in the app · not handled · read `positionsAt` at the neighbor page end, write destinations (P7.6: in timeline mode `copyPagePositions` reads the resolver at the neighbor page's end beat and the handler writes through `moveMarchersOnPage`)
- [x] `src/utilities/RegisteredActionsHandler.tsx` ~544 to 548 (previous and next page queries feeding those actions) · R · not handled (P7.6: the neighbor-page queries are disabled in timeline mode)
- [x] No clipboard copy and paste exists. P7.6 decides whether to add one or to close with the two items above. Shape copy to another page belongs to P7.11. (P7.6: closed with the two items above; no clipboard feature added, since neither the spec nor `ui.md` asks for one)

#### P7.7 Coordinate sheets, drill charts and PDF

- [x] `src/components/exporting/ExportCoordinatesModal.tsx` ~110 to 450 (coordinate sheet export; reads all marcher pages at ~122, builds rows at ~240 to 323, calls the PDF export at ~357) · R · not handled · sample the resolver at each page's end beat (P7.7, PR #35: `buildCoordinateSheets` with `readTimelineExportPositions`, the resolver at each page end beat)
- [x] `src/components/exporting/MarcherCoordinateSheet.tsx` ~52 to 53, ~182 to 233, ~528, ~860 · R (per-marcher sheet preview and print) · not handled (P7.7: rows are a plain `PagePosition`; the modal's preview always shows example data)
- [x] `src/components/exporting/CoordinateSheetTemplates.tsx` ~13 to 48, ~117 to 130, ~165 to 305 · R (templates take page rows) · not handled · change the row type to a plain position (P7.7: row type is `PagePosition`; the file has no importer in the app)
- [x] `electron/main/services/export-utility-process.ts` ~185 (reads `marcher_pages` straight from the file), ~20 to 131, ~250 · R · PDF layout in a separate process · not handled · the resolver lives in the renderer, so either pass sampled rows in or run the resolver in that process (decide in P7.7) (P7.7: no change; the file is unreachable: nothing imports or forks it and it is not a Vite entry. Follow-up: delete it)
- [x] `electron/main/index.ts` ~449 and `electron/preload/index.ts` ~238 to 261 (the PDF export and per-marcher document contracts) · IPC · changing the payload is an IPC contract change, so log it as a decision first (P7.7: no change; `export:pdf` and `export:generateDocForMarcher` take HTML and SVG rendered in the renderer, so no contract change)
- [x] `src/components/exporting/ExportCoordinatesModal.tsx` ~703 to 1000 (drill chart export; marcher pages at ~706, appearances at ~741, `generateDrillChartExportSVGs` at ~913) · R · not handled (P7.7: the drill chart export passes the sampled map in timeline mode)
- [x] `src/components/exporting/utils/svg-generator.ts` ~80 to 430 (per-page SVGs read the current, previous and next page rows to draw positions and pathways) · R · not handled (P7.7: takes a `PagePositionMap`)
- [x] `src/utilities/SvgPreviewHandler.tsx` ~32 to 36, ~66, ~129 to 136 (launch page preview SVGs on close) · R · not handled (P7.7: samples the store resolver for the first page in timeline mode)
- [x] `src/global/classes/MarcherPage.ts` ~41 to 90 and `src/global/classes/MarcherPageIndex.ts` · R helpers (lookup by marcher and page, nested maps) used by the exports above · not handled · replace or adapt with a position-by-page map built from the resolver (P7.7: the exports use `PagePositionMap`, built from the resolver in timeline mode; page mode still uses these helpers)
- [x] `src/hooks/queries/useMarcherPages.ts` ~58 to 125 (`allMarcherPagesQueryOptions` and the by-page and by-marcher queries) and `src/db-functions/marcherPage.ts` ~411 to 470 · R · the page-era query layer all of the above use · stays until Phase 10; add a sibling query that samples the resolver (P7.7: kept for page mode until Phase 10; instead of a sibling query, the exports read once under the write lock with `readTimelineExportPositions`, as P7.12 does)

#### P7.8 Video export and appearances

- [x] `src/components/exporting/ExportCoordinatesModal.tsx` ~1253 to 1950 (video export; `useManyCoordinateData` at ~1350, `coordinateDataQueryOptions` and `combineMarcherTimelines` at ~1521 to 1534, page rows for appearances at ~1262 to 1317) · R · not handled · sample the resolver per frame (done in PR https://github.com/AlexDumo/OpenMarch-timeline/pull/23: timeline mode samples the resolver per frame; appearances ignore page rows)
- [x] `src/components/exporting/video/videoRenderer.ts` ~19, ~46 and `src/components/exporting/video/videoFrameRenderer.ts` ~9 to 16, ~92, ~106 (take per-marcher page-mode timelines and call the keyframe interpolator) · R · not handled (done: `frameSampler` replaces the page keyframes in timeline mode, page mode unchanged)
- [x] `src/components/exporting/utils/exportAppearances.ts` ~31 to 70 (`buildMarcherAppearancesByPageId` reads each page's rows for per-marcher-page appearances) · R · not handled · depends on the P7.14 decision (dropped: never implemented, owner decision 2026-09-30)
- [x] `src/hooks/queries/useMarcherAppearances.ts` ~98 to 190 (`_combineMarcherAppearances` puts the page row's appearance first in the stack; the query fetches marcher pages by page) · R · canvas appearances as well as exports · not handled · depends on the P7.14 decision (dropped: never implemented, owner decision 2026-09-30)
- [x] `src/components/singletons/StateInitializer.tsx` ~41 to 70 (prefetch of appearances and coordinate data for the selected, next and previous pages) · R · not handled · see P7.13 (P7.13: coordinate data prefetch gated in timeline mode; appearances still prefetched)
- [x] `electron/main/services/video-export-service.ts` · no direct reads (it receives encoded chunks) · no change expected; confirm (confirmed: no marcher, page or coordinate reads; no change)

#### P7.9 Keyframe export

- [x] `src/utilities/Keyframes.ts` (`MarcherTimeline`, `getCoordinatesAtTime` ~32, `findSurroundingTimestamps` ~118) · R · the page-mode keyframe interpolator, used by `useAnimation.ts` ~174, `CollisionDetection.ts`, video export and `useCoordinateData.ts` · P5 bypasses it for playback · the spec §11 generator (keyframes from the resolver, chord error within tolerance) does not exist yet; build it here and let P7.8, P7.10 and P7.12 reuse it (done: `src/timeline/timelineKeyframes.ts` builds spec 11 keyframes from the resolver)
- [x] `src/hooks/queries/useCoordinateData.ts` ~15 to 31, ~41 to 152 (`getMarcherTimelines`, `coordinateDataQueryOptions`; reads marcher pages and pathways), ~154 to 212 (`combineMarcherTimelines`, `useManyCoordinateData`) · R · page-mode keyframes built from page rows and pathways · not handled · stays until Phase 10 and must never be fed back as state (D-2) (unchanged; the export never reads it in timeline mode and never feeds keyframes back)

#### P7.10 (new) Pathways, midpoints, step size and collisions in timeline mode

- [x] `src/global/classes/canvasObjects/OpenMarchCanvas.ts` ~1253 to 1303 (`renderPathVisual`), ~1307 to 1455 (`renderPathVisuals` reads the previous, current and next page rows), ~1457 to 1476 (hide), with `MarcherVisualGroup.ts`, `Pathway.ts`, `Midpoint.ts`, `Endpoint.ts` and `stepSizeWarning.ts` in `src/global/classes/` · R · P5 left these drawing from page data, so they can disagree with the drawn marchers (P7.10, PR #33: `renderTimelinePathVisuals` draws `TimelinePathway` polylines sampled from the resolver between page end beats; midpoint = midset; straight lines hidden)
- [x] `src/components/canvas/Canvas.tsx` ~70 to 78, ~258 to 295, ~402 to 450 and `src/components/canvas/hooks/canvasListeners.movement.ts` ~32 to 107 · R · path render effects fed by page queries · not handled (P7.10: `useTimelinePathRender` replaces the page path effect once the resolver draws; the drag redraw is skipped then; the queries stay for the fallback, per P7.13)
- [x] `src/components/canvas/listeners/LineListeners.ts` ~75 to 262 · R and preview-only draw of temporary pathways from marchers to the line · not handled (the apply step is P7.2) (P7.10: positions already come from the drawn marchers; the marcher id now comes from the canvas marcher, since a resolver-drawn `coordinate` has no `marcher_id`. The preview paths stay straight from each marcher's current position to its new spot on the line: they preview a destination change, not a walked path)
- [x] `src/global/classes/StepSize.ts` ~143 to 240 and `src/components/inspector/MarcherEditor.tsx` ~502 to 562, ~658 to 715 · R · step sizes between the previous and current page rows · not handled · compute step size between page end beats from the resolver (P7.10: `useTimelineStepSizes`; after the PR #33 review the step size is the stride of the fastest moving stretch, the largest length per count over the non-hold spans clipped to the page; `StepSize.fromDistance`. The inspector keeps page mode's values until the resolver is ready)
- [x] `src/global/classes/CollisionDetection.ts` ~26 to 70, ~149 to 153, ~215 to 300, `src/stores/CollisionStore.ts` ~11 to 45, `src/hooks/useAnimation.ts` ~38, ~140 to 164, `src/components/canvas/Canvas.tsx` ~604 to 640 (markers), `src/components/toolbar/Toolbar.tsx` ~19, `src/components/toolbar/tabs/CollisionsTab.tsx` ~13 · R · collisions from page-mode timelines and the page-row hash; currently not computed in either mode (see the facts above) · decide whether to revive on the resolver or leave dormant (P7.10: left dormant in both modes; nothing feeds the store in timeline mode. Reviving it is a feature, not parity; it should sample `positionsAt` per beat)
- [x] `src/hooks/queries/usePathways.ts` ~48 to 290 (reads at ~81 and ~90; creates and updates `pathways` and sets `marcher_pages.path_data_id` at ~147 to 154; deletes at ~200), `src/db-functions/pathways.ts` ~16 to 90 (`updateEndPoint`, `findPageIdsForPathway`), `src/components/canvas/hooks/editablePath.tsx` ~14 to 45, `src/global/classes/canvasObjects/EditablePath.ts` ~15 to 125 · W `pathways` and `marcher_pages` · dormant (no reachable UI) · decide: leave frozen until Phase 10, or gate off in timeline mode. C-8: curved paths are a spec decision for Phase 9, not here (P7.10: gated off; `useEditablePath` writes nothing in timeline mode, reading the flag when it runs; page-era data left frozen until Phase 10)
- [x] `midsets` table · no reader or writer · confirm there is no work and close (mocks only) (P7.10: confirmed, no reader or writer outside mocks)

#### P7.11 (new) Shapes and shape pages in timeline mode

- [ ] `src/db-functions/shapePages.ts` ~159 to 245 (`createShapePages` writes `shape_pages`, `shape_page_marchers` and, through `_updateChildMarcherPages` at ~127 to 157, `marcher_pages`), ~247 to 322 (`updateShapePages`), ~325 to 372 (`deleteShapePages`) · W · not handled · map to timeline shapes plus the transition into the shape, with slot order from the shape's marcher order
- [ ] `src/db-functions/shapePages.ts` ~377 to 480 (`copyShapePageToPage`; reads `marcher_pages` at ~447) and `src/hooks/queries/useShapePages.ts` ~101 to 155 · R and W · copy a shape to another page · not handled
- [ ] `src/db-functions/shapePageMarchers.ts` (reads ~62 to 165; order shifts, swaps and flatten ~165 to 375; create with conflict handling ~385 to 480) · R and W `shape_page_marchers` · not handled
- [ ] `src/db-functions/shapes.ts` (`getShapes` ~74, create ~102 to 143, update ~145 to 192, delete ~194 to 235, `getShapesWithNoShapePages` ~237) · R and W `shapes` · not handled
- [ ] `src/global/classes/canvasObjects/MarcherShape.ts` ~35 to 100 (reads `shape_page_marchers`), ~250 to 275, ~285 to 335 (`_createMarcherShape` → `createShapePages`), ~336 to 380 (update args) and `StaticMarcherShape.ts` ~204 to 337 · R and W · canvas shape objects and edits (control point drag) · not handled
- [ ] `src/components/singletons/StateInitializer.tsx` ~37, ~104 (shape edit → `updateShapePagesMutationOptions`) · W · control point edits write shape pages and, through them, marcher pages · not handled
- [ ] `src/components/canvas/hooks/shapes.ts` ~19 to 40 and `src/components/canvas/hooks/canvasListeners.selection.ts` ~18 to 284 · R · shape rendering and selection by shape page · P5 left shapes drawn from page data
- [ ] `src/components/inspector/ShapeEditor.tsx` ~44 to 200, ~260 (copy to page, delete, edit) and `src/stores/SelectionStore.ts` · UI for shapes · not handled
- [ ] `src/utilities/RegisteredActionsHandler.tsx` ~1225 to 1244 (create a marcher shape from the alignment event) · W · not handled
- [ ] `src/hooks/queries/useShapePages.ts` ~29 to 100 (queries and keys) and `src/hooks/queries/utils.ts` ~41 (a `shape_page_marchers` change invalidates shape pages and marcher pages) · R and invalidation · not handled

#### P7.12 (new) Mobile and performer exports

- [x] `src/components/mobile/utilities/dots-to-om.ts` ~165 to 205 (`buildCoordinates` converts every page row to steps), ~265 (reads all `marcher_pages`), ~372 · R · mobile app payload · not handled · build the same payload from the resolver at page end beats (or from the P7.9 keyframes if the mobile format changes; that format change is a decision) (P7.12, PR #30: timeline mode samples a cold-built resolver at each page end beat through `readTimelinePagePositions`; page format kept)
- [x] `src/components/mobile/utilities/performer-appearance-export.ts` ~99 to 170, ~219 to 290 (appearance data per page, built from page rows) · R · not handled · depends on the P7.14 decision (dropped: never implemented, owner decision 2026-09-30)
- [x] `src/components/mobile/utilities/upload-service.ts` ~2 · caller of the export · no change expected (P7.12: confirmed, no change)

#### P7.13 (new) Undo, redo and query invalidation in timeline mode

- [x] `src/db-functions/history.ts` ~1160 to 1215 (after undo or redo, the page to jump to and the marchers to select come only from `marcher_pages` statements) · R · not handled · timeline table changes (already logged in `tablesWithHistory` at ~28 to 41) need the equivalent: select the affected marchers and jump to the affected page (P7.13: `timelineHistoryFocus` reads the action's change batch in timeline mode, PR #29)
- [x] `src/hooks/queries/utils.ts` ~25 to 54 and `src/hooks/queries/useHistory.ts` ~50 to 80 (query keys per table; "greedily invalidate all coordinate data") · invalidation · timeline table names map to their own keys, but no page-parity query uses those keys yet; wire them in as the other packages add queries (P7.13: no package added a timeline React Query; timeline tables now map to no keys, and views follow the resolver store version)
- [x] `src/hooks/queries/sharedInvalidators.ts` ~15 to 37 · invalidation after coordinate edits · add the timeline queries (P7.13: no change needed; there are no timeline queries to add)
- [x] `src/hooks/useAnimation.ts` ~44 (`useManyCoordinateData` keeps fetching page rows in timeline mode) and `src/components/singletons/StateInitializer.tsx` ~41 to 70 (prefetches coordinate data) · R · wasted work and a stale-data risk in timeline mode · gate by mode (P7.13: both gated; appearance prefetches stay, the canvas reads them in both modes)
- [x] Resolver rebuild on undo and redo of timeline tables (`notifyTimelineBatch` in `src/db-functions/history.ts`) · P4 and P5 · verify with a `test:history` case, not just by reading (P7.13: `timelineHistoryFocus.test.ts` compares the store with a fresh cold build after each undo and redo, under `test:history`)

#### P7.14 (new) Per-marcher-per-page appearance, rotation and notes (decision first)

- [ ] `electron/database/migrations/schema.ts` ~185 to 226 (`marcher_pages` columns: appearance columns, `rotation_degrees`, `notes`, path columns) · data with no timeline home · the converter copies only x and y · decision needed: drop, keep in the frozen page-era table, or add timeline fields. Record it as a blocker for a person before building anything
- [ ] `src/global/classes/MarcherPage.ts` ~1 to 40 and `src/hooks/queries/useMarcherAppearances.ts` ~98 to 190 · R · the per-page appearance override sits first in the appearance stack · see P7.8
- [x] `src/components/mobile/utilities/dots-to-om.ts` ~184 to 200 (`rotation_degrees` exported per coordinate) · R · see P7.12 (P7.12: left out in timeline mode, dropped per the P7.14 decision; page mode unchanged)

#### Checked: no timeline work needed

- [x] `src/__mocks__/generators.ts`, `src/__mocks__/globalMocks.ts`, `src/test/base.tsx`, `src/test/history.ts` · test support only
- [x] `src/global/Constants.ts` ~9 (a name prefix) and `src/components/field/customizer/ThemeTab.tsx` ~197 (a label) · names only
- [x] `src/settings/workspaceSettings.ts` ~24 · the timeline flag's doc comment
- [x] `src/components/timeline/PageTimeline.tsx` ~299, ~351 · only clears shape selection state

## Progress log

<!-- Append entries below, newest last, using the format in ../README.md. Never edit earlier entries. -->

### 2026-09-30 · timeline-worker (no code branch) · P7.1

- **Done:** inventory of page-coordinate code, written as a checklist in this file's handoff notes, grouped by owning package. It found 5 gaps that no existing package covered and adds P7.10 to P7.14: pathways, midpoints, step size and collisions; shapes; mobile and performer exports; undo and redo and query invalidation; per-marcher-per-page appearance, rotation and notes. Findings that correct earlier notes: the inspector x/y inputs are read-only (writers are the distribute buttons); no `midsets` reader or writer exists; pathway writers are dormant; collision detection is switched off in both modes; no position copy and paste exists, only set-to-previous or next page and shape copy.
- **Checks:** read-only searches, no code run. Searches (from `apps/desktop`, files only, then read by hand): `grep -rlE "marcher_pages|shape_pages|shape_page_marchers|pathways|midsets|schema\.shapes|marcherPages|MarcherPage|marcherPageKeys|ShapePage|shapePage|Midset|Pathway|midset|pathway" src electron ../../packages --include='*.ts' --include='*.tsx'` (74 non-test files); `grep -rlE "useCoordinateData|getMarcherTimelines|Keyframe|keyframe|videoExport|useMarcherPages|CoordinateActions|setGlobalNewMarcherPages|updateMarcherPages|ShapePageMarcher|getByMarcherAndPage" src electron` ; callers of the mutations: `grep -rnE "useUpdateSelectedMarchers|updateMarcherPagesMutationOptions|swapMarchersMutationOptions|updateMarcherPagesInTransaction|useCreatePathway|useUpdatePathway|copyShapePageToPage|createShapePages|updateShapePages|deleteShapePages" src`; beat, measure and page callers: `grep -rnE "(create|update|delete|shift|flatten)(Beats|Measures|MeasuresAndBeats|Pages|PageYank|LastPage)MutationOptions" src`; midset use: `grep -rnE "midsets|schema\.pathways" src electron`; copy and paste: `grep -rniE "clipboard|paste" src`; other packages: the same table-name search over `packages`, the website and the CMS found nothing. Test files, mocks and migrations were excluded.
- **Next:** the lead assigns P7.2 to P7.14. P7.14 starts with a blocker for a person. P7.4 and P7.5 are the riskiest (ripple procedures with `test:history`).
- **Blockers:** none for P7.1. P7.14 needs a person's decision on where per-page appearance, rotation and notes live.

### 2026-09-30 · lead session · P7.14 (decided)

- **Done:** the project owner decided that `marcher_pages`' per-page appearance overrides, `rotation_degrees` and `notes` are dropped in timeline mode: they were never implemented as features. The converter copies only x and y, and its loss report should list any non-empty values it finds so nothing disappears silently. 4 P7.14 checklist items ticked as dropped. P7.14 set to done; P7.8 and P7.12 no longer wait on it.
- **Checks:** none (decision only).
- **Next:** P7.2 onward after Phase 6 merges.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-drag-align) · P7.2 checkpoint

- **Done:** `moveMarchersOnPage` / `moveMarchersOnPageInTransaction` in `apps/desktop/src/db-functions/timelineMoves.ts`: one `transactionWithHistory` edit that turns "these marchers at these x/y on page N" into timeline writes. Page 0 (no previous page) sets homes. Page N ≥ 1 finds the R-2 winner among the marcher's rows with `start < pageEndBeat ≤ end`, requires that it and its transition end at the page's end beat, and updates that slot's destination. Decisions: a shape-backed transition is switched to individual points in the same edit, copying the shape's exact samples (Q-14 workaround; sampled through the public `createResolver`, so no new core export), then the slot is updated; follow-the-leader into a shape is refused (E-T5); a marcher with no move ending at the page's end beat is refused (E-ARGS) with a message naming it, left for P8.9. Everything is validated before the first write. Tests in `src/db-functions/__test__/timelineMoves.test.ts`.
- **Checks:** `pnpm --dir apps/desktop exec vitest run src/db-functions/__test__/timelineMoves.test.ts` → 7 passed.
- **Next:** route canvas drag, nudges, snap, align, distribute, flip, swap, circle, line tool and the inspector distribute buttons through it in timeline mode; read current positions from the resolver; fix the stale `coordinate.page_id`.
- **Resume from:** branch `timeline/p7-drag-align` at `5ff9f67b`. Add the timeline branch to `useUpdateSelectedMarchers` (`src/hooks/queries/useMarcherPages.ts`) and an `updateCoordinates` wrapper in `RegisteredActionsHandler.tsx`; replace the drag gate in `Canvas.tsx` ~238.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-drag-align) · P7.2 checkpoint 2

- **Done:** routing in timeline mode. `src/timeline/timelineCoordinateWrites.ts` (`withTimelinePositions` reads current x/y from the resolver at the page's end beat; `canvasCoordinateWriter` is the drag callback, and is the page-mode writer itself when the flag is off). Canvas drag is re-enabled (`Canvas.tsx`) and ignores the stale `coordinate.page_id`; `renderMarcherPositions` now stamps the drawn page's id too. `useUpdateSelectedMarchers` (nudges, circle, inspector distribute buttons) and `RegisteredActionsHandler` (snap, align, distribute, flip, swap, apply line tool) write through `moveMarchersOnPage` with the flag on; page mode calls are unchanged. Tests in `src/timeline/__test__/timelineCoordinateWrites.test.ts` (drag and align vertically, flag on and off).
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit` → clean; `vitest run` on the two new test files → 15 passed; `pnpm --dir apps/desktop run test:history src/db-functions/__test__/timelineMoves.test.ts` → 7 passed.
- **Next:** the regular desktop suite (running), then the PR and the checklist ticks.
- **Resume from:** branch `timeline/p7-drag-align` at `fcd54872`. Re-run `pnpm --dir apps/desktop run test` in the background, then open the PR and tick the P7.2 items.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-drag-align) · P7.2 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/20. `moveMarchersOnPage` (`src/db-functions/timelineMoves.ts`) writes homes (page 0) or slot destinations (page N ≥ 1) in one undoable edit. Every P7.2 writer is routed through it in timeline mode: drag (re-enabled), nudges, snap, align, distribute, flip, swap, circle, the line tool and the inspector's distribute buttons. Current positions are read from the resolver, and the inspector x/y display shows them too. The stale `coordinate.page_id` is no longer read on the drag path. Decisions: a shape-backed transition is switched to individual points copying the shape's exact samples, then updated (Q-14 workaround). Follow-the-leader into a shape is refused (E-T5). A marcher with no move ending at the page's end beat is refused (E-ARGS); creating one is for P8.9. Swap exchanges positions, not slot assignments. 20 P7.2 items ticked (3 of them already handled by P5).
- **Not ticked:** `MarcherEditor.tsx` ~433 to 452 and `ShapeSelector.tsx` (`isLocked` from shape membership; belongs with P7.11's timeline shapes). Also untouched: set-to-previous/next page still writes `marcher_pages` from page rows in timeline mode (P7.6).
- **Checks:** `pnpm install` ok; `pnpm exec turbo run build --filter=@openmarch/desktop^...` → 4 successful; `pnpm --dir apps/desktop exec tsc --noEmit` → clean; `vitest run src/db-functions/__test__/timelineMoves.test.ts src/timeline/__test__/timelineCoordinateWrites.test.ts` → 15 passed; `pnpm --dir apps/desktop run test:history src/db-functions/__test__/timelineMoves.test.ts` → 7 passed; `pnpm --dir apps/desktop run test` → 106 files passed, 7 skipped, 1591 tests passed (at `fcd54872`, before the inspector display commit, which has no tests; tsc, eslint and prettier cover it); cspell, prettier --check and eslint on the changed files → clean (only warnings that already existed). Skipped by policy: full `test:history`, Playwright, `build:electron`. The app was not run by hand.
- **Next:** review and merge. Exit-gate items unchanged.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-drag-align) · P7.2 review fixes

- **Decisions (P7.2, recorded for the phase):**
  - **Shape-backed transitions:** moving a marcher whose slot is in a shape-backed transition switches that transition to individual points in the same edit. Every slot is copied from the shape's exact samples, then the moved slots are updated (the Q-14 workaround). Follow-the-leader into a shape is refused (E-T5).
  - **Structural moves are refused and left to P8.9** (E-ARGS, naming the marcher). These are marchers with no move ending at the page's end beat: a hold, a winning assignment that spans several pages, or an assignment whose transition ends later.
  - **Swap** exchanges the two marchers' positions on the page and not their slot assignments. When a marcher's slot is in a shape-backed transition, the swap switches that transition to individual points, as any move does.
  - **Set to previous/next page** is refused in timeline mode until P7.6 (handoff note added).
- **Done (from the lead review of PR #20):**
  - In timeline mode, `getSelectedMarcherPages` and `useUpdateSelectedMarchers` build the selection from `selectedMarchers` and the resolver (`timelineCoordinateRecords`, `transformMarchersOnPage`). They no longer depend on `marcher_pages`, and `CoordinateActions` now accepts a `CoordinateRecord` (a `Pick` of `MarcherPage`).
  - Set to previous/next page is refused in timeline mode.
  - `timelineMoves.ts`: the empty-beats check now comes before `pageEndBeat`, shapes are read and sampled before the first write, and the comment says what a later DB rejection does.
  - New tests: a layered steal that wins and an earlier steal that doesn't; refusals for a multi-page move and for a transition that ends after its assignment; `Object.is` in the shape-switch test; a nudge on a marcher with no `marcher_pages` row; a swap with the flag on; set to previous with the flag on (no writes) and off.
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit` → clean. `vitest run src/db-functions/__test__/timelineMoves.test.ts src/timeline/__test__/timelineCoordinateWrites.test.ts` → 21 passed. eslint, prettier and cspell on the changed files → clean (the only warnings were already there). `pnpm --dir apps/desktop run test:history src/db-functions/__test__/timelineMoves.test.ts src/timeline/__test__/timelineCoordinateWrites.test.ts` → 21 passed. Branch head `483150f5`.
- **Next:** the lead re-reviews and merges PR #20.
- **Blockers:** none.

### 2026-09-30 · lead session · P7.2 (reviewed and merged)

- **Done:** fork PR #20 reviewed by a sub-agent (APPROVE WITH NITS: page mode unchanged on every routed path with hooks unconditional; the page N rule picks the highest-layer assignment ending at N's end beat per R-2 and refuses structural moves; the shape → individual switch keeps every other marcher's position bit for bit; positions come from the resolver, so no stale `marcher_pages` reaches a timeline write). The worker fixed the nits: timeline-mode selections come from the selected marchers rather than `marcher_pages`; "set to previous/next page" is refused in timeline mode until P7.6; every refusal is decided before the first write; added layered, multi-page, transition-ends-later and swap tests. Squash-merged. P7.2 set to done.
- **Checks:** at 483150f5: `pnpm --dir apps/desktop exec tsc --noEmit` (pass); `test:history` on `timelineMoves.test.ts` and `timelineCoordinateWrites.test.ts` (21 passed); `pnpm --dir apps/desktop run test` (106 files, 1,597 passed).
- **Next:** P7.3 onward.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-marchers) · P7.3 checkpoint

- **Done:** `apps/desktop/src/db-functions/timelineMarchers.ts` (`addMarchersToTimelineInTransaction`, `removeMarchersFromTimelineInTransaction`), wired into `createMarchers` and `deleteMarchers` behind a `timelineMode` argument (default false, so page mode is unchanged), the mutation options in `useMarchers.ts`, and the UI callers (`MarcherForm.tsx`, `MarcherList.tsx`) through `useTimelineMode`. Add: home at a free spot (checked against homes), then each shapeless transition whose rows are all layer 0 over the whole transition grows by one slot per new marcher, with the destination at the home and a layer-0 assignment over the transition. Delete: assignments deleted first, then shapeless transitions compacted (drop the last slot if vacated, otherwise move the last slot's marcher and point into the vacated slot), skipping shape-backed transitions and ones sharing a marcher with an inheriting follow-the-leader transition. Commit `b9ea5b68` (wip, untested).
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit` → clean. No tests yet.
- **Next:** tests in `src/db-functions/__test__/timelineMarchers.test.ts` (converted show: add, delete, undo/redo, flag off).
- **Resume from:** branch `timeline/p7-marchers` at `b9ea5b68`; write the tests modelled on `timelineMoves.test.ts`, run them with `pnpm --dir apps/desktop exec vitest run src/db-functions/__test__/timelineMarchers.test.ts` and with `test:history`.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-marchers) · P7.3 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/22 (commit `7c9d2809`). New `src/db-functions/timelineMarchers.ts` (`addMarchersToTimelineInTransaction`, `removeMarchersFromTimelineInTransaction`), run in the same edit as `createMarchers` / `deleteMarchers` when they get `timelineMode: true`; the mutation options and `MarcherForm` / `MarcherList` pass `useTimelineMode()`. Page mode is unchanged (flag default false; `createMarchersInTransaction` untouched). 8 P7.3 items ticked.
- **Decisions (P7.3, recorded for the phase):**
  - **Home of a new marcher:** the first free spot, found the way page mode places a new marcher on page 0 (8 steps in from the top left, down 2 steps until no marcher's home is there; several new marchers side by side 2 steps apart), checked against homes rather than frozen page rows.
  - **Add joins page moves only:**
    - The new marcher joins every shapeless transition whose rows are all layer 0 and span the whole transition (the converter's page moves). In each one, `slot_count` grows first, then the new slot's point is inserted at the home, then a layer-0 assignment covering the transition is added.
    - Transitions are taken in start order; any that overlap one already taken are skipped (E-A3), and so are transitions that would go past 10,000 slots.
    - Shape-backed transitions, steals and partial rows are not joined. The marcher holds through them.
  - **Delete compacts without moving anyone:**
    - The assignments are deleted first (children before the parent, C-1).
    - In each shapeless transition, the vacated slot is removed. If it is the last slot, its point is deleted and the count shrinks; otherwise the last slot's marcher and point move into the vacated slot, then the last slot goes.
    - Vacant slots stay (D-13, D-VACANT) in four cases: shape-backed transitions; a transition down to one slot; a last slot that was already vacant before the delete; and a transition that shares a marcher with a follow-the-leader transition using `order_mode = 'inherit'`, because R-12 orders that trail by slot index in the previous transition.
- **Not ticked:** `electron/main/services/previous-dots-import-service.ts`. When the source file is a converted show, it still reads that file's frozen last-page `marcher_pages` rows. Fixing it needs homes or the resolver read from another file in the main process. Left for a follow-up or P7.12-style work.
- **Checks:**
  - `pnpm install`: ok.
  - `pnpm exec turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run src/db-functions/__test__/timelineMarchers.test.ts`: 9 passed.
  - `pnpm --dir apps/desktop run test:history` on `timelineMarchers`, `marcher`, `timelineUndo` and `timelineMoves` test files: 4 files, 70 passed.
  - `pnpm --dir apps/desktop run test`: 112 files passed, 7 skipped, 1666 tests passed.
  - eslint, prettier --check and cspell on the changed files: clean. The only warnings are `react/prop-types` warnings in `MarcherForm.tsx` that were already there.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`. The app was not run by hand.
- **Next:** review and merge PR #22. Exit-gate items unchanged.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p7-marchers) · P7.3 review fixes

- **Done (from the lead review of PR #22, commit `d0024fbe`, after merging the current `timeline-try-2`):**
  - The marcher create and delete mutations no longer take the flag from `useTimelineMode()`, which is false while the workspace settings load. They now read it when they run, through `readTimelineMode` in `useWorkspaceSettings.ts`, which uses the cached settings or waits for them to load. As a result, `MarcherForm.tsx` and `MarcherList.tsx` are back to their original code. New test `src/hooks/queries/__test__/useMarchersTimelineMode.test.ts` checks two things: a create or delete started before the settings load waits for them and takes the timeline path, and cached flag-off settings give page mode.
  - The mid-order delete test now checks that the last slot's marcher has the vacated slot index, that the point at that slot holds the last slot's old coordinates (`Object.is`), and that positions a third of the way through each transition are unchanged.
  - New comments in `timelineMarchers.ts`: the `if (!point) break` branch can only run in a file that already breaks I-T6; the follow-the-leader marcher set includes the deleted marchers, which is harmless.
  - In this file, the notes on the `useMarchers.ts` and `MarcherForm.tsx` checklist items now describe the change. The query-keys item stays ticked, with the test evidence.
- **Checks:**
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run` on `timelineMarchers.test.ts`, `useMarchersTimelineMode.test.ts` and `marcher.test.ts`: 3 files, 47 passed.
  - `test:history` on `timelineMarchers.test.ts` and `marcher.test.ts`: 2 files, 44 passed.
  - eslint, prettier --check and cspell on the changed files: clean. The only eslint warnings are two unused imports in `useWorkspaceSettings.ts` that were already there.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`. I didn't rerun the regular desktop suite after these fixes.
- **Next:** the lead re-reviews and merges PR #22.
- **Blockers:** none.

### 2026-10-01 · lead session · P7.3 (reviewed and merged)

- **Done:** fork PR #22 reviewed by a sub-agent (APPROVE WITH NITS: the add order grow slot_count → point → assignment and the delete compaction (update the vacated point, re-key the last slot's assignment, delete the last point, shrink once) are valid at every intermediate state in both directions; the follow-the-leader guard is complete because FTL transitions always have a shape and only `inherit` FTLs read another transition's slot order). The worker fixed the nits: the timeline flag is read when the mutation runs, waiting for workspace settings if they're loading, so an add or delete can't fall back to page mode in that window; the mid-order delete test now proves the move-into-vacated-slot path and checks mid-transition positions. Squash-merged. P7.3 set to done.
- **Checks:** at d0024fbe, in the worker's work tree: `pnpm --dir apps/desktop exec tsc --noEmit` (pass); `test:history` on timelineMarchers, marcher and useMarchersTimelineMode (47 passed); `pnpm --dir apps/desktop run test` (113 files, 1,669 passed).
- **Next:** P7.4 onward. Open from P7.3: `previous-dots-import-service.ts` still reads a converted source file's frozen page rows (main process).
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p8-commands) · Cross-phase note from P8.9

- **Done:** P8.9 adds `shiftTimeline` (a clip move moves its whole spec timeline) and `createTrack` (`apps/desktop/src/db-functions/timelineCommands.ts`). It does **not** add a structural "move marcher on page N": the cases P7.2 refuses with E-ARGS (a hold through the page end, a winning assignment spanning several pages, a transition that ends later) are still refused. A workaround exists in timeline mode: Create Track for that marcher over the page makes a steal (one layer up) whose single destination can then be moved with `moveMarchersOnPage`, since that track's move ends at the page's end beat.
- **Remains:** a structural page move (split the spanning assignment and transition at the page end, or insert a steal automatically) is unowned; it needs a package in Phase 7 or 8.
- **Checks:** none for this note.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-exports) · P7.8, P7.9 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/23. Timeline mode only; page mode is unchanged (the new `frameSampler` is null with the flag off).
  - **P7.8:** `src/timeline/timelineExport.ts` adds `ResolverFrameSampler` (seconds to a beat with `beatAtTime`, `positionsAt` into one reused `Float64Array` through `TimelinePositionBuffer`, applied by marcher id), `acquireExportResolver` (the store's resolver when ready, otherwise a cold build with `readTimelineTables`, as the store does) and `readExportBeats`. `videoFrameRenderer.ts` (`setMarcherPositionsAtTime`, now exported) and `videoRenderer.ts` use the sampler when `frameSampler` is set. `ExportCoordinatesModal.tsx` (video export only) builds a preview sampler from the store resolver and the export's sampler from `acquireExportResolver`, skips the page keyframe queries and the marcher_pages dependency in timeline mode. `buildMarcherAppearancesByPageId` takes `timelineMode` and ignores marcher page rows (the dropped per-page fields, P7.14); `marcherPagesMap` is optional.
  - **P7.9:** `src/timeline/timelineKeyframes.ts`: `buildKeyframes(resolver, beats, { tolerance, float32 })`. Per marcher, one keyframe at every span edge and at the show's start (beat 1, show time 0) and end; inside every non-hold span, the interval is bisected in show time until 7 probes per piece (at 1/8 steps) are within the tolerance of the resolver (depth cap 14). Time-domain bisection also handles tempo changes. Default tolerance 0.01 field units; coordinates are rounded to Float32 by default (extra error at most 2^-24 of the coordinate; the resolver stays Float64). Helpers: `interpolateKeyframes`, `keyframesToMarcherTimelines` (page-mode shape in ms, for consumers of that format) and `keyframesToJson`. Exposure: `window.openmarchTimeline.exportKeyframes(options?)` returns the JSON text (dev console, no UI); nothing reads it back as state. Left as a follow-up for P7.10 / P7.12 to call `buildKeyframes` or `keyframesToMarcherTimelines`.
- **Decisions (recorded for the phase):** the export starts at beat 1 because beat 0 shares show time 0 with beat 1 (the app's tempo map); positions are continuous at span boundaries (P-1), so one keyframe per boundary is exact; the probe-based tolerance is checked against dense samples in the tests. The keyframe JSON shape (`format: openmarch-keyframes`, version 1, `[time, x, y]` triples) is a dev export and not a file-format commitment; the mobile payload format change stays a decision for a person (P7.12).
- **Not ticked:** `StateInitializer.tsx` prefetch (belongs to P7.13). The coordinate-sheet `useMarcherAppearances` and mobile items are other packages.
- **Checks:** `pnpm install` ok; `pnpm exec turbo run build --filter=@openmarch/desktop^...` ok; `pnpm --dir apps/desktop exec tsc --noEmit` clean; `vitest run src/timeline/__test__/timelineKeyframes.test.ts src/timeline/__test__/timelineExport.test.ts src/components/exporting` passed (keyframes on G1, G8, G8b, G6 and G12: boundaries present, dense chord error within tolerance for 0.01 and 1e-4, Float32 rounding, determinism, tempo change; frame sampling equals `positionAt` at `beatAtTime`, page mode unchanged; appearances ignore page rows; cold-built and store resolvers on a real DB); `pnpm --dir apps/desktop run test` (full regular suite) 119 files passed, 7 skipped, 1734 tests passed; eslint, prettier and cspell on `src/timeline` and `src/components/exporting` clean (one existing warning in `MarcherCoordinateSheet.tsx`). Skipped per policy: `test:history`, Playwright, `build:electron`.
- **Next:** review and merge.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-exports) · P7.8, P7.9 review fixes

- **Done (lead review of PR #23, commit 88fcbfb6):**
  - `acquireExportResolver` always cold-builds a separate resolver, so an edit during a long export can't change later frames; the live preview still uses the store's resolver, and now redraws when the store version changes. Test: an edit committed mid-export leaves the export resolver unchanged while the store follows it.
  - Keyframes: hitting the depth cap now reports `maxErrorAboveTolerance` per marcher and in the JSON, and logs a warning (test forces the cap with a tiny tolerance and `maxDepth`). Doc comments say the tolerance is a sampled bound (7 probes per piece) and that `keyframesToMarcherTimelines` can merge keys under 1 ms apart.
  - `timelineMode` is passed to `buildMarcherAppearancesByPageId` at the drill chart export and `SvgPreviewHandler` as well (covered by the builder's timeline-mode test).
  - In timeline mode the video preview's duration comes from `showEndTime(beats)`.
- **Checks:** `tsc --noEmit` clean; `vitest run src/timeline src/components/exporting` 287 passed; `pnpm --dir apps/desktop run test` 119 files passed, 7 skipped, 1735 tests passed; eslint, prettier and cspell clean (one existing warning in `MarcherCoordinateSheet.tsx`). Merged `timeline-try-2` first.
- **Next:** re-review and merge.
- **Blockers:** none.

### 2026-10-01 · lead session · P7.8, P7.9 (reviewed and merged)

- **Done:** fork PR #23 reviewed by a sub-agent (APPROVE WITH NITS: page mode unchanged on every export path; frame sampling and keyframe boundaries correct, including beat 0 and tempo changes). The worker fixed the nits: video export always cold-builds its own resolver (an edit mid-export no longer changes later frames; tested); the keyframe export reports the worst error left when the subdivision depth cap is hit and warns; the other two appearance callers ignore the dropped per-page fields; the preview redraws on store version changes and takes its duration from the beats. Squash-merged. P7.8 and P7.9 set to done.
- **Checks:** at 88fcbfb6, in the worker's work tree: tsc (pass); `test:focused src/timeline src/components/exporting` (25 files, 287 passed); the worker's regular desktop suite (119 files, 1,735 passed). It merged cleanly onto the base after PR #24.
- **Next:** P7.4 and P7.5 (page and beat ripple), now that P8.9's timeline shift exists.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-ripple) · P7.4, P7.5 checkpoint

- **Done:** `apps/desktop/src/db-functions/timelineRipple.ts` (commit `f9ea01bf`, wip, untested): `withTimelinePageRipple(tx, edit)` reads the page grid (beat ids in order, each page's ordinal range, as `fromDatabasePages` builds it) before a page or beat edit, runs the edit, reads it again and rewrites timelines, transitions and assignments to match in the same transaction. The flag is read inside the transaction from `workspace_settings`, so page mode is unchanged and no caller threads a flag. Wrapped: `createBeats`, `updateBeats`, `deleteBeats`, `shiftBeats`, `flattenOrder`, `createPages`, `updatePages`, `deletePages`, `deletePageYank`, `createLastPage`, `createTempoGroupAndPageFromWorkspaceSettings`, `updateUtility`, the page update and measures-and-beats mutations, split page, tempo group create and update, cascade measure delete, MusicXML import and the audio player's beat edits.
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit` clean. No tests yet.
- **Next:** tests in `src/db-functions/__test__/timelineRipple.test.ts`.
- **Resume from:** branch `timeline/p7-ripple` at `f9ea01bf`; write the tests (converted `marchersAndPages` show with the flag set in `workspace_settings`): beat insert before, inside and after a move; beat delete inside a move and refusals; page resize; page insert and delete; undo/redo round trips; flag off. Run with `pnpm --dir apps/desktop exec vitest run src/db-functions/__test__/timelineRipple.test.ts` and `pnpm --dir apps/desktop run test:history src/db-functions/__test__/timelineRipple.test.ts`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-ripple) · P7.4, P7.5 checkpoint 2

- **Done:** tests `src/db-functions/__test__/timelineRipple.test.ts` (17, converted show, flag in `workspace_settings`) pass; commit `5e7217e9`.
- **Checks:** `tsc --noEmit` clean; `vitest run` on the new test file: 17 passed; `test:history` on timelineRipple, beat, page, measures, timelineCommands and timelineRangeEdit: 6 files, 265 passed. Regular desktop suite running.
- **Next:** read the regular suite's result, write the decisions into the log, open the PR.
- **Resume from:** branch `timeline/p7-ripple` at `5e7217e9`; re-run `pnpm --dir apps/desktop run test` (background), then open the PR with `gh pr create --repo AlexDumo/OpenMarch-timeline --base timeline-try-2`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-ripple) · P7.4, P7.5 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/26 (head `5e7217e9`). New `apps/desktop/src/db-functions/timelineRipple.ts`: `withTimelinePageRipple(tx, edit)` reads the page grid before a page or beat edit, runs it, reads the grid again and rewrites timelines, transitions and assignments in the same transaction (one undo restores everything). The flag is read inside the transaction from `workspace_settings`; flag off runs only the page-mode edit. Every `transactionWithHistory` that changes beats, pages or `last_page_counts` is wrapped (beat.ts, page.ts, utility.ts, usePages, useMeasures, split page, tempo groups, cascade measure delete, MusicXML import, the audio player's beat edits). Ticked the P7.4 and P7.5 inventory items except `shapePages.ts` (P7.11). Query invalidation needed no timeline keys: timeline views rebuild on the resolver store version, which every committed batch bumps.
- **Decisions (recorded for the phase):**
  - **Row edges:** an edge on a page boundary follows its page, unless that empties the row; any other edge follows its beat (a start stays at its beat's start, an end at the end of the beat before it). Inserting k beats at ordinal p shifts rows starting at or after p by k and grows rows strictly containing p; a non-page row ending at p stays; a page move ending at p grows, because page mode gives beats inserted after a page's last beat to that page. Deleting beats shrinks the rows holding them and shifts later rows. Inserting right after beat 0 grows page 1's move (page mode's `ensureSecondBeatHasPage`).
  - **Q-1, page-scoped:** a page resize changes beat membership, not beat count. It edits the move ending at the moved boundary and the move starting there (R-E1 style, anchored assignments follow) and nothing else. Beat insert and delete ripple every later row.
  - **Q-2, page-scoped:** beats stay absolute; the procedure rewrites each later row explicitly, one logged statement each.
  - **Page delete:** the page's moves (transitions ending at its end and starting inside it) are deleted, children first; the previous page's move stretches over its beats, as page mode does. Yank also shifts later moves earlier. Deleting the last page leaves the previous page's range unchanged (page mode sets `last_page_counts`).
  - **Page insert, split and add last page:** each transition ending at the new page's start gets a holding transition over the page (same timeline, grown if needed; one slot per assignment ending there, at its layer; destination = position at the page start). With none, one hold for every marcher at layer 0 in the timeline containing the page start. Marchers busy at that layer over the page are left out.
  - **Refusals before any timeline write** (the page-mode statements roll back too): empty row `E-ARGS`, stranded assignment `E-A1`, transition outside its timeline `E-T1`, overlap or reorder at one layer `E-A3`.
  - **Order (U-3):** delete removed pages' transitions; grow timelines, then transitions, to the union; move assignments in dependency order per marcher and layer; shrink transitions, then timelines; add holds.
- **Known limits:** the audio player's "replace all beats" and MusicXML import create new beats in one edit and delete the old ones in another, so non-page tracks lose their beats in the second edit and it is refused (page moves follow their pages). One UPDATE per moved assignment, as in `shiftTimeline`.
- **Checks:**
  - `pnpm install`: ok.
  - `pnpm exec turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run src/db-functions/__test__/timelineRipple.test.ts`: 17 passed.
  - `test:history` on timelineRipple, beat, page, measures, timelineCommands and timelineRangeEdit: 6 files, 265 passed, 1 todo.
  - `pnpm --dir apps/desktop run test`: 122 files passed, 7 skipped; 1,777 tests passed.
  - eslint, prettier --check and cspell on the changed files: clean.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`. The app was not run by hand.
- **Exit gate:** "`test:history` passes for every ripple procedure" is not ticked; it becomes true when PR #26 merges, and the full suite is skipped by policy.
- **Next:** review and merge PR #26.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-ripple) · P7.4, P7.5 review fixes

- **Done (lead review of PR #26, commit `e3ddff2c`, after merging the current `timeline-try-2`):**
  - Page delete now removes only the page's **page moves**: shapeless transitions over exactly the page's beats whose assignments are all layer 0 and cover them (what the converter writes). Other tracks are never deleted by a page edit. If one would lose all its beats, the edit is refused with `E-ARGS` naming the move and its timeline, and nothing is written. Tests: a layer-1 track over exactly the deleted page is kept; deleting page 3 with its beats removes its page move and shifts the rest; the same delete with a track inside the page is refused and writes nothing.
  - The audio player's "replace all beats" is one edit: create the beats, point the pages at the new beats, replace the measures and delete the old beats, all under one ripple wrapper. A refusal therefore leaves nothing, not even the new beats. The audio mutations show timeline refusals through `toastTimelineError` and keep `audio.beats.*.error` for other errors. Tests: the replace is one edit that one undo restores; a refusal writes nothing.
  - New tests: a non-page track ending on a page boundary grows with the page when beats go in there; nested wrappers in one edit ripple once.
  - The module comment no longer says every refusal comes before the first write: the holding moves' out-of-bounds refusal runs after the ripple's writes, and the transaction rolls back.
- **Corrections to my in-review entry above:**
  - **Row edges:** any row's edge on a page boundary follows the page, not only page moves. So a track ending where a page ends grows when beats are inserted there, as the page's own move does. Only edges off page boundaries use the beat rule: a row ending at p stays when beats go in at p.
  - **MusicXML import** is one transaction and refuses cleanly. The known limit I gave for it was wrong. The audio player's two-edit replace was the real case, and it is fixed above.
- **Checks:**
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run src/db-functions/__test__/timelineRipple.test.ts`: 24 passed.
  - `test:history` on timelineRipple, beat, page, measures and EditableAudioPlayerUtils: 5 files, 281 passed, 1 skipped, 1 todo.
  - `pnpm --dir apps/desktop run test`: 127 files passed, 7 skipped; 1,864 tests passed.
  - eslint, prettier --check and cspell on the changed files: clean.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`.
- **Next:** the lead re-reviews and merges PR #26.
- **Blockers:** none.

### 2026-10-01 · lead · P7.4, P7.5

- **Done:** re-checked PR #26 at e3ddff2c and squash-merged it as 549451b2.
- **Checks:**
  - `tsc --noEmit` in `apps/desktop`: pass.
  - Focused `test:history` (`src/db-functions/__test__/`, `electron/database`, `src/components/timeline/audio`): 33 files passed; 756 tests passed.
  - `pnpm --dir apps/desktop run test`: 127 files passed and 1,864 tests passed, with 1 unhandled error. That error is the known Tolgee timer (`window is not defined` in `TimelineInspectorSection.test.tsx`), recorded in `findings.md`, and doesn't come from this PR.
  - Skipped by policy: the full `test:history` and e2e.
- **Next:** P7.6, P7.10–P7.13; P7.7 needs the PDF IPC decision.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-copy-paste) · P7.6 checkpoint

- **Done:** commit `93b8f310` on `timeline/p7-copy-paste`. `copyPagePositions` in `apps/desktop/src/timeline/timelineCoordinateWrites.ts` plans "set all or selected marchers to the previous or next page" from the resolver (each marcher's position at the source page's end beat; marchers already there get no move). The four actions in `RegisteredActionsHandler.tsx` use it in timeline mode and write through `moveMarchersOnPage` (one `transactionWithHistory` edit; homes on page 0, slot destinations otherwise), replacing the P7.2 refusal (`refuseInTimelineMode` removed). The neighbor-page `marcher_pages` queries no longer run in timeline mode. Tests: `src/timeline/__test__/timelinePageCopy.test.ts`.
- **Checks:** `tsc --noEmit` clean; `vitest run` on `timelinePageCopy.test.ts` and `timelineCoordinateWrites.test.ts`: 18 passed.
- **Next:** focused `test:history`, the regular desktop suite, lint, then the PR.
- **Resume from:** branch `timeline/p7-copy-paste` at `93b8f310`; run `pnpm --dir apps/desktop run test:history src/timeline/__test__/timelinePageCopy.test.ts src/timeline/__test__/timelineCoordinateWrites.test.ts` and `pnpm --dir apps/desktop run test` (background), then open the PR.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-copy-paste) · P7.6 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/28 (head `93b8f310`).
  - "Set all or selected marchers to the previous or next page" works in timeline mode. `copyPagePositions` (`src/timeline/timelineCoordinateWrites.ts`) reads each marcher's position on the neighbor page from the resolver at that page's end beat. `RegisteredActionsHandler.tsx` then writes the moves through the `moveMarchersOnPage` mutation as one `transactionWithHistory` edit: homes on page 0, slot destinations on later pages.
  - The P7.2 refusal (`refuseInTimelineMode`, `NOT_IN_TIMELINE_MODE_MESSAGE`) is removed.
  - The neighbor-page `marcher_pages` queries are disabled in timeline mode.
  - Page mode is unchanged.
  - Ticked the 3 P7.6 inventory items.
- **Decisions (P7.6, recorded for the phase):**
  - **No clipboard copy and paste.** The app never had one, and neither the spec nor `ui.md` asks for one, so P7.6 is closed with the set-to-previous/next actions. Copying a shape to another page belongs to P7.11.
  - **Marchers already at the source position get no move.** This avoids refusing a marcher that holds still across both pages, which has no move ending at the page's end beat. Positions are compared exactly.
  - **The edit is all or nothing.** Say a marcher's position must change but it has no move ending at the page's end beat. Then the whole edit is refused with `E-ARGS` and nothing is written, as P7.2 decided. Structural page moves stay unowned (see the P8.9 cross-phase note).
  - **No `withTimelinePageRipple`.** These actions write no pages or beats, only homes and slot destinations.
  - **The success toast** now shows only after the edit is written.
- **Checks:**
  - `pnpm install`: ok.
  - `pnpm exec turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run` on `timelinePageCopy.test.ts` and `timelineCoordinateWrites.test.ts`: 18 passed.
  - `pnpm --dir apps/desktop run test:history` on `timelinePageCopy.test.ts`, `timelineCoordinateWrites.test.ts` and `timelineMoves.test.ts`: 3 files, 28 passed.
  - `pnpm --dir apps/desktop run test`: 127 files passed, 1 failed; 1,870 tests passed, 1 failed; 1 unhandled error. Neither failure is related to this change:
    - `useTimelineTracks.test.tsx` timed out under suite load. It passes alone (5 passed), and it imports no changed file.
    - The unhandled error is the known Tolgee timer error (`findings.md`).
  - eslint, prettier --check and cspell on the changed files: clean. The 3 `react-hooks/exhaustive-deps` warnings in `RegisteredActionsHandler.tsx` were already on the base.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`. The app was not run by hand.
- **Exit gate:** unchanged.
- **Next:** review and merge PR #28.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-copy-paste) · P7.6 review fixes checkpoint

- **Done (lead review of PR #28, commit `560510e1`):**
  - **Stale-resolver plans:** the action now runs `timelinePositionsSettled()` (`src/timeline/timelineCoordinateWrites.ts`) before planning. That waits for `withTimelineWriteLock`, so every queued write has committed and delivered its batch, and then for `timelineResolverSettled()`. A nudge still in flight is no longer missed.
  - **Testable action:** the four actions are one plain function, `setMarchersToNeighborPage` (`src/utilities/setMarchersToNeighborPage.ts`). It takes `timelineMode`, the writes, `notify` and `t`, and the handler only wires it up. The success message shows only after `mutateAsync` resolves, and a refused write shows none.
  - **Translated planning errors:** planning errors go through `toastTimelineError`, both here and in P7.2's `getSelectedMarcherPages`. `conToastErrorMessage` is removed.
  - **Drill numbers in refusals:** the `E-ARGS` and `E-T5` refusals in `moveMarchersOnPage` name the marcher by drill number (`drill_prefix` + `drill_order`), falling back to the id. The edit is still all or nothing.
  - **Tests:** `timelinePageCopy.test.ts` now runs `setMarchersToNeighborPage` itself. It covers:
    - both page-mode branches;
    - the missing previous/next page message and an empty selection;
    - success only after the write;
    - previous from the last page and next from the second-to-last;
    - a shape-backed transition, which switches to individual points;
    - follow-the-leader, which is refused with `E-T5`;
    - a write in flight. Without the wait, this test fails; I checked by removing the wait.
  - **Docs:** the handoff note and the `useMarcherPages.ts` inventory note no longer mention `refuseInTimelineMode`. Cross-phase note on the stale-resolver pattern: below, and in Phase 8's log.
- **Cross-phase note (stale-resolver plans), for P7.10 to P7.13:** any tool that reads `useTimelineResolverStore.getState().resolver` to plan a write can plan from stale positions while an earlier write is still in its transaction. Batches reach the resolver only on commit. Await `timelinePositionsSettled()` before planning; never call it inside a wrapped write. P7.2's tools still read the resolver synchronously (`getSelectedMarcherPages`, `transformMarchersOnPage`). Rapid nudges are serialized by `isUpdatingDirection`, but an align pressed right after a nudge can still miss the nudge. Left as a follow-up; no package owns it yet.
- **Checks:** `tsc --noEmit` clean. `vitest run` on `timelinePageCopy.test.ts` and `timelineMoves.test.ts`: 25 passed. eslint, prettier and cspell on the changed files: clean, apart from the 3 warnings already on the base. The desktop suite and focused `test:history` are running.
- **Resume from:** branch `timeline/p7-copy-paste` at `560510e1`. Read the suite log, rerun `pnpm --dir apps/desktop run test:history src/timeline/__test__/timelinePageCopy.test.ts src/timeline/__test__/timelineCoordinateWrites.test.ts src/db-functions/__test__/timelineMoves.test.ts` alone, then update the PR #28 body.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-undo-redo) · P7.13 checkpoint

- **Done:** commit `5a935213` (wip). New `apps/desktop/src/db-functions/timelineHistoryFocus.ts`: in timeline mode, `performHistoryAction` picks the page to jump to and the marchers to select from the action's committed change batch (now returned as `HistoryResponse.timelineBatch`) instead of `marcher_pages` statements. Timeline table names map to no React Query keys. `useAnimation` and `StateInitializer` no longer fetch page-mode coordinate data in timeline mode. Tests in `src/db-functions/__test__/timelineHistoryFocus.test.ts`.
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit` clean; `vitest run src/db-functions/__test__/timelineHistoryFocus.test.ts`: 10 passed.
- **Next:** focused `test:history`, the regular desktop suite, lint, then the PR.
- **Resume from:** branch `timeline/p7-undo-redo` at `5a935213`; run `pnpm --dir apps/desktop run test:history src/db-functions/__test__/timelineHistoryFocus.test.ts src/db-functions/__test__/history.test.ts src/db-functions/__test__/timelineUndo.test.ts` and `pnpm --dir apps/desktop run test` (background), then open the PR.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-copy-paste) · P7.6 review fixes ready

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/28 is at head `560510e1`, and the PR body is updated with the review fixes listed in the checkpoint above. P7.6 stays in review; the Owner, Status, PR and inventory lines are confirmed on `timeline-try-2`.
- **Checks:**
  - `tsc --noEmit`: clean.
  - `vitest run` on `timelinePageCopy`, `timelineCoordinateWrites` and `timelineMoves`: 35 passed.
  - `test:history` on the same three files: 35 passed.
  - `pnpm --dir apps/desktop run test`, run once: 127 files passed, 1 failed; 1,870 tests passed, 8 failed. All 8 are in `timelinePageCopy.test.ts` ("attempt to write a readonly database"). I had run that file in history mode at the same time, from the same directory, and the test database path is `<cwd>/<task id>.tmp.dots`, so the two runs collided. Run alone afterwards, it passes in both modes (above).
  - eslint, prettier and cspell: clean, apart from 3 warnings that are already on the base.
  - Skipped by policy: the full `test:history`, Playwright and `build:electron`.
- **Next:** the lead re-reviews and merges PR #28.
- **Blockers:** none.

### 2026-10-01 · lead · P7.6

- **Done:** reviewed PR #28 and squash-merged it at head 560510e1.
  - The review found five items, all fixed in 560510e1:
    - the action now waits for queued writes to settle before planning;
    - planning errors go through `toastTimelineError`;
    - refusals name marchers by drill number;
    - the action is extracted to `setMarchersToNeighborPage` with real branch tests;
    - the phase docs no longer mention `refuseInTimelineMode`.
- **Checks** (run by the lead on 560510e1):
  - `tsc --noEmit`: pass.
  - Focused `test:history` on `src/db-functions/__test__/`, `timelinePageCopy` and `timelineCoordinateWrites`: 25 files, 608 tests passed.
  - `pnpm --dir apps/desktop run test`: 128 files and 1,878 tests passed, no errors.
  - Skipped by policy: the full `test:history` suite and e2e.
- **Next:** P7.2's tools still plan without waiting for writes to settle. That gap went to the P7.13 worker, either to fix or to log as a follow-up.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-undo-redo) · P7.13 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/29 (head `fd7b1d53`, two `wip:` commits to squash). New `apps/desktop/src/db-functions/timelineHistoryFocus.ts`. With the flag on, `performHistoryAction` takes the page and marchers from the action's committed change batch, now returned as `HistoryResponse.timelineBatch`. It no longer uses `marcher_pages` statements. Other changes:
  - `useHistory.ts` passes the selected page.
  - It jumps to page 0 too: page 0's id is 0, so it now compares with `!= null`.
  - It never selects an undefined page.
  - It selects marchers from the marcher list fetched after the invalidation.
  - Timeline table names map to no React Query keys.
  - `useAnimation` and `StateInitializer` no longer fetch page-mode coordinate data in timeline mode.
  - Page mode is unchanged.
  - Ticked the 5 P7.13 items and the P7.8 `StateInitializer` item, which points here.
- **Decisions (P7.13, recorded for the phase):**
  - **Page of a change:**
    - A home change belongs to the first page.
    - A transition, assignment or slot destination belongs to the page whose beats `(start, end]` hold its end beat (D-16).
    - A shape change belongs to the pages of the transitions into it.
    - A deleted row is read from its image before the action.
  - **Marchers of a change:**
    - A home change: that marcher. An assignment: its marcher. A slot destination: the marcher in that slot.
    - A transition or shape: everyone assigned to it, unless the batch also changes that transition's assignments or destinations. Then those rows name the marchers.
  - **Which page to show:** the current page if the action changed it. Otherwise the earliest changed page (where a ripple or marcher add begins). The marchers changed on it are selected; with none, the selection is left alone.
  - **Timeline mode never reads `marcher_pages` statements after an undo**, even when the action also replayed some (page ops still write them inside the ripple).
- **Not changed, on purpose:**
  - `Canvas.tsx` keeps its `marcher_pages` queries: P5's fallback draws from them until the resolver is ready, and P7.10's path visuals depend on them.
- **Findings for follow-ups:**
  - `rowIdFromSql` in `history.ts` parses the whole `WHERE rowid=N` match, so it returns `NaN`. Page mode has therefore never navigated after an undo. Left alone (page-mode behavior).
  - A change to `timelines` rows alone (name, range) is not in the change batch, so the store version doesn't bump. `useTimelineTracks` keeps showing the old row until some later batch arrives. This can happen after an undo of a ripple that only moved a timeline's range. It needs a version bump outside the change log, or the `timelines` table added to it (spec §10.2 lists only five tables). Unowned; the lead should route it.
  - `useHistory` reads `pages` from the render that started the action. A redo that restores a page this render doesn't know yet stays on the current page instead of jumping.
  - From the lead's note: the P7.2 coordinate tools still plan from the resolver synchronously, so an action pressed right after a nudge, or right after an undo, can plan from the state before it. PR #28's `timelinePositionsSettled()` is the fix. P7.13 left it alone because #28 is still open; it's a follow-up.
  - The open threads named for this package stay open:
    - flag-off edits don't ripple (P7.4 handoff note; needs a policy);
    - the inspector's stale-target window after a write (PR #27). P7.13 needed no shared fix for it.
- **Checks:**
  - `pnpm install`: ok.
  - `pnpm exec turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run src/db-functions/__test__/timelineHistoryFocus.test.ts`: 10 passed.
  - `test:history` on timelineHistoryFocus, history, timelineUndo, timelineMoves, timelineMarchers and timelineRipple: 6 files, 119 passed. Run at `fd7b1d53`, after the suite had finished.
  - `pnpm --dir apps/desktop run test`: 128 files passed, 7 skipped; 1,874 tests passed. The run started at `5a935213`; the `fd7b1d53` refactor of the same module landed while it was running.
  - eslint, prettier `--check` and cspell on the changed files: clean. The only eslint warnings are 3 in `StateInitializer.tsx` that were already there.
  - Skipped by policy: the full `test:history` suite, Playwright and `build:electron`. I didn't run the app by hand.
- **Exit gate:** unchanged.
- **Next:** review and merge PR #29.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-mobile-exports) · P7.12 checkpoint

- **Done:** commit `31e23071` on `timeline/p7-mobile-exports`. New `apps/desktop/src/timeline/timelinePagePositions.ts`: `readTimelinePagePositions(db)` awaits `timelinePositionsSettled()`, then, under the write lock, cold-builds a resolver (`acquireExportResolver`, P7.8) and reads the pages (`readShowTiming`), and samples every marcher at each page's end beat (`sampleTimelinePagePositions`, `pageEndBeat`). `dots-to-om.ts` reads the timeline flag from `workspace_settings` and, in timeline mode, builds the payload's coordinates from those samples instead of `marcher_pages`, with no per-page rotation or appearance overrides (dropped, P7.14). Page mode is unchanged. Tests: `src/components/mobile/utilities/__test__/dots-to-om.timeline.test.ts`.
- **Checks:** `tsc --noEmit` clean; `vitest run src/components/mobile`: 8 files, 83 passed. The in-flight-write test fails when the wait is removed (checked by hand).
- **Next:** the regular desktop suite, then the PR.
- **Resume from:** branch `timeline/p7-mobile-exports` at `31e23071`; run `pnpm --dir apps/desktop run test` in the background, then open the PR with `gh pr create --repo AlexDumo/OpenMarch-timeline --base timeline-try-2`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-undo-redo) · P7.13 review fixes checkpoint

- **Done (lead review of PR #29; merged `timeline-try-2` first, with #27 and #28, in a normal merge commit; review fixes in `61814b53`):**
  - **One lock turn:** `performHistoryAction` now reads the timeline focus in the action's own lock turn, right after it commits and delivers its batch. Before, two quick undo actions queued as undo, undo, focus, focus, so the first focus saw the state after the second undo. Test: two queued undo actions; the first focus still sees the marcher that the second undo removes.
  - **Waiting for the target page:** `useHistory` keeps the target page pending until the page list has it, then goes there and selects the marchers. The marchers are selected only together with that page; with no page, only the marchers are selected. New hook test `src/hooks/queries/__test__/useHistory.test.tsx` covers page 0, a page that appears after the page list is fetched again, restored marchers, and the no-page case.
  - **Page 0 in page mode:** page mode now selects the marchers on page 0 too (`!== undefined`). Together with the earlier `!= null` fix in `useHistory`, page mode can now jump to page 0.
  - **Deletes across beat changes:** when the action also changed `beats`, rows it deleted no longer place a page, because their beats are on the old grid. Rows that still exist decide. Tested on a crafted batch.
  - **Handoff note added** (as the lead asked): the follow-up for `timelines`-only edits and shape renames that don't advance the store version.
  - **Known limit for the PR:** turning the flag off while the app is running starts with an empty page-mode coordinate cache, because nothing was fetched in timeline mode. Playback can stop until those queries load.
- **Checks:**
  - `pnpm install` and `turbo run build --filter=@openmarch/desktop^...`: ok.
  - `tsc --noEmit`: clean.
  - `vitest run` on `timelineHistoryFocus.test.ts` and `useHistory.test.tsx`: 16 passed.
  - `test:history` on timelineHistoryFocus, history, timelineUndo, timelineMoves, timelineMarchers and timelineRipple: 6 files, 121 passed.
  - eslint and cspell on the changed files: clean.
  - The regular desktop suite is running.
- **Next:** read the suite's result, then update the PR body.
- **Resume from:** branch `timeline/p7-undo-redo` at `61814b53`. Re-run `pnpm --dir apps/desktop run test` (background), then update PR #29's body from the scratch file `pr-P7.13.md`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-undo-redo) · P7.13 review fixes in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/29 is updated at head `61814b53`: the merge of `timeline-try-2`, plus the review fixes described in the checkpoint above. The PR body now says that page mode jumps to page 0. It also states the known limit: turning the flag off at runtime starts with an empty coordinate cache.
- **Checks:**
  - `pnpm --dir apps/desktop run test` (one run, after the merge): 133 files passed, 7 skipped; 1,953 tests passed.
  - Earlier at the same head:
    - `tsc --noEmit`: clean.
    - The new and changed test files: 16 passed.
    - Focused `test:history` (6 files): 121 passed.
    - eslint and cspell on the changed files: clean.
  - Skipped by policy: the full `test:history` suite, Playwright and `build:electron`.
- **Next:** the lead re-reviews and merges PR #29.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-mobile-exports) · P7.12 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/30 (head `31e23071`, one commit). In timeline mode the mobile app payload (`dots-to-om.ts`) takes each marcher's position on each page from the resolver at the page's end beat, through the new `readTimelinePagePositions` (`src/timeline/timelinePagePositions.ts`). That function awaits `timelinePositionsSettled()`, then, under the write lock, cold-builds a private resolver (`acquireExportResolver`, P7.8) and reads the pages (`readShowTiming`). It never reads `marcher_pages`. Page mode is unchanged. Ticked the 2 open P7.12 inventory items and the P7.14 `rotation_degrees` item that points here.
- **Decisions (P7.12, recorded for the phase):**
  - **Payload format kept:** one position per marcher per page, as page mode sends. P7.9's keyframes are not used, because that would change the mobile format.
  - **Per-page fields left out:** in timeline mode the payload has no per-page `rotation_degrees` and no per-page appearance overrides, following the P7.14 decision. Section and tag appearances are unchanged.
  - **Snapshot:** the export uses its own cold-built resolver, so an edit made during the upload can't change it halfway. A write still in flight when the export starts is included.
  - `sampleTimelinePagePositions` is a pure helper that P7.7 (coordinate sheets) can reuse for "positions by page" from the resolver.
- **Open question for a person (not a blocker):** the mobile app sees only page-end positions. Timeline motion that a page-end sample can't show (shape paths, or steals and holds that end mid-page) is flattened to straight moves between pages. Carrying it would mean adding keyframes (`buildKeyframes`, P7.9) to the mobile payload, which is a format change for the mobile app and server.
- **Not in scope:** `electron/main/services/previous-dots-import-service.ts` (P7.3's open item) still reads a converted source file's frozen `marcher_pages`.
- **Checks:**
  - `pnpm install`: ok.
  - `pnpm exec turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
  - `vitest run src/components/mobile`: 8 files, 83 passed.
  - `test:history` on `dots-to-om.timeline.test.ts` and `dots-to-om.test.ts`, run alone after the suite: 2 files, 20 passed.
  - `pnpm --dir apps/desktop run test`: 132 files passed, 7 skipped; 1,944 tests passed, no errors.
  - eslint, prettier `--check` and cspell on the 3 changed files: clean. The only warning (`max-lines-per-function` on `buildOpenMarchFromRows`) was already on the base.
  - Skipped by policy: the full `test:history` suite, Playwright and `build:electron`. No db-functions changed. I didn't run the app by hand.
- **Exit gate:** unchanged.
- **Next:** review and merge PR #30.
- **Blockers:** none.

### 2026-10-01 · lead · P7.13

- **Done:** reviewed PR #29 and squash-merged it at head 61814b53.
  - The review found two medium issues, both fixed:
    - The focus was read in a second lock turn, so a quick double undo saw the later state.
    - `useHistory` searched the page list from before the action, so a restored or added page was dropped.
  - Also fixed:
    - page-mode marcher selection on page 0;
    - deleted rows across beat changes no longer decide the page.
  - The branch merged #27 and #28 before verification.
- **Checks (lead, on 61814b53):**
  - `tsc --noEmit`: pass.
  - Focused `test:history src/db-functions/__test__/`: 25 files, 604 tests passed.
  - `pnpm --dir apps/desktop run test`: 133 files, 1,953 tests passed, no errors.
  - Skipped by policy: the full `test:history` and e2e suites.
- **Next:** route the stale `useTimelineTracks` follow-up. It is caused by edits to `timelines` rows and shape names, which the change log doesn't cover.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-pathways) · P7.10 checkpoint

- **Done:** commit `cb984e71` (wip, no tests yet) on `timeline/p7-pathways`. `sampleMarcherPath` in `src/timeline/timelineKeyframes.ts` (P7.9's span-edge plus bisection sampler, in beats); new `src/timeline/timelinePaths.ts` (paths between page end beats, midset midpoint, length, step sizes), `TimelinePathway` (a fabric polyline), `OpenMarchCanvas.renderTimelinePathVisuals`, `useTimelinePathRender` (wired in `Canvas.tsx`; the page-mode path effect and the drag redraw skip once the resolver draws), `useTimelineStepSizes` (inspector), `StepSize.fromDistance`, an optional `distance` for `evaluatePathWarning`, `marcher_id` from the canvas marcher in `LineListeners`, and editable-path writers that write nothing in timeline mode.
- **Checks:** `pnpm --dir apps/desktop exec tsc --noEmit`: clean.
- **Next:** tests for the sampler, paths, step sizes and the canvas renderer; then the suite and the PR.
- **Resume from:** branch `timeline/p7-pathways` at `cb984e71`; write `src/timeline/__test__/timelinePaths.test.ts` (golden fixtures with arcs and follow-the-leader), run `pnpm --dir apps/desktop exec vitest run src/timeline/__test__/timelinePaths.test.ts`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-15-refresh-views) · P7.15 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/32. A display version in `apps/desktop/src/db-functions/timelineDisplay.ts` bumps after a `transactionWithHistory` commit, undo or redo that touched `timelines` or `timeline_shapes`; `useTimelineTracks` and `useTimelineInspections` reload on it and tag reads with it. No change-log tables added, resolver version untouched.
- **Checks:** `test:history` on `timelineDisplay.test.ts` and `timelineHistoryFocus.test.ts`: 18 passed. `pnpm --dir apps/desktop run test`: 134 files, 1960 tests passed. `tsc --noEmit`: clean. eslint on changed files: no errors. Skipped per policy: full `test:history`, e2e.
- **Note:** a shape rename does bump the resolver version too (the `shapes` change-log table fires on it), so the display bump is redundant for shapes but harmless; a `timelines`-only edit is the real gap. The package's "ripple that only moves a range" is covered by a direct range edit with undo and redo; no existing ripple in the converted fixture changes only a timeline range.
- **Next:** review and merge.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-mobile-exports) · P7.12 review fixes checkpoint

- **Done (lead review of PR #30):** merged `timeline-try-2` (with #29) as `3566f8a5`; fixes in `357f1e90`.
  - All the payload's reads and the resolver build now run inside one `withTimelineWriteLock` (`fetchDotsData` in `dots-to-om.ts`), and sampling runs after the lock is released.
  - Sampling (`sampleTimelinePagePositions`) makes one `positionsAt` call per page into a reused `Float64Array` and yields to the event loop every 8 ms.
  - `timelinePositionsSettled()` is dropped. With only the lock, the in-flight test still passed, and the export's resolver is private. Both lock tests (a write in flight; a write queued mid-export) now fail when the lock is removed (checked by hand).
  - The doc comments of `toOpenMarchSchema` and `toCompressedOpenMarchBytes` say they take the write lock in timeline mode.
  - New tests: a dropped rotation; a page and a marcher created after conversion; a page-mode snapshot, written by the previous `dots-to-om.ts` and passing on the new one.
- **Checks:** `tsc --noEmit` clean; `vitest run src/components/mobile`: 8 files, 88 passed. eslint, prettier and cspell: clean, apart from the `max-lines-per-function` warning that was already on the base.
- **Next:** time a large seeded show, run focused `test:history` and the desktop suite, then update the PR body.
- **Resume from:** branch `timeline/p7-mobile-exports` at `357f1e90`. Time the export with a scratch test (500 marchers × 200 pages, not committed). Then run `pnpm --dir apps/desktop run test:history src/components/mobile/utilities/__test__/dots-to-om.timeline.test.ts src/components/mobile/utilities/__test__/dots-to-om.test.ts` and, separately, `pnpm --dir apps/desktop run test`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-pathways) · P7.10 checkpoint 2

- **Done:** tests written and passing, `timeline-try-2` merged in (clean), commit `b75c95f7`. Tests: `src/timeline/__test__/timelinePaths.test.ts` (sampler on G1, G4, G6, G8 and G8b; midsets, lengths, step sizes, warnings, the canvas renderer), `src/timeline/__test__/useTimelinePathRender.test.tsx`, `src/components/canvas/hooks/__test__/editablePath.test.tsx`.
- **Checks:** `tsc --noEmit` clean; the 3 new test files: 27 passed; `prettier --check`, `cspell` and `eslint` on the changed files: clean apart from warnings already on the base. The regular desktop suite is running.
- **Next:** read the suite result, open the PR.
- **Resume from:** branch `timeline/p7-pathways` at `b75c95f7`; re-run `pnpm --dir apps/desktop run test` (background, alone), then open the PR from the scratch body `pr-P7.10.md` with `gh pr create --repo AlexDumo/OpenMarch-timeline --base timeline-try-2`.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-mobile-exports) · P7.12 review fixes ready

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/30 is at head `357f1e90`. It merges `timeline-try-2` (with #29) at `3566f8a5`, and its body is updated. The fixes are in the checkpoint above. The PR body now also says:
  - In timeline mode, `coordinates` is page-major: pages in show order, then marchers by id. The mobile reader (not in this repo) must look coordinates up by `(marcherId, pageId)`.
  - The "same moment" claim now covers every read, because all reads run under one lock.
- **Timing:** measured with a scratch test, not committed. The seeded show was 500 marchers × 201 pages (100,500 positions), in the test environment.

  | Step                                                | Time                                                      |
  | --------------------------------------------------- | --------------------------------------------------------- |
  | Timeline export                                     | ~500 to 620 ms                                            |
  | Page-mode export                                    | ~630 to 690 ms                                            |
  | Locked reads plus resolver cold build               | ~310 ms, one stretch, the same work the video export does |
  | Sampling                                            | ~300 ms, with the longest event-loop gap 37 ms            |
  | Schema validation                                   | ~17 ms                                                    |
  | Converting the seeded show (not part of the export) | ~19 s                                                     |

- **Checks:**
  - `tsc --noEmit`: clean.
  - `vitest run src/components/mobile`: 8 files, 88 passed.
  - `test:history` on `dots-to-om.timeline.test.ts` and `dots-to-om.test.ts`, run alone: 25 passed.
  - `pnpm --dir apps/desktop run test`, run once: 134 files passed, 7 skipped; 1,965 tests passed, no errors.
  - eslint, prettier and cspell: clean, apart from the `max-lines-per-function` warning that was already on the base.
  - Skipped by policy: the full `test:history` suite, Playwright and `build:electron`.
- **Next:** the lead re-reviews and merges PR #30.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-pathways) · P7.10 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/33 (head `b75c95f7`, with the current `timeline-try-2` merged in). In timeline mode, once the resolver is ready, paths, midpoints, endpoints, step-size warnings and the inspector's step sizes come from the resolver between page end beats, not from `marcher_pages`. Page mode is unchanged.
  - `sampleMarcherPath` (`src/timeline/timelineKeyframes.ts`) reuses P7.9's sampler in beats.
  - `src/timeline/timelinePaths.ts` holds the page paths and step sizes.
  - Drawing: `TimelinePathway` (a polyline) and `OpenMarchCanvas.renderTimelinePathVisuals`, called by `useTimelinePathRender` from `Canvas.tsx`.
  - Inspector: `useTimelineStepSizes`.
  - The drag redraw no longer puts back straight lines in timeline mode.
  - The line tool preview takes the marcher id from the canvas marcher.
  - The editable-path writers write nothing in timeline mode.
  - Ticked the 7 P7.10 inventory items.
- **Decisions (P7.10, recorded for the phase):**
  - **Paths are sampled from the resolver** between the previous and current pages' end beats. Arcs and follow-the-leader moves draw as curves, within 0.25 field units.
  - **Midpoint = midset:** the position halfway through the move in counts, on the drawn path. For a constant-pace straight move this is page mode's midpoint.
  - **Step size = distance along the path over the page's counts,** measured at 0.01 tolerance. For a straight move it equals page mode's.
  - **Collisions stay dormant in both modes** (the trigger is commented out). Reviving them is a feature beyond parity. When someone does, they should sample `positionsAt` per beat.
  - **Dormant pathway writers are gated off in timeline mode,** with the flag read when they run. The page-era `pathways` data stays frozen until Phase 10. Curved-path authoring stays C-8 (Phase 9).
  - **`midsets`:** no work.
  - **`marcher_pages` queries in `Canvas.tsx` and the movement listener stay.** They feed the page-mode fallback until the resolver is ready (as P7.13 noted).
- **Checks:**
  - `pnpm install`: ok.
  - `turbo run build --filter=@openmarch/desktop^...`: 4 successful.
  - `tsc --noEmit`: clean, after the merge.
  - The 3 new test files: 27 passed.
  - Paths, keyframes and `src/global/classes`: 254 passed.
  - `pnpm --dir apps/desktop run test`, run alone: 136 files passed, 7 skipped; 1,980 tests passed, no errors.
  - prettier `--check` and cspell on the changed files: clean. eslint on the changed files: only warnings that were already on the base.
  - Skipped by policy: the full `test:history` suite and Playwright. No db-functions changed, so no focused `test:history` was run. `build:electron` wasn't run, and I didn't run the app by hand.
- **Exit gate:** unchanged. "Each feature's existing tests pass in timeline mode" is a phase-wide item, not ticked here.
- **Next:** review and merge PR #33.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-15-refresh-views) · P7.15 review fixes

- **Done:** PR #32 review fixes, merged `timeline-try-2` first. The display check is one SQL `LIKE ... LIMIT 1` over the edit's undo group and can't abort the edit; the display tables now include `marchers`; hooks read both versions together (`useTimelineViewVersions`) for one load per write; undo and redo share `historyStatementTable`. New tests: a real range-only ripple (beat inside a transition-less timeline after the last page; display moves, resolver doesn't, through undo and redo), rollbacks, failed undo and redo, drill numbers, the inspector hook, and a load count.
- **Checks:** `tsc --noEmit`: clean. `test:history` on timelineDisplay, timelineHistoryFocus and history: 72 passed. `pnpm --dir apps/desktop run test`: 134 files, 1966 tests passed. Skipped per policy: full `test:history`, e2e.
- **Note:** a drill number edit doesn't move the resolver version (the change log's marcher image doesn't carry it), so the display signal is what refreshes labels; a new marcher moves both.
- **Next:** re-review and merge.
- **Blockers:** none.

### 2026-10-01 · lead · P7.12

- **Done:** reviewed PR #30 and squash-merged it at head 357f1e90. The review found no blockers, but these were fixed before merging:
  - every read now happens under one lock;
  - sampling yields to the event loop;
  - the redundant settle call is gone;
  - the lock warning is in the doc comments;
  - new tests: rotation drop, post-conversion page and marcher, and a page-mode snapshot.
- **Checks** (lead, on 357f1e90):
  - `tsc --noEmit`: pass.
  - Focused `test:history` on `src/db-functions/__test__/` and `src/components/mobile`: 33 files, 692 tests passed.
  - `pnpm --dir apps/desktop run test`: 134 files, 1,965 tests passed, no errors.
  - That head predates #31 (P8.4). The two touch disjoint files and merge cleanly; a combined base run is planned after #32.
  - Skipped by policy: full `test:history` and e2e.
- **Open question for a person:**
  - **Mid-page motion in the mobile payload:** the payload carries only page-end positions, so shape paths and moves ending mid-page reach the mobile app as straight page-to-page moves. Carrying them would change the mobile format.
  - **Coordinate order:** coordinates are page-major in timeline mode. The mobile reader must look them up by (marcherId, pageId).
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-15-refresh-views) · P7.15 merge with P8.4

- **Done:** merged `timeline-try-2` (P8.4, P7.12) into PR #32 with a normal merge commit. One conflict, in the imports of `useTimelineInspections.ts`; both kept. The assignment target's `version` is now the resolver version plus the display version, so the P8.4 editor's stale-plan guard re-enables after a display-only edit and can't hang; the transition editor's guard is per target object and already rebuilds. The combined `useTimelineViewVersions` hook and one load per write are kept.
- **Checks:** `tsc --noEmit`: clean. `test:history` on timelineDisplay, timelineHistoryFocus, history, timelineAssignmentEdits: 88 passed. `vitest run` on `src/components/inspector` and `useTimelineInspections`: 76 passed. `pnpm --dir apps/desktop run test`: 139 files, 2037 tests passed. Skipped per policy: full `test:history`, e2e.
- **Next:** re-review and merge.
- **Blockers:** none.

### 2026-10-01 · lead · P7.15

- **Done:** reviewed PR #32 and squash-merged it at head b46fe6c8.
  - Review fixes:
    - The table check is now an SQL `EXISTS` that can't abort an edit; it no longer pulls every undo statement into JS.
    - A real ripple test was added.
    - Rollback, refusal and failed undo/redo don't bump.
    - `marchers` was added for drill-number labels.
    - Each write causes a single combined load.
    - Undo/redo now use the shared parser.
  - Merged with #31: the P8.4 editor guard keys on resolver + display version, so display-only edits can't leave it disabled.
- **Checks (lead, on b46fe6c8, which includes #30 and #31):**
  - `tsc --noEmit`: pass.
  - Focused `test:history` on `src/db-functions/__test__/` and `src/components/mobile`: 35 files, 719 tests passed.
  - `pnpm --dir apps/desktop run test`: 139 files, 2,037 tests passed, no errors.
  - This run is also the combined check of #30 + #31 owed from P7.12.
  - Skipped by policy: full `test:history` and e2e.
- **Next:** P7.10 fixes (PR #33), P8.2 in progress; P7.11 and P7.7 remain.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-pathways) · P7.10 review fixes checkpoint

- **Done (lead review of PR #33):** merged `timeline-try-2`, which now has #30 and #31, with a normal merge commit (`adba1f40`). Review fixes are in `88b764ed`, pushed with no force-push.
  - **Step size:** the stride of the fastest moving stretch (below).
  - **Cost:**
    - Paths use 3 probes per piece instead of the export's 7, and the 0.5 probe is reused as the bisection point.
    - Samples are kept per resolver version and page pair.
    - A side that can't show isn't sampled (`canShowPath`).
    - Nothing is sampled or drawn while playing.
    - Step sizes reuse the drawn path's 0.25 tolerance; the 0.01 tolerance is gone.
    - Budget test: 300 marchers on arcs about 10 steps across take about 180 positions per marcher, bounded at 250. Before this change it was 426.
  - **Zig-zags:** a moving span is cut at every whole count when any count leaves its chord.
  - **Drawing:** the curved path is stacked under the dots, at the straight line's index, and offset by half a grid line like the dots. Its bounds are computed after the warning style sets the stroke width.
  - **Inspector:** step sizes come from the resolver only once it is ready (`active`). Until then the inspector keeps page mode's values.
  - **Editable path:** a failed settings read counts as page mode, so a page-mode write is never dropped.
  - **New tests:**
    - in `timelinePathStride.test.ts`: the stride with a hold, the warning, the midpoint at a hold, page-mode equality, the first and last page shapes, a corner where a steal takes over mid-page, a zig-zag, the budget, warning styling and the forced next path, and the line tool's marcher ids;
    - in the hook tests: playback, side skipping, memoization and the inspector fallback;
    - in `editablePath.test.tsx`: the failed settings read.
- **Decisions (P7.10, from the lead review, recorded for the phase):**
  - **Step size in timeline mode is the stride of the marcher's fastest moving stretch within the page:** the largest length per count over the non-hold spans clipped to the page.
    - Holds, moves that end mid-page and breakaway holds don't dilute it.
    - The canvas warning and the inspector both use it.
    - For a straight move over the whole page it equals page mode's value.
    - Note: at the default 45-inch threshold (0.5-inch tolerance), 8 steps in 4 counts is exactly 45 inches and doesn't warn. The warning test therefore uses 9 steps.
  - **Collisions stay dormant in both modes.**
  - **`midsets`:** no reader or writer outside mocks.
  - **Line tool preview paths stay straight** from each marcher's current position to its new spot. They preview a destination change, not a walked path.
  - The inventory notes for step size and the line tool are updated to match. All 7 P7.10 items were already ticked.
- **Checks:**
  - `tsc --noEmit`: clean, after the merge.
  - The 4 P7.10 test files: 44 passed. The keyframe tests also pass (70 tests across the 5 files).
  - `pnpm --dir apps/desktop run test`, run once at `88b764ed`: 142 files passed, 7 skipped; 2,067 tests passed, no errors. A focused run of 5 test files overlapped with it from the same directory; none of them opens a test database.
  - Pre-commit hook (cspell, eslint, prettier): passed. eslint on the changed files shows only warnings that were already on the base.
  - Skipped by policy: the full `test:history` suite and Playwright. No db-functions changed.
- **Next:** the lead re-reviews PR #33 (body updated).
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-coordinate-sheets) · P7.7 checkpoint

- **Done:** commit `257aed4a` on `timeline/p7-coordinate-sheets` (wip). New `src/components/exporting/utils/exportPagePositions.ts`: `readTimelineExportPositions(db)` returns `null` in page mode and, in timeline mode, reads the flag, the timeline tables and the pages under one `withTimelineWriteLock` (P7.12's `readTimelinePageSnapshot`), then samples with `sampleTimelinePagePositions` into a `PagePositionMap` (same shape as `MarcherPageMap`). Coordinate sheet building moved to `utils/coordinateSheets.tsx` (`buildCoordinateSheets`); the sheet export and the drill chart export use the sampled map in timeline mode and the `marcher_pages` query in page mode. `svg-generator.ts` and the sheet components take a plain position type (`PagePosition`). `SvgPreviewHandler` samples the store resolver for the first page in timeline mode.
- **Finding on the IPC question:** `electron/main/services/export-utility-process.ts` is unreachable: nothing imports or forks it, and it is not a Vite entry. The live PDF calls (`export:pdf`, `export:generateDocForMarcher`) take sheets and SVGs the renderer already rendered, and the main process never reads `marcher_pages` for them. So the resolver already runs in the renderer and no IPC payload has to change.
- **Resume from:** write tests (`src/components/exporting/utils/__test__/coordinateSheets.test.tsx`: page-mode deep-equal guard against the old inline rendering, timeline-mode rows equal the resolver at page end beats; `exportPagePositions` db tests with `describeDbTests`), then tsc, focused vitest and lint. Re-run `pnpm install` and `pnpm exec turbo run build --filter=@openmarch/desktop^...` first in a fresh work tree.
- **Blockers:** none.

### 2026-10-01 · lead · P7.10

- **Done:** reviewed PR #33 and squash-merged it at head 88b764ed.
  - Review fixes:
    - Step size is now the stride of the fastest non-hold span clipped to the page. This is the lead's decision: holds no longer dilute the warning.
    - Sampling cost dropped from about 426 to about 180 `positionAt` calls per marcher on arcs. Hidden sides are skipped, nothing is sampled during playback, and results are memoized.
    - The polyline now sits below the dots, aligned to the grid.
    - The inspector falls back to page mode until the resolver is ready.
    - The flag read no longer drops page-mode writes.
    - Zig-zag seeding is fixed.
- **Checks (lead, on 88b764ed; no file overlap with #32, merges cleanly):**
  - `tsc --noEmit`: pass.
  - Focused `test:history src/db-functions/__test__/`: 26 files, 621 tests passed.
  - `pnpm --dir apps/desktop run test`: 142 files and 2,067 tests passed, no errors.
  - Skipped by policy: full `test:history` and e2e.
- **Next:** P7.11 after P8.2 (PR #34) merges, and P7.7 in progress.
- **Blockers:** none.

### 2026-10-01 · timeline-worker (timeline/p7-coordinate-sheets) · P7.7 in review

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/35 (head `a9de7bea`, one commit). In timeline mode the coordinate sheet export, the drill chart export and the launch-page preview take positions from the resolver at each page's end beat, never from `marcher_pages`. `readTimelineExportPositions(db)` (`src/components/exporting/utils/exportPagePositions.ts`) returns `null` in page mode and otherwise reads the flag, tables and pages under one `withTimelineWriteLock` (P7.12's `readTimelinePageSnapshot`), then samples a private resolver. Sheet rendering moved to `buildCoordinateSheets` (`utils/coordinateSheets.tsx`). Ticked all 10 P7.7 inventory items.
- **Decisions (P7.7, for the lead):**
  - **No IPC change, so no `C-n` or ADR amendment.** The lead's direction assumed the utility process reads `marcher_pages` for the PDF. It doesn't run: `export-utility-process.ts` has no importer, no fork and no Vite entry. The live calls (`export:pdf`, `export:generateDocForMarcher`) already carry HTML and SVG rendered in the renderer, so the resolver stays in the renderer with no contract change. If the lead still wants that recorded, it would be a Proposed ADR 0001 amendment needing human acceptance; I didn't write one for a contract that doesn't change.
  - Per-page appearance, rotation and notes stay out (P7.14).
  - The close-time preview samples the store's resolver, since previews may and exports build a private one (P7.8).
- **Follow-up (unowned):** delete the dead `export-utility-process.ts`, or leave it for Phase 10.
- **Checks:**
  - `tsc --noEmit`: clean.
  - `vitest run` on `coordinateSheets.test.tsx` and `exportPagePositions.test.ts`: 11 passed. This includes the page-mode deep-equal guard against the pre-P7.7 rendering.
  - `pnpm --dir apps/desktop run test`: 141 files passed, 7 skipped; 2,048 tests passed.
  - `test:history src/components/exporting`, run alone after the suite: 10 files, 88 passed.
  - eslint, prettier and cspell on the 9 changed files: clean. The only eslint warning was already on the base.
- **Skipped:**
  - By policy: full `test:history` and e2e.
  - `build:electron`.
  - A manual run in the app.
  - No db-functions changed.
- **Exit gate:** unchanged.
- **Next:** review and merge PR #35.
- **Blockers:** none.
