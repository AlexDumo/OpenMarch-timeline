---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-outline
title: Outline with one spacing all the way round
summary: A box in Outline now spaces its marchers the same on every side, so a long side gets more marchers than a short one. Switching to Outline keeps the space you drew; the first edit after puts the spacing back on half steps.
status: open
variants: []
questions:
  - Switch a long box to Outline. Do the long sides get more marchers than the short ones, about as many as you'd expect?
  - Does the spacing look even all the way round, corners included?
  - After switching to Outline, the spacing may be an odd number such as 0.81. Did that bother you, or was keeping the space you drew more useful?
  - Drag a side handle to make the outline longer or shorter. Did marchers move between the sides the way you expected?
---

Before, an outline could put the same number of marchers on every side and space
the long sides wider. Now there's **one spacing all the way round**.

**New in this build:**

- **Outline spaces every side the same.** Each side holds as many marchers as
  its length: a box twice as long as it is deep has about twice as many on its
  long sides. There's always a marcher on every corner.
- **Switching to Outline keeps the space you drew.** It picks the spacing that
  fits your box best, even if that's not a half step (for example 0.81).
- **The first edit puts it back on half steps**: dragging a handle, dragging
  the spacing, its − and + buttons, the count's − and +, or moving the box.
- **Dragging a side handle** shares the marchers out between the sides again,
  so the spacing stays even as the box gets longer or shorter.
- The floating editor shows **one spacing** for an outline, and changing it
  changes every side.
- With an odd count, the **Leftover** menu still decides which side takes the
  extra space.

**What to try**

- Draw a long box of 20 or more, then pick **Outline** in the mode menu.
- Drag the east handle to make it longer, then shorter.
- Drag the spacing number, and press its − and +.
- Open a show that already has an outline: it should look as it did until you
  change it.

**Good to know**

- Hold **Alt** while dragging for fine control (lines still catch), or
  **Cmd** / **Ctrl** for no snapping at all.
- A circle's outline already had one spacing round the rim; it's unchanged.
