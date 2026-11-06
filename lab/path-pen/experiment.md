---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: "Paths stay in their move (pathways, step 24)"
summary: "Step 24 of pathways: drawing a path no longer takes marchers out of their move. Everything that worked in step 15 should look and play exactly the same. New: a block in a shape keeps its shape under a path, follows the shape when you change it, and is back in the shape when you remove the path."
status: open
variants: []
questions:
  - "Redo what you tried in step 15 (a path for one marcher, a group path with a curve, Own path, Rejoin, editing points, Remove path, undo and redo). Did anything look, play or behave differently?"
  - "Draw a group path on a block you placed with a shape, then Remove path. Is the block still that shape, with nobody left out of it?"
  - "On a move into a shape, draw a group path, then change the end shape (bigger spacing, or a different shape). Do the marchers on the path land on the new spots?"
  - "Give one marcher of a block its own path. Did the rest of the block stay exactly as it was?"
  - "Split at playhead, split by marchers and the holds tools on a move with a path should each either keep the path or refuse with a message. Did any of them do something else, or show a message that didn't make sense?"
---

This build changes how a path is **stored**, not how it looks. Until now, drawing
a path took each marcher out of its move into a move of its own, so a block in a
shape lost its link to the shape. Now a path is attached to the marcher's **spot**
in its move instead, and nobody leaves the move.

**What should be the same**

Everything from steps 1, 2 and 15: drawing a path for one marcher, curves, a group
path that holds its shape, Own path, Rejoin, editing points, Remove path, Big
steps, and undo and redo. Positions are the same to the last digit: we checked
the step 15 build against this one on the same edits (about 1.5 million
positions, all identical).

**What's new**

- **Remove path puts the block back in its shape.** A block placed with a shape
  tool, or a move into a shape, is still that shape after you remove a path, with
  no empty spots left behind.
- **A path follows the end shape.** Change the end shape of a move that has a
  group path, and the marchers on the path land on the new spots.
- **One marcher's own path leaves the others alone.** The rest of its block stay
  in their move, as they were.
- **Edits that can't keep a path yet refuse** with a message, instead of breaking
  it: split by marchers of a marcher on a path, merging moves, Remove keyframe's
  join, and making a move with a path follow the leader. Split at playhead keeps
  a marcher's own path and refuses a group path, as before.

**Try it**

1. Open a show you used for step 15, or make a new one. Redo the step 15 tries:
   a group path with a curve, Own path, Rejoin, Remove path, undo and redo.
2. Place a block with a shape tool. Select it, press **P**, draw a path, press
   **Enter**. Play it. Then **Remove path**: is it still the shape?
3. On a move into a shape, draw a group path. Change the end shape. Play it.
4. Select one marcher in a block and draw it its own path. Play the block.
5. Try Split at playhead, split by marchers, Hold, and Clear this page on moves
   with paths.

**Good to know**

- A file saved by this build is **version 11**. The step 15 build refuses it
  ("saved by a newer version"). Files from step 15 open here and are moved to the
  new storage when they open; their undo history from step 15 is cleared.

**Not in this step, on purpose**

- Adjusting one marcher's lane, Detach (Own path that keeps the group's counts),
  pins, the spacing handoff, and marchers joining a path partway. Those are the
  next steps.
- Splitting a group path, and copying a path when marchers are split into a new
  move. They still refuse.
