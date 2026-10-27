---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: spread-fixed-frame
title: Spread fills the box you drew
summary: Switching to Spread, Reshuffle and typing a seed now keep the box or circle exactly where and as big as you drew it. Spread's handles reshape the box freely, and the spacing is whatever fits.
status: open
questions:
  - When you switched a box from Grid to Spread (or back), did it keep the space it took up?
  - Could you resize a Spread box by its handles the way you wanted? Did it keep up with the pointer?
  - When you pressed Reshuffle, did the box or circle stay exactly where it was and the same size?
  - Did the marchers fill the whole shape every time, with no empty strip along one side?
  - Did any layout look crowded, or have someone left alone?
  - Did the spacing number still match how close the nearest marchers stand?
  - Did typing a seed bring back the layout you expected, without moving the box?
---

Spread now fills the shape you drew. Switching a box from Grid or Outline
to Spread keeps its outline, and the spacing becomes whatever fits your
marchers in it. Reshuffle and a typed seed only change which even
arrangement fills it. Spread's handles move a side wherever you drag it,
the other sides staying put.

**What to try**

- Open a demo show or start a new one, and select 20 to 60 marchers.
- Press **B** and drag out a box. On the second row under the shape,
  open the mode menu and pick **Spread**.
- Press **Reshuffle** on that row several times and watch the box's
  outline and handles. They shouldn't move.
- Open the arrow beside Reshuffle, type an earlier seed and press
  **Enter**. That layout comes back, and the box still stays put.
- Drag a side or corner handle of the Spread box. The side should follow
  the pointer smoothly, even with a lot of marchers, and the marchers
  settle into their places when you let go.
- Switch back to **Grid**: the box keeps the space the spread took up.
- Try a circle too (**O**), switched between Outline and Spread.

**Good to know**

- No two marchers stand closer than the spacing. A spread in the space a
  grid took up is a little tighter than the grid was, since the grid's
  box runs through its outside marchers.
- While you drag a handle, the marchers stretch with the box. They take
  their exact places when you let go.
- Spreads placed before this build reopen exactly as they were. The
  first Reshuffle on one of them may resize it once, and after that
  Reshuffle keeps it.
