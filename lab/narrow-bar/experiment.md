---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: narrow-bar
title: The shape editor fits a narrow window
summary: In a narrow window the shape editor ran off the side of the field, hiding its last controls. Now it goes onto two rows when one row doesn't fit, and stays one row otherwise.
status: open
variants: []
questions:
  - With the window narrow, could you see and use every control on the shape editor?
  - Did the switch between one row and two rows ever get in your way, for example while resizing the window or changing a number?
---

**Fixed in this build:**

The shape editor under a box is a single row. In a narrow window it used to
run off the side of the field, so you couldn't reach Place or the controls
before it.

Now, when one row doesn't fit, the editor goes onto two rows: the counts and
spacing on top, and the turn, flips, Expand and Shrink and Place below. With
room for one row, it's one row as before.

**Try it**

1. Open a demo show, select some marchers and press **B** to draw a box.
2. Make the window narrower until the editor goes onto two rows. Every
   control should stay inside the field.
3. Make the window wide again. The editor goes back to one row.
