---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: arc
title: Arcs of marchers, on a circle or an ellipse
summary: A new Arc shape. Drag it end to end, stretch it like a box (onto an ellipse), set its degrees in the editor, and close it by its chord or all the way around.
status: open
questions:
  - Did stretching the arc by its ends and middle feel like stretching a box?
  - Was setting the degrees from the editor enough, or did you want a handle for it on the field?
  - Did closing (with a straight line, or all the way around) do what you expected?
---

Select some marchers, open the **Shapes** tab and pick **Arc** (after Curve).

**What to try**

- Drag on the field from one end to the other. The arc bows a quarter turn
  to the left of your drag.
- Drag an end to stretch the arc side to side, and the handle in its middle
  to stretch it front to back. The other side stays put; Alt stretches from
  the center and Cmd/Ctrl keeps its proportions. Stretched one way only, it
  runs on an ellipse.
- Set how far it turns with the degrees in the editor (drag or type). The
  dashed circle or ellipse stays put and the arc grows or shrinks around it,
  so the marchers spread out or close up.
- The editor also shows the dashed guide's size ("Circle 60 × 60 steps":
  width × depth); drag or type either.
- Try **Open or closed**: **Close with a straight line** and fill it with
  **Grid**, or close it all the way around.

**Good to know**

- The arc's spacing, interval groups and Who goes where work as on a Line.
- Grid fill of a half-moon is a plain grid for now; staggered fills come later.
