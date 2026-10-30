# Box v1: the rebuild's first shape

Status: owner decisions, 2026-10-12 and 2026-10-13; revised after the owner's hands-on feedback on
2026-10-14 (marchers on the edges, evenness first). Built on branch `shapes/box-v1`.

## Why a rebuild

The first draw-first build (branch `shapes-draw`) felt wrong in the owner's hands. An audit on
2026-10-12 found that the trouble was in the interaction layer, not in the shape core.

- **Kept.** The kind contract (`types.ts`) and the kinds, geometry, assignment (`assign.ts`),
  checks (`validate.ts`), natural fill, interval locks (`follow.ts`) and recipes (ADR 0006).
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
- **The marchers stand on the rectangle's edges**: the front and back ranks on the front and back
  edges, the end files on the sides. A marcher stands on the corner where the drag started,
  snapped to the half-step grid. The intervals snap to half steps, so the far edge lands near
  the cursor rather than always on it. (Revised 2026-10-14. The first build read the rectangle
  as a footprint with each marcher in the middle of its cell; in the owner's hands that put the
  marchers somewhere that looked arbitrary.)
- **Evenness first.** Of the splits whose cells are within 2× of square for the drawn
  rectangle, the one with the fewest empty spots in its short rank wins, then the one closest
  to square. When no split is within 2×, the fewest empty spots of all. 20 marchers become 5 × 4
  or 4 × 5, not 6 + 6 + 6 + 2. The split uses hysteresis so the file count doesn't flicker as
  the drag crosses a boundary.
- Intervals snap live to **half steps**. The smallest is half a step.
- **Shift** makes the across and deep intervals equal. The footprint is not forced square.
- **Alt** turns snapping off.
- A short rank is the **back** rank, **centered**, at the same interval. The readout says how
  many spots it leaves empty ("· 2 short").
- While dragging, dots show the new spots and the marchers stay where they are. The lines from
  each marcher to its spot appear when the drag ends.
- No rotation in v1.

### Editing an open box

- The handles sit on the corner and edge marchers. **Corner handles** stretch both intervals in
  half steps. Files and ranks stay the same.
- **Side handles** stretch one axis's interval in half steps. A single file or rank has no
  handles on that axis.
- **Drag inside** the box to move it.
- A readout under the box shows its size as across × deep ("8 × 4") and the intervals. Its **−** and **+** buttons step through every number of files, even ones that leave a short rank. The intervals and the **center** stay put.
  Keeping the center is provisional until the owner has tried it.
- A press on the field outside the box draws a new box that replaces it. That is one undo step.
- **Enter** places the box. **Esc** cancels the tool.
- Who goes where (Nearest) is held during any gesture and worked out again when it ends.

The split into files and ranks only changes when a box is drawn again, or when the file count
changes.
