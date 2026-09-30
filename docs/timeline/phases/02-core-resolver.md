---
phase: 2
title: Cached incremental resolver (core)
status: in-progress
owner: timeline-worker (timeline/p2-resolver)
branch: timeline/p2-resolver
pr: none
depends_on: [1]
updated: 2026-09-30
---

# Phase 2: Cached incremental resolver (core)

Follow the protocol in [../README.md](../README.md). Claim a work package before you start, and append to the progress log as you go.

## Goal

Port `ref/resolver.mjs` to TypeScript behind the §10.1 `Resolver` interface: boundary caches, batch-driven invalidation and an iterative pull-compile. It must agree with the Phase 1 oracle under fuzzing.

## Read first

- Spec §9 (all), §10.1, §10.2, §12.6, §12.7
- `ref/resolver.mjs`, `ref/fuzz.mjs`, `ref/cx.mjs`, `ref/deep.mjs`, `ref/regress.mjs` (the QA-REG half)
- Phase 1 handoff notes

## Work packages

Each field is on its own line so that concurrent claims merge cleanly. Edit only the Owner, Status and PR lines of packages you own.

### P2.1: Row index and batch coalescing

- Owner: timeline-worker (timeline/p2-resolver)
- Status: claimed
- PR: none
- Parallel: no
- Depends on: —

Row index built only from batch after-images (by id, marcher and transition), plus a host mirror interface for marchers, shapes and transitions. Batch coalescing: first `before`, last `after` (§10.2).

### P2.2: Caches and iterative pull-compile

- Owner: timeline-worker (timeline/p2-resolver)
- Status: claimed
- PR: none
- Parallel: no
- Depends on: P2.1

Local caches (`spans`, `spansByTransition`, `destinations`, `ftlGeometry`) and cascading caches (`origin` keyed by `(marcher, span.start)`, `ftlEntry`). Pull-compile with an **explicit work stack**, which throws on a detected cycle (§9.3).

### P2.3: Invalidation (notify)

- Owner: timeline-worker (timeline/p2-resolver)
- Status: claimed
- PR: none
- Parallel: no
- Depends on: P2.2

`notify(batch)`: §9.4 steps 1 to 4 exactly, and walk rules W-1 to W-4 with an explicit stack. Returns an `InvalidationReport`.

### P2.4: Query and introspection API

- Owner: timeline-worker (timeline/p2-resolver)
- Status: claimed
- PR: none
- Parallel: no
- Depends on: P2.2

`positionAt`, `positionsAt(beat, Float64Array)`, `marcherIds`, `explain`, `ftlEntry`, `diagnostics`, `warmAll`, `counters`, `resetCounters`, `checkCacheClosure` (I-C1, including stale keys). Leave out the ref's `rules: 'v0.1'` switch.

### P2.5: Golden, regression, invalidation and complexity tests

- Owner: unassigned
- Status: open
- PR: none
- Parallel: yes
- Depends on: P2.4

Tests: G1 to G13 on the resolver; QA-REG-1 to -4; QA-INV-02 to -07; QA-CX-01 to -05 (CX-04 hasn't been run in `ref/` yet).

### P2.6: Differential fuzz

- Owner: unassigned
- Status: open
- PR: none
- Parallel: yes
- Depends on: P2.4

QA-INV-08: port `fuzz.mjs` as a seeded Vitest suite (a small seed count in CI) plus a `pnpm` script for the 1,000-seed run. Assert P-3 and P-4 after every batch.

### P2.7: Deep chains on a small stack

- Owner: unassigned
- Status: open
- PR: none
- Parallel: yes
- Depends on: P2.4

QA-REG-6: a deep-chain script run with `node --stack-size=300` (20,000 direct, the same chain after a first-shape edit, and 5,000 FTL).

### P2.8: P-8 and P-10 assertions

- Owner: unassigned
- Status: open
- PR: none
- Parallel: yes
- Depends on: P2.4

New dedicated assertions for P-8 (a shape edit leaves other transitions' caches bit-identical) and P-10 (timeline edits never change positions).

### P2.9: Export the resolver

- Owner: timeline-worker (timeline/p2-resolver)
- Status: claimed
- PR: none
- Parallel: no
- Depends on: P2.4

Export the resolver from `@openmarch/core`, and confirm the public API matches the ADR.

## Exit gate

Tick an item only after running its check, and paste the command and result into the log.

- [ ] P2.5 to P2.8 pass
- [ ] The 1,000-seed fuzz run passes locally (log its command and output)
- [ ] `pnpm --dir packages/core run build` and `run test` pass

## Handoff notes

Kept current by the phase lead: where things stand, surprises, and what not to redo.

- None yet.

## Progress log

<!-- Append entries below, newest last, using the format in ../README.md. Never edit earlier entries. -->

### 2026-09-30 · lead session · P2.1 to P2.4 (checkpoint after a usage-limit stop)

- **Done:** the worker hit the account usage limit after drafting `packages/core/src/timeline/resolver.ts` (878 lines: row index, coalescing, `createCachedResolver`, `createResolver`) and an `index.ts` export change, without committing. The lead committed the draft as-is as eae47f91 (`wip:`, untested; plus one word added to its cspell ignore line) and pushed it to `timeline/p2-resolver` on the fork.
- **Checks:** pre-commit hook (cspell, eslint, prettier) passed on the draft. Build and tests not yet run.
- **Next:** the resumed worker reviews the draft against spec §9 and `ref/resolver.mjs`, completes it, and adds the tests.
- **Blockers:** none.
- **Resume from:** check out `timeline/timeline/p2-resolver` (eae47f91); run `pnpm --dir packages/core run build` and `exec tsc --noEmit -p .` to see the draft's state; then finish P2.1 to P2.4 and P2.9 as the phase file describes.
