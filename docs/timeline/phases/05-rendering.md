---
phase: 5
title: Resolver host, time mapping, rendering
status: in-progress
owner: timeline-worker (timeline/p5-frame-clock)
branch: none
pr: none
depends_on: [4]
updated: 2026-09-29
---

# Phase 5: Resolver host, time mapping, rendering

Follow the protocol in [../README.md](../README.md). Claim a work package before you start, and append to the progress log as you go.

## Goal

Behind a per-file dev flag, drive the canvas (playback and static) from the resolver instead of `marcher_pages`, fed by Phase 4's batches, and measure the QA-PF budgets.

## Read first

- Spec §7, §9.4 (idle warming), §9.5, §12.8, §12.9
- `apps/desktop/src/hooks/useAnimation.ts`, `apps/desktop/src/utilities/Keyframes.ts`, `apps/desktop/src/components/canvas/Canvas.tsx`, `OpenMarchCanvas.ts` (`renderMarchers`)
- `timing_objects` view, `apps/desktop/src/hooks/useTimingObjects.ts`, `apps/desktop/src/settings/workspaceSettings.ts`
- `docs/conventions/multi-query-hooks.md`, `docs/conventions/testing.md`

## Work packages

Each field is on its own line so that concurrent claims merge cleanly. Edit only the Owner, Status and PR lines of packages you own.

### P5.1: Dev flag

- Owner: timeline-worker (timeline/p5-resolver-store)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/11
- Parallel: yes
- Depends on: —

Per-file dev flag in `workspace_settings` (optional zod field, default off), hidden from normal users.

### P5.2: Time and beat mapping

- Owner: timeline-worker (timeline/p5-frame-clock)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/5
- Parallel: yes
- Depends on: —

`beatAtTime(seconds)` and `timeAtBeat(beat)` by binary search over `timing_objects` timestamps (Q-9), with unit tests at beat boundaries and uneven tempo.

### P5.3: Resolver store and hooks

- Owner: timeline-worker (timeline/p5-resolver-store)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/11
- Parallel: yes
- Depends on: —

`apps/desktop/src/timeline/`: a resolver store per open file. It cold-builds from the tables on open and applies batches from the P4.3 listener. Hooks: `usePositionAt`, `useExplain`, `useDiagnostics`.

### P5.4: Playback

- Owner: timeline-worker (timeline/p5-playback)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/14
- Parallel: no
- Depends on: P5.2, P5.3

Playback: in timeline mode, `useAnimation` converts the playback time to a beat and fills a reused `Float64Array` with `positionsAt` each frame.

### P5.5: Static render

- Owner: timeline-worker (timeline/p5-playback)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/14
- Parallel: no
- Depends on: P5.3

Static render: in timeline mode, draw positions at the selected page's end beat instead of `marcher_pages`.

### P5.6: Idle warming

- Owner: timeline-worker (timeline/p5-warm-fixtures)
- Status: claimed
- PR: none
- Parallel: yes
- Depends on: P5.4

Idle warming outward from the playback position.

### P5.7: Fixture loader

- Owner: timeline-worker (timeline/p5-warm-fixtures)
- Status: claimed
- PR: none
- Parallel: yes
- Depends on: P5.3

Dev fixture loader that builds G1 to G13 and the QA-SC scenarios into a show.

### P5.8: Tests and performance numbers

- Owner: timeline-worker (timeline/p5-warm-fixtures)
- Status: claimed
- PR: none
- Parallel: yes
- Depends on: P5.5, P5.7

Tests: store and hook tests on a real DB; a QA-SC-11 scale fixture with QA-PF-01 to -04 recorded in `findings.md`; one Playwright spec checking rendered positions at several beats.

### P5.9: Frame clock from 0.2

- Owner: timeline-worker (timeline/p5-frame-clock)
- Status: done
- PR: https://github.com/AlexDumo/OpenMarch-timeline/pull/5
- Parallel: yes
- Depends on: —

Bring 0.2's frame-clock store (`origin/0.2:apps/desktop/src/services/clock/frame-clock.ts` and the commits that introduced it) onto `timeline-try-2`. It already tracks `currentBeatIndex`, so it can serve P5.2 and P5.4, and the 0.2 timeline (P8.1) depends on it. Check what else those commits changed before porting; take only what the clock needs.

## Exit gate

Tick an item only after running its check, and paste the command and result into the log.

- [ ] P5.8 tests pass, and QA-PF numbers are in `findings.md`
- [ ] `pnpm --dir apps/desktop run build:electron` and the new e2e spec pass
- [ ] With the flag off, behavior is unchanged (existing suites pass)

## Handoff notes

Kept current by the phase lead: where things stand, surprises, and what not to redo.

- Missing a QA-PF budget is a finding, not a blocker. Move the resolver to a worker only if the budgets are badly missed.
- Every show starts with a fixed, zero-length beat at position 0 (migration 0000). In the tempo map (`src/timeline/timeMap.ts`), beat 1 owns show time 0 and beat positions in [0, 1) are never reached during playback. P5.4 and P5.5 draw the show from beat 1; a resolver span over [0, 1) has no visible time.
- The frame clock (`src/services/clock/frame-clock.ts`, copied unchanged from 0.2) isn't wired in yet. P5.4 kept the existing `getLivePlaybackPosition` clock, so wiring the frame clock is deferred to P8.1, which must call `init` from a user gesture, register `setOnPause` if pause should land on a page end, and set the beat index with `beatIndexAtTime(beats, currentTime / 1000)`: the clock's `currentTime` is in milliseconds, `timeMap` takes seconds, and `beatIndexAtTime` returns -1 when there are no beats.
- Resolver store (P5.3, `src/timeline/timelineStore.ts`): `positionsAt(beat, out)` returns false when no resolver is ready or when `out` isn't `2 * timelineMarcherIds().length` long (resize from that every frame after marcher adds/deletes). While a rebuild is pending, the old resolver stays "ready", so the render loop may draw one stale frame. After a failed cold build, batches are ignored until a reset or a flag toggle; consider retrying. Test gaps to fill in P5.8: a batch that switches a transition between shape and individual destinations, an edit committed while a cold build is pending, and a destination update that changes `slot_index`.
- Playback and static render (P5.4, P5.5): the canvas draws from `marcher_pages` until the resolver store reports ready (and after a failed build), then from the resolver. Page N's end beat is `lastBeat.index + 1` (the next page's start beat; page 0 → 1), which agrees with the page-mode keyframe time. Canvas drag is disabled in timeline mode (marchers snap back); every other `marcher_pages` writer is still reachable (see Phase 7's handoff notes). Pathways, midpoints, endpoints, collision markers and shapes are still drawn from `marcher_pages` in timeline mode and can disagree with the drawn marchers. `renderMarcherPositions` keeps a stale `coordinate.page_id` from the last page render, which Phase 7 must replace before re-enabling drag. While the resolver isn't ready, playback runs with frozen marchers.

## Progress log

<!-- Append entries below, newest last, using the format in ../README.md. Never edit earlier entries. -->

### 2026-09-30 · timeline-worker (timeline/p5-frame-clock) · P5.9, P5.2

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/5 (commit a4b1d41b). P5.9: `apps/desktop/src/services/clock/frame-clock.ts` and `apps/desktop/src/utilities/zustand.ts` (`createSelectors`) ported unchanged from `origin/0.2`, with new tests (0.2 had none) using a stand-in `AudioContext` and faked `requestAnimationFrame`. P5.2: `apps/desktop/src/timeline/timeMap.ts` with `beatAtTime`, `timeAtBeat`, `beatIndexAtTime` and `showEndTime`, binary search over cumulative beat timestamps, half-open beat ranges (later beat owns a boundary), clamped to `[0, beats.length]`, and tested at boundaries, fractions, uneven tempo, zero-duration beats, before 0, past the end and float drift.
- **Seam:** nothing imports the clock, so behavior is unchanged. Not ported from 0.2: the `useAnimation` rewrite, the `AudioPlayer`/`Clock.tsx` wiring that calls `init`, `IsPlayingContext` removal, the canvas `setCoords` change, and `SelectedPageContext`'s `setOnPause` page-end snap. In 0.2 the clock does not compute `currentBeatIndex`; `Timeline.tsx` sets it. P5.4 and P8.1 should set it with `beatIndexAtTime(beats, currentTime / 1000)` so there is one mapping.
- **Checks:** `pnpm --dir apps/desktop run test:focused src/timeline/__test__/timeMap.test.ts src/services/clock/__test__/frame-clock.test.ts`: pass (30 tests). `pnpm --dir apps/desktop exec tsc --noEmit`: pass. eslint, prettier and cspell on the changed files: pass. Full `test:history` and e2e not run (policy); no history tests apply.
- **Next:** review and merge by the lead. No exit-gate items are covered by these packages.
- **Blockers:** none.

### 2026-09-30 · lead session · P5.2, P5.9 (reviewed and merged)

- **Done:** fork PR #5 reviewed by a sub-agent (APPROVE WITH NITS) and merged (33a8be4f). Before merging, the lead added tests for the fixed zero-length beat 0, corrected the `timeMap` docs (a beat runs to the next beat's timestamp), and stated `beatIndexAtTime`'s units and NaN behavior. The reviewer confirmed `frame-clock.ts` and `zustand.ts` are byte-identical to `origin/0.2` and that nothing imports the clock yet. P5.2 and P5.9 set to done; handoff notes updated for P5.4.
- **Checks:** at the PR head before the fixes: `test:focused src/timeline/__test__/timeMap.test.ts src/services/clock/__test__/frame-clock.test.ts` (30 passed) and `tsc --noEmit` (pass). After the fixes: the same tests (33 passed).
- **Next:** P5.1, P5.3 and later wait for Phase 4.
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p5-resolver-store) · P5.1, P5.3

- **Done:** restarted under the existing claim (the previous session stopped on a usage limit before writing code). Status set to in-progress; code branch `timeline/p5-resolver-store` starts from `timeline-try-2` (9753fdbb).
- **Checks:** none yet.
- **Next:** P5.1 flag in `src/settings/workspaceSettings.ts`, then the resolver host in `src/timeline/`.
- **Blockers:** none.
- **Resume from:** check out `timeline/p5-resolver-store` from the fork; if it has no code commits, start with P5.1.

### 2026-09-30 · timeline-worker (timeline/p5-resolver-store) · P5.1, P5.3

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/11. P5.1: optional `timelineMode` in `workspaceSettingsSchema` (off when absent, not shown in the settings UI), with `isTimelineModeEnabled` and `useTimelineMode`. P5.3: `apps/desktop/src/timeline/`. `timelineRows.ts` is the one place that maps DB rows and change-log images to core types, and holds the cold-build read. `timelineHost.ts` updates the mirror in place (marchers, shapes, transitions, slot-destination index behind `points`) from batch images, then calls `resolver.notify`. `timelineStore.ts` holds the zustand store, the session lifecycle, the hooks `usePositionAt`, `useExplain` and `useDiagnostics`, and the imperative `positionsAt(beat, out)` and `timelineMarcherIds()`. `TimelineResolverHost.tsx` is mounted in `App.tsx` and runs only while the flag is on. The cold build reads under the new `withTimelineWriteLock` export in `history.ts`, so its read contains exactly the batches delivered before it.
- **Checks:** `tsc --noEmit`: pass. `test:focused` on `timelineStore.test.tsx`, `timeMap.test.ts`, `timelineChanges.test.ts` and `parseFromWorkspaceSettings.test.ts`: 47 passed. `test:history` on `timelineStore.test.tsx`, `timelineChanges.test.ts` and `timelineHistory.test.ts`: 30 passed. eslint: 0 errors (2 unused-import warnings that were already in `useWorkspaceSettings.ts`). prettier and cspell: pass. Full `test:history`, e2e and `build:electron` not run (policy). No exit-gate items ticked: none are fully covered by these packages.
- **Notes for P5.4 and P5.5:** read positions with `positionsAt(beat, out)`, where `out` has length `2 * timelineMarcherIds().length` in ascending id order. It returns false while no resolver is ready. Subscribe to `useTimelineResolverStore` `version` to know when to redraw a static frame. `snapshot.assignments` is only the cold build's input. P4.4 merged while this was in progress. The store still reads tables with drizzle and doesn't use the db-functions.
- **Next:** review and merge by the lead.
- **Blockers:** none.

### 2026-09-30 · lead session · P5.1, P5.3 (reviewed and merged)

- **Done:** fork PR #11 reviewed by a sub-agent (APPROVE WITH NITS, no correctness bugs: the mirror is updated in place before `notify`, slot destinations replay correctly under the UNIQUE constraint, the cold build reads under the write lock so skipping batches while it's pending can't lose one, flag gating works, and the row-to-core mapping matches the triggers' images). Before merging, the lead made the store's `positionsAt` return false instead of throwing when the buffer size is stale, with a test. Merged as a3f97c41. P5.1 and P5.3 set to done; remaining nits in the handoff notes.
- **Checks (PR):** tsc (pass); `test:history` on the store test and three timeline db-function files (48 passed); `pnpm --dir apps/desktop run test` (89 files, 1,415 passed); after the fix, the store test (11 passed).
- **Checks (merged base):** on `timeline-try-2` at 99419e1c: `pnpm exec turbo run build --filter=@openmarch/desktop^...` (pass); `pnpm --dir apps/desktop exec tsc --noEmit` (pass); `test:history` on `timelineRangeEdit`, `timelineWrites`, `timelineChanges`, `timelineHistory` and `src/timeline/__test__/` (6 files, 92 passed).
- **Next:** P5.4 (playback) and P5.5 (static render).
- **Blockers:** none.

### 2026-09-30 · timeline-worker (timeline/p5-playback) · P5.4, P5.5

- **Done:** wip commit on `timeline/p5-playback`: `src/timeline/timelineCanvas.ts` (reused `TimelinePositionBuffer`, `playbackBeat`, `pageEndBeat`), a timeline branch in `useAnimation`, `useTimelineStaticRender` and `OpenMarchCanvas.renderMarcherPositions`, with `Canvas.tsx` skipping the marcher_pages renders in timeline mode. Clock decision: keep the existing `getLivePlaybackPosition` clock; the 0.2 frame clock is not wired in.
- **Checks:** `tsc --noEmit`: pass. Tests not written yet.
- **Next:** unit, hook and real-DB tests.
- **Blockers:** none.
- **Resume from:** check out `timeline/p5-playback`; write tests in `apps/desktop/src/timeline/__test__/` (timelineCanvas, useAnimation flag on and off, static render on a real DB), then run the focused tests.

### 2026-09-30 · timeline-worker (timeline/p5-playback) · P5.4, P5.5

- **Done:** code and tests squashed into e329b9bd on `timeline/p5-playback` (rebased on `timeline-try-2` at b7d7da00). New tests: `src/timeline/__test__/timelineCanvas.test.ts` (pure) and `timelineRender.test.tsx` (real DB).
- **Checks:** `tsc --noEmit`: pass. `test:focused src/timeline/__test__/ src/components/canvas/__test__/Canvas.test.tsx`: 51 passed. eslint, prettier, cspell on the changed files: pass. The regular desktop suite is running.
- **Next:** read the suite result, open the PR, set in-review.
- **Blockers:** none.
- **Resume from:** check out `timeline/p5-playback`; run `pnpm --dir apps/desktop run test` in the background, then open the PR with `gh pr create --repo AlexDumo/OpenMarch-timeline --base timeline-try-2`.

### 2026-09-30 · timeline-worker (timeline/p5-playback) · P5.4, P5.5

- **Done:** PR https://github.com/AlexDumo/OpenMarch-timeline/pull/14 (commit e329b9bd). New `src/timeline/timelineCanvas.ts`, which holds `TimelinePositionBuffer` (reused, resized when the marcher count changes, applied by id), `playbackBeat` and `pageEndBeat`. New `src/timeline/useTimelineStaticRender.ts` and `OpenMarchCanvas.renderMarcherPositions`. `useAnimation` and `Canvas.tsx` gained timeline branches.
- **Clock decision:** P5.4 uses the existing `getLivePlaybackPosition` clock, which is the smallest change and leaves page mode untouched. The 0.2 frame clock is still not imported anywhere. P8.1 should wire it in and set `currentBeatIndex` with `beatIndexAtTime(beats, currentTime / 1000)`.
- **Page semantics (confirmed in `Page.ts` `fromDatabasePages`):**
  - Page N covers the sorted beats from its start beat up to the next page's start beat. Its marcher_pages row is the position at the page's end (the keyframe at `(timestamp + duration) * 1000`).
  - The end beat is therefore `lastBeat.index + 1`: the next page's start beat, or `beats.length` for the last page.
  - Page 0 holds only beat 0, so its end beat is 1, which is time 0.
  - A test checks that this equals `beatAtTime(beats, page.timestamp + page.duration)`.
- **Drags:** disabled in timeline mode. A drag doesn't write marcher_pages and snaps back to the resolver position. Other page-era writers (alignment, line tools, shapes, keyboard moves) and the pathway and shape visuals are left for Phase 7.
- **Before the resolver is ready:** canvas marchers keep their construction position, (0, 0) from `MarcherVisualGroup`, until the first cold build finishes. Consider drawing marcher_pages until then.
- **Checks:**
  - `turbo build --filter=@openmarch/desktop^...`: pass.
  - `tsc --noEmit`: pass.
  - `test:focused src/timeline/__test__/ src/components/canvas/__test__/Canvas.test.tsx`: 51 passed.
  - Mutation check: forcing the page path or shifting `pageEndBeat` fails 8 tests.
  - `pnpm --dir apps/desktop run test`: 92 files passed, 7 skipped; 1,458 tests passed.
  - eslint: 0 errors. prettier and cspell: pass.
  - Full `test:history`, e2e and `build:electron`: not run (policy).
- **Exit gate:** nothing ticked. The desktop suite passes with the flag off on this branch, but that becomes true on the base only once the PR merges.
- **Next:** review and merge by the lead.
- **Blockers:** none.

### 2026-09-30 · lead session · P5.4, P5.5 (reviewed and merged)

- **Done:** fork PR #14 reviewed by a sub-agent (APPROVE WITH NITS: page mode is unchanged, with hooks called unconditionally and no extra renders; playback converts ms to seconds to beats correctly, resizes the buffer before `positionsAt`, and applies positions by marcher id; the page → end-beat mapping agrees with `fromDatabasePages` and with the page-mode keyframes). Before merging, the lead made the canvas keep drawing from `marcher_pages` until the resolver is ready, instead of leaving marchers at (0, 0) until the first build, or for the whole session if it failed. Merged. P5.4 and P5.5 set to done; the remaining gaps are in the handoff notes here and in Phase 7.
- **Checks:** at the PR head: tsc (pass); `test:focused src/timeline/__test__/ src/components/canvas/__test__/` (5 files, 51 passed); the worker's regular desktop suite (92 files, 1,458 passed). After the fix: tsc, eslint and the same focused tests (51 passed).
- **Next:** P5.6 (idle warming), P5.7 (fixture loader), P5.8 (tests and performance numbers).
- **Blockers:** none.

### 2026-09-30 · lead session · P5.6 to P5.8 (checkpoint after a usage-limit stop)

- **Done:** the worker stopped on the account usage limit after drafting `apps/desktop/src/timeline/timelineWarm.ts` (182 lines) and edits to `timelineStore.ts`, uncommitted. The lead committed them as-is as e56cb6b3 (`wip:`, untested; only a cspell ignore line added) and pushed to `timeline/p5-warm-fixtures` on the fork. P5.7 and P5.8 weren't started.
- **Checks:** pre-commit hook passed. Not run yet.
- **Next:** the resumed worker reviews and finishes P5.6, then does P5.7 and P5.8.
- **Blockers:** none.
- **Resume from:** check out `timeline/timeline/p5-warm-fixtures` (e56cb6b3), run tsc and the `src/timeline/__test__/` tests, then continue.
