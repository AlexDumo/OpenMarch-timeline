---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shape-moment
title: Keep a shape open while you move around the timeline
summary: Only Enter or Place places a shape now. Moving the playhead, playing, switching to Visuals or selecting other marchers leaves it open. Away from its count it waits behind an accent chip that takes you back or dismisses it, and starting a new shape there sets it aside.
status: open
questions:
  - Is the accent "Shape open at …" chip easy to notice now? Does it stand out too much?
  - Away from the shape, Enter and Esc do nothing to it. Did you ever press one expecting it to act on the shape?
  - Playing or switching to Visuals hides the shape until you stop or come back, without placing it. Did it come back when you expected?
  - After selecting other marchers, the shape stays open for its own marchers. Did that make sense, or did you expect something else?
  - With a box open, the other marchers are lighter but still readable, and the box's own marchers show as their spots and the rings where they start. Could you tell who is where? Is the fade about right now?
  - On another page, could you set the waiting shape aside and draw a new one, with the chip's × or by just starting a new shape? Did undo bring the old one back when you wanted it?
---

The last build placed the shape when you played, changed the selection or
switched to Visuals. Now **only Enter or Place places it**. Select some
marchers, press **B** and drag a box.

**New in this build** (from your feedback on the last one):

- While a box is open, **everyone else is lighter** (40%, labels too), so the
  rest of the drill stays readable as context.
- Once it's drawn, **the box's own marchers' dots hide**: its spots are where
  they'll be, and the **rings show where they start**, always. **Pathways** in
  the floating editor now only adds the walk lines. Placing or Esc brings
  every dot back.
- The **↔ and ↕ marks** in the floating editor and the inspector are icons
  now, so neither shows up as a color emoji.

- The chip has a **×** that dismisses the waiting shape, as Esc would at its
  count. Undo right after brings it back.
- **Starting a new shape away from a waiting one isn't blocked.** Press **B**,
  or pick a kind in the Shapes tab, the ring or the command bar. The waiting
  shape is set aside and the new one starts here. Undo before you draw brings
  the old one back.

**From the last round:**

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
- Leave a box open, go to another page and press **B** (or click **×** on the
  chip). Draw a new box there and press **Enter**.

**Good to know**

- Opening another file or reloading the app with a shape open drops it
  without placing it. Undo can't bring it back.
- While the box is hidden, undo, redo and the arrow keys work on the show as
  usual. The box doesn't change.
- A kind picked with nothing drawn yet closes when you move the playhead.
