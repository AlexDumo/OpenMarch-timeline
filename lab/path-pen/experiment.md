---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: "Paths you can click (pathways, step 3a)"
summary: "Step 3a of pathways: a drawn path is now something you can select on the field, like a shape in a drawing app. Click a path's line to select it, even with no marchers selected; press Delete to remove it. With Paths set to All, a group path shows as one line."
status: open
variants: []
questions:
  - "With nothing selected and Paths set to All, click a group path's line. Was it easy to hit, and was it clear that the path (not its marchers) was selected?"
  - "Select a path, then press Delete, then Undo. Did the path come back exactly as it was? Did Delete ever remove something you didn't mean it to?"
  - "Single click selects a path, double-click opens it for editing, Escape steps back out. Did that feel natural, or did you expect something else (for example the marchers staying selected)?"
  - "Move the box at the end of a group path. Does the line's end follow the box, with the corners you placed staying where they were?"
  - "With a placed box selected (a single click on it), click its path's line outside the box, then double-click it. Did that select and open the path the way you expected?"
  - "With Paths set to All, can you tell group paths and single-marcher paths apart, and does the field look calm enough with several paths drawn?"
---

Until now a path could only be reached through its marchers: you selected the
marchers, and their path showed. In this build a path is **a thing on the field
of its own**, as a shape is in a drawing app.

**What's new**

- **Click a path's line to select it**, even when nothing is selected. A
  selected path turns blue with a soft glow. The marchers you had selected are let
  go of: you have either marchers or a path selected, not both.
- **Double-click it to open it** for editing, as before. **Escape** steps back
  out: from editing to selected, then to nothing. A click on empty field also lets
  it go.
- **Delete or Backspace removes a selected path**, the same as Remove path in its
  menu. **Undo** brings it back.
- **Paths set to All** (the start flag's Paths setting, or holding **N**): a group
  path is drawn as **its one line**, with its marchers' own lines faint, so you can
  click it. A single marcher's path is drawn as before.
- **Right-click or long-press** a path's line selects it and offers **Edit path**
  and **Remove path**. On a tablet, tap selects and double-tap opens.
- **Move the box at either end of a group path** and the line's end follows it. The
  corners you placed stay where they are; stretching them to fit is Re-fit, in 3b.
- **With a placed box selected**, click its path's line outside the box to select the
  path, or double-click to open it. Inside the box, presses stay the box's.
- Dragging a dot still moves that dot, never the path.
- **P on a selected or open path** draws that path again, and it stays the same
  path: a group path opened through one of its marchers is drawn again as the
  group's path, not as that marcher's own.

**Try it**

1. Open a show with a few paths (draw some with **P**: one marcher, and a block of
   several). Set Paths to **All**.
2. Click empty field so nothing is selected. Click a group path's line. Then click
   a single marcher's path.
3. With a path selected, press **Delete**. Then **Undo**.
4. Double-click a path, drag a point, press **Escape** twice.
5. Select a marcher whose path shows, and click its path's line.

**Good to know**

- Files are unchanged from step 24 (still version 11).
- Paths are clickable for the move at the playhead.

**Not in this step, on purpose**

- **Adjust** (nudging one marcher's line within a group path) and **Re-fit**:
  step 3b.
- **Detach and Rejoin** (a group member taking a copy of the path and coming
  back): step 3c. Own path and Rejoin from step 15 still work as before.
- **Collisions along a path**: collision checking is switched off in the app for
  now, so this waits.
- A marquee (drag on empty field) that selects nothing keeps the selected path;
  only a click on empty field lets it go.
