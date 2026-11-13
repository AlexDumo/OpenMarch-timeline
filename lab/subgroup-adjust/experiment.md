---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: subgroup-adjust
title: "Bend several lanes together (pathways, step 26)"
summary: "Step 26 of pathways: on an open group path, pick several marchers' lanes and drag one. They all take the same bend, a shared adjustment, and one of them can still be bent on its own on top. Reshape the path and the bend rides along; Reset takes only the shared bend away; Detach gives the group one shared copy."
status: open
variants: []
questions:
  - "Open a group path, click one lane, then Shift-click three more and drag one of them. Did all four bend the same way? Was it clear which lanes were picked before you dragged?"
  - "Click one lane of those four. The whole group of four got picked. Click it again and only that lane is picked; drag it a step further. Did the other three stay put, and did that one keep the shared bend under its own? Is 'click picks the group, click again picks one' the right way in, or would you rather double-click (as Figma does) or use a button?"
  - "Drag a point of the group path, then delete a point the bend sits on. The bend rode along, then moved to the nearest points left with a 're-homed' note. Did it end up where you expected?"
  - "With the group picked, press Reset shared adjustment (or Delete). Only the shared bend went: the one bent on its own kept its own bend. Is that what Reset should do, or should it also offer to clear everyone's own bends?"
  - "Shift-click a fourth lane that isn't in the group onto the picked group and drag. It's refused: a marcher can share only one bend, so reset theirs first or pick exactly the group. Would you rather it moved that marcher into the group after asking?"
  - "With the group picked, press Detach. The four get one shared copy of the path, keeping the shared bend, and nobody moves. Then Rejoin them. Is one shared copy what you expected, or one copy each?"
  - "Try picking and bending lanes with a finger or pencil: tap a lane, long-press another for 'Add to picked lanes' (or use the pill's Add), then drag. Did that work for you?"
  - "Anything else about bending several lanes together you'd change?"
---

**What's new**

- **Pick several lanes on an open group path.** Click a lane, then **Shift-click** others
  to add them (Shift-click a picked one takes it out), as you pick layers in Figma. On a
  tablet, use the pill's **Add**, or long-press a lane for **Add to picked lanes**. Each
  picked lane is drawn heavy and the bar says how many spots are picked.
- **Drag one picked lane and they all bend together.** That makes a **shared adjustment**:
  one bend the group keeps, wherever the path goes.
- **A group's lane picks the group.** Click any lane of a group with a shared bend and the
  whole group is picked; its bend's points show on every lane and drag for all of them.
  **Click that lane again** and it's picked alone: drag it, and it gets its own bend **on
  top of** the shared one. Dragging a group's lane without picking anything first bends
  the group.
- **The bend follows the path.** Drag or add points, Re-fit, resize the move: the shared
  bend rides along, as a single spot's does. Delete a point it sits on and it moves to the
  nearest points left, with the "re-homed" note.
- **Reset shared adjustment** (the bar, the lane's menu, the palette, or Delete with the
  group picked) takes the shared bend away. Each spot keeps its own bend.
- **Detach** with the group picked gives the whole group **one shared copy** of the path,
  with the shared bend, and nobody moves. Detaching one member gives it a copy of the shared
  bend on its own copy. **Rejoin** puts them back on the group path, without their bends,
  as before.
- All of it is one undo step per action.

**Try it**

1. Draw a group path for a 4 × 4 block (select it, press P, draw, finish). Double-click the
   path to open it.
2. Click a front-rank lane, then Shift-click the other three front-rank lanes. Drag one of
   them a step toward the front sideline at the first corner.
3. Click one of them twice, and drag it one more step.
4. Drag the path's middle point. Then press **Space** and watch the front rank.
5. Undo back through it, one step at a time.

**Good to know**

- A spot can share one bend at most. A pick that mixes a group with other spots, or takes
  only part of a group, is refused with a reason when you drag.
- Older builds can't play a file with a shared bend (they'd walk those spots without it), so
  a file with one is saved as a newer version.

**Not in this step, on purpose**

- **Moving a spot from one group to another** (with a confirm) isn't built: reset its group
  first, or pick the whole group.
- **Nested groups inside groups**: one level only, the group's bend plus each spot's own.
- **A "Reset all"** that clears the shared bend and every spot's own bend at once.
- **Group bends on follow-the-leader trails** are a later step (27).
