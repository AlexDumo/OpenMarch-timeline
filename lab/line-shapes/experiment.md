---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: line-shapes
title: Line shapes (work in progress)
summary: Lines, corners, curves and mixed intervals in the shape tool. Select marchers, pick Line or Curve in the Shapes tab, drag or click points on the field, set the spacing in the floating editor, and press Enter to place.
status: open
variants: []
questions:
  - Was drawing a line natural, both by dragging and by clicking point after point? Did finishing (Enter, double-click, clicking the last point) and Esc work the way you expected?
  - Did corners holding a marcher feel right? When you dragged a corner with a typed interval, did moving in whole intervals help or get in the way?
  - Did smooth points and the Curve entry give you the curves you wanted? Was clicking a point to switch corner and smooth too easy to hit by accident?
  - Was typing mixed intervals (for example 2*3+4*2, or 2.5+3*4 for the last 3 at 4 steps) quick? Did the group chips make sense?
  - When your list didn't add up to the marchers selected, did the last group growing (marked +N) make sense?
  - Did the Who goes where menu (Least travel, Keep order, Reverse) do what you expected when moving one line into another?
  - Anything that felt wrong, slow or confusing?
---

A test build of the Line shape, still being built. Everything here is a shape:
a way to place the selected marchers.

**What to try**

- Select some marchers, pick **Line** in the Shapes tab and drag on the field.
- Instead of dragging, click point after point to draw corners. Click a
  segment's middle handle to split it. Press Enter to finish, then Enter again
  to place.
- Type an interval in the floating editor (2) to fix it, or a mixed list such
  as `2*3+4*2` (2 marchers at 3 steps, then 4 at 2). A group with no count is
  "the rest": `2.5+3*4`.
- Pick **Curve**, or click a point to make it smooth.
- Move a placed line into another one and try **Who goes where**.

**Not in this build yet**

- Measured (side to side ↔ / front to back ↕), closing a line and filling it,
  and Line and Curve in the favorites ring and command bar are still in review
  and will be added to this build when they land.
