# 0019: Performer figures are baked by the app and kept in the show file

- Status: proposed
- Date: 2026-11-25

## Context

The 2D field can draw each performer as their instrument seen from straight above, to scale
(fork #1319), so designers can see how big instruments sit in a form. The first build drew every
show with one fixed set of pictures, baked offline from the 3D View's models and shipped with
the app (`apps/desktop/src/field/three/figures/figures.webp`). That set can't follow the show:

- A Tuba section set to sousaphone, a silver brass line, the guard's swing flags or sabre, and
  each bass drum's size change the shape on the field, which is what the figures are for.
- Equipment states (horns up or down) and later uniform changes multiply the looks.
- Nothing remade the shipped pictures when a model changed.

The owner (2026-11-25) chose: the app makes the pictures itself, in the background, and the show
file keeps them, in 0.2.0. One body and one uniform color (slate) for every performer stays: the
figures show shape and size, not the uniform's colors.

## Decision

1. **A look is a key.** Everything that changes a figure's shape (the carried model and its
   options, the brass finish, the hold state, the bake's body and uniform, and the app's model
   version) hashes to a fingerprint. Two performers with the same fingerprint share a picture.
2. **The app bakes missing looks in the background.** When a show opens, or a setting changes
   the looks it uses, the editor works out the fingerprints it needs and renders the missing
   ones straight down at a fixed scale, from the 3D View's own marcher classes, on a WebGL
   renderer of its own that it throws away after. It runs in a worker on an `OffscreenCanvas`,
   one worker per bake, ended after. Where a worker can't draw (no WebGL in workers), or a
   worker bake fails, the session bakes on the editor's main thread instead, one figure per
   turn. The owner (2026-11-26) first chose the main thread, then the worker once measured: on
   a CPU slowed to a quarter, the main-thread bake froze the editor for about 1 s twice; in the
   worker the editor had no long task, and the field missed at most a frame or two while the
   shaders compiled. The field keeps the shipped set until every performer's picture is ready.
3. **The show file keeps them** in a `performer_figures` table: one row per fingerprint with the
   picture (WebP) and where the performer stands in it. Migration 0031, numbered past the
   shape-count branch's 0030 and dated before it, so whichever merges first a file takes both; the
   app also makes the table on its first write when a file missed the migration. The table is a
   cache:
   - A row whose fingerprint no look uses is ignored, and dropped when the figures are next
     written. A row that can't be decoded is ignored and baked again.
   - It is never in undo or redo (no history triggers), and writing it is not an edit: the
     working copy's publish watcher doesn't count the commit, so opening a show never changes
     the file in the person's folder by itself. The rows go out with the next real save.
4. **No file version.** Under ADR 0017 §9 a new number is for facts an older build would play
   or edit wrong. An older build ignores the table, and a stale row is harmless (rule 3), so
   the file stays at its version.

## Consequences

- A show carries about 100 to 250 KB of pictures; audio is usually several MB.
- A new app version with a changed model bakes that look again on open; the fingerprint
  includes the model version.
- The model-building code loads only in the bake's worker (or, on the main-thread fallback,
  through `import()`): about 3 MB of models and clips per bake, from the app's own files.
- Another device opening the show draws the figures at once; one without WebGL still has them.
- Merging into upstream carries one more table.

## Verification

- Unit tests: fingerprints change with each shape input and not with anything else; stale and
  broken rows are ignored.
- A history test: writing figures adds nothing to undo.
- A working-copy test: writing figures alone doesn't publish; an edit after it publishes both.
- A scripted run: switching the Tuba section to sousaphone changes its figures on the field.
