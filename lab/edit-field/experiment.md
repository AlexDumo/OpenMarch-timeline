---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: edit-field
title: Edit the field on the field
summary: The Field button opens a Field panel beside the field, and the field becomes editable in place. Drag lines out of rulers, drag them to move them, pick many and delete them, with every setting in the panel. Done keeps your changes; X throws them away.
status: open
questions:
  - Adding a yard line by dragging it out of the top ruler (its twin on the other side comes too) - did that feel quick and clear, or did you reach for something else first?
  - Did dragging a line back into its ruler to delete it feel natural, or did you ever delete one by accident?
  - The Field panel opens like the Marchers and Show settings panels, and the rest of the app stays as it is. Did that feel right, and was it clear that Done keeps your changes and the X throws them away?
  - Did having the marchers faded while you edit the field help or get in the way?
---

In the example show, select **Field** in the sidebar (or press Cmd/Ctrl+Shift+E). The **Field** panel opens beside the field, the field fits in the room left, and rulers appear along its top and left.

**What to try**

- Drag down out of the top ruler between the 45 and the 40. The note by the pointer says where the line goes. With **Mirror sides** on, the same line appears on the other side.
- Drag a line to move it, or drag it back up into the ruler to delete it. Hold Shift for half steps.
- Double-click a line and type `47.5yd`, `+4` or `85.33/2` as its position, then press Enter.
- Delete every 5-yard line: drag a thin box across the field between the front sideline and the front hash, from inside one goal line to inside the other, select **Every other**, then press Delete.
- Pick lines in the panel's list, and use the **+** between two rows to add a line halfway.
- Open the panel's other sections: the field's width and depth, step size, template, side names, yard numbers, background image and colors.
- Undo any of it with Cmd/Ctrl+Z: every change is one step.
- Make a few changes, then close the panel with its **X**: the field goes back to how it was when you opened the panel. Cmd/Ctrl+Z brings the changes back. **Done** (or Escape) keeps them.

**Good to know**

- Marchers don't move when the field changes size; they keep their place on the drawing.
- On a tablet, touch and hold a line for its menu; **Select many** in the panel lets taps pick several lines, and a line's popover has a number pad.
