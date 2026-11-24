---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: follow-outline
title: "Follow: drag any marcher around a circle or box outline, or out of it (pathways, step 10)"
summary: "Step 10 of pathways: select marchers standing on a circle or a box outline, press Shift+L, then grab any marcher. Drag it around the outline and everyone slides around with it; drag it off the outline and it leads the rest out along a trail. Set order (Shift+O) is honored when you've set one, and isn't needed."
status: open
variants: []
questions:
  - "New (2026-11-22): one Follow tool, one drag. Grab any marcher on the circle and drag it around. Did the line go the way you dragged, with the one you grabbed leading?"
  - "Drag a marcher off the circle. Did it pull out into a trail with the others following, the way you expected?"
  - "Drag around a few spots first, then off the circle, in one drag. Did the trail carry on from where the line had slid to? Is that useful, or would you rather it started from where they stand?"
  - "New (2026-11-23): click a marcher, let go, and move the mouse without holding the button. Did the line follow, and did the next click keep it? Would you rather it worked another way?"
  - "New (2026-11-23): while a trail is drawn, the bar has Straight | Curved. Did you find it, and did Curved bend the trail the way you wanted?"
  - "New (2026-11-23): put marchers on a closed shape that isn't a circle or box (a closed Curve, or by hand in a loop) and press Shift+L. Did they go around the shape you expected? Anywhere the loop cut a corner or bulged?"
  - "New (2026-11-23): the mode now shows in the top bar (Following, with a live line). Did you see it, and did you miss the note over the field? Was not being able to switch tabs fine, or in the way?"
  - "New (2026-11-23): after clicking a marcher, could you tell at once that you were holding the line?"
  - "Was it clear when you were sliding around and when you had pulled out? Did it ever switch when you didn't mean it to (too easily, or not easily enough)?"
  - "You never have to set the order now. With no order set, did Follow guess the order you expected (neighbors around the outline)?"
  - "Set an order with Set order, then Shift+L. Did it open going your order's way, with your leader?"
  - "Type a number (say 4) and press Enter instead of dragging. Was that easy to find from the note by the leader?"
  - "On a tablet, drag a marcher with a finger or pencil, around and out. Did it work as with a mouse?"
  - "A box outline shows corner chips only at its four corners; a circle shows none. Is that right?"
  - "Anything else about following around or out of an outline you'd change?"
---

**First, turn it on:** Follow-the-leader is a preview, off by default. Open **Settings ›
Field** and turn on **Follow-the-leader (preview)**. Without it, Follow and Set order don't
show.

**What's new (2026-11-22, from your feedback)**

- **One Follow tool, one drag.** Going around and spreading out are the same gesture now.
  Press **Shift+L** on marchers standing all the way around a circle or box outline, then
  press **any marcher** and drag. The one you grab leads.
- **Drag along the outline** and the whole line slides around it, the way you drag, snapped
  to whole spots, with a count by the pointer ("4 spots"). **Let go** to keep it, one undo
  step.
- **Drag off the outline** and the marcher you grabbed is pulled out into a trail: the others
  follow it around the outline and off it. Let go to place the trail's first point, click for
  more corners if you want them, then **Enter** (or double-click) to keep it. Spacing and Ends
  are on the bar, as for any trail.
- **Around, then out, in one drag.** Slide a few spots around first and then pull off, and the
  trail carries on from where the line had slid to. Come back onto the outline and it slides
  again.
- **Any closed shape (2026-11-23, a prototype).** Follow now goes around any closed shape the
  marchers stand all the way around, not only a circle or a box. Placed with a shape tool (a
  closed Line or Curve, a polygon), they go around that shape's own outline, corners and all.
  Placed by hand, they go around a smooth loop through them.
- **Following, in the top bar (2026-11-23, a prototype).** The note over the field is gone.
  While Follow is open, the Paths tab's Follow button reads **Following**, and a short line
  beside it says what's happening ("Holding T9 · move along to slide, away to pull out ·
  click to drop · Esc put back"). The other tabs and tools wait until you finish or press
  Esc; hover or click one and it says so.
- **You can see the pickup.** Click or press a marcher and the Leader flag jumps to it, the
  orange arrows disappear, a purple halo sits on it and the cursor closes into a fist.
- **Click, let go, then move (2026-11-23).** You don't have to hold the button. Click a
  marcher, let go, and move the mouse: the line slides around or pulls out just as it does
  when you drag. **Click again** to keep it, **Enter** also keeps it, **Esc** puts it back.
  Holding and dragging still works. On a tablet it stays press and drag.
- **Straight | Curved (2026-11-23).** While a trail is drawn (also after pulling out of a
  circle) the bar has **Straight | Curved**: clicks place corners or smooth points, and the
  points you've placed change with it. Pressing and dragging a point still rounds that one
  point. After finishing, **Edit path** and a click on a point give Corner | Smooth for it.
- **No order needed.** Follow no longer asks you to set the march order first. With none set
  it takes their places around the outline, and shows who it would lead with until you grab
  someone.
- **Your order still wins when you set one.** With **Set order** (Paths tab, Shift+O), Follow
  opens going your order's way with your leader, including an order set on the page you're on
  (it used to be ignored there). Dragging the other way still goes the other way: the drag is
  the last word.
- **Which way, without dragging:** the bar's **Clockwise | Counterclockwise** button, or
  Reverse leader (Alt+L), turns it for a typed count.

**Still here**

- **Esc** while dragging puts everything back. Or **type a number** and press **Enter** for
  an exact count around. With nothing dragged or typed, Enter writes nothing. Dragging back
  past where they started goes the other way around.
- **How far:** a number of **spots** (the places around the outline) or **steps**, from the
  bar's **−**, **+** and the number. It can be more than once around, up to 100 times.
- **By spots, each marcher moves on to the place that many ahead,** so everyone lands on a
  spot even when the spacing is uneven, and a gap goes around with the line.
- **Corner chips only at real corners:** a box's four corners; a circle shows none.
- **Refusals say why:** a page early, only part of a shape selected, a gap too wide, or some
  standing too far off the shape.
- **After finishing:** Shift+L on the same line reopens it with how far it went. Reverse leader
  on the finished move goes the other way around as far. Remove trail walks everyone straight
  to the same spots.

**Try it**

1. Turn on **Settings › Field › Follow-the-leader (preview)**.
2. On page 1, select twelve marchers and draw a circle with the Circle tool (O).
3. Go to page 2, select the twelve, and press **Shift+L**. No order needed.
4. Grab any marcher and drag it counterclockwise a few spots along the circle, then let go.
   Press **Space** to watch: they walk counterclockwise behind the one you grabbed. Undo, and
   try clockwise.
5. Shift+L again, grab a marcher and drag it straight out of the circle, let go, then press
   **Enter**. Space: it leads the others out along the trail.
6. Shift+L once more: drag a marcher a quarter of the way around, then off the circle, all in
   one drag.
7. Do the same with marchers on a box outline (Box tool, then Outline).

**Good to know**

- Grabbing anyone needs marchers all the way around a closed shape (four or more): a circle,
  a box outline, a placed closed Line or Curve, or any loop of marchers with no big gap.
  A line on part of a circle (an arc) has two ends: drag a trail out of either, as before.
- An order you set that zigzags across the circle instead of going around it is followed as
  a trail from its two ends, each marcher through the ones ahead of them.
- Followers walk straight from place to place around a circle on their way to the trail, so
  after "around, then out" they can end a hair off the places the slide showed (about a tenth
  of a step in a quarter circle).
- The outline is fitted from where they stand. If you reshape the circle on page 1
  afterwards, the move still goes around the circle as it was, and anyone off it walks
  straight onto it first.

**Not in this step, on purpose**

- **Snakes through a box** (step 11).
- **Drawing your own closed outline** (a block letter) with the pen.
- Reading the placed shape itself instead of fitting one, so the move follows the shape
  when it's reshaped.
- Editing the outline's points. Reverse leader and Shift+L are the ways to change it.
