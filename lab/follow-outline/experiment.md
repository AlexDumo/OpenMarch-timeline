---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: follow-outline
title: "Follow around a circle or a box outline in your march order (pathways, step 10)"
summary: "Step 10 of pathways: set the march order of marchers standing on a circle or a box outline (Set order), press Shift+L, then drag the leader around it and everyone follows the ones ahead of them in that order. Let go to keep it (one undo step), or type how far and press Enter."
status: open
variants: []
questions:
  - "New (2026-11-22): there is no separate Go around any more. Set the order with Set order, then Shift+L. Did the marchers follow in the order you set?"
  - "Set the order going the other way around, then Shift+L. Did the line go that way, with the one you clicked first leading?"
  - "Press Shift+L on a circle with no order set. Did the message tell you clearly to set the order first?"
  - "Drag the leader around and let go. Did that feel like you moved the line yourself? Was the count by the pointer clear?"
  - "Type a number (say 4) and press Enter instead of dragging. Was that easy to find from the note by the leader?"
  - "On a tablet, drag the leader with a finger or pencil. Did it work as with a mouse?"
  - "A box outline shows corner chips only at its four corners; a circle shows none. Is that right?"
  - "Set an order that zigzags across the circle instead of going around it, then Shift+L. Each marcher follows the trail through the ones ahead of them, crossing the circle. Is that what you expected?"
  - "Anything else about following around an outline you'd change?"
---

**First, turn it on:** Follow-the-leader is a preview, off by default. Open **Settings ›
Field** and turn on **Follow-the-leader (preview)**. Without it, Follow and Set order don't
show.

**What's new (2026-11-22, from your feedback)**

- **One Follow tool, in your march order.** The separate Go around mode is gone. You set the
  march order (**Set order** on the Paths tab, Shift+O: click the marchers from the leader to
  the tail, or drag through them), and **Follow** (Shift+L) has each marcher follow the ones
  ahead of them in that order.
- **Around a closed outline the trail closes the loop.** When the order runs around the circle
  or box outline they stand on, the leader walks on towards the tail's spot, and everyone
  follows around. The order sets who leads and which way around.
- **Your order always wins.** An order set on the page you're on counts (it used to be
  ignored when set at the playhead), and Follow never swaps it for a guessed way around. With
  no order set on a closed outline, Follow says to set one.
- **Going the other way:** use **Reverse order** (Paths tab), then Shift+L. Reverse leader is
  off while following around, and says so.

**Still here**

- **Drag the leader** (or any marcher of the line, or the outline) around it: the whole line
  slides with you, snapped to whole spots, and a count by the pointer says how far ("4
  spots"). **Let go** to keep it, one undo step. **Esc** while dragging puts it back. Or
  **type a number** and press **Enter** for an exact count. With nothing dragged or typed,
  Enter writes nothing. Dragging back past where they started leaves everyone where they are:
  the line only walks forward in its order.
- **How far:** a number of **spots** (the places around the outline) or **steps**, from the
  bar's **−**, **+** and the number. It can be more than once around, up to 100 times.
- **By spots, each marcher moves on to the place that many ahead,** so everyone lands on a
  spot even when the spacing is uneven, and a gap goes around with the line.
- **Corner chips only at real corners:** a box's four corners; a circle shows none.
- **Refusals say why:** a page early, only part of a shape selected, a gap too wide, some
  standing too far off the shape, or no order set around a closed outline.
- **After finishing:** Shift+L on the same line reopens it with how far it went. Reverse leader
  on the finished move goes the other way around as far. Remove trail walks everyone straight
  to the same spots.

**Try it**

1. Turn on **Settings › Field › Follow-the-leader (preview)**.
2. On page 1, select eight marchers and draw a circle with the Circle tool (O).
3. Go to page 2, select the eight, and press **Shift+L**: it asks you to set the order.
4. Press **Shift+O** and click the eight one by one, going counterclockwise, starting anywhere.
5. Press **Shift+L**, drag the leader (the one you clicked first) a quarter of the way around
   and let go. Then **Space** to watch: they go counterclockwise, each into the spot ahead.
6. Do the same with twelve marchers on a box outline (Box tool, then Outline).

**Good to know**

- The loop needs marchers all the way around a circle or box outline (four or more), with the
  order running around it. A line on part of a circle drags a trail out as before.
- The outline is fitted from where they stand. If you reshape the circle on page 1
  afterwards, the move still goes around the circle as it was, and anyone off it walks
  straight onto it first.

**Not in this step, on purpose**

- **Snakes through a box** (step 11).
- **Drawing your own closed outline** (a block letter) with the pen.
- Reading the placed shape itself instead of fitting one, so the move follows the shape
  when it's reshaped.
- Editing the outline's points. Reverse leader and Shift+L are the ways to change it.
