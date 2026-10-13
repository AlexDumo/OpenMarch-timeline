# Box v1: the rebuild's first shape

Status: owner decisions, 2026-10-12 and 2026-10-13. Not built yet.

## Why a rebuild

The first draw-first build (branch `shapes-draw`) felt wrong in the owner's hands. An audit on
2026-10-12 found that the trouble was in the interaction layer, not in the shape core.

- **Kept.** The kind contract (`types.ts`) and the kinds, geometry, assignment (`assign.ts`),
  checks (`validate.ts`), natural fill, interval locks (`follow.ts`) and recipes (ADR 0004).
- **Removed.** The canvas overlay, the tool store, the panel, the picker strip and the fine-tune
  box. The old panel tool is removed too; it does not stay behind a setting.

What the audit blamed:

- A drawing was snapped to an interval lock carried over from the last shape, so the shape under
  the cursor was not the one drawn.
- Nearest assignment ran on every pointer move while drawing, so spots swapped under the cursor.
- Hidden modes: an arc's bend took the next click anywhere, and a curve ended on a double-click
  anywhere.
- Several capture listeners competed with fabric for each press.

## Build order

1. One explicit tool state machine that owns pointer input while the tool is open.
2. **Box**, grid pattern only.
3. Line, as the first shape from the path family, to check the state machine isn't box-shaped.
4. Arc, then circle, then curve.
5. Then filled shapes, staggered boxes and interval locks.

The owner signs off each shape hands-on before the next one starts.

## Box v1

### Drawing

- Select marchers, open Box, then drag from corner to corner.
- The rectangle is the **footprint**. Each marcher stands in the middle of its own cell. The
  owner's reason: "we have no idea if marchers will be on the corner."
- The marchers are split into files and ranks with cells as close to square as possible. The
  split uses hysteresis so the file count doesn't flicker as the drag crosses a boundary.
- Intervals snap live to **half steps**. The smallest is half a step.
- **The marchers snap** to the half-step grid, not the footprint's edges. The footprint follows
  from where they stand.
- **Shift** makes the across and deep intervals equal. The footprint is not forced square.
- **Alt** turns snapping off.
- A short rank is the **back** rank, **centered**.
- While dragging, dots show the new spots and the marchers stay where they are. The lines from
  each marcher to its spot appear when the drag ends.
- No rotation in v1.

### Editing an open box

- **Corner handles** stretch both intervals in half steps. Files and ranks stay the same.
- **Side handles** stretch one axis's interval in half steps.
- **Drag inside** the box to move it.
- A readout under the box shows files, ranks and intervals. Its **−** and **+** buttons, and
  the `[` and `]` keys, change the number of files. The intervals and the **center** stay put.
  Keeping the center is provisional until the owner has tried it.
- A press on the field outside the box draws a new box that replaces it. That is one undo step.
- **Enter** places the box. **Esc** cancels the tool.
- Who goes where (Nearest) is held during any gesture and worked out again when it ends.

The split into files and ranks only changes when a box is drawn again, or when the file count
changes.
