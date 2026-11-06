---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: path-pen
title: "Paths for a group (pathways, step 15)"
summary: "Step 15 of pathways: draw one path for a whole block. Select several marchers and press P. The block slides along the path keeping its shape and lands on its end set. Any one marcher can break off with Own path and come back with Rejoin."
status: open
variants: []
questions:
  - "Select a block and draw a path through a turn. Does the block hold its shape all the way between the first and last points, and land where it should?"
  - "When the end set isn't the start formation moved over, each marcher changes speed where it joins the path and where it leaves it, and walks with the group in between. Does that read right in playback and the 3D View, or would you rather each marcher kept one steady speed and the block bent through turns?"
  - "Big steps now names the leg (onto the path, along it, off it). Is it clear which marchers it means, and what to do about it?"
  - "Own path and Rejoin on the floating bar: did they do what you expected? Was it clear from the blue and orange rings who follows the group path and who doesn't?"
  - "Remove path with one marcher selected removes the path for the whole group (the toast says how many). Is that what you wanted, or should it take only that marcher off?"
---

Steps 1 and 2 drew a path for one marcher. This build draws **one path for a
group**: the block slides along it, keeps facing the same way, and lands on its
end set.

**What's new**

- **Drawing for a group.** Select two or more marchers in the same move and
  press **P**. The hint says "Group path for 16 marchers". You draw one line
  from the middle of the block; every marcher's own copy of it (its **lane**)
  is drawn faint as you go. Points, curves, Enter and Escape work as before.
- **The block holds its shape.** Every marcher passes its copy of each point at
  the same moment, so between the first and last points the block moves as one.
  Only the stretch from each marcher's start onto the path, and from the path to
  its own end spot, can be faster or slower. A block whose end set is its start
  formation moved over walks at one steady speed the whole way.
- **Rings.** With a group path shown, each marcher on it gets a blue ring
  ("Follows the group path"). A selected marcher in the move that isn't on it
  gets an orange ring ("Own path" when it walks its own).
- **Editing.** Double-click the line, or any lane, to open it (or right-click
  for Edit path). Point edits move every lane at once.
- **Own path · Rejoin.** On the floating bar. **Own path** gives the selected
  marchers their own copy of their lane, which you can then edit alone. It then
  walks that line at its own steady speed. **Rejoin** puts selected marchers
  back on the group path, each from where it stands. It also adds a marcher that
  wasn't on it. Both are in the command palette too.
- **Remove path** on a group path removes it for the whole group, whichever
  marcher is selected, and the toast says how many marchers lost it (with Undo).
  **Own path** first keeps one marcher's.
- **Big steps** now judges each leg: onto the path, along it, and off it.
- Each edit is one undo step, and redo brings back the same paths.

**Try it**

1. Put the playhead on a page where a block moves. Select the whole block.
2. Press **P**, place a smooth point and a corner, and press **Enter**.
3. Play it, and watch the 3D View. Try an end set that's a different shape
   (a line, an arc) and watch where the speed changes.
4. Select one marcher of the block, double-click the path, and press
   **Own path**. Edit its path. Then press **Rejoin**.
5. Try **Remove path** with one marcher selected, then Undo.

**Good to know**

- The moments the block reaches the first and last points come from the path
  you drew. They don't fall on whole counts. Pins (a later step) will put a
  point on a count.
- **Split at playhead** on a move with a group path refuses, and says to give
  the marchers their own paths (Own path) or remove the path first.
- With marchers from different moves selected, the pen refuses and says so.

**Not in this step, on purpose**

- Wheeling or turning the block with the path. It always slides, facing the
  same way.
- Pins and holds shared by the group, re-fitting the path when the starts or
  ends move, follow the leader along a drawn path.
- Tablet polish. Long-press still opens the menus.

Shows with a group path open in this build and later ones. The step 2 build
ignores the offsets (every marcher walks the middle line) and can't edit them.
