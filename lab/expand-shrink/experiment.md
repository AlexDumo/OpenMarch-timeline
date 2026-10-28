---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: expand-shrink
title: Expand and Shrink a shape
summary: Two new buttons on the shape's floating editor make the whole shape bigger or smaller while keeping its proportions. The number of marchers never changes.
status: open
variants: []
questions:
  - Did Expand and Shrink do what you expected? Did the shape keep its proportions?
  - Did each press change the shape by about the right amount?
  - Did holding a button down, or dragging on it, feel natural?
  - Did the two icons read as "make it bigger or smaller" and not as "move"?
---

Expand and Shrink sit on the floating editor, right after the two flip
buttons.

**Try it**

1. Select a group of marchers and draw a box (press **B**, then drag on the
   field).
2. Set different spacings side to side and front to back, for example 2 and 3.
3. Press **Expand** (arrows pointing out) and **Shrink** (arrows pointing in).
   - Each press moves one spacing to its next half step. The other spacing
     follows so the shape keeps its proportions, so it may show an uneven
     number.
   - When both spacings are the same, each press changes both by half a step.
   - The shape grows and shrinks around its pivot, the same point it turns
     around. Change the pivot with the picker beside the degrees.
4. Hold a button down to keep going, or drag on it (right or up for bigger).
   Hold **Alt** while dragging for fine control, or **Cmd** (Mac) or **Ctrl**
   for no snapping.
5. Try it in **Outline** and **Spread** too, and on a circle.
6. **Undo** takes back one press, or one whole hold or drag.

**Good to know**

- Shrink turns grey when the next press would bring any spacing under half a
  step.
