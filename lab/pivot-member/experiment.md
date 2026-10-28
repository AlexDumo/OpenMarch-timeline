---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: pivot-member
title: The marcher at the pivot stays in the box
summary: Turning a placed box about a marcher on a later page left that marcher out of the box there, because it didn't move. Now every marcher in the box belongs to it on that page, the one at the pivot included.
status: open
variants: []
questions:
  - Turn a placed box about one of its marchers on the next page. Does that marcher still belong to the box there (a click on it selects the whole box)?
  - After that, go back to the earlier page and move the box. Did the next page do what you expected?
---

**Fixed in this build:**

When you turn a placed box about one of its own marchers, that marcher stays
where it is. On a later page this used to leave it out of the box: a click on
it selected only that marcher, and the box acted as if it had one fewer.

Now an edit to a box that moves anyone sets every marcher in the box on that
page, including the one that didn't move. A change that moves nobody, such as
only picking a new pivot, still sets no one.

For now the marcher at the pivot shows no keyframe diamond on that page, since
it didn't move. It still belongs to the box. The diamond comes with the planned
keyframe change, where every stored move counts as a keyframe.

**Try it**

1. Open a demo show, select some marchers and press **B** to draw a box.
   Press **Enter** to place it.
2. Click the box. Cmd/Ctrl-drag its center dot onto a corner marcher, then
   turn it a quarter with ↻.
3. Go to the next page. Click the box, Cmd/Ctrl-drag the pivot onto another
   of its marchers, and turn it again.
4. Click the marcher at the pivot. The whole box should be selected.
