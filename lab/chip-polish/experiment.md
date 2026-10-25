---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: chip-polish
title: A clearer floating editor
summary: The floating editor under an open shape is a solid surface, its Pathways and link toggles show an accent background when on, and the spacing readout while you drag a handle sits on a solid pill.
status: open
variants: []
questions:
  - Is it obvious at a glance whether Pathways and the link (spacings locked together) are on?
  - Does the floating editor read clearly now that it's solid, in the light and dark themes?
  - While you drag a handle, can you read the spacing readout next to the pointer wherever it lands on the field?
---

Small polish on the floating editor under an open shape. Select some
marchers, press **B** and drag a box.

**What to try**

- Click **Pathways** (the path icon) and the **link** between the two
  spacings. When either is on, its icon sits on an **accent background**.
- Look at the floating editor over the field lines and the faded marchers.
  It's a **solid surface** now in both themes. Switch themes in the settings
  to compare.
- Drag one of the box's handles. The readout next to the pointer
  (for example "15 × 10½ steps · ↔ 10½ ↕ 5 apart") sits on a **solid pill**.
