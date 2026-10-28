---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: spacing-guides
title: Line up a box's corners by dragging its spacing, and with Alt
summary: While you drag a box's spacing number in the floating editor, a corner or its center that comes close to a yard line, a hash or a sideline lands on it, with the orange guide, its name and a ring on the corner. Alt now means fine control, and lines still catch. Cmd (Mac) or Ctrl turns all snapping off.
status: open
variants: []
questions:
  - After turning a box, could you get a corner onto a yard line or hash by dragging its spacing?
  - Did the spacing ever catch a line you didn't want, or skip a half step you wanted?
  - Was it clear which corner landed and on which line?
  - Did the spacing it landed on (for example 2.83 or 7⅔) make sense to you?
  - Holding Alt, does a turned box's corner slide smoothly onto a line now? Is it clear that Cmd or Ctrl turns snapping off completely?
---

Turning a box puts its corners off the field's lines. Dragging its spacing is
how you get them back on, and now the spacing helps.

**New in this build:**

- **Drag a spacing number** (side to side or front to back) in the floating
  editor. As the box grows from its pivot, when one of its **corners** or its
  **center** comes within a few pixels of a yard line, a hash or a sideline,
  the spacing settles where that point sits exactly on the line.
- The same **orange guide** runs across the screen with the line's name, and an
  **orange ring** marks the corner. On a square box, a side on the line turns
  thick and orange.
- Away from lines, the spacing still steps by **half steps** as you drag.
- **Typing** a spacing keeps exactly what you typed, and **− and +** stay on
  half steps. Neither snaps.

**What to try**

- Draw a box, turn it 45°, and drag its side-to-side spacing until a corner
  lands on a yard line.
- Do the same with the front-to-back spacing and a hash.
- Move the pivot (the 3 × 3 grid by the degrees) and try again: the box grows
  from there.
- Select a placed box and drag its spacing.

**Two modifiers, everywhere the orange guides show** (drawing, stretching,
moving and dragging a spacing):

- **Alt: fine control.** No half steps: a corner slides smoothly, and spacings
  go by hundredths. Yard lines, hashes and sidelines **still catch**. Try it on a
  turned box: Alt-drag a corner handle onto a yard line. Without Alt, the corner
  zigzags between half steps.
- **Cmd (Mac) or Ctrl: no snapping at all.** No half steps and no guides.
- Turning with **Alt** is still free rotation.
- Cmd- or Ctrl-dragging from the center dot still pulls the pivot out.

**Good to know**

- The circle's spacing doesn't snap yet.
