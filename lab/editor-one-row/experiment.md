---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: editor-one-row
title: Shape editor on one row, with Recalculate
summary: The shape's floating editor no longer has a ⋯ menu. Turn, the flips, Save and a new Recalculate button now sit on its one row, and a box's layout has its own pill under it. Recalculate decides again who goes where by least travel.
status: open
variants: []
questions:
  - Could you find turn, flip and save without the ⋯ menu? Was anything hard to find?
  - Is ↻ next to the degrees (it adds 90°) clear? Did you try typing or dragging the degrees too?
  - Did Recalculate do what you expected? Did you notice when it became available? Was it clear why it was greyed out when it was?
  - Is the editor too wide now? Which button would you give up first?
  - Did you use the keys (Alt+R, Alt+F, Shift+R)? Are those the right keys?
---

The floating editor under a shape is now **one row**. The **⋯** menu is gone,
and everything it held sits on the row as small icon buttons. Hover any of
them for its name. A box's layout ("Short back") has its own small pill
under the editor.

**New in this build:**

- **Turn:** **↻** adds 90° to the degrees beside it. Drag the degrees, or
  click them and type. They snap every 15°, and holding **Alt** turns it
  freely.
- **Flip side to side** and **flip front to back**.
- **Recalculate** (a person with arrows): moving, turning or flipping a
  shape keeps everyone on their own spot. Recalculate works out who goes
  where again, so everyone travels the least from where they start the move.
  It's one undo step. When the order is already least travel it's just a
  greyed-out icon. When it can change something, the word "Recalculate"
  springs open and the button lights up purple for a moment.
- **Close up** for a placed shape with empty spots.
- At the end, before Place: the **pathways** toggle and **☆ Save**. They
  don't change the shape itself.
- The **Least travel / Drill order** choice is gone for now.

- **Keys** while a shape is open or selected: **Alt+R** turns it 90°,
  **Alt+F** and **Alt+Shift+F** flip it, **Shift+R** recalculates. Tooltips
  show the keys.

**What to try**

- Select some marchers, press **B** and draw a box. Turn it a quarter with
  ↻, then press Recalculate. Watch the pathways (the path button) change.
  Then undo.
- Move the box by dragging inside it. Recalculate stays greyed out: sliding a
  whole shape doesn't change who should go where.
- On a later page, place a box, click it to select it, flip it and press
  Recalculate.

**Good to know**

- At home (the first page) a placed shape has nowhere else to come from, so
  Recalculate stays greyed out there.
- For a placed shape with empty spots, use Close up instead.
