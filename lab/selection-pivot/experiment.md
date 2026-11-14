---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: selection-pivot
title: Turning a group around any point
summary: A selected group now has a yellow crosshair, its pivot, that you can drag anywhere. The round handle and the Rotation box turn the group around it. The Transform section at the top of the inspector is gone; Rotation is back in the marcher section.
status: open
questions:
  - Did you notice the crosshair in the middle of the selection, and could you tell it moves?
  - Did it snap where you wanted (a marcher, a corner of the frame, the grid)?
  - Did turning around the pivot, with the handle or the Rotation box, do what you expected?
  - When you moved the group, or picked other marchers, did the pivot end up where you expected?
---

Open a show and select two or more marchers.

**What to try**

- Drag the yellow crosshair in the middle of the frame onto a marcher or a corner of the frame. It snaps there. Hold Shift to place it freely.
- Drag the round handle above the frame: the group turns around the crosshair.
- Type an angle in **Rotation**, under **Rotate** in the inspector's marcher section.
- Move the group: the crosshair moves with it.
- Double-click the crosshair, or drag it back onto the center, to put it back in the middle.
