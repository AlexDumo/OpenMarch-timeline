---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: ratio-lock
title: Keeping a group's proportions when you resize it
summary: With two or more marchers selected, the inspector's Arrange section has a Keep ratio button under Resize. While it's on, dragging a corner or side handle of the group keeps its width-to-depth proportions, and holding Ctrl (Cmd on a Mac) frees it for one drag. It's the same lock as the chain button in a box's editor, and it's in the command palette as Toggle ratio lock.
status: open
questions:
  - Did you find Keep ratio under Resize in Arrange? Was it where you expected it?
  - With it on, did resizing the group by a corner or side keep its shape the way you expected?
  - Was it clear from the button and its tooltip whether the lock was on, and what Ctrl/Cmd does while it's on?
  - Did it matter to you that the same lock also turns on for a box's spacings?
---

Open a show and select two or more marchers.

**What to try**

- In the inspector, under **Arrange**, find **Resize** and select **Keep ratio**. It fills in while the lock is on.
- Drag a corner handle of the frame around the group: it grows or shrinks without changing shape. Try a side handle too.
- Hold Ctrl (Cmd on a Mac) while you drag a handle: the lock lets go for that drag.
- Select **Keep ratio** again to turn it off, and resize the group the old way.
- Open the command palette and search for "ratio": **Toggle ratio lock** flips the same button.
- Draw or open a box shape: the chain button beside its spacings is on and off together with **Keep ratio**.
