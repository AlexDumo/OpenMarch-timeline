---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: set-following
title: See which marchers are set on each count, and take a spot back
summary: Marchers you haven't placed on the count you're looking at draw with a dashed edge, the timeline marks where your selection was set, and Unset takes a spot back.
status: open
questions:
  - Could you tell at a glance which marchers you'd already placed on a page and which were just carrying over? Did the dashed edge ever get in the way?
  - Did the diamonds on the timeline help you find where the selected marchers were set? Did you try clicking or right-clicking one?
  - When you used Unset, did the later pages do what you expected? Was it clear which of the two Unset actions to pick?
  - Where did you first look for Unset? The inspector, the field's right-click menu, a diamond's right-click menu, or the command palette (⌘K / Ctrl+K)?
---

Each marcher is now either **set** or **following** on the count you're
looking at. A set marcher has been placed on that exact count. A following
marcher is carrying over from earlier, or is partway through a move. Open a
demo show to try it.

**What to try**

- Step through the counts with nothing selected. Following marchers draw
  with a dashed edge and a lighter label. Set marchers are solid. Press Play,
  then Stop, and watch them ease back.
- Drag a dashed marcher on a page. It turns solid: you've set it there.
- Select a few marchers. Diamonds on the timeline show the counts where they
  were set: filled where all of them were, hollow where only some were.
  Click a diamond to jump there.
- On a count where a selected marcher is set, use **Unset here** (in the
  inspector, the field's right-click menu, or a diamond's right-click menu).
  It goes back to following from earlier, and the pages after it keep their
  spots.
- Undo, then try **Unset here and on Pages N–M**. This time the pages after
  it follow back to the earlier spot too.
- Right-click the field to see its new menu. Right-drag still pans.

**Good to know**

- Playback, exports and the 3D View always draw everyone solid.
- Zoomed all the way out, the labels look the same; the dashes carry the
  difference there.
