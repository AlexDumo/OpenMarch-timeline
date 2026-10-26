---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: editor-one-row
title: Shape editor on one row, with Recalculate
summary: The shape's floating editor no longer has a ⋯ menu. Turn, the flips, Save and a new Recalculate button now sit on its one row. Recalculate decides again who goes where by least travel.
status: open
variants: []
questions:
  - Could you find turn, flip and save without the ⋯ menu? Was anything hard to find?
  - Can you tell the quarter turn (↻90) and the free turn (arc and degrees) apart at a glance?
  - Did Recalculate do what you expected? Was it clear why it was greyed out when it was?
  - Is the editor too wide now? Which button would you give up first?
  - Did you miss choosing Least travel or Drill order?
---

The floating editor under a shape is now **one row**. The **⋯** menu is gone,
and everything it held sits on the row as small icon buttons. Hover any of
them for its name.

**New in this build:**

- **↻90** turns the shape a quarter, as before.
- **Turn** (an arc arrow and the degrees) turns it freely. Drag the number,
  or click it and type. It snaps every 15°, and holding **Alt** turns it
  freely.
- **Flip side to side** and **flip front to back**.
- **Recalculate** (a person with arrows): moving, turning or flipping a
  shape keeps everyone on their own spot. Recalculate works out who goes
  where again, so everyone travels the least from where they start the move.
  It's one undo step. It's greyed out when the order is already least travel.
- **☆ Save**, and **Close up** for a placed shape with empty spots.
- The **Least travel / Drill order** choice is gone for now.

**What to try**

- Select some marchers, press **B** and draw a box. Turn it a quarter with
  ↻90, then press Recalculate. Watch the pathways (the path button) change.
  Then undo.
- Move the box by dragging inside it. Recalculate stays greyed out: sliding a
  whole shape doesn't change who should go where.
- On a later page, place a box, click it to select it, flip it and press
  Recalculate.

**Good to know**

- At home (the first page) a placed shape has nowhere else to come from, so
  Recalculate stays greyed out there.
- For a placed shape with empty spots, use Close up instead.
