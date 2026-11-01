# 0009: Show issues: pure checks, a worker sweep, and dismissals in the show file

- Status: proposed
- Date: 2026-11-01
- Spec: [docs/show-issues](../show-issues/README.md)
- Related: [ADR 0001](0001-timeline-motion-model.md) (the resolver this reads),
  [ADR 0005](0005-three-field-renderer.md) (the field that draws the markers)

ADR numbers 0007 and 0008 are taken by open PRs (#550, #373). If another
record merges as 0009 first, the second to merge renumbers.

## Context

Collision detection (fork #226) checks only the selected page, in the
renderer, about 30 ms per page at 2,000 marchers. Its results show in a
toolbar tab that appears and disappears with the selected page. Step-size
warnings are a separate system with their own badge, field paths and
threshold.

The owner wants one **Issues** panel that collects every problem in the
whole show, like a grammar review, without slowing editing down or adding a
constant cost (spec: [docs/show-issues](../show-issues/README.md)). Three
things need durable decisions:

1. Where checks live and what they read, so more checks can be added later.
2. How the whole show gets checked without a constant cost. A 60-page show
   at 30 ms per page is about 2 s of CPU per full pass. Rerunning that after
   every edit isn't acceptable. Moves, holds and keyframes overlap page
   flags, so "the pages an edit touched" isn't a reliable unit.
3. Where dismissals are kept. They are a new kind of data in the show file.

## Decision

### D-1. Checks are pure functions in `packages/core`

A check reads positions through the resolver interface (`positionAt`,
`positionsAt`, `spanInfos`) plus a plain snapshot of the show data it
declares (sections, tags, rules). It returns hits over the time window it
was given. Checks have no React, no database access and no DOM, so the same
code runs on the main thread and in a worker, and tests pass stand-in
resolvers as `CollisionDetection` does today.

Each check declares:

- **its natural incident unit**, `counts` or `move`, used to stitch hits
  into incidents;
- **its inputs**, `positions` or `positions+show`, used to decide what an
  edit makes out of date (D-3);
- **its rules schema**, with show defaults;
- **its field drawings**, a rest mark and a focus explanation, so the
  framework draws markers and checks don't draw directly.

The framework, not each check, owns stitching, levels, dismissal matching
and rule resolution.

### D-2. Two tiers, one check implementation

- **Live tier, main thread**: runs the checks on the selected page's window
  once the page and resolver version settle (150 ms), as
  `useCollisionDetection` does today. It costs no more than today and drives
  the soft blink.
- **Sweep tier, a dedicated worker**: owns a second resolver built from the
  same `TimelineSnapshot` with `createCachedResolver`. After every commit,
  the main thread posts the same `ChangeBatch` it passes to
  `resolver.notify()`, so both resolvers describe the same show. The worker
  never touches the database. It checks the rest of the show in chunks,
  nearest the playhead first, and posts issues back.

Results from both tiers go through the same stitching and dismissal
matching. The live tier's answer replaces the sweep's for the window it
covers.

### D-3. What's out of date is found from positions, in time buckets

The worker keeps a **fingerprint per (marcher, bucket)**, where a bucket is
4 counts: a 32-bit hash of the marcher's positions sampled at each beat in
the bucket. 200 marchers over 1,000 counts is 50,000 numbers, about 200 KB.

After a batch:

1. `notify()` returns `InvalidationReport.marchersRebuilt`. The worker
   re-samples only those marchers across the show.
2. Buckets whose hash changed for any marcher go on a dirty list as
   (bucket, changed marchers).
3. Checks rerun only on dirty buckets. Position checks narrow further: a
   collision recheck tests only pairs where at least one marcher changed,
   using a spatial grid. Unchanged pairs keep their cached result.
4. A change fingerprints can't see makes every `positions+show` check that
   reads it **all-dirty**, and it does a full pass. That covers tags,
   sections, rules, props, and marchers added or removed. This fallback is
   always correct, just slower.

Stitching then merges hits across bucket edges into incidents (spec,
"Stitching"). Buckets decide what to recheck. Users never see them.

This is deliberately independent of the timeline model. Whatever produces
positions (moves, holds, keyframes, future features), a change shows up as
changed positions.

**Known risk**: if `marchersRebuilt` ever left out a marcher whose positions
changed, its fingerprints would go stale. Two safeguards:

- debug builds compare against a full re-sample after every batch and fail
  loudly;
- after the first sweep completes on an idle show, one cheap full
  fingerprint pass runs as a backstop.

### D-4. Pacing is driven by out-of-date work, never by a timer

The sweep runs only while the dirty list is non-empty, so an idle show uses
no CPU. It doesn't run during playback, scrubbing or a drag. It pauses while
the window is hidden. It starts about 2 s after the last commit, or about
10 s and in smaller chunks on battery (Electron `powerMonitor`, and the
Battery API in the web build where it exists). A per-user setting chooses
**Automatically**, **When Issues is open** or **Never**. Never leaves only
the live tier running.

### D-5. Dismissals and rules live in the show file, outside undo

A new migration adds tables for:

- **dismissals**: check id, kind (`occurrence`, `performers` or `check`),
  performer ids, and for occurrences the dismissed span (from and to beat);
- **check rules**: check id, target (`show`, `section`, `tag` or
  `performer`) with its id, and a JSON value validated by the check's rules
  schema.

Neither table gets history triggers, following `view3d_cameras` and the
Library tables: dismissing is a review judgement, not a drill edit, so undo
never brings warnings back. The panel's Dismissed section is how they come
back.

An occurrence matches on a recheck when the check and the performer set are
equal and the new span overlaps or touches the stored span. Deleting a
performer deletes their dismissals and performer rules.

The step-size threshold in field properties
(`stepSizeWarningThresholdInches`) becomes the step-size check's
show-default rule in phase 2. The migration copies the value, and field
properties stops owning it.

Scope (Whole show or Here), the seen state behind the "new" dot, and the
sweep setting are per user (UI settings), not saved in the show.

## Consequences

- One framework, one panel and one marker style for every check. New checks
  are a core function plus messages, with no UI or scheduling work.
- The collision toolbar tab, the `CollisionStore` per-page map and the
  separate step-size field paths and toggles are removed or folded in.
- A second resolver in a worker roughly doubles resolver memory for the open
  show, and adds one message per commit.
- The resolver's `marchersRebuilt` becomes a correctness dependency of the
  sweep, guarded by D-3's safeguards.
- A show-file migration, with its tables outside history triggers. Older app
  versions ignore the tables.
- Field properties lose the step-size threshold in phase 2. That changes the
  field-properties shape, and the import of older files copies the value.

## Verification

- Before phase 1, a spike on the 2,000-marcher benchmark show measures:
  fingerprint build time and memory; re-sample cost for a 1-marcher edit and
  a 200-marcher shape edit; recheck cost per dirty bucket; the per-commit
  cost of keeping the worker resolver in sync. Results go in the spec, and
  phase 1 starts only if the steady-state main-thread cost stays at or below
  today's.
- Unit tests in core: each check against stand-in resolvers; stitching
  across bucket and page edges; dismissal matching under span shifts; rule
  precedence (performer, then tag, then section, then show, with the more
  lenient tag winning).
- A property test: for random edit sequences, the incremental sweep's issues
  equal a full recheck's.
- Debug-build assertion: fingerprints equal a full re-sample after every
  batch.
- Migration tests: new tables, no history triggers, the threshold copied.
- Browser scenarios: the badge count and dot, scope switch, dismiss and
  restore, soft blink after an edit, click to jump.
