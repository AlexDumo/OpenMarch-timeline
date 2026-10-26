<!-- cspell:disable -->

# Draft: ADR 0001 amendment, ownership of motion

Status: **draft**, matching the owner's decisions of 2026-10-26 ([research](README.md),
Decisions). Not part of ADR 0001 yet. Text in [brackets] waits on the open item named. Once
accepted, it goes into `docs/adr/0001-timeline-motion-model.md` §2 as a dated amendment, with
matching notes on spec §3, D-16 and R-13, and two small amendments to ADR 0006 (end of this file).

---

**Amendment (2026-10-26, project owner): who owns when, where, how and who.** Each concern of
motion has one owner, and commands reach a move's motion only through its block contract.

- **The block is a move.** A move (a timeline) is one clip and one block. There are no lanes: a
  block never holds other blocks, and where it sits on screen means nothing. Its transitions span
  it (C-11, unchanged).
- **When: the block's counts.** Each assignment's range sits inside them.
- **How: the block's path style,** with its parameters. Nothing outside the style's module reads
  `path_style`, `path_params` or `order_mode` to decide what an edit does.
- **Where: the block's points, made by its recipe.** A shape is a recipe (ADR 0006): a kind, its
  version and its parameters, which lay out N spots and know nothing of time. The shape host
  evaluates it **when it is placed or edited** and writes the spots into the block's destinations
  (`timeline_slot_destinations`). The recipe is saved for later edits. The resolver never reads a
  recipe. **The recipe lives with the block that holds the points**, so a split, merge or cut
  carries it with them. [Open item 1: keyed by `timeline_id`, with split by marcher and merge
  carrying recipes; or by `transition_id`, with placement gathering a shape's members into one
  transition. Settle it before migration 0027 reaches `main`.]
- **Who: membership.** Assignments put marchers into slots over ranges. A recipe's marcher-to-spot
  rows say which marcher stands on which spot, and a marcher not on its spot is not a member (ADR
  0006, 2026-10-14).
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

**Arcs** are deprecated (owner, 2026-10-19). [Open item 6.]

**Schema.** No table or column changes in this record. The recipe's key is part of migration 0027
(#181, unreleased) [open item 1]. The on-leave setting is a field of the recipe's params. The
change log, the resolver, `ref/` and the file version are unchanged.

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
- Split by marcher, merge and cut keep each recipe with the points it made.
- A test that no write path outside the block modules reads `path_style` (a lint rule or a grep
  test).

---

## ADR 0006 amendments that go with it

1. **Where a recipe lives.** "A recipe lives with the block that holds its points" replaces "a
   recipe belongs to a move" in decision 2, with the key settled by open item 1.
2. **On-leave setting.** "A recipe stores what its other members do when one leaves: `hole`,
   `closeUp` or `resplit` (`params.onLeave`). The toast that follows a member leaving offers the
   other two as an override for that edit. No `onLeave` reads as the kind's default." This
   extends the 2026-10-14 revision (binary membership) without changing it.
