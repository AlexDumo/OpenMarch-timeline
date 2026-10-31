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
  - Did Measured (true distance, ↔ side to side, ↕ front to back) put marchers where you expected, and were the greyed-out reasons clear?
  - Was closing a line (click its first point, or drop an end on the other) and filling it (Grid, Outline, Spread) natural? Did Open bring it back the way you expected?
  - Did reaching Line and Curve from the favorites ring and the command bar (try `line 2*3+4*2`) work?
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

- In the Measured menu, try ↔ or ↕ on a line that goes one way across the
  field: the steps land exactly on the grid that way.
- Click the first point again (or drop an end on the other) to close the line,
  then pick Grid, Outline or Spread to fill it.
- Put Line or Curve in the favorites ring, or press ⌘K and type `line 2*3+4*2`.

- Open any menu in the shape editor: each choice now has a small picture.

**Not in this build yet**

- From your last feedback: clicking a point to see its curve with a
  double-click to switch corner and smooth (#557), hiding the marchers for a
  moment (#558) and dropping the Points menu (#560).
