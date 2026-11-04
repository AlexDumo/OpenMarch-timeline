---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: Draw a path for one marcher (pathways, step 1)
summary: The first step of pathways. Select one marcher, press P, click corners between where it starts and its end spot, and double-click or press Enter. The marcher walks your path at one steady speed. This round, the pen has its own Paths tab, its small editor looks like the shape editor, and drawing and editing work like the Line in the shape tool.
status: open
variants: []
questions:
  - Is the Paths tab the right home for the Path pen, apart from Shapes?
  - Did drawing feel like the Line? Clicks for corners, double-click or Enter to finish, right-click or Backspace to take one back, Escape to cancel.
  - On an open path, did dragging a corner, Shift for fine, Ctrl or Cmd to keep its direction, clicking the small dot mid-leg to add a corner, and the corner's right-click menu work as you expected?
  - Does the small editor beside the path now look like the shape editor? Is anything in it you don't need, or anything missing?
  - Did the amber "Big steps" advice make sense, and would you know what to do about it?
  - Did the marcher walk the path the way you meant during playback, in the 3D View, and in the start flag paths?
---

Until now a move could only go straight, or along an arc. This build lets one
marcher walk a path you draw: a run of corners from where it starts to its end
spot.

**What changed since the last round**

- The Path pen has its own **Paths** tab in the toolbar, apart from Shapes.
  **P** still starts it, and its shortcuts have their own Paths group.
- The small editor beside the path is now the shape editor's bar: solid, with
  icons, no outline round each button and one text size. It holds only what a
  path needs: **Big steps** when the path is too long for its counts, **Remove
  path**, and while drawing **Remove last corner**, **Cancel** and **Finish**.
  The word "Path" and the marcher's drill number are gone from it.
- Drawing and editing work like the shape tool's Line:
  - Clicks place corners. Double-click, **Enter**, or a click on the last
    corner or the end spot finishes. Right-click or **Backspace** takes the last
    corner back, and **Escape** cancels.
  - Corners land on half steps and on the field's lines, as a Line's points do.
    Hold **Shift** (fine) to place or drag one off the grid. Hold **Ctrl**
    (**Cmd** on a Mac) to place one at 45° from the last, or to drag one along
    its direction. The chip by the pointer names what's held, as it does for
    shapes.
  - On an open path, a click on a corner selects it. A small dot in the middle of
    each leg adds a corner there when clicked, or adds one and drags it. A
    right-click on a corner deletes it; on the dot, it adds a corner.
  - Deleting the last corner removes the path, so the move goes straight again.
    That's one undo step.

**Try it**

1. Open a demo show or start a new one with a few pages. Put the playhead on a
   page where a marcher moves, and select **one** marcher.
2. Press **P**, or click **Path** in the toolbar's **Paths** tab. A hint over the
   field says whose path it is and how to go on.
3. Click on the field to place corners. The path runs from where the marcher
   starts, through your corners, to its end spot.
4. Double-click, or press **Enter** (or **Finish** in the small editor), to keep
   it. That's one undo step.
5. Play the page. The marcher walks the whole path at one steady speed, passing
   the corners without stopping. The 3D View and the start flag paths follow it
   too.
6. With that marcher selected, its path shows on the field with the small editor
   beside it. Drag corners, add them with the dots mid-leg, and delete them from
   their right-click menu or with **Backspace** once selected. **Remove path**
   (Shift+Backspace) makes the move straight again.
7. Try **Split at playhead** on the move: the path is cut at the count, and
   both halves play exactly as the whole did.

**Good to know**

- The amber **Big steps** label shows when the path is too long for its counts.
  Its tooltip gives the step length. The marcher walks at one steady speed, so
  every leg has the same step size.
- Some edits can't keep a path yet, so they refuse and say why: split by
  marchers, merging moves, and the Move card's Straight and Arc ("remove it
  first"). Nothing changes when they refuse.

**Not in this step, on purpose**

- Curves and smooth corners: every corner is sharp for now. A Line's
  double-click on a point (corner to smooth) does nothing on a path until then.
- Pins: nothing ties a corner to a count yet, so a marcher doesn't stop on one.
- Paths for groups, and several marchers sharing one path: the pen draws for one
  marcher at a time.
- Follow the leader along a drawn path.
- Rejoining the path after a takeover: a marcher taken over partway by another
  move walks straight to its end spot when it comes back.
- Steps per count (double or half time) and turns.

Shows saved with a path open only in this build and later ones.
