---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: chip-polish
title: A clearer floating editor
summary: The floating editor under an open shape fades so you can see under it while your pointer is away, and turns solid when you point at the box or the editor. Its Pathways and link toggles show the icon in the accent on a light accent tint when on, and the spacing readout while you drag a handle sits on a solid pill.
status: open
variants: []
questions:
  - With your pointer away, does the faded editor let you see what's under it? Does it turn solid when you point at the box or the editor, and is 40% the right amount of fade?
  - Is it obvious at a glance whether Pathways and the link (spacings locked together) are on?
  - While you drag a handle, can you read the spacing readout next to the pointer wherever it lands on the field?
---

Small polish on the floating editor under an open shape. Select some
marchers, press **B** and drag a box.

**New in this build:** with your pointer away from both the box and its
floating editor, the editor fades to 40% so you can see what's under it.
Point at the box or the editor, click into one of its numbers or open its
layout menu, and it's solid again. It stays faded while you drag the box's
handles.

**What to try**

- Click **Pathways** (the path icon) and the **link** between the two
  spacings. When either is on, its icon turns the **accent color on a light accent
  tint**.
- Look at the floating editor over the field lines and the faded marchers,
  then point at it. Switch themes in the settings to compare.
- Drag one of the box's handles. The readout next to the pointer
  (for example "15 × 10½ steps · ↔ 10½ ↕ 5 apart") sits on a **solid pill**.
