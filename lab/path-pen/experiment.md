---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: Paths with curves (pathways, step 2)
summary: "Step 2 of pathways: curves. A path's points can now be smooth, and you draw and edit them the way you do a Line's points. In the pen, click for a corner or press and drag for a smooth point. On an open path, double-click a point to swap corner and smooth, drag the ends of its tangent bar for roundness, and use the point and leg menus."
status: open
variants: []
questions:
  - "Is drawing and editing curves now like the Line? Think about press-and-drag in the pen, double-click to swap, the tangent bar, Corner | Smooth and Roundness in the point's menu, and Straight | Curved on a leg's dot. Tell us anything that works differently from the Line."
  - "In the pen, a press-and-drag sets how round the new point is, but not its direction: the curve's direction comes from the points around it, as on a Line. Did you expect to aim the curve with the drag, as in Figma or Illustrator?"
  - Draw a run or a flutter with more points than counts. Does the marcher walk it at one steady speed in playback, the 3D View and the start flag paths?
  - "Split at playhead on a curved stretch: the curve near the cut is redrawn slightly, and the marcher can drift about half a step there. Is that acceptable, or should a split on a curve be refused until it can stay exact?"
  - Do the Corner and Smooth buttons in the small editor (shown with a point selected) earn their place, or is the point's menu enough?
---

Step 1 drew paths with sharp corners only. This build adds curves, drawn and
edited like the shape tool's Line (owner feedback on step 1: "Is there a reason
this can't be exactly like the line editor, especially once we get to curves?").

**What changed since the last round**

- On an open path, **Backspace** or **Delete** with no point selected removes
  the path (undo brings it back). With a point selected they delete that point
  and select the one before it, so pressing on deletes point after point.
- A drawn path now shows by the same rules as the straight paths: the start
  flag positions setting, and **N** (hold it, or tap it to keep it on). At the
  default, a closed path is hidden until you press N. A path you're editing or
  drawing always shows.
- A path's points are **corners** or **smooth**. A smooth point bends the path
  through it. Its **roundness** goes from flat to very round, and 1 is the plain
  curve, as on a Line.
- **Drawing (the pen, P):**
  - A **click** places a corner, as before.
  - A **press and drag** places a smooth point where you pressed. The further
    you drag along the curve, the rounder it gets. Drag back onto the point to
    make it a corner. Roundness moves in tenths; hold **Shift** (fine) for any
    value. While you drag, the point's tangent bar shows.
  - The hint over the field says so: "click for a corner, drag for a smooth
    point".
- **Editing an open path** works like a Line's points:
  - **Double-click** a point to swap corner and smooth.
  - Click a smooth point to select it and show its **tangent bar**. Drag either
    end to change its roundness (tenths, **Shift** for fine). Drag behind the
    point to make it a corner.
  - **Right-click** (or long-press) a point: **Corner | Smooth**, **Roundness**
    (selects it so its bar shows) and **Delete point**.
  - The small **dot in the middle of each leg** now sits on the curve. Click it
    to add a point, or drag it to add one and move it. A point added on a curved
    leg is as smooth as the smoother end. Right-click the dot for **Add point
    here** and **Straight | Curved**.
  - With a point selected, the small editor has **Corner** and **Smooth**
    buttons. They're also in the command palette.
- Words: "corner" became "point" wherever a point can be either (Delete point,
  Remove last point, Add point here).
- Each edit is one undo step, and redo brings back the same points.

**Try it**

1. Open a demo show or start a new one with a few pages. Put the playhead on a
   page where a marcher moves, and select **one** marcher.
2. Press **P**. Press and drag to place a couple of smooth points, click once
   for a corner, then double-click or press **Enter**.
3. Play the page. The marcher walks the curve at one steady speed. Try a
   flutter: more points than the move has counts.
4. Double-click the path to open it. Double-click a point, drag its tangent
   bar, and try the point's and the leg dot's right-click menus.
5. Try **Split at playhead** in the middle of a curve, and on a straight leg.

**Good to know**

- The curve is the Line's: centripetal Catmull–Rom, the same roundness scale.
  The path's two ends (where the marcher starts and its end spot) aren't
  points. They have no roundness, and the path leaves and arrives along a
  natural curve.
- If an earlier page moves where the marcher starts, only the first stretch of
  the path changes. The curve between your points stays put.
- **Split at playhead** on a straight leg keeps the motion exactly. On a curved
  stretch, the marcher is still exactly where it was at the split count, and
  every point stays put. The curve right next to the cut is redrawn, though, so
  the marcher can drift a little in between. In tests that was about 1% of the
  path's length.
- Split by marchers, merging moves, and the Move card's Straight and Arc still
  refuse on a move with a path, and say why.

**Not in this step, on purpose**

- Handles you aim by hand. A smooth point's direction comes from its
  neighbors, as on a Line, and a drag sets only how round it is.
- Arcs inside a path, pins (a point on a count), midsets.
- Paths for groups, follow the leader along a drawn path, rejoining after a
  takeover, steps per count, turns.
- Tablet polish. Long-press still opens a point's menu, but nothing else was
  tuned for touch.

Shows saved with a smooth point open in this build and later ones. The step 1
build walks a smooth point as a corner.
