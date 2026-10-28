---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-tool
title: The shape tool (box)
summary: OpenMarch's first shape tool. Select marchers, pick Box, draw it on the field, shape it from the floating editor under it, and press Enter to place it. We want your read on the controls as the model for every future shape, not only on this box.
status: open
variants: []
questions:
  - Select marchers, pick a shape, draw it, press Enter to place. Did that order feel natural? Where did you hesitate?
  - An open shape waits at its moment, and only Enter places it. Did you ever lose work, or place something by accident?
  - Everything is on the floating editor next to the shape, and nothing is in the inspector. Did you look for anything in the inspector, or miss it there?
  - Was it clear which controls change the shape (size, turn, flip, pivot) and which change how marchers fill it (Grid, Outline, Spread, layout)?
  - Would these same controls make sense on a circle, a line, an arc, or a custom shape? What would you expect to be different?
  - Spacing is in steps, snaps to half steps, and edges pull onto yard lines and hashes. Could you hit the exact form you'd write on a coordinate sheet?
  - Did dragging or typing feel faster for you? When did you switch from one to the other?
  - Marchers keep their spots when you move or turn a shape, and Recalculate (Shift+R) reassigns them by least travel. Is that the right default, or should reassigning happen automatically?
  - What would make you reach for this instead of placing marchers one by one?
  - What's the first shape you'd want after the box?
---

OpenMarch has never had a shape tool. This is the first one, a box, built so
the same controls can carry other shapes later.

**Try it**

1. Open a demo show or start a new one. Select a group of marchers, then
   press **B** (or pick Box in the Shapes tab).
2. Drag on the field to draw the box. Its edges and corners pull onto yard
   lines, hashes and sidelines, and an orange guide names the line ("S2: On
   45", "On FH").
3. Shape it from the floating editor under it: its size (8 × 4), the two
   spacings (type fractions like 1 2/3, or drag the numbers), turn (↻ or the
   degrees), flip, and the pivot grid that sets what it turns and grows around.
4. Pick how marchers fill it from the mode menu: **Grid**, **Outline** or
   **Spread**. Switching keeps the box where you drew it. In Spread, try
   **Edge** to stand marchers along the outline, and **Reshuffle**.
5. Drag inside the box to move it. Its corners and center catch yard lines
   and hashes too.
6. Press **Enter** to place it, or **Esc** to discard.
7. Click a placed box to select it and edit it again. **Recalculate**
   (Shift+R) works out who goes where by least travel.

**Good to know**

- Hold **Alt** for fine control (no half steps, lines still catch). Hold
  **Cmd** (Mac) or **Ctrl** for no snapping at all.
- If the box or its editor would end up off the screen, the field glides just
  far enough to bring them back.

Answer the questions with the whole tool in mind: we're deciding whether this
is how every shape in OpenMarch should work.
