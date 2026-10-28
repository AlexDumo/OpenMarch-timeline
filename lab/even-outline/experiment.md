---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-outline
title: Outline that keeps both spacings exactly as you set them
summary: A box in Outline now keeps both its side-to-side and front-to-back spacing exactly as you set them, like Grid. Dragging an edge moves marchers between the sides in whole spacings. A new Even out button spreads the marchers as evenly as the box allows.
status: open
variants: []
questions:
  - Set the side-to-side spacing to 2 and the front-to-back spacing to 3. Did both stay exactly as you set them?
  - Drag an edge of an outline. Did the box change shape the way you expected, in jumps of one spacing, with the other side staying put?
  - Try Even out on an outline you've stretched. Did the result look as even as you'd expect for that box?
  - With an odd count, is the small note after the Leftover menu ("· ↔ 4 steps") clear? Does its tooltip help?
---

**New in this build:**

- **Both spacings are yours.** Set the side-to-side and the front-to-back spacing
  (type, − / +, or drag), and each stays exactly as you set it. The box's size
  follows from the spacings and the number of marchers on each side, as in Grid.
- **Dragging an edge** moves marchers from one side to another, in whole
  spacings, keeping the total. The opposite edge stays where it is. An edge can
  still land on a yard line or hash when one of those jumps puts it there.
- **Even out** (next to Recalculate, and in the command palette) spreads the
  marchers as evenly as the box allows, keeping the box's size. The spacings it
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
- Drag each edge in and out.
- Stretch it unevenly, then press **Even out**.
- Open a show that already has an outline: it should look as it did until you
  change it.

**Good to know**

- Hold **Alt** while dragging a spacing for hundredths, or **Cmd** / **Ctrl**
  for no snapping.
- A circle's outline is unchanged.
