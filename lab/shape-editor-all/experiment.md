---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-editor-all
title: Everything for a shape is in its floating editor
summary: The inspector no longer has shape sections. The floating editor's second row now starts with a Grid / Outline / Spread menu that pictures your shape in each mode, then the layout menu (Grid), the leftover menu (Outline) or Reshuffle (Spread). A pivot button beside the turn opens the 3 × 3 pivot grid.
status: open
variants: []
questions:
  - "When you change the box, does the floating editor glide to its new place predictably? Clicking − or + quickly, does each click land on the same button?"
  - Could you find everything you used to do in the inspector for a shape (switching Grid, Outline and Spread, the layout, the leftover side, Reshuffle, the pivot)?
  - Does the second row under the editor read clearly? Do the mode menu's pictures help you pick Grid, Outline or Spread?
  - Does the pivot button's icon tell you which pivot is picked?
  - Do you miss the inspector's closer / wider (half a step) scale buttons?
---

The inspector's shape sections are gone. Everything for an open or
selected shape is now in its floating editor. Select some marchers, press
**B** and drag a box.

**New in this build**

- Under the editor's row, a second row starts with a **mode menu** (Grid,
  Outline, Spread). Each choice shows a small picture of your shape filled
  that way. After a divider: the **layout** menu in Grid, a **Leftover** menu in
  Outline (which side the odd spot is left out of, and whether it leaves a
  gap or spreads evenly), and **Reshuffle** in Spread.
- Beside the turn degrees, a small **pivot** button shows the pivot as a
  3 × 3 of dots. Click it to pick a corner, an edge's middle or the center.
  A pivot dragged on the field (Cmd/Ctrl-drag from the center dot) lights
  none of them.
- The inspector shows nothing for an open or selected shape. With plain
  marchers selected it still has the **Box** button and the **Transform**
  section (pivot, rotation, flips).
- The inspector's closer / wider scale buttons are gone. The editor's
  spacings cover them.

**The editor glides**: whenever the box changes, the floating editor
springs gently to its new place under it. It no longer waits for your
pointer to leave, and while you're clicking it, it stays put until a moment
after your last click.

**What to try**

- Switch a box between Grid, Outline and Spread from the editor.
- With 7 marchers in Outline, open the Leftover menu and move the gap.
- Pick a corner pivot, then turn the box.
- Place the box, select it again, and do the same.
- Click − and + a few times quickly, turn the box, and stretch it near the
  bottom of the field.
