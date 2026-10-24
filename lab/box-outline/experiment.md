---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-outline
title: Put a box's marchers around its edge, and pick where the gap goes
summary: A box can now be filled in Outline, with marchers around its edge and one on every corner, in about the space the box took up. With an odd count, one side spreads its marchers evenly, or leaves a gap where you pick.
status: open
questions:
  - Did switching to Outline keep about the space your box took up? Were the new spacings ones you'd keep, or did you change them straight away?
  - With an odd count, did "Spreads evenly" on the back look right as the default?
  - When you picked "Leaves a gap", could you see the empty spot (the dashed ring)?
  - Was clicking another spot the obvious way to move the gap there? Did a click ever move the box or do something else instead?
  - Did Back · Front · Left · Right in the inspector match the sides you see, also on a flipped box?
---

The box has another way to be filled. Select some marchers, press **B**
and drag a box, then pick **Outline** in the inspector's **Shapes**
section. The marchers stand around the edge with one on every corner.

**New in this build** (from your feedback on the last one):

- Switching to Outline **keeps the space the box took up**, not its file
  count. The spacings are refitted to that space in half steps, so change
  them afterwards if you want it tighter or looser.
- With an **odd count**, the back now **spreads evenly** by default.
  "Leaves a gap" is the other choice.

**What to try**

- Select 7, 13 or 21 marchers, draw boxes of different shapes and switch
  each to **Outline**. Compare the outline with the box you drew.
- Pick **That side: Leaves a gap**. The empty spot shows as a dashed ring
  in the middle of the back. **Click any spot between corners** to move it
  there; dragging still moves the box.
- Pick **Gap: Back · Front · Left · Right** in the inspector. The short
  side moves to the middle of that side.
- Change the count across with **−** and **+** in the floating editor, or
  type a size, and watch the outline go round.
- Flip the box, place it with **Enter**, then select it again: the gap is
  where you left it.
- In the command bar, **/ box** asks **Fill** first (Enter keeps Grid).
  A one-liner such as **box outline** works too, and **box 4x2 3** still
  sizes a box in Grid.

**Good to know**

- Fewer than 4 marchers make a line across the front.
- A box in a single rank or file has no space to keep, so it keeps its
  spacing and goes round as wide (or deep) as it can.
- On a placed box the field click selects marchers as before, so pick the
  gap from the inspector there.
- The busy look while a shape is open is a known issue, filed separately.
