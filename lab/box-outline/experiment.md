---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-outline
title: Put a box's marchers around its edge, and pick where the gap goes
summary: A box can now be filled in Outline, with marchers around its edge and one on every corner. With an odd count, one spot between corners stays empty, and you pick which.
status: open
questions:
  - Did Outline put the marchers where you expected, with every corner filled?
  - With an odd count, could you see the empty spot (the dashed ring) at the back's middle?
  - Was clicking another spot the obvious way to move the gap there? Did a click ever move the box or do something else instead?
  - Did Back · Front · Left · Right in the inspector match the sides you see, also on a flipped box?
  - When would you pick "Spreads evenly" over "Leaves a gap"? Does a side off the half steps look right to you?
  - Did the box's proportions after switching to Outline feel close to the box you drew?
---

The box has a second way to be filled. Select some marchers, press **B**
and drag a box, then pick **Outline** next to **Files** in the inspector's
**Shapes** section. The marchers stand around the edge at the box's
spacing, with one on every corner. The box keeps the proportions you drew
as near as whole intervals allow, and its size follows the count.

With an **odd count**, one spot between corners has to stay empty. It
starts in the middle of the back and shows as a dashed ring.

**What to try**

- Select 7, 13 or 21 marchers, draw a box and switch it to **Outline**.
- **Click any spot between corners** to move the gap there. Clicking a
  corner or inside the box does nothing new, and dragging still moves the
  box.
- In the inspector, pick **Gap: Back · Front · Left · Right**. The gap
  goes to the middle of that side.
- Pick **That side: Spreads evenly**. That side's marchers spread out
  between its corners, so they're no longer on the half steps, and there's
  no gap to see.
- Change the count across with **−** and **+** in the floating editor, or
  type a size, and watch the outline go round.
- Flip the box, place it with **Enter**, then select it again: the gap is
  where you left it.
- In the command bar, **/ box** now asks **Fill** first (Enter keeps
  Files). A one-liner such as **box outline 6x3** works too, and
  **box 4x2 3** still sizes a box in Files.

**Good to know**

- Fewer than 4 marchers make a line across the front.
- On a placed box the field click selects marchers as before, so pick the
  gap from the inspector there.
- Even spread and the circle come in later builds.
