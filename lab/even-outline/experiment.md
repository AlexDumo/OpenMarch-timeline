---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-outline
title: Outline with a hard side-to-side interval and sides that sway
summary: A box in Outline now stands its back and front exactly at your side-to-side spacing, and its sides follow the box's depth, about as far apart. A long side gets more marchers than a short one. Switching to Outline keeps the box you drew.
status: open
variants: []
questions:
  - Switch a long box to Outline. Do the long sides get more marchers than the short ones, about as many as you'd expect?
  - Drag the front or back handle. Did the sides' spacing squeeze and stretch the way you'd expect, and did marchers move between sides at sensible moments?
  - The front-to-back spacing now shows as "≈" and can't be changed directly. Is that clear? Do you miss changing it?
  - After switching to Outline, the side-to-side spacing may be an odd number such as 0.78. Did that bother you, or was keeping the box you drew more useful?
---

This is how drill writers usually build an outline: **side to side is the hard
interval, front to back is whatever the box's depth makes it.**

**New in this build:**

- **The back and front stand exactly at the side-to-side spacing**, the number
  you set (half steps; Alt for fine control, Cmd or Ctrl for no snapping).
- **The sides follow the box's depth.** Their spacing is the depth shared out
  between them, with as many marchers as brings it nearest the side-to-side
  spacing. A box twice as long as it is deep gets about twice as many on its
  long sides. There's always a marcher on every corner.
- The floating editor shows the **front-to-back spacing as "≈ 1.8"**: it
  follows the box, so you don't set it.
- **Dragging the front or back** squeezes and stretches the sides' spacing
  smoothly. A marcher moves from one side to another only when that fits
  better, and who goes where is worked out again.
- **Dragging a side or a corner** shares the marchers out to suit the new
  shape, keeping the side-to-side spacing on half steps.
- **Switching to Outline keeps the box you drew.** The side-to-side spacing is
  whatever fits exactly, even if that's not a half step (for example 0.78).
  The first edit puts it back on half steps.
- With an odd count, the **Leftover** menu still decides which side takes the
  extra space.

**What to try**

- Draw a long box of 20 or more, then pick **Outline** in the mode menu.
- Drag the front handle slowly. Watch the sides' spacing and when a marcher
  moves to another side.
- Drag the east handle to make it longer, then shorter.
- Drag the side-to-side spacing, and press its − and +.
- Open a show that already has an outline: it should look as it did until you
  change it.

**Good to know**

- A circle's outline is unchanged.
