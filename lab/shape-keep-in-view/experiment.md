---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-keep-in-view
title: The shape and its editor stay in view after an edit
summary: Turning, flipping or resizing a box near the edge of the screen used to push it partly out of sight. Now the field glides just far enough to keep the box and its editor in view, and zooms out when they no longer fit.
status: open
variants: []
questions:
  - When an edit pushed the box toward the edge, did the field bring it back the way you expected? Was it ever disorienting?
  - When the box grew too big for the screen, did zooming out to show it whole help, or would you rather zoom yourself?
  - The field never zooms back in when the box gets smaller again. Did you miss that?
  - After you dragged the box partly off the screen and let go, did you want the field to bring it back?
  - Did the glide feel too slow, too fast or about right?
---

Select some marchers, press **B** and drag a box. Then pan the field
(right-drag) so the box sits near an edge of the screen, and change it from
its floating editor: ↻ to turn it, the degrees, the flips, − and +, the
spacings, the mode or the layout. You can also press **Alt+R** to turn it.

**New in this build**

- If the box or its editor would end up partly off the screen, the field
  glides just far enough to bring them back. If they're still in view, nothing
  moves. Letting go after dragging the box off the edge brings it back too.
- If they no longer fit at all (zoom in close, then type a big spacing), the
  field zooms out just enough to show the box and its editor whole. It never
  zooms back in on its own.

The field never moves while you're dragging, and it stops gliding the moment
you pan or zoom yourself.
