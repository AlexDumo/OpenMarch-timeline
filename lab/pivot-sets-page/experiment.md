---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: pivot-sets-page
title: Changing a box's pivot on a later page
summary: A box placed on one page also shows on later pages while its marchers stand still. Changing only its pivot on a later page used to change it on the earlier page too. Now it works like any other edit there. That page gets its own copy of the box with the new pivot, and the earlier page keeps its pivot.
status: open
variants: []
questions:
  - After you moved the pivot on Page 2, was Page 1's pivot where you left it?
  - Did you expect Page 2 to stop following later changes to the box on Page 1 once you changed its pivot?
  - Did undo put things back the way you expected?
---

**Changed in this build:**

A box placed on one page shows on the next pages for as long as its marchers
stay where it put them. Turning, resizing or moving the box on a later page
already gave that page its own copy of the box. Changing only its pivot there,
with nobody moving, used to change the pivot on the earlier page too.

Now a pivot change on a later page is treated like any other edit there. Every
marcher in the box is set on that page, where they already stand, so the page
gets its own copy of the box with the new pivot. The earlier page keeps its
pivot. On the box's own page, changing the pivot still just changes the pivot.

**Try it**

1. Open a demo show or start a new one with at least two pages. Go to Page 1,
   select a group of marchers, press **B**, draw a box and press **Enter** to
   place it. Leave Page 2 without moving anyone.
2. Click **Page 2** on the timeline, so you edit Page 2 alone. Click one of
   the box's marchers. The box is selected, carried over from Page 1.
3. Hold **Ctrl** (**Cmd** on a Mac) and drag the pivot dot (the dot in the
   middle of the box) onto a corner or a marcher. You can also pick a point
   from the pivot menu beside the degrees, or double-click the dot to send it
   back to the center.
4. Go back to Page 1 and select the box. Its pivot is where it was, not where
   you put it on Page 2.
5. Press undo (Ctrl+Z or Cmd+Z) once. Page 2 shares Page 1's box again.

**Good to know**

- Once Page 2 has its own copy, changing the box on Page 1 no longer changes
  it on Page 2. That's the same as after any other edit on Page 2.
- An edit on Page 2 that leaves the box exactly as it was doesn't give
  Page 2 a copy.
- In Expert, if your edit reaches back over Page 1 (the start flag is still
  on Page 1), a pivot change sets no one and changes the box's pivot on both
  pages, as before.
- In Basic, if some of the box's marchers are locked on Page 2, a pivot
  change there also changes it on both pages, as before.
