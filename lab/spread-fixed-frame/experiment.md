---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: spread-fixed-frame
title: Reshuffle a spread without moving the box
summary: Reshuffle now keeps the box or circle exactly where and as big as you drew it, and only picks a different even layout inside it.
status: open
questions:
  - When you pressed Reshuffle, did the box or circle stay exactly where it was and the same size?
  - Did the marchers fill the whole shape every time, with no empty strip along one side?
  - Did any layout look crowded, or have someone left alone?
  - Did the spacing number still match how close the nearest marchers stand?
---

Before this build, each **Reshuffle** on a Spread box made the box a
little bigger or smaller and moved its edges. Now the shape you drew
stays put: Reshuffle only changes which even arrangement of marchers
fills it.

**What to try**

- Open a demo show or start a new one, and select 20 to 60 marchers.
- Press **B** and drag out a box. In the inspector's **Shapes** section,
  switch the fill from **Grid** to **Spread**.
- Press **Reshuffle** several times and watch the box's outline and
  handles. They shouldn't move.
- Try a circle too (**O**), switched to Spread.
- Change the spacing or drag a handle, then Reshuffle again.

**Good to know**

- No two marchers stand closer than the spacing. Some layouts stand a
  little looser than others, because the shape no longer stretches to
  fit each one.
- Spreads placed before this build reopen exactly as they were. The
  first Reshuffle on one of them may resize it once, and after that
  Reshuffle keeps it.
