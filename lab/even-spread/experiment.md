---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: even-spread
title: Scatter marchers evenly in a box or a circle
summary: A box or a circle can now be filled as an even spread, a scatter with no visible files where no two marchers stand closer than the spacing. Reshuffle gives a new layout.
status: open
questions:
  - Does the spread look natural, with no files, ranks or rows along the edges? Where did you see a pattern?
  - Do the marchers look about the same distance from their neighbors, with nobody crowded or left alone?
  - Is "Spread" a clear name for this fill? What would you call it?
  - After a few Reshuffles, did you find a layout you liked? Did you want something Reshuffle can't do?
  - When you dragged the box's handles in Spread, did the shape change the way you expected?
  - Was it clear that the spacing in Spread is the closest any two marchers stand?
---

A closed shape can now be filled three ways: **Files** (ranks and files,
the box as it was), **Outline** (around the edge, the circle) and
**Spread**. Spread scatters the marchers evenly with no visible files.
No two stand closer than the spacing you set, and the edges stay soft,
so no row forms along a straight side. **Reshuffle** gives a new layout,
and undo brings the last one back.

**What to try**

- Open a demo show or start a new one, and select 20 to 60 marchers.
- Press **B** and drag out a box. In the inspector's **Shapes** section,
  switch the fill from **Files** to **Spread**.
- Press **Reshuffle** a few times, under the shape or in the inspector.
  Then press **⌘Z** / **Ctrl+Z** to go back a layout.
- Change the spacing under the shape (type it or drag it), and drag the
  box's corners and sides to make it wider or deeper.
- Press **O** for a circle, drag it out from its center, and switch it to
  **Spread** too.
- Press **Enter** to place the marchers, click one of them to select the
  placed shape again, and press **Reshuffle** in the inspector.

**Good to know**

- The shape's size follows how many marchers there are, as in Files.
  The spacing is the closest pair, so most neighbors stand a little
  farther apart than it.
- The same shape, count and layout always give the same spots, so a placed
  spread reopens exactly as you left it.
- A saved shape keeps Spread but not the layout: each new shape starts
  from the first layout.
- Outline for the box comes separately.
