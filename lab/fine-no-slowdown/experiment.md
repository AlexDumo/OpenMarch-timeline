---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: fine-no-slowdown
title: Fine turns snapping off without slowing the drag
summary: Fine (Shift with a keyboard, or the Fine button on a tablet) used to move marchers at a quarter of the pointer's speed as well as off the grid. Now it only turns snapping off, and the marchers stay under your pointer or finger.
status: open
questions:
  - With Fine on, did the marchers stay under your pointer or finger and land off the grid where you let go?
  - Did you miss the slow movement anywhere, for example when placing a marcher very precisely?
---

Open a demo show.

**What to try**

- Drag a marcher normally: it snaps to the grid.
- Hold **Shift** (or tap **Fine** on the floating buttons in the tablet
  layout) and drag again. The marcher follows the pointer exactly and lands
  off the grid.
- Press or release Shift partway through a drag. The marcher jumps onto the
  grid or off it at the pointer.

**Good to know**

- Fine still turns a rotation in whole degrees instead of 15° steps.
- Resize and scale handles never snapped, so Fine no longer changes them.
