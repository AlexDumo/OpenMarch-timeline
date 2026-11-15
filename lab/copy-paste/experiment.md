---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: copy-paste
title: Copy a formation and paste it onto other marchers
summary: Copy where a group of marchers stands, or a whole shape, and paste it onto the marchers you select. Paste shows a preview first, and Enter places it.
status: open
questions:
  - Paste shows a preview and waits for Enter. Did that feel right, or did you expect the marchers to move at once?
  - The preview starts centered on the marchers you selected. Is that where you expected it?
  - When you pasted a shape onto more or fewer marchers, was the shape it rebuilt the one you wanted?
  - When you pasted loose marchers onto fewer marchers, did it use the spots you wanted? Did you want to pick them?
  - Did you reach for Cut or Duplicate?
---

Copy and paste reuses a formation. It never adds marchers: it moves the
marchers you have selected into the copied formation.

**What to try**

- Draw a box with a few marchers and place it. Click one of its marchers to
  select the whole box, then copy it (Ctrl/Cmd+C, or right-click the field
  and choose **Copy**).
- Select the same number of other marchers and paste (Ctrl/Cmd+V). The box
  appears centered on them and nobody moves yet. Drag it where you want it,
  turn or flip it, then press Enter. Escape throws it away.
- Paste the box onto more or fewer marchers. It keeps its spacing and is
  laid out for the new count: a 4 × 4 box pasted onto 12 marchers is 4 × 3.
- Select marchers who are not in a shape and copy them. Paste them onto the
  same number, then onto fewer, then onto more. With fewer, the nearest
  spots are used. With more, the nearest marchers take the spots and the
  rest stay where they are.
- Go to another page and use **Paste in place** (Ctrl/Cmd+Shift+V): the
  preview starts exactly where the formation was copied.
- Open another show and paste there. The copied formation is kept by
  OpenMarch on this computer.

**Good to know**

- A shape copied whole is still a shape after pasting: click it and change
  its spacing. Loose marchers paste as plain marchers.
- You can't yet pick which spots stay empty when you paste onto fewer
  marchers. Until then, copy only the marchers on the spots you want.
- This is OpenMarch's own clipboard. Ctrl/Cmd+C and V in a text box still
  copy and paste text.
