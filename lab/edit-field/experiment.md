---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: edit-field
title: Edit the field on the field
summary: The Field button opens a Field panel beside the field, with Setup, Lines and Appearance tabs. Edit lines on the Lines tab lets you drag lines out of rulers, move them, pick many and delete them on the field itself. Done keeps your changes; X throws them away.
status: open
questions:
  - The panel opens on Setup, and changing lines is a mode you turn on with Edit lines on the Lines tab. Was it clear how to start changing lines, and how to stop?
  - Adding a yard line by dragging it out of the top ruler (its twin on the other side comes too) - did that feel quick and clear, or did you reach for something else first?
  - When you only wanted to change a setting (a color, the side names, the step size), did you ever worry you might change a line by accident?
  - Was it clear that Done keeps your changes and the X throws them away?
---

In the example show, select **Field** in the sidebar (or press Cmd/Ctrl+Shift+E). The **Field** panel opens beside the field on its **Setup** tab, and the field fits in the room left.

**What to try**

- Look through the tabs: **Setup** (template, size and steps, names), **Lines** (the list of lines) and **Appearance** (markings, background image, colors). Change a color or a side name.
- On **Lines**, select **Edit lines**. Rulers appear along the field's top and left. Drag down out of the top ruler between the 45 and the 40. The note by the pointer says where the line goes. With **Mirror sides** on, the same line appears on the other side.
- Drag a line to move it, or drag it back up into the ruler to delete it. Hold Shift for half steps.
- Double-click a line and type `47.5yd`, `+4` or `85.33/2` as its position, then press Enter.
- Delete every 5-yard line: drag a thin box across the field between the front sideline and the front hash, from inside one goal line to inside the other, choose **Keep every other line picked** from the **⋯** menu, then press Delete.
- Pick lines in the panel's list, and use the **+** between two rows to add a line halfway.
- Press Escape a few times: it drops the pick, then turns off Edit lines, then closes the panel.
- Undo any of it with Cmd/Ctrl+Z: every change is one step.
- Make a few changes, then close the panel with its **X**: the field goes back to how it was when you opened the panel. Cmd/Ctrl+Z brings the changes back. **Done** keeps them.

**Good to know**

- The field's width and depth follow its outermost lines; they're shown, not typed.
- Marchers don't move when the field changes size; they keep their place on the drawing.
- On a tablet, touch and hold a line for its menu; **Select many** next to Editing lines lets taps pick several lines, and a line's popover has a number pad.
