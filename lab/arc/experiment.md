---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: arc
title: Arcs of marchers, on a circle or an ellipse
summary: A new Arc shape. Drag it end to end, bend it with the handle in its middle, stretch its guide into an ellipse, and close it by its chord or all the way around.
status: open
questions:
  - Did bending the arc feel natural, including past a half turn where the ends start to move?
  - Were the round handles on the dashed guide easy to find, and was it clear that they stretch it?
  - Did closing (with a straight line, or all the way around) do what you expected?
---

Select some marchers, open the **Shapes** tab and pick **Arc** (after Curve).

**What to try**

- Drag on the field from one end to the other. The arc bows a quarter turn
  to the left of your drag.
- Drag the handle in the middle of the arc to bend it. The readout shows how
  far it turns. It sticks to 45° steps; hold the fine key for whole degrees.
- Bend it past 180°. The circle keeps its size and the ends come around it.
  Keep going and it closes into a circle; drag back to open it.
- The faint dashed line is the whole circle the arc is on. Drag one of the
  two small round handles on it to stretch it into an ellipse. Alt stretches
  both sides; Cmd/Ctrl keeps its proportions.
- On an ellipse, drag an end to slide it around the ellipse.
- In the editor, drag or type the degrees, and the size of the dashed guide
  ("Circle 60 × 60 steps": width × depth). Hold Cmd/Ctrl while dragging one
  to keep the proportions. Try **Open or
  closed**:
  **Close with a straight line** and fill it with **Grid**, or **Close to
  circle**.

**Good to know**

- The arc's spacing, interval groups and Who goes where work as on a Line.
- Grid fill of a half-moon is a plain grid for now; staggered fills come later.
