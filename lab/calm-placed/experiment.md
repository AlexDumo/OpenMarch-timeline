---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: calm-placed
title: Placed boxes get the calm look
summary: A selected placed box now looks like an open one. With your pointer away its handles, knob and fill fade and its floating editor fades to 40%. Point at the box, drag a handle or type in its editor and everything is back at full strength.
status: open
variants: []
questions:
  - With a placed box selected and your pointer away from it, could you see the box and the field clearly? Did the controls come back when you reached for a handle?
  - Did the selected box's floating editor fade and come back the same way as an open shape's?
  - Is there any moment where you wanted a placed box's controls and they were faded?
---

A placed box you select now gets the same calm look as an open shape.
Select some marchers, press **B**, drag a box and press **Enter** to place
it. Then press **Escape** and click one of its marchers to select the box.

**New in this build**

- With your pointer away from the selected box, its fill goes, and its
  handles, rotate knob and center dot fade to 25%.
- Point at the box or one of its handles and they come back at full
  strength. They also stay at full strength while you drag a handle.
- The floating editor under the box fades to 40% with your pointer away,
  the same as an open shape's. It's solid while you point at the box or
  the editor, type in one of its numbers, or have its menu open.

**What to try**

- Move the pointer on and off the selected box, then on and off its
  floating editor.
- Drag a handle to stretch the box.
- Click a number in the floating editor and type a new value.
