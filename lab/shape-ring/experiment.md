---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-ring
title: Pick a shape from the ring at your cursor
summary: Hold R on the field and a ring of shapes opens around your cursor. Slide to one and let go to pick it, or tap R to keep the ring open.
status: open
questions:
  - Did holding R, sliding and letting go feel quick enough to use all the time?
  - Did tapping R to keep the ring open make sense? Did you ever get one when you meant the other?
  - With nobody selected, did you understand why the shapes were greyed out?
  - The ring only holds the box for now. What would you want in it once you can star shapes?
---

This build adds a **favorites ring**. With the mouse over the field, hold
**R**: a ring of shapes opens around the cursor. Only the box exists for
now; your starred shapes will go in it first once the shape library
arrives, with the basic shapes filling the rest (8 at most).

**What to try**

- Select some marchers, put the mouse on the field, then hold **R**.
- Slide toward **Box** until it lights up, and let go of R. Then drag on
  the field to draw the box, and press **Enter** to place it.
- Tap **R** quickly instead: the ring stays open. Click **Box** to pick
  it, or click anywhere else to close the ring.
- Try it with nobody selected.

**Good to know**

- **Esc** closes the ring before anything else, so a drawn shape stays.
- Picking from the ring while a shape is drawn turns the drawn shape into
  the one you picked (with only the box, there's nothing to switch to
  yet).
- The key can be changed in Settings › Shortcuts, under Shape.
