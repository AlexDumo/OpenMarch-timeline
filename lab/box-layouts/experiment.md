---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-layouts
title: Pick a layout for a box
summary: A box can now be a full block, a stagger, rounded, short at the back or notched. The inspector lists each layout's versions as small pictures, wide to deep, and a compact row sits under the box's editor.
status: open
questions:
  - Could you tell what each layout looks like from its picture before clicking it?
  - Do the labels make sense ("5 × 5", "6 × 4, 1 short", "5 × 5 staggered")? Did you miss knowing which version is turned?
  - When a layout wasn't offered, did the "Not for 23: Full (add 1 or remove 2)" line tell you enough?
  - Did − and + on the size keep the layout you picked? Was that what you wanted?
  - Did a new box start in the layout you picked last? Did you expect it to?
  - Which did you use more, the list in the inspector or the small row under the box's editor? Is one of them unnecessary?
  - With a count your layout can't make, was the note in the box's editor (for example "Full needs 1 more or 2 fewer") clear?
---

A box used to have one layout: full ranks, with the back rank short and
centered. Now it has five, each a full block with a pattern of spots left
out, and every rank centered:

- **Full**: nothing left out (only for counts that divide evenly).
- **Stagger**: every other rank one shorter, so it sits between the files
  (23 as 5 / 4 / 5 / 4 / 5).
- **Rounded**: one or two left out of the front and back ranks.
- **Short back**: the box as it was.
- **Notched**: one or two left out of the middle rank.

Each layout lists its versions from wide to deep, and Stagger, Rounded and
Notched also come turned, running front to back. A version is named by
the full block it's cut from, across × deep. The counts are in its
tooltip.

**What to try**

- Select 23 marchers (or any count), press **B** and draw a box. Look at
  the **Shapes** section of the inspector and click a few versions.
- Use the small row of pictures under the box's editor to switch layouts.
- Press − and + next to the size. Then type a size the layout can't make.
- Place the box, then select everyone again and draw a new one: it starts
  in the layout you picked last.
- Select a count that your layout can't make (one more or one fewer) and
  look at the note next to the size.
- Open the command bar (**/** or **⌘K**), pick **Shape › Box** and type a
  layout at the last step, for example "stagger" or "rounded 5x5".

**Good to know**

- Picking a version keeps the box's spacing.
- The stagger slider (leaning ranks by a third, a sixth and so on) comes
  next, in the same section.
