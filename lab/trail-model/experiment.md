---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: trail-model
title: "A trail's path is the move (pathways)"
summary: "Edit a trail's path and the marchers follow it: their end spots are always where the path puts them, live while you drag. Moving one marcher by hand takes it out of the trail."
status: open
variants: []
questions:
  - "Snake a box out (Shift+L, drag out of a corner), turn Edit path on, and drag the path's points around. Did the marchers and the form follow the path live, the way you expected?"
  - "Let go and press Space. Did everyone walk the new path into the form, with nobody fanning out at the end?"
  - "Make the path shorter than the line (drag the head back toward the box). The spacing holds and the last marchers just haven't left the box yet. Is that right, or should the line squeeze up to fit the path?"
  - "Make the path much longer than the line. The leader stays at the end of the path and the rest of the path is empty behind the tail. Is that what you'd want?"
  - "Alt + drag one marcher (or move it any other way: a field drag, typed coordinates, a shape tool). It leaves the trail and walks straight to its new spot. Is leaving the trail the right result?"
  - "Moving all the marchers of a trail at once by hand (say with the arrow keys) takes every one out of the trail. Should moving the whole line move the trail with it instead?"
  - "Open ··· on the path bar and choose Convert to shape. A Line now holds the end spots for the shape tools. Is that the way you'd want to get a shape from a trail?"
  - "In Edit path, only the corner you're dragging shows its count chip (the bar's summary shows them all). Is that enough?"
  - "Anything else about editing a trail you'd change?"
---

**What's new (2026-11-17): the path is the move**

- **Marchers are beads on a string.** A trail you dragged out of a line or a box has one truth:
  its path. The end spots are always where the path puts them, each marcher its own distance
  back from the leader, who stands at the end of the path. Edit the path any way you like (drag
  a point, add or delete one, Corner or Smooth, drag the head, or bend the line by dragging a
  marcher) and every spot follows, in one undo.
- **Live.** While you drag a path point in Edit path, the form and the marchers at the playhead
  move with it. Nothing is saved until you let go; **Escape** cancels.
- **Moving one marcher by hand takes it out of the trail.** Alt + drag, a plain field drag, typed
  coordinates or a shape tool: the marcher gets its own straight move to where you put it, and
  the trail carries on with the rest. If only one is left, the trail is removed and everyone keeps
  their spot.
- **No second shape.** A drag-out no longer saves a Line for the end spots on top of the trail, so
  Edit path shows the path alone, with one handle at the head. If you want a shape, choose
  **Convert to shape** in the path bar's ···: a Line is placed through the end spots, the shape
  tools own them from then on, and the marchers still walk the path into it.
- **During playback** nothing editable is drawn: no handles and no selection frame.

**Try it**

1. On page 1, make a 5 × 3 box with the Box tool.
2. Go to page 2, select the fifteen, press **Shift+L**, and drag a trail out of a corner: along
   the side, around two corners and back, so it closes up into a shape. Press **Enter**.
3. With the trail selected, turn **Edit path** on (the button on the path bar, or double-click
   the trail). Drag the points so the trail leaves the box diagonally. Watch the marchers follow.
4. Let go, go back to the start of the page and press **Space**. Everyone walks the new path into
   the form.
5. At the end of the page, drag the leader. The form doesn't jump: it was already on the path.
6. **Alt** + drag one marcher off the line. It leaves the trail. Undo brings it back.
7. Try **Convert to shape** in ···, then edit the Line with the shape tools.
8. On a tablet, every step has a button: Edit path on the bar, Convert to shape in ···, and the
   touch pill's Alt.

**Good to know**

- Nothing new is stored and files open as before. A trail saved by an earlier test build that
  still has its Line for the end spots loses that Line the next time you edit the trail.
- Trails that go into a form you placed (Follow into a form, Ripple in) work as before: their
  spots belong to the form, and moving a spot doesn't take anyone out.
- Reverse leader is still off for a trail dragged out of a line: drag it out of the other end.
