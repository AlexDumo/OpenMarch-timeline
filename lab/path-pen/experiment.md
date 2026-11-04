---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: Draw a path for one marcher (pathways, step 1)
summary: The first step of pathways. Select one marcher, press P, click corners between where it starts and its end spot, and press Enter. The marcher walks your path at one steady speed. We want your read on drawing and editing the path on the field, before we add curves, pins and groups.
status: open
variants: []
questions:
  - Was it clear how to start the Path pen and who it was drawing for?
  - Did clicking corners, then Enter to finish, feel natural? Did Backspace and Escape do what you expected?
  - Did the marcher walk the path the way you meant during playback, in the 3D View, and in the start flag paths?
  - Was the small editor beside the path in the right place? Was anything missing from it, or in it that you didn't need?
  - Did the amber "Big steps" advice make sense, and would you know what to do about it?
  - Did dragging a corner, and deleting one from its menu (right-click, or a long press on a tablet), work as you expected?
  - On a tablet, could you draw and finish a path with your finger or a pencil?
---

Until now a move could only go straight, or along an arc. This build lets one
marcher walk a path you draw: a run of corners from where it starts to its end
spot.

**Try it**

1. Open a demo show or start a new one with a few pages. Put the playhead on a
   page where a marcher moves, and select **one** marcher.
2. Press **P**, or click **Path** in the toolbar's **Shapes** tab. A banner
   says who the pen draws for.
3. Click on the field to place corners. The path runs from where the marcher
   starts, through your corners, to its end spot. **Backspace** takes the last
   corner back; **Escape** cancels.
4. Press **Enter** (or **Finish** in the small editor) to keep it. That's one
   undo step.
5. Play the page. The marcher walks the whole path at one steady speed, passing
   the corners without stopping. The 3D View and the start flag paths follow it
   too.
6. With that marcher selected, its path shows on the field with a small editor
   beside it. Drag a corner to move it. Right-click a corner (long press on a
   tablet) to delete it. **Remove path** (Shift+Backspace) makes the move
   straight again.
7. Try **Split at playhead** on the move: the path is cut at the count, and
   both halves play exactly as the whole did.

**Good to know**

- The amber **Big steps** label shows when the path is too long for its counts.
  The marcher walks at one steady speed, so every leg has the same step size.
- Corners snap as marchers do (Coordinate Rounding). Hold **Alt** to place one
  freely.
- Some edits can't keep a path yet, so they refuse and say why: split by
  marchers, merging moves, and the Move card's Straight and Arc ("remove it
  first"). Nothing changes when they refuse.

**Not in this step, on purpose**

- Curves and smooth corners: every corner is sharp for now.
- Pins: nothing ties a corner to a count yet, so a marcher doesn't stop on one.
- Paths for groups, and several marchers sharing one path: the pen draws for one
  marcher at a time.
- Follow the leader along a drawn path.
- Rejoining the path after a takeover: a marcher taken over partway by another
  move walks straight to its end spot when it comes back.
- Steps per count (double or half time) and turns.

Shows saved with a path open only in this build and later ones.
