---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: following-look
title: "Set or Following: faded dots or hollow dots?"
summary: Marchers you haven't placed on the count you're looking at are drawn differently. Compare two looks for them and tell us which reads better.
status: open
questions:
  - Which look made it easier to see, at a glance, which marchers are placed on the count you're on? Why?
  - Were all marchers and their numbers easy to read in both looks, including over a field background image and on a dark field?
  - When you dragged the playhead or pressed Stop after playing, did either look feel distracting or confusing?
---

On the field, a marcher is **Set** on a count when it was placed there (a move
of its own ends on that count). Every other marcher is **Following**: it
stands where an earlier page left it. This test compares two ways to draw
Following marchers:

- **Fade** (where you start): Following marchers are drawn at half strength.
- **Hollow**: Following marchers are drawn as a ring in their own color, with
  no fill. Set marchers stay filled.

**Switching looks.** Open your browser's console (F12, or ⌥⌘J on a Mac) and
run one of these. The field switches on its next redraw; click a page box or
move the playhead to see it.

```js
localStorage.setItem("openmarch.followingLook", "hollow");
localStorage.setItem("openmarch.followingLook", "fade");
```

**What to try (in both looks)**

- Open a demo show and step through pages with **Q** and **E**. Which
  marchers were placed on this page?
- Add a page past the end: everyone should be Following there. Drag a few
  marchers: they turn Set.
- Drag the playhead slowly across a few pages. Marchers turn Set for a moment
  on the counts where they were placed.
- Play, then press **Stop**: the look comes back in over a moment.
- Add a field background image (field settings), and try a dark field theme.
