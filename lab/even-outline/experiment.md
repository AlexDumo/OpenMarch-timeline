---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-outline
title: Outline that keeps what you set and works out the rest
summary: A box in Outline keeps whatever you just touched and works out the rest once. Set a spacing and the marchers are shared out so the other spacing comes as near it as it can. Drag an edge and only that edge moves. A spacing off the half steps shows as "≈" and a click puts it on one.
status: open
variants: []
questions:
  - Set the side-to-side spacing of an outline to something quite different (for example 2 to 4). Did the result, and the way marchers moved between sides, make sense?
  - Drag an edge of an outline. Did anything other than that edge move?
  - When a spacing showed "≈", was it clear what that meant, and that a click puts it on a half step?
  - Switch a long box to Outline. Do the long sides get more marchers than the short ones, about as many as you'd expect?
---

An outline now follows one simple rule: **whatever you just touched is kept,
and only the rest is worked out, once.**

**New in this build:**

- **Set a spacing** (type it, press − or +, or drag it), side to side or front
  to back. That spacing is kept, and so is the box's length the other way. The
  marchers are shared out between the sides so the other spacing comes as near
  the one you set as it can, and that other spacing is worked out. Doing the
  same edit again changes nothing.
- **Drag an edge**: only that edge moves. The counts on each side, the other
  spacing and the other edges stay exactly where they are. The dragged side's
  spacing follows the drag.
- **A spacing that isn't on a half step shows as "≈"** (for example "≈1.83").
  Click it (or Tab to it and press Enter) to put it on the nearest half step.
  Both spacings are always shown, and you can set either one.
- **Switching to Outline keeps the box you drew**, with the marchers shared out
  so the two spacings come as near each other as they can.
- With an odd count, the spacing numbers are the **full sides'**, and the
  **Leftover** side adjusts. When it spreads its marchers evenly they stand a
  little wider apart, and a small note after the Leftover menu shows how far:
  "· ↔ 4 steps". Point at the menu to see why.

**What to try**

- Draw a long box of 20 or more, then pick **Outline** in the mode menu.
- Type a very different side-to-side spacing, then a front-to-back one.
- Drag each edge in and out. Only that edge should move.
- Click a "≈" spacing to put it on a half step.
- Open a show that already has an outline: it should look as it did until you
  change it.

**Good to know**

- Hold **Alt** while dragging a spacing for hundredths, or **Cmd** / **Ctrl**
  for no snapping. Edges still catch yard lines and hashes unless you hold
  Cmd or Ctrl.
- A circle's outline is unchanged.
