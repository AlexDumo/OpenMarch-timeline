---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: expert-start-flag
title: In Expert, the start flag stays put and Play stops at the playhead
summary: In Expert mode the start flag only moves when you go to a page or drag it, and Space plays from the start flag to the playhead once.
status: open
questions:
  - Did the start flag ever stay somewhere you expected it to follow, or move when you didn't expect it to?
  - When you clicked behind the start flag and the two lines swapped, was that what you wanted?
  - Did Space stopping at the playhead help, or did you want it to keep playing? Did you find Alt+Space?
---

This changes the start flag, the playhead, the loop and Play in **Expert**
mode. Open a demo show and switch to **Expert** if it isn't already. Basic
mode is unchanged.

**What to try**

- Click and scrub ahead of the start flag. Only the playhead should move,
  even past page flags.
- Click or scrub behind the start flag. That beat becomes the start flag and
  the old start flag becomes the playhead.
- Go to another page (page box, **Q**/**E**, a clip). The start flag moves
  there.
- Press **Space**. It plays from the start flag to the playhead once and
  stops back where you pressed it. **Alt+Space** (or Alt+click on Play) keeps
  playing past the playhead; **Shift+Space** plays on from the playhead.
- Turn on Loop (**C**). The loop is the stretch between the two lines; drag
  the loop bar's ends and both lines follow.
- Drag the start flag and watch the field: it shows the start flag while you
  drag, then the playhead again.

**Good to know**

- The start flag's pin is gone; it no longer needs one.
