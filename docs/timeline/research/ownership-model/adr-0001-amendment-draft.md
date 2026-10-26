<!-- cspell:disable -->

# Draft: ADR 0001 amendment, ownership of motion

Status: **draft for owner review**, not part of ADR 0001. It is written for Option A of the
[research](README.md) (shapes are evaluated when you edit). The notes after it say what changes for
Options B and C. Text in [brackets] waits on the owner question named. Once accepted, it goes into
`docs/adr/0001-timeline-motion-model.md` §2 as a dated amendment, and spec §3, D-16 and R-13
get matching notes.

---

**Amendment (YYYY-MM-DD, project owner): who owns when, where, how and who.** Each concern of
motion has one owner, and commands reach a move's motion only through its block contract.

- **When: the track.** A move (a timeline) owns its counts. Its transitions span it, as C-11 says,
  and each assignment's range sits inside it. [Option B, question 2: a move may hold several
  blocks one after another; C-11's commit check becomes "inside" instead of "equal".]
- **How: the block.** A transition is a block: a path style with its parameters, over its counts,
  with its own destination per slot (`timeline_slot_destinations`). Nothing outside the block's
  module reads `path_style`, `path_params` or `order_mode` to decide what an edit does.
- **Where: the shape.** A shape is a recipe (ADR 0006): a kind, its version and its parameters,
  which lay out N spots and know nothing of time. The shape host evaluates it **when it is placed
  or edited**, and writes the spots into the block's destinations. The resolver never reads a
  recipe. A recipe belongs to the block whose destinations it wrote
  (`timeline_shape_recipes.transition_id`, replacing `timeline_id`) [question 5].
- **Who: membership.** Assignments put marchers into a block's slots over ranges, as today. A
  recipe's spot-to-marcher rows say which marcher stands on which spot, and a marcher not on its
  spot is not a member (ADR 0006, 2026-10-14).
- **Keyframes: the result.** A keyframe is a visible stored move end (holds decision 13). Its
  position comes from the resolver, and for a direct move it equals the block's destination
  exactly. No position over time is stored (D-2). A block's destinations are authored ends, like a
  dragged spot (D-16), whether a drag or a shape wrote them.

**The block contract.** Every path style implements, in one module per style, the operations that
commands use. Commands call these and never branch on the style:

1. **Cut in time** at a whole count inside the block. The result is two blocks that meet at the
   count, with every marcher where it was. Direct motion is cut exactly (Split at playhead,
   UI-27). A style that can't be cut exactly samples the first half into direct motion and reports
   the marchers whose path changes, as Split at playhead does today.
2. **Remove a marcher** over a range of counts inside the block: cut at both ends, then take the
   marcher out of the middle block. The marcher holds there (R-6). **Nobody else's motion
   changes.** The marcher's slot is left vacant (D-13), or compacted where the style allows it. In
   a recipe, its spot becomes a hole.
3. [Later: add a marcher; retime.]

Re-flowing the others (a shape's Close up or Re-split; follow-the-leader closing its line) is
always a separate, explicit edit, never a side effect of operation 2 [questions 6 to 8].

**The spec's shape link.** No write path sets `dest_shape_id`. Converting a show, or opening a
file whose transitions use it, bakes each shape into destinations, as `writeSlotMoves` already
does for a drag (Q-14). [Question 4: retire `timeline_shapes` and the I-T3, I-T4, I-T5 and
`tr_shape_set` checks, or keep them as follow-the-leader's route only.] The resolver keeps
reading `dest_shape_id` while `ref/` uses it, so `ref/` and the core API are unchanged.

**Follow-the-leader**, when it returns, owns its route in `path_params` (copied from a recipe's
path when the move is made), so it references no shape. Removing a member keeps the member's
target point reserved, so the others keep theirs [question 8]. [Question 9: an explicit trail
that a cut continues exactly.]

**Arcs** are deprecated (owner, 2026-10-19). [Question 10: convert them to direct on open, or
leave them dormant.]

**Schema.** Migration 0027 (#181, unreleased) creates `timeline_shape_recipes` with
`transition_id INTEGER REFERENCES timeline_transitions(id) ON DELETE CASCADE` instead of
`timeline_id`. The cascade is safe under undo for the same reason as the kept-spots table's (2026-10-09
amendment): no trigger reads the recipe tables, so their replay order doesn't matter (C-1), and their
rowid keys restore the same rows (C-2). No other table or column
changes. The change log, the resolver, `ref/` and the file version are unchanged.

**Consequences.**

- Split by marcher, merge and Split at playhead carry a recipe with the block that holds its
  points, instead of leaving it on the old move.
- The refusals for shaped and follow-the-leader moves in split, compaction, drag and the ripple
  (`timelineSplitMoves.ts`, `timelineMembership.ts`, `timelineMoves.ts`, `timelineRipple.ts`)
  move into the follow-the-leader block module, or go with the dormant link.
- A shape never updates by itself: editing one is a write that places its members again.
- A file with a recipe kind the app doesn't know still plays, as points (ADR 0006 decision 5).
- Changing a form during a move ("transforms over time") can't be baked. It needs a block type
  that evaluates a shape at resolve time, which takes its own amendment (Option C, limited to that
  type).

**Verification.**

- One contract test suite, run against every block type: cut at each whole count leaves every
  position equal (direct) or reports the change (sampled styles); remove over a range changes
  only that marcher's positions; undo restores the rows and recipes by id.
- The migration test checks `timeline_shape_recipes.transition_id` and its cascade.
- A test after every command checks that no write path outside the block modules reads
  `path_style` (a lint rule or a grep test).

---

## If the owner picks Option B instead

Add to the amendment: "C-11 is relaxed: a move may hold several blocks one after another, each
inside it. A cut in time splits a block inside its move. C-12's 'one transition per marcher in a
timeline' becomes 'one block per marcher at any count'." Range edits (P8.10), resize, flag
drags, the ripple and the page-move mark then move blocks inside a move as well as the move.

## If the owner picks Option C instead

Replace "Where: the shape" with: "A shape is a resolver input. `timeline_shapes` stores a kind,
version and parameters, with no fixed kinds, and a transition's destinations are sampled from it
(R-13, extended to open kinds through a kind registry in `@openmarch/core`)." Add a §4 note for
the registry. ADR 0006's decision 1 ("positions stay the source of truth") is superseded, and a
file with an unknown kind is refused, or plays its last baked points, which have to be kept as a
fallback.
