---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: mode-switch-frame
title: Switching Grid, Outline and Spread keeps your box
summary: Switching a box between Grid, Outline and Spread now keeps it where you drew it and about as big. Before, Outline to Grid could shrink it.
status: open
questions:
  - When you switched between Grid, Outline and Spread, did the box stay where you drew it, about the same size?
  - Did any switch pick spacings or a layout you didn't expect?
  - Did switching back and forth a few times make the box creep?
---

Switching a box's fill between **Grid**, **Outline** and **Spread** now
keeps the box you drew. Its center stays exactly where it was, and each
side stays within half a step. Grid and Outline stand their marchers on
half-step spacings, so that's as near as they can get. Before this build,
Outline to Grid could shrink the box.

**What to try**

- Open a demo show or start a new one, and select about 15 marchers.
- Press **B** and drag out a box.
- On the second row under the shape, use the mode menu to switch between
  **Grid**, **Outline** and **Spread** in every order. Watch the box's
  outline and handles.
- Try a tall, narrow box and a wide one, and a bigger group (40 or so).

**Good to know**

- Each side can move up to half a step on a switch, so several switches
  in a row can add up to about a step.
- A box with a single rank or file has no area to keep, so Outline lays
  it out the way it always did.
