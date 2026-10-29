---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: page-pivot
title: A box's pivot on a later page
summary: A box placed on one page also shows on later pages while its marchers stand still. Changing only its pivot on a later page used to change it on the earlier page too. Now it changes on that page alone, and the later page still follows edits you make to the box on the earlier page.
status: open
variants: []
questions:
  - After you moved the pivot on the later page, was the earlier page's pivot where you left it?
  - After you edited the box on the earlier page, did the later page follow it the way you expected?
  - Did a later page with no pivot of its own take the pivot you expected (the most recent earlier page's)?
---

**Changed in this build:**

A box placed on one page shows on the next pages for as long as its marchers
stay where it put them. Turning, resizing or moving the box on a later page
gives that page its own copy of the box. Changing only its pivot there, with
nobody moving, used to change the pivot on the earlier page too.

Now a pivot-only change on a later page is kept for that page alone. Nobody is
set on that page, so it keeps following what you do to the box on the earlier
page. A page with no pivot of its own uses the most recent earlier page's.

**Try it**

1. Open a demo show or start a new one with at least three pages. Go to
   Page 1, select a group of marchers, press **B**, draw a box and press
   **Enter** to place it. Leave Pages 2 and 3 without moving anyone.
2. Go to Page 2. Click one of the box's marchers: the box is selected, carried
   over from Page 1.
3. Hold **Ctrl** (**Cmd** on a Mac) and drag the pivot dot (the dot in the
   middle of the box) onto a corner or a marcher. You can also pick a point
   from the pivot menu beside the degrees, or double-click the dot to send it
   back to the center.
4. Go back to Page 1 and select the box. Its pivot is where it was, not where
   you put it on Page 2.
5. Still on Page 1, change the box: make the spacing wider, for example.
6. Go to Page 2 and select the box. It's the wider box from Page 1, and its
   pivot is still the one you set on Page 2.
7. Go to Page 3. The box has Page 2's pivot.
