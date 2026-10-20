---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: command-bar
title: Make a shape from the command bar
summary: Press / or Ctrl+K, type "box", and answer a few questions while the box shows on the field. Or type it all in one go, like "box 4x2 3".
status: open
questions:
  - Did you find the command bar on your own? Which key did you try first?
  - At each question, did you know what it was asking and what your answer would do?
  - When the last answer put the marchers straight on the box, was that what you wanted, or did you expect to adjust it first?
  - When you typed a whole line such as "box 4x2 3", did it go where you expected?
  - Did going back (Backspace in an empty answer) and backing out (Esc) feel safe?
---

This build adds a **command bar** for shapes. **/** and **Ctrl+K**
(**⌘K** on a Mac) open the same bar. Commands that don't need numbers
run as before. **Shape › Box** moves the bar to the top of the field
and asks for the box's numbers one at a time, while the box updates on
the field as you type.

**What to try**

- Select some marchers, press **/**, type **box** and press **Enter**.
- Each question starts with an answer already typed: press **Enter** to
  keep it, or type over it. Try **4x2** for the size and **3** for the
  spacing, and watch the box change.
- The last **Enter** places the marchers.
- Undo, then type the whole thing in one go: **box 4x2 3**. The bar
  opens at the first number you didn't type, with the rest already on
  the field.
- Draw a box with the mouse, then use **Shape › Box** in the bar to
  change it, and press **Esc**. The box you drew comes back.

**Good to know**

- **Backspace** in an empty answer (or **Shift+Tab**) goes back a step.
  On the first question, it goes back to the list of shapes.
- **Esc** cancels the whole command and puts back whatever was on the
  field before.
- With nobody selected, Shape › Box is greyed out and says why.
- Only the box exists for now. Other shapes and your saved shapes will
  appear under **Shape** as they arrive.
