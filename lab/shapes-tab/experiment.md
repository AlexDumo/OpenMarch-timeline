---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shapes-tab
title: Pick a shape from the Shapes tab
summary: A Shapes tab in the top bar lists the shapes you can draw. Pick one, then drag it out on the field.
status: open
questions:
  - Where did you look first for shapes? Did you find the Shapes tab on your own?
  - When a shape was greyed out, did you understand why and what to do?
  - After picking Box, was it clear the app was waiting for you to drag on the field?
  - With a box drawn, you clicked Box again. What did you expect to happen?
---

This build adds a **Shapes** tab to the top bar, next to Alignment. It
lists every shape you can draw. Only the box exists for now; lines, arcs
and circles join it later, along with your starred shapes and a library.

**What to try**

- Open a demo show or start a new one, and click the **Shapes** tab
  before selecting anyone.
- Select some marchers, then click **Box** in the tab (or press **B**).
- Drag on the field from one corner of the block to the other.
- Press **Enter** to place the marchers, or **Esc** to back out.

**Good to know**

- With nobody selected, the shapes are greyed out and say why.
- The shape you picked is highlighted in the tab while it's open.
- Picking another shape while one is drawn will turn the drawn shape into
  it in the same place and size. With only the box, there's nothing to
  switch to yet.
