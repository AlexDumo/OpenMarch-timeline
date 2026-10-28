---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-outline
title: Outline that keeps both spacings exactly as you set them
summary: A box in Outline now keeps both its side-to-side and front-to-back spacing exactly as you set them, like Grid. Dragging an edge stretches that way's spacing and the edge follows your pointer; marchers move between the sides only with Even out. A new Even out button spreads the marchers as evenly as the box allows.
status: open
variants: []
questions:
  - Set the side-to-side spacing to 2 and the front-to-back spacing to 3. Did both stay exactly as you set them?
  - Drag an edge or a corner of an outline. Did it follow your pointer, with the other side staying put?
  - Try Even out on an outline you've stretched. Did the result look as even as you'd expect for that box?
  - With an odd count, is the small note after the Leftover menu ("· ↔ 4 steps") clear? Does its tooltip help?
---

**New in this build:**

- **Both spacings are yours.** Set the side-to-side and the front-to-back spacing
  (type, − / +, or drag), and each stays exactly as you set it. The box's size
  follows from the spacings and the number of marchers on each side, as in Grid.
- **Dragging an edge** stretches that way's spacing and the edge follows your
  pointer, by half steps of the spacing. The opposite edge stays where it is and
  the number on each side stays the same. A corner stretches both spacings. An
  edge still lands on a yard line or hash when you drag it close.
- **Even out** (next to Recalculate, and in the command palette) spreads the
  marchers as evenly as the box allows, keeping the box's size. It's the only
  way marchers move from one side to another. Like Recalculate, it's just its
  "=" icon while there's nothing to even, and its name opens out when there is.
  Pressing it glides the marchers to their new spots. The spacings it
  picks may not be half steps; they show as "≈" until you set them. It's greyed
  out when there's nothing more to even.
- **A spacing that isn't on a half step shows "≈"**: click the small "≈" before
  it to put it on the nearest half step. Click the number itself to type.
- **Switching to Outline keeps the box you drew.** Its spacings may show "≈"
  until you set them or press Even out.
- With an odd count, the spacing numbers are the **full sides'**, and the
  **Leftover** side adjusts. When it spreads its marchers evenly they stand a
  little wider apart, and a small note after the Leftover menu shows how far:
  "· ↔ 4 steps". Point at the menu or the note to see why.

**What to try**

- Draw a box of 20 or more, pick **Outline**, then set 2 steps side to side and
  3 front to back.
- Drag each edge and corner in and out.
- Stretch it unevenly, then press **Even out**.
- Open a show that already has an outline: it should look as it did until you
  change it.

**Good to know**

- Hold **Alt** while dragging a spacing for hundredths, or **Cmd** / **Ctrl**
  for no snapping.
- A circle's outline is unchanged.
