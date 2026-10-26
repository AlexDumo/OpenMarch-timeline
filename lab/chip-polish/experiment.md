---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: chip-polish
title: A clearer floating editor
summary: The floating editor under an open shape is nearly see-through at rest and solid when you point at it (three looks to compare), its Pathways and link toggles show the icon in the accent on a light accent tint when on, and the spacing readout while you drag a handle sits on a solid pill.
status: open
# How the floating editor looks while the pointer is elsewhere; Glass first
variants:
  - id: glass
    label: Glass
    description: Nearly see-through with a blur at rest, solid on hover or focus
  - id: clear
    label: Clear
    description: Nearly see-through with no blur at rest, solid on hover or focus
  - id: solid
    label: Solid
    description: Always solid, as before
questions:
  - Switch between Glass, Clear and Solid with the Version switch at the bottom left. Which floating editor do you prefer while you look at the field, and does it turn solid when you need it to?
  - Is it obvious at a glance whether Pathways and the link (spacings locked together) are on?
  - Can you read the floating editor's numbers and icons over the field while it's see-through, in the light and dark themes?
  - While you drag a handle, can you read the spacing readout next to the pointer wherever it lands on the field?
---

Small polish on the floating editor under an open shape. Select some
marchers, press **B** and drag a box.

**New in this build:** a **Version** switch at the bottom left compares
three looks for the floating editor while your pointer is elsewhere:
**Glass** (nearly see-through, blurred), **Clear** (nearly see-through, no
blur) and **Solid** (as before). Glass and Clear turn solid when you point
at the editor, click into one of its numbers or open its layout menu, and
stay see-through while you drag the box's handles.

**What to try**

- Click **Pathways** (the path icon) and the **link** between the two
  spacings. When either is on, its icon turns the **accent color on a light accent
  tint**.
- Look at the floating editor over the field lines and the faded marchers,
  then point at it. Switch themes in the settings to compare.
- Drag one of the box's handles. The readout next to the pointer
  (for example "15 × 10½ steps · ↔ 10½ ↕ 5 apart") sits on a **solid pill**.
