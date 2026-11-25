# Draft: ADR 0016 amendment, a follow move around a shape that changes

- Status: proposed (2026-11-24). Not applied. Nothing below is built, and no app code changes
  until the owner accepts it.
- Would amend: [0016](../../../adr/0016-moves-follow-drawn-paths.md) (routes, and its amendment
  "follow a drawn trail").
- Touches: [0006](../../../adr/0006-shape-recipes.md) (the revision of 2026-11-22, itself proposed)
  and [0018](../../../adr/0018-exact-paths.md) (one more case that exports as points).
- Research: [README.md](README.md), with a prototype in [demo/](demo/shape-over-time.html).
- Fork issues: #1174, #355, #1208, #434.

This is the text proposed for `docs/adr/0016-moves-follow-drawn-paths.md`, after its amendment of
2026-11-09.

---

## Amendment (proposed): the outline a line goes around can change during the move

### Context

A follow move around a closed outline (spec R-13‴, pathways step 10) stores its own copy of the
outline as a closed route, and its end spots as placed spots. Nothing links the move to the shape
the outline came from. So:

- editing the shape after a Follow doesn't reach the move, and the outline's points can't be
  edited (AP-T15);
- the outline is fixed for the whole move, so a shape can't turn, grow, travel or become another
  shape while the line goes around it.

The owner asked for both (2026-11-24): to edit the shape after a Follow, and to treat the shape
and the walk around it as two separate things.

### Decision

1. **A closed route may carry the outline at the move's end.** Its geometry gains an optional
   `change`:
   - `from`, `points`, `toBulge`: the outline at the move's end, closed, under the same rules as
     the outline at its start (I-R1). It walks the same way around, and starts at the point that
     matches the start outline's first point.
   - `pivot`, `pivotTo`: the shape's center at the start and at the end, in field coordinates.
   - `turn`: how far the shape turns over the move, in radians, signed. It may be more than a
     full turn, up to a limit the spec sets.

   A route without `change` is unchanged in meaning.

2. **The resolver blends the outline and walks a share of the way around it.** For a
   follow-the-leader move with `ends: "around"` whose route has `change`, at share `p` of the
   move:

   ```
   outline(p, u) = lerp(pivot, pivotTo, p)
                 + R(turn · p) · [ (1 − p) · (A(u) − pivot) + p · R(−turn) · (B(u) − pivotTo) ]
   ```

   - `A(u)` and `B(u)` are the start and end outlines' points at share `u` of their own length.
   - Each founder starts at the share of `A` nearest its origin, and ends at the share of `B`
     nearest its own spot, past its start the way the outline runs, plus `laps`. These are
     R-13‴'s `s_q` and `e_q`, each divided by its outline's length.
   - Its share grows steadily between the two, and its position is `outline(p, share)`.
   - Ends are exact (spec §8.10). A founder off the outline at either end keeps its offset from
     its place, fading from the start offset to the end offset.
   - Rows that aren't founders walk straight to their spot (R-11), as now.

   The spec step writes this as a rule beside R-13‴, with its own golden tests, properties and
   reference oracle.

3. **Without `change`, the resolver runs today's code.** The app writes `change` only when the two
   outlines differ or the shape turns, and removes it when they stop differing. Files with no
   changing shape resolve bit for bit as before.

4. **Shapes stay app data; the resolver never reads them.** ADR 0016 §1 and ADR 0006 stand. The
   app links a follow move to the shapes at its start and end counts with a
   `timeline_route_sources` row of kind `recipe` (migration 0028, already in place). When a linked
   shape is edited, the app rewrites the move's outlines, its `change` and its end spots, in the
   same transaction and undo step, and never during undo or redo replay.

5. **End spots stay placed spots** (DL-9). The end shape deals them, each marcher taking the spot
   N ahead of its own in line order (DO-5), and the app writes them through the same path as any
   other spot. The resolver reads them back to find each marcher's end share.

6. **No schema change and no migration.** The route's JSON grows, and the link table exists.

7. **File version.** A file is written with the next free file version when a route first gets
   `change`, and the number is never lowered (ADR 0017 §9). A build that doesn't know `change`
   would walk the start outline and cut straight to the spots, so it must refuse the file. The
   link alone needs no version: a build without it plays the file the same.

8. **Edits that can't keep the move exact are refused with a reason** (ADR 0016 §4): split at a
   count, and a shape flipped between its two ends, until their own steps.

### Consequences

- **One rule for turn, move, resize and reshape.** A shape that only turns, grows or travels comes
  out exactly rigid. A straight blend with no stored turn was rejected: it shrinks a turned shape
  in the middle of the move.
- **Exact paths (ADR 0018).** A walk around a changing outline has no exact line, arc or cubic
  form. It joins Adjust and handoffs on curves in ADR 0018 §2: points within 1/100 of a step. Show
  files grow for these moves only.
- **Gaps between the two ends are close to even, not exactly even,** when the outline changes
  form. Exactly even would need the blended outline measured at every moment. It was left out to
  keep the resolver to exact lookups on the two stored outlines.
- **Step size.** The shape's change and the walk around add up. The general step-size warning
  covers it (owner, 2026-11-22). There is no check of its own.
- **ADR 0006 revision.** It needs three additions, decided in that thread:
  - a shape counts as carried through a follow move linked to it;
  - every closed kind gives its outline with a start point and direction that turn with the
    shape;
  - the turn between two counts is the move's fact, not the shape's.
- **Upkeep cost.** Every shape edit must look for linked moves. The lookup is by recipe id in an
  indexed app table. It is measured in step 1.
- **A drawn trail with no shape** can't change yet. The storage allows it: a later step can write
  `change` from a free transform, with no file format change.

### Verification

- **Parity:** the base-against-branch script shows every show without `change` resolves bit for
  bit, at every 1/16 beat, over the golden fixtures, the generated worlds and the real `.dots`
  files.
- **Resolver:**
  - golden tests for a circle turning a quarter turn, a box traveling, a circle growing, a bean
    becoming a flat oval, and more than once around;
  - a property test that a turn, a resize and a move of one outline give the rigidly carried
    position;
  - ends exact;
  - the reference oracle and core agree within 10⁻⁹.
- **Validator:** `change` on an open route, an end outline with a smooth point, a `turn` that
  isn't finite or is past the limit, and a missing pivot are each refused.
- **File version:** a build from before this step refuses a file with `change`, with the existing
  message. A file with only a link opens in it and plays the same.
- **v0.1.7 files** open unchanged (`v017Files.test.ts`). No migration runs.
- **Edits:** the owner's two cases, each one undo step, with redo restoring the same rows:
  - a circle on page 14, a Follow on page 15, then the circle made bigger on page 14;
  - a bean on page 1, a Follow into page 2, then the bean turned and flattened on page 2.
- **Exports:** every tick of a changing move within 1/100 of a step of `positionAt`, with file
  sizes reported.
