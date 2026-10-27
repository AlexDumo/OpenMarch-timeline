---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-keep-in-view
title: The shape and its editor stay in view after an edit
summary: Turning, flipping or resizing a box near the edge of the screen used to push it partly out of sight. Now the field glides to keep it in view. Two versions to compare, switched at the bottom left. A keeps the box and its editor in view. B keeps the editor where it is on screen.
status: open
variants:
  - id: keep-in-view
    label: A · Keep in view
    description: After a change, the field glides just far enough to bring the box and its editor back into view, and doesn't move if they're still in view
  - id: hold-editor
    label: B · Hold the editor still
    description: After a change, the field glides so the floating editor stays at the same spot on screen
questions:
  - Which version felt better while you edited a box near the edge of the screen, A (Keep in view) or B (Hold the editor still)? Why?
  - Was either version disorienting, for example the field moving when you didn't expect it to?
  - In B, did it help that the editor stayed put while you clicked its buttons? Did the box drifting across the field bother you?
  - In A, after you dragged the box partly off the screen and let go, did you want the field to bring it back?
  - Did the glide feel too slow, too fast or about right?
---

Select some marchers, press **B** and drag a box. Then pan the field
(right-drag) so the box sits near an edge of the screen, and change it from
its floating editor: ↻ to turn it, the degrees, the flips, − and +, the
spacings, the mode or the layout. You can also press **Alt+R** to turn it.

**A · Keep in view**: if the box or its editor would end up partly off the
screen, the field glides just far enough to bring them back. If they're still
in view, nothing moves. Letting go after dragging the box off the edge brings
it back too.

**B · Hold the editor still**: after each change the field glides so the
floating editor stays where it was on screen, and the box moves under it.
Dragging on the field never moves the view.

In both, the field never moves while you're dragging, never zooms, and stops
gliding the moment you pan or zoom yourself. Switch between A and B with the
**Version** switch at the bottom left; your box stays as it is.
