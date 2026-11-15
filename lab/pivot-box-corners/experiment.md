---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: pivot-box-corners
title: Pivot on the frame's corners, and a turn you can read
summary: A group's pivot now snaps to the corners and side middles of the blue frame as it's drawn, and the pivot grid's cells point at those same spots. Turning a group draws a dashed yellow line from the pivot to the pointer, with the angle beside it, as turning a shape does.
status: open
questions:
  - When you dragged the pivot to a corner of the blue frame, did it snap where you expected?
  - Did the pivot grid's corner cells put the pivot where you expected?
  - While turning the group, did the dashed line and the angle help? Did the angle read the way you expected (minus for counterclockwise)?
---

Open a show and select two or more marchers, for example a block.

**What to try**

- Hold Ctrl (Cmd on a Mac) and drag the small dot in the middle of the group onto a corner of the blue frame. It snaps to the corner as drawn, just outside the corner marcher. Dragged onto the corner marcher itself, it snaps to the marcher.
- Try a side's middle too, and the pivot grid next to **Rotation** in the inspector: point at a corner cell to see where it lands.
- Zoom in or out after setting a corner: the pivot stays where you put it.
- Drag the round handle above the frame: a dashed yellow line runs from the pivot to the pointer, and the angle shows by the pointer. Past a half turn it reads the other way, with a minus sign.
