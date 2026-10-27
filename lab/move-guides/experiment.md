---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: move-guides
title: Line a box up with the field while moving it
summary: While you drag a whole box, a side or its center that comes close to a yard line, a hash or a sideline lands on it, with the same orange guide and name as when stretching. Away from lines, it still moves by half steps.
status: open
variants: []
questions:
  - When you moved a box toward a yard line or hash, did its edge catch the line when you wanted it to?
  - Did it ever catch a line when you only wanted to move it a half step? Where?
  - Centering a box on a line (the 50, a hash) also catches. Did that help, or did the box feel sticky?
  - Was it clear from the orange guide and its name which line the box landed on?
---

Moving a box now lines it up with the field the same way stretching it does.

**New in this build:**

- **Dragging a whole box** (from inside it, or by its center dot): when one of
  its sides comes within a few pixels of a yard line, a hash or a sideline, the
  box lands with that side on the line. The side turns **thick and orange**, an
  orange line runs across the screen with its name ("S2: On 45", "On FH"), and
  the marchers on it turn orange.
- The box's **center** catches lines too, so you can center a block on the 50.
- Side to side and front to back catch separately: a box can sit on a yard line
  and a hash at once.
- Away from lines, the box still moves by **half steps**.
- It works on the box you're drawing and on a placed box you've selected.

**What to try**

- Draw a box, then drag it so its front rank sits on the front hash.
- Drag a box so its left edge sits on the 40, then slide it front to back: the
  edge should stay on the 40.
- Center a box with an odd number of files on the 50.
- Select a placed box and move it onto a hash.

**Good to know**

- Holding **Alt** moves freely, with no pull.
- A box turned at an angle doesn't pull. A box turned a quarter does.
- The pull reaches up to a quarter step, so at a far zoom it's small. Zoom
  in for a stronger pull.
