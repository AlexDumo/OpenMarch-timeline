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
  - "Press Follow (Shift+L) and hover each end before you grab one. Did the numbered lane make it clear who would lead and in what order, and did it stay out of the way?"
  - "Set an order by clicking the leader and then just moving over the marchers (Backspace to take one back, Enter or a click to finish). Was that easier than holding the button down?"
  - "Ripple a line into a box on the next page (Ends: Ripple in). The tail takes the corner nearest the way in and the leader goes to the far end. Is that the order you'd write?"
  - "Ripple into a box with an empty spot in it. The snake goes through the hole and nobody stops there. Does that read right?"
  - "On a 2-row box, Go around opens first, with Drag out beside it. Should a 2-row box open on the snake instead?"
  - "With a trail selected and Edit path off, clicks on the trail, its head or a marcher only select. Turn Edit path on to drag points or click the head to keep drawing. Was it clear when the trail was safe from clicks, and when it was editable?"
  - "At the end of the move, drag a middle marcher to bend the line, drag the leader, then the tail. Did each do what you expected, and did the marchers stay where you'd want them?"
  - "Alt + drag one marcher to take it off the line. Is Alt the right way to do that, and was moving the whole form (drag between the marchers) easy to find?"
  - "Anything else about snaking through a box you'd change?"
---

**What's new (2026-11-17, later): the order you set, and seeing it in Follow**

- **Your order now wins in Follow.** An order set with **Shift+O** on the page you're working on
  was ignored by Follow, which used the box's snake instead. Fixed: the ends offered are your
  order's first and last, and either one leads with the rest following your order.
- **See the order before you grab.** With Follow open, hover an end: a numbered lane shows who
  leads and the order everyone follows. Hover another end and it flips. It goes away when you
  move off or grab.
- **Setting an order without holding the button.** Click the leader, then just move over the
  marchers in order. **Backspace** takes the last one back (press again for the one before),
  **Enter** or a click finishes, **Esc** cancels. Press-and-drag still works. On a tablet, tap to
  start, then drag, or use **Remove last** on the bar.

**What's new (2026-11-17): Edit path and dragging marchers**

- **Edit path is a toggle.** Select a trail and the bar's **Edit path** button shows whether it's
  on. Off (the default), clicking the trail, its head or a marcher only selects; nothing changes.
  On, the trail's points show and drag, a click on its head keeps drawing it, and a quick drag on
  the head makes it longer or shorter. **Escape** or a click on empty field turns it off.
- **Drag a marcher to reshape the form.** At the end of the move, with Edit path on or off:
  drag a middle marcher to bend the line there (it stays under your pointer and the spacing
  holds); drag the leader to move the head; drag the tail to slide it along the trail, spreading
  or tightening the form. With Edit path off, the trail before the form doesn't move. **Alt** +
  drag takes one marcher off the line. To move the whole form, drag between the marchers.
  Every drag is one undo; **Escape** mid-drag cancels.

**What's new (step 11)**

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
