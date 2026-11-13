---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pins
title: "Pins: midsets and quarter sets (pathways, step 5)"
summary: "Step 5 of pathways: pin a point of a drawn path to a count, and every marcher on the path passes it on that count. Type a count on the path bar, drag the playhead marker onto a point, or put every corner on a count at once."
status: open
variants: []
questions:
  - "Draw a path for one marcher with one corner in the middle. Select the corner and type a count into the path bar's field. Did the marcher pass the corner on that count when you played it?"
  - "Draw a group path for a block, pin a corner to count 6 and play. Did every member pass its own copy of that corner on 6, adjusted members too?"
  - "Move the playhead into the move and drag the yellow diamond (the playhead marker) onto a point. Was it clear what the diamond is and what dropping it does? Did you expect it to work on a curve too?"
  - "Drop the diamond on a straight stretch between two points. It adds a corner there and pins it. Is that what you wanted, or should it only work on points?"
  - "Try Corners on counts on a block letter. Did each corner land on the count you'd have written? When two corners were close, one moved to the next count: was that the right one?"
  - "Resize the move with pins by dragging a clip edge. The pins kept their counts. Then do it again with Alt held (or tap Scale pins instead on the toast). Which did you want more often? Should the toast offer stay?"
  - "Pins are whole counts only. Did you ever want a pin on a half count?"
  - "Anything else about pins you'd change?"
---

**What's new**

- **Pin a point to a count.** Open a path (double-click it), select one of its points,
  and type a count into the field on the path bar, then **Enter**. The point is passed
  on that count by everyone on the path. Empty the field, or click its **×**, to take the
  pin off. The field shows the count the point is passed on now as a hint.
- **Right-click or long-press a point** for **Pin to count…** and **Remove pin**.
- **The playhead marker**: with the playhead inside the move, a yellow diamond on the open
  path shows where the path's walker is now. **Drag it onto a point** to pin that point to
  the playhead's count. Dropped on a straight stretch, it adds a corner there and pins it.
- **Corners on counts** on the bar pins every corner to the whole count it reaches at a
  steady speed (block letters). It replaces the path's other pins. When two corners would
  land on one count, one takes the next count.
- Between pins the path is walked at one steady speed; the speed changes at a pin.
- Pinned points carry a small tag with their count, and the timeline shows a tick at
  each pinned count of the open path.
- **Resizing keeps pinned counts** (counted from the edge you didn't drag). **Alt** while
  dragging an edge scales them with the move instead, onto whole counts. After a resize
  the toast offers **Scale pins instead**, which does the same with a pencil or a finger.
  An edge stops before it would pass a pin.
- Deleting a pinned point takes its pin too, and the toast says so (with Undo).
- **Big steps** judges each stretch between pins at its own speed.

**Try it**

1. Select one marcher and press **P**. Click a corner halfway, then **Enter**.
2. Double-click the path, click the corner, type **4** and **Enter**. Press **Space**.
3. Move the playhead to count 6, drag the diamond onto the corner. Play again.
4. Draw a block letter path with four corners for a block and press **Corners on counts**.
5. Drag the move's end edge on the timeline, then undo and drag it with **Alt**.
6. Try it with a finger or pencil on a tablet: long-press a point, and the toast's button.

**Good to know**

- A pin needs a point: to pin the middle of a straight leg, click the leg's midpoint to
  add a point there (or drop the diamond there).
- Splitting a one-marcher path at the playhead keeps its pins on both halves.

**Not in this step, on purpose**

- Stops and holds ("mark time 2 at the corner") are step 14.
- Pins on another step grid (double time, triplets) are step 16.
- Trails take no pins; their corner counts are step 6.
- Splitting a group path at the playhead is still refused (step 17).
- A pin for one member only is not possible: a group path's pins are the whole group's.
- Moving a page flag that would push a pin out of its move is refused with a reason,
  rather than stopping short as a clip edge does.
