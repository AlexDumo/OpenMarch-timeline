<!-- cspell:disable -->

# Draft: ADR 0001 amendment, ownership of motion

Status: **not ready to accept.** This is a sketch to bring to the grilling session, not a proposal
(owner, 2026-10-26: no shape or transition data model is chosen yet). Only the parts that restate
decisions 1–5 in the [research](README.md) are settled. The placement model (P1 in
[placements.md](placements.md)) and the block contract are options. Text in [brackets] waits on
the open item named. Where and how stay separate, and the "how" is a straight line for now.

---

**Amendment (2026-10-26, project owner): who owns when, where, how and who.** Each concern of
motion has one owner, and commands reach a move's motion only through its block contract.

- **The block is a move.** A move (a timeline) is one clip and one block. There are no lanes: a
  block never holds other blocks, and where it sits on screen means nothing. Its transitions span
  it (C-11, unchanged).
- **When: the block's counts.** Each assignment's range sits inside them.
- **How: the block's path style,** with its parameters. Nothing outside the style's module reads
  `path_style`, `path_params` or `order_mode` to decide what an edit does.
- **Where: placements.** A placement is a transition of the move with an optional recipe
  ([placements.md](placements.md), P1) [placements question 1]:
  - its points are the transition's destinations (`timeline_slot_destinations`), one per slot;
  - its formula, if it has one, is a recipe (ADR 0006): a kind, its version and its parameters,
    which lay out N spots and know nothing of time;
  - the shape host evaluates the recipe **when it is placed or edited**, writes the spots as the
    transition's points, and saves the recipe for later edits;
  - placing a shape puts its members into **one** transition of the move, taking them out of the
    ones they had there (C-12 allows one per marcher per move);
  - a dragged marcher is a placement of one (UI-9's own one-slot transition), and a placement
    without a recipe is freeform (a converted page, for example);
  - the resolver never reads a recipe. The recipe lives with the block that holds the points
    (decision 3), so a split, merge or cut carries it with the transition.
- **Who: membership.** Assignments put marchers into a placement's slots over ranges, and they are
  the only record of membership. A **hole** is a slot that has a point but no assignment (D-13).
  A marcher not on its spot is not a member (ADR 0006, 2026-10-14).
- **Keyframes: the result.** A keyframe is a visible stored move end (holds decision 13). Its
  position comes from the resolver; for a direct move it equals the block's destination exactly.
  No position over time is stored (D-2). Destinations are authored ends (D-16), whether a drag or
  a recipe wrote them.

**The block contract.** Every path style implements, in one module per style, the operations that
commands use. Commands call these and never branch on the style:

1. **Cut in time** at a whole count inside the block. The result is two blocks that meet at the
   count, with every marcher where it was. Direct motion is cut exactly (Split at playhead,
   UI-27). A style that can't be cut exactly samples the first half into direct motion and reports
   the marchers whose path changes. A recipe goes with the second half, which holds its points.
2. **Remove a marcher** over a range of counts inside the block: cut at both ends, then take the
   marcher out of the middle block. The marcher holds there (R-6). In a shape, the recipe's
   **on-leave setting** decides what the others do in the middle block: `hole` leaves the spot
   empty and moves nobody; `closeUp` and `resplit` place the middle block's other points again.
   [Open item 2: whether a removal for a range follows the setting or always leaves a hole.]
3. [Later: add a marcher; retime.]

**Follow-the-leader is deferred.** Until its design lands, the contract refuses to remove an FTL
member, with a reason, and a cut samples it as Split at playhead does today.

**The spec's shape link.** No write path sets `dest_shape_id`. A file whose transitions use it
has the shape baked into destinations the first time an edit touches them, as `writeSlotMoves`
already does for a drag (Q-14). The resolver keeps reading the column while `ref/` uses it, so
`ref/` and the core API are unchanged. [Open item 4: retire `timeline_shapes` and the I-T3, I-T4,
I-T5 and `tr_shape_set` checks with the FTL design.]

**Arcs, follow-the-leader and spec shapes on `main` are leftovers.** They were never the
intended design (owner, 2026-10-26). [README open item 6: remove them.] Pathways and
follow-the-leader are designed fresh later.

**Schema.** Migration 0027 (#181, unreleased on `main`) creates `timeline_placement_recipes`
instead of ADR 0006's two recipe tables:

- `transition_id INTEGER PRIMARY KEY REFERENCES timeline_transitions(id) ON DELETE CASCADE`;
- `kind`, `kind_version`, `params` (JSON: frame, pivot, distribution, `onLeave`, who goes where);
- `created_at`.

It has no member table. The table is in `tablesWithHistory` and has no change-log triggers, so the
resolver never reads it. The cascade is safe under undo for the same reason as the kept-spots
table's (2026-10-09 amendment): no trigger reads it (C-1), and its key is the rowid (C-2). It
uses new table names and a migration date after the shape branches' old 0027 and 0028, so lab
files that ran those apply it cleanly. The change log, the resolver, `ref/`, the core API and the
file version are unchanged.

**Consequences.**

- The refusals for shaped and follow-the-leader moves in split, compaction, drag and the ripple
  (`timelineSplitMoves.ts`, `timelineMembership.ts`, `timelineMoves.ts`, `timelineRipple.ts`) move
  into the follow-the-leader module, or go with the dormant link.
- A shape never updates by itself. Editing one is a write that places its members again.
- A file with a recipe kind the app doesn't know still plays, as points (ADR 0006 decision 5).
- A form that changes during a move can't be baked. A "morph" block that evaluates a recipe at
  play time would need its own ADR.

**Verification.**

- One contract test suite, run against every block type: a cut at each whole count leaves every
  position equal (direct) or reports the change (sampled styles); removing over a range with
  `hole` changes only that marcher's positions; undo restores rows and recipes by id.
- Split by marcher, merge and cut keep each recipe with the transition that holds its points.
- Placing a shape leaves its members in one transition of the move, with one recipe row.
- A test that no write path outside the block modules reads `path_style` (a lint rule or a grep
  test).

---

## ADR 0006 amendments that go with it

1. **Where a recipe lives.** Decision 2's two tables are replaced by `timeline_placement_recipes`,
   one row per transition (placement). Membership is read from assignments and points from slot
   destinations. Decision 4 ("a marcher belongs to at most one recipe per move") follows from C-12.
2. **On-leave setting.** "A recipe stores what its other members do when one leaves: `hole`,
   `closeUp` or `resplit` (`params.onLeave`). The toast that follows a member leaving offers the
   other two as an override for that edit. No `onLeave` reads as the kind's default." This
   extends the 2026-10-14 revision (binary membership) without changing it.
