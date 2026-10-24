---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: set-following
title: See which marchers have a keyframe on each count, and remove one
summary: Marchers you haven't placed on the count you're looking at draw with a dashed edge, the timeline marks your selection's keyframes with diamonds, and Remove keyframe takes one back.
status: open
questions:
  - Could you tell at a glance which marchers you'd already placed on a page and which were just carrying over? Did the dashed edge ever get in the way?
  - Did the keyframe diamonds on the timeline help you find where the selected marchers were placed? Did you try hovering, clicking or right-clicking one?
  - Is "keyframe" a clear word for a count where a marcher was placed? What would you call it?
  - When you used Remove keyframe, did the later pages do what you expected? Was it clear which of the two to pick?
  - Where did you first look for Remove keyframe? The inspector, the field's right-click menu, a diamond's right-click menu, or the command palette (⌘K / Ctrl+K)?
---

Each marcher either **has a keyframe** or is **following** on the count
you're looking at. A marcher with a keyframe has been placed on that exact
count. A following marcher is carrying over from earlier, or is partway
through a move. Open a
demo show to try it.

**What to try**

- Step through the counts with nothing selected. Following marchers draw
  with a dashed edge and a lighter label. Marchers with a keyframe are solid. Press Play,
  then Stop, and watch them ease back.
- Drag a dashed marcher on a page. It turns solid: it has a keyframe there now.
- Select a few marchers. Keyframe diamonds on the timeline show the counts
  where they were placed: filled where all of them were, hollow where only
  some were. Hover one to see who, and click it to jump there.
- On a count where a selected marcher has a keyframe, use **Remove keyframe**
  (in the inspector, the field's right-click menu, or a diamond's right-click
  menu). It goes back to following from earlier, and the pages after it stay
  where they are.
- Undo, then try **Remove keyframe, Pages N–M follow back**. This time the
  pages after it follow back to the keyframe before it too.
- Right-click the field to see its new menu. Right-drag still pans.

**Good to know**

- Playback, exports and the 3D View always draw everyone solid.
- Zoomed all the way out, the labels look the same; the dashes carry the
  difference there.
