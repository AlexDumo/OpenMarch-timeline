---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-layouts
title: Pick a layout for a box
summary: A box can be a full block, a stagger, rounded, short at the back or notched. This build follows your last round. Turned copies are gone and ↻ turns the box instead, the row under the editor is a layout menu, and layouts the count can't make show greyed. It also has four versions of − and + to compare.
status: open
questions:
  - "Which version of − and + feels best: Center, Front, Glide or Front + glide? Why?"
  - Did the box stay where you put it while you pressed − and + (no creeping toward the front)?
  - Is ↻ next to the size where you expected to turn the box? Do you miss the turned versions in the lists?
  - Does the layout menu under the box's editor work for you? Is hovering a layout (or clicking its arrow) the right way to see its versions?
  - 'Do the greyed layouts with "add 1 / remove 2" tell you what you need, in the menu and in the inspector?'
  - Does the inspector list feel calmer now, with nothing missing?
  - When a layout can't make your count, is the greyed layout next to the menu clear?
  - Anything else about picking a layout?
---

A box has five layouts, each a full block with a pattern of spots left out,
and every rank centered: **Full**, **Stagger** (every other rank one
shorter), **Rounded** (front and back ranks shorter), **Short back** (the
box as it was) and **Notched** (the middle rank shorter). They always keep
that order.

**What changed since the last build (your feedback)**

- A version that is just a quarter turn of another is gone from the lists,
  so there are no more two "3 × 3"s. **↻** next to the size on the box's
  editor turns the box a quarter. Drawing a tall box or pressing − still
  gives the tall versions.
- The small row under the box's editor is now a **layout menu**. It lists
  every layout. Hover a layout, or click its arrow, to see its versions,
  then click one. Clicking the layout itself picks its version nearest
  your box's proportions.
- Layouts your count can't make stay in their place, **greyed**, as a
  picture at the nearest count they make, with what they need ("add 1 /
  remove 2"). This replaces the "Not for 23" line, in the menu and in the
  inspector.
- When your box's layout can't make the count (say you picked Full and then
  selected 23), Short back stands in, and the editor shows Full greyed next
  to the menu with what it needs.
- The inspector list is calmer: labels on the left, no frames around
  unpicked versions.
- A new box still starts in the layout you picked last.

**What to try**

- Select 23 marchers (or any count), press **B** and draw a box. Pick
  versions in the inspector and from the menu under the editor.
- Press **↻**, then − and + next to the size.
- Select a count your layout can't make (one more or one fewer) and look
  at the menu and the inspector.

**Good to know**

**Try the versions of − and +** (your "fairly jarring" note)

The box no longer creeps toward the front as you press − and + (in every
version). Open one of these links, draw a box, and press − and + a few times.
The inspector's **Shapes** section has a **Lab** switch, so you can change
version without reloading:

- [Center](https://lab.openmarch.com/x/box-layouts/?variant=center): the box
  grows and shrinks around its center (as before, minus the creep).
- [Front](https://lab.openmarch.com/x/box-layouts/?variant=front): the front
  rank stays where it is, and the box grows toward the back.
- [Glide](https://lab.openmarch.com/x/box-layouts/?variant=glide): around the
  center, with each marcher sliding to their new spot instead of jumping.
- [Front + glide](https://lab.openmarch.com/x/box-layouts/?variant=front-glide):
  both.

The glide also plays when you pick a layout or press ↻.

- The stagger slider comes next, in the same section.
