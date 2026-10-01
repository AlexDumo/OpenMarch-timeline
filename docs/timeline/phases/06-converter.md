---
phase: 6
title: Page→timeline converter
status: in-progress
owner: timeline-worker (timeline/p6-converter)
branch: timeline/p6-converter
pr: none
depends_on: [5]
updated: 2026-09-29
---

# Phase 6: Page→timeline converter

Follow the protocol in [../README.md](../README.md). Claim a work package before you start, and append to the progress log as you go.

## Goal

A converter that turns a page show into timeline data with positions **exactly equal** to `marcher_pages` at every page boundary, and a per-page report of anything it can't carry over (C-8). Run on demand behind the dev flag; not yet on open.

## Read first

- [implementation-plan.md](../implementation-plan.md) C-7, C-8
- `apps/desktop/src/hooks/queries/useCoordinateData.ts` (`getMarcherTimelines`: which page's coordinates are reached when), pathway and midset tables in `schema.ts`
- Spec D-16, R-13 (individual destinations)

## Work packages

Each field is on its own line so that concurrent claims merge cleanly. Edit only the Owner, Status and PR lines of packages you own.

### P6.1: Confirm page semantics

- Owner: timeline-worker (timeline/p6-converter)
- Status: in-progress
- PR: none
- Parallel: no
- Depends on: —

Confirm the page semantics in code: which beat range each page's move covers, and where page 0 sits. Log the answer with file references before writing the converter.

### P6.2: Converter

- Owner: timeline-worker (timeline/p6-converter)
- Status: in-progress
- PR: none
- Parallel: no
- Depends on: P6.1

Pure converter (desktop-side, reading via Drizzle): homes from page 0; one timeline; per page N ≥ 1 one shapeless `direct` transition over page N's beats, one slot per marcher, `slot_destinations` from `marcher_pages(N)`, and one layer-0 assignment per marcher.

### P6.3: Loss report

- Owner: timeline-worker (timeline/p6-converter)
- Status: in-progress
- PR: none
- Parallel: yes
- Depends on: P6.2

Loss report per page: pathways, midsets and curved SVG shapes, which are kept only at page ends (C-8).

### P6.4: Dev command

- Owner: timeline-worker (timeline/p6-converter)
- Status: in-progress
- PR: none
- Parallel: yes
- Depends on: P6.2

Dev command that runs the converter as one `transactionWithHistory` edit, so it can be undone.

### P6.5: Converter tests

- Owner: timeline-worker (timeline/p6-converter)
- Status: in-progress
- PR: none
- Parallel: yes
- Depends on: P6.4

Tests on fixture shows (including the e2e fixtures): resolver positions equal `marcher_pages` bit for bit at every page boundary; in between they match the old keyframes when tempo is uniform and there are no pathways; undo removes everything.

## Exit gate

Tick an item only after running its check, and paste the command and result into the log.

- [ ] P6.5 passes
- [ ] The converter has been run on at least three real shows, with loss reports logged

## Handoff notes

Kept current by the phase lead: where things stand, surprises, and what not to redo.

- None yet.
- Page and beat positions: the fixed beat at position 0 has zero length (see the Phase 5 handoff notes). Map page N's transition range from beat positions as ADR 0001 says, and remember that positions in [0, 1) never play.

## Progress log

<!-- Append entries below, newest last, using the format in ../README.md. Never edit earlier entries. -->

### 2026-09-30 · timeline-worker (timeline/p6-converter) · P6.1

- **Done:** P6.1 page semantics confirmed in code, reusing P5.5's mapping (`pageEndBeat` in `apps/desktop/src/timeline/timelineCanvas.ts`):
  - Beats: `fromDatabasePages` (`apps/desktop/src/global/classes/Page.ts`) sorts `beats` by `position` and gives each its 0-based index in that order. ADR 0001 §2 makes that index the timeline beat ("beat `n` is the start of the `n`th row of `beats` ordered by `position`").
  - Page 0 (`FIRST_PAGE_ID`, `src/db-functions/page.ts`) holds only beat 0, which has zero length; its `marcher_pages` rows are the start positions, at show time 0. The converter seeds `marchers.home_x/home_y` from them (C-5).
  - Page N ≥ 1 covers the sorted beats from its start beat up to the next page's start beat (the last page: `utility.last_page_counts` beats, clamped to the beat count). Its `marcher_pages` row is the position when those beats are done: `getMarcherTimelines` (`src/hooks/queries/useCoordinateData.ts`) puts the keyframe at `(page.timestamp + page.duration) * 1000`, and `getCoordinatesAtTime` (`src/utilities/Keyframes.ts`) interpolates linearly in milliseconds from the previous page's keyframe (or along the pathway of the destination row, `path_data_id`).
  - So page N's move is the beat range `[beats[0].index, pageEndBeat(page))` = `[start beat of N, last.index + 1)`, and its end beat is the next page's start beat (the show end for the last page; page 0 → 1). This equals `beatAtTime(beats, page.timestamp + page.duration)`, which P5.5's tests check.
  - Midsets are already ignored by page-mode playback (the midset code in `getMarcherTimelines` is commented out); pathways are not.
- **Checks:** reading only.
- **Next:** P6.2 converter in `apps/desktop/src/timeline/convert/`.
- **Blockers:** none.
- **Resume from:** check out `timeline/p6-converter` on the fork; write the pure planner `src/timeline/convert/planPageConversion.ts`, then the reader/writer.

### 2026-09-30 · timeline-worker (timeline/p6-converter) · P6.2, P6.3, P6.4

- **Done:** checkpoint 5a5313f2 on `timeline/p6-converter`. `apps/desktop/src/timeline/convert/planPageConversion.ts` (pure planner and loss report), `writePageConversion.ts` (reads the page model inside the edit, refuses E-ARGS when timeline rows exist unless `replace`, writes through the db-functions in one `transactionWithHistory`), `convertPages` on the dev console API (`fixtures/timelineFixtures.ts`), `getMarcherTimelines` exported for the tests. Pure tests in `src/timeline/__test__/planPageConversion.test.ts`.
- **Checks:** `tsc --noEmit` (pass); `test:focused src/timeline/__test__/planPageConversion.test.ts` (10 passed).
- **Next:** real-DB tests (P6.5) on the `marchersAndPages` fixture.
- **Blockers:** none.
- **Resume from:** check out `timeline/p6-converter` (5a5313f2); write `apps/desktop/src/timeline/__test__/pageConversion.test.ts` (boundary positions bit for bit, keyframe match between pages, undo, refusal and replace, loss report, only page 0), then run it with `test:focused` and `test:history`.
