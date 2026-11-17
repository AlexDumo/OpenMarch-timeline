---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: snake-box
title: "Snake out of a box, and ripple into one (pathways, step 11)"
summary: "Step 11 of pathways: select a filled box and press Shift+L. Drag a trail out of any corner and the block snakes out row by row behind its leader. Ripple in now works into a box too."
status: open
variants: []
questions:
  - "Select a filled box (say 4 × 3), press Shift+L, and drag a trail out of a corner. Did the snake go the way you expected, row by row from that corner?"
  - "Try Columns on the bar. Is Rows the right default, and was the choice easy to find?"
  - "Drag only a short way out. The tail stays in the box and the spots it left stay empty. Is that what you'd want, or should the box close up?"
  - "Drag far enough that everyone leaves. Did they keep the gaps they had in the box?"
  - "Set an order by hand first (Shift+O), then drag out. Your order should win over the snake. Did it?"
  - "Ripple a line into a box on the next page (Ends: Ripple in). The tail takes the corner nearest the way in and the leader goes to the far end. Is that the order you'd write?"
  - "Ripple into a box with an empty spot in it. The snake goes through the hole and nobody stops there. Does that read right?"
  - "On a 2-row box, Go around opens first, with Drag out beside it. Should a 2-row box open on the snake instead?"
  - "Anything else about snaking through a box you'd change?"
---

**What's new**

- **Drag a box out by a corner.** Select the marchers in a filled box and press **Shift+L**
  (or the Follow button by the Path pen). Every corner of the box is a grab point. Drag a trail
  out of one, and the box snakes out behind its leader, row by row from that corner, with the
  rows joined straight across at their ends.
- **Rows | Columns** on the path bar picks which way the snake runs (also "Snake row by row" and
  "Snake column by column" in the command palette). An order you set by hand (Shift+O) always
  wins over the snake.
- **How far:** everyone moves the length you drag, keeping the gaps they had in the box. A short
  drag leaves the tail in the box, and the spots it moved out of stay empty. A long drag takes
  everyone out onto the trail.
- **Ripple into a box.** Ends: **Ripple in** now accepts a box as the next form. Spots are dealt
  along the box's snake, starting at the corner nearest where the line arrives: the tail takes
  that corner and the leader goes to the far end. If the box has an empty spot, the snake passes
  through it and nobody stops there.

**Try it**

1. On page 1, make a 4 × 3 box with the Box tool.
2. Go to page 2, select the twelve, press **Shift+L**.
3. Drag a trail out of a corner a short way, then **Enter**, then **Space** to watch it.
4. Undo, try **Columns**, and drag out farther so everyone leaves the box.
5. For Ripple in: put eight marchers in a line on page 1, and on page 2 put the same eight in a
   3 × 3 box with one empty spot. On page 2, select them, press **Shift+L**, choose
   **Ripple in**, then click an end of the box to go straight in (or click a few corners on the
   way first). Double-click to finish.
6. Try it with a finger or pencil on a tablet: every choice is a button on the bar.

**Good to know**

- A box here means at least 2 rows and 2 columns, evenly spaced, with no more than a quarter of
  its spots empty. Other folded shapes (a sharp V) and circles are still refused for Ripple in,
  with the reason.
- Nothing new is stored: a snake is a follow-the-leader move like any other trail.

**Not in this step, on purpose**

- Rounded turns at the row ends (they cut straight across for now).
- Moves that mix a fixed number of steps with landing on spots (open question O-28).
- Ripple into a shape with more or fewer spots than marchers: the end spots are always the
  marchers' own.
