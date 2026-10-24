---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-moment
title: Keep a shape open while you move around the timeline
summary: Only Enter or Place places a shape now. Moving the playhead, playing, switching to Visuals or selecting other marchers leaves it open. Away from its count it waits behind an accent chip that takes you back.
status: open
questions:
  - Is the accent "Shape open at …" chip easy to notice now? Does it stand out too much?
  - Away from the shape, Enter and Esc do nothing to it. Did you ever press one expecting it to act on the shape?
  - Playing or switching to Visuals hides the shape until you stop or come back, without placing it. Did it come back when you expected?
  - After selecting other marchers, the shape stays open for its own marchers. Did that make sense, or did you expect something else?
---

The last build placed the shape when you played, changed the selection or
switched to Visuals. Now **only Enter or Place places it**. Select some
marchers, press **B** and drag a box.

**New in this build** (from your feedback on the last one):

- The **Shape open at …** chip uses the **accent color**.
- **Enter and Esc leave a shape you can't see alone.** They only act on it
  once you're back at its count.
- **Nothing places the shape for you.** While the show plays, or while
  you're in Visuals, the shape is hidden. It comes back when you stop or
  return to the Editor. Selecting other marchers leaves it open for its own
  marchers.

**What to try**

- With the box open, move the playhead: drag it, click the timeline, press
  **Shift+E** or **E**. The box hides and the chip appears. Press **Enter**
  or **Esc**: nothing happens to the box. Click **Go back** and it's there,
  unchanged. Now **Enter** places it.
- Press **Space** to play with the box open, then **Space** to stop. Playback
  returns to where you pressed Play, and the box is back.
- Switch to **Visuals** and back to **Editor**. The box is still open.
- Select other marchers, then press **Enter**. Only the box's own marchers
  move.

**Good to know**

- Opening another file or reloading the app with a shape open drops it
  without placing it. Undo can't bring it back.
- While the box is hidden, undo, redo and the arrow keys work on the show as
  usual. The box doesn't change.
- A kind picked with nothing drawn yet closes when you move the playhead.
