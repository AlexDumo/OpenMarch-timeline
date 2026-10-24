---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-moment
title: Keep a shape open while you move around the timeline
summary: Moving the playhead no longer places the shape you're drawing. It stays open at the count you drew it at, hidden while you look elsewhere, with a chip that takes you back.
status: open
questions:
  - When you moved the playhead with a shape open, did you expect it to stay open, or to be placed?
  - While you were away, was the "Shape open at …" chip enough to remember the shape was waiting? Did Go back take you where you expected?
  - Pressing Enter away from the shape places it at its own count, and Esc throws it away. Did either surprise you?
  - Playing, selecting other marchers and switching to Visuals still place the shape right away. Did that feel right next to the timeline keeping it open?
---

Until now, moving the playhead with a shape open placed it. In this build the
shape stays open, tied to the count you drew it at. Select some marchers,
press **B** and drag a box.

**What to try**

- With the box open, move the playhead: drag it, click the timeline, press
  **Shift+E** for the next count or **E** for the next page. The box and its
  floating editor hide, and a chip at the top of the field says **Shape open
  at count N** (or **at home**).
- Click **Go back** on the chip. The box is back as you left it: same
  numbers, pivot and who goes where. Coming back any other way, such as
  **Shift+Q** or clicking that count, shows it too.
- Away from the box, press **Enter**. It's placed at its own count, and the
  playhead stays where you are. Undo takes it back.
- Away from the box, press **Esc**. It's thrown away, and undo right after
  brings it back.

**Still the same**

- Pressing Play, selecting other marchers and switching to Visuals place the
  box where you drew it, as one undo step.
- Isolating a move with the shape open places it as well, because that
  changes what the edit writes to.

**Good to know**

- While you're away, undo, redo and the arrow keys leave the hidden box
  alone. Go back to edit it.
- A kind picked with nothing drawn yet closes when you move the playhead.
