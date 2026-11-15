---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: held-shapes
title: Hold a shape across pages
summary: A shape can now be Held like any marchers. Place a box, move it on one page, hold it through the next, and changing it on the Held page changes it where it was set. Selecting one marcher holds the whole shape. A shape shown on a later page without a hold now reads Not defined, so the bars and the field look match what an edit there does.
status: open
questions:
  - After holding the shape through a later page, did changing it there change it on the earlier page, as you expected?
  - Selecting one marcher of the shape held the whole shape. Was that what you wanted?
  - Before you held it, the later page showed the shape as Not defined (dashed). Did that make sense?
  - Did anything about holds or shapes surprise you, or refuse something you expected to work?
---

Open a demo show. Basic or Expert both work.

**What to try**

- Select a few marchers and place a box on Page 2 (press the box shape key or
  use the Shapes tab).
- Go to Page 3. Select the box: its bars on the timeline are dashed, Not
  defined. That's what it always did when you edited it there: Page 3 got a
  copy of its own.
- Right-click Page 3's box on the timeline (or a marcher of the box on the
  field) and choose **Hold from last keyframe**. Select just **one** marcher of
  the box first: the whole box is held, the rest join the selection, and the
  message says "and the rest of their shape".
- Now change the box on Page 3: drag it, resize it, turn it. Go back to Page 2:
  it changed there too. Page 3 follows Page 2, like any Held marchers.
- Undo puts both pages back in one step.

**Also try**

- Hold Page 4 as well, then change the box on Page 4: Pages 2–4 all follow.
- On a page where you had already changed the box before holding, hold it: the
  page's own copy goes, and the box goes back to how Page 2 has it.
- Hold only part of a box (shorten one marcher's hold by dragging the end of
  its bar), then try to change the box: it's refused with a message, because a
  shape is held whole or not at all.

**Good to know**

- A shape on a later page without a hold still shows its outline and can be
  selected; changing it there still gives that page its own copy.
