---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: mark-fixes
title: Shape tool fixes from your feedback
summary: Three fixes from tester feedback on the shape tool. The turn knob is never hidden under the editor bar, Shapes comes before Props in the left toolbar, and the pivot of a box can now be changed on a later page.
status: open
variants: []
questions:
  - Turn a box upside down (180°), then sideways (90° and 270°). Could you always see and grab the turn knob?
  - Is Shapes where you'd expect it in the left toolbar, now that it comes before Props?
  - Place a box on one page and change its pivot. Then go to the next page, select the box and change its pivot again. Did it take?
  - On that next page, if the marchers just carry over from the page before, the pivot change also shows on the earlier page, since it's the same box. Is that what you'd expect?
---

**New in this build:**

- **The turn knob stays clear of the editor bar.** Turned upside down, the
  knob is under the box, and the editor bar used to cover it. The bar now
  moves below the knob, or above the box when there's no room below.
- **Shapes before Props** in the left toolbar.
- **The pivot on a later page.** Place a box on a page and go to the next
  one. If the marchers just carry over, changing the box's pivot there used
  to do nothing. Now it takes, and because the box on that page is the same
  box as on the page before, the earlier page shows the new pivot too. If the
  next page has its own positions for those marchers (you placed the box
  again, or set them to the previous page), the change stays on that page.

**Try it**

1. Open a demo show, select some marchers and press **B** to draw a box.
2. Type 180 in the editor's degrees, then 90 and 270. Grab the knob each time.
3. Press **Enter** to place the box. Click it, and pick a pivot from the
   grid beside the degrees, or Cmd/Ctrl-drag the center dot.
4. Go to the next page, click the box and change its pivot again.
