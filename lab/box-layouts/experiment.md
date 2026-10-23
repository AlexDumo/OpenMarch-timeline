---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: box-layouts
title: Pick a layout for a box
summary: A box can be a full block, a stagger, rounded, short at the back or notched. This build follows your last round. Turned copies are gone and ↻ on the box's editor turns the box instead. The row under the editor is now a layout menu. Layouts the count can't make show greyed with what they need, in place of the "Not for 23" line.
status: open
questions:
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

- − and + still move between versions of the layout. We're looking at what
  makes that feel jumpy separately; this build doesn't change it yet.
- The stagger slider comes next, in the same section.
