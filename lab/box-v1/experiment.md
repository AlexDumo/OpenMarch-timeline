---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-v1
title: Draw a block of marchers
summary: Select marchers, press B and drag out a block on the field.
status: open
questions:
  - Did the block you drew end up where and how you expected? If not, what surprised you?
  - When you changed the number of files with − / + (or the [ and ] keys), did the block stay where you wanted it?
  - Was it clear how to start, adjust and finish a block? What did you look for and not find?
---

This build has a new way to put marchers in a block (a grid of files and
ranks). It's the first shape of a rebuilt shape tool, so it only does
blocks for now.

**What to try**

- Open a demo show or start a new one, and select some marchers.
- Press **B** (or the **Box** button in the inspector), then drag on the
  field from one corner of the block to the other.
- Drag the corners or sides to stretch the spacing, or drag inside the box
  to move it.
- Use **−** and **+** under the box (or `[` and `]`) to change how many
  files there are.
- Press **Enter** to place the marchers, or **Esc** to cancel.

**Good to know**

- Spacing snaps to half steps. Hold **Shift** for equal spacing across and
  deep, or **Alt** to turn snapping off.
- If the marchers don't fill the last rank, the short rank goes at the back,
  centered.
- Pressing outside an open box draws a new one in its place.
- There's no rotating a block yet.
