# Shapes research 01: what the codebase has today

Branch `timeline/shapes` (from `timeline-try-2` at f0c29a64). Read-only survey, 2026-10-10.
Paths are relative to the repo root; `src/` means `apps/desktop/src/`.

Context: the owner wants shape creation to be an **in-place** action. A shape tool positions
the selected marchers at one moment (the playhead P, which is the end of a move), not across
time. Needed: lines, circles, arcs, splines and curves, boxes and blocks (with variations and
staggers), plus future shapes, all in **one** extensible tool system.

---

## 1. The spec's shape data model, and what exists in timeline mode

### 1.1 Tables

- **Shape** (`spec.md:61`, D-5 `:116`): "a formation drawn in absolute field coordinates … It
  has no knowledge of time or of marchers. **Optional**." DDL `spec.md:148-160`. App table
  `timeline_shapes` (`apps/desktop/electron/database/migrations/schema.ts:466-489`):
  `id, name, kind, geometry(JSON)`. CHECK `kind IN ('line','freehand','circle','box','block')`
  (`:478`). Only the circle's radius and start angle are checked in SQL (`:483`). Everything
  else is checked by `validateShapeGeometry` (`packages/core/src/timeline/validate.ts:139`) in
  the write path (I-S1, E-S1).
- **Geometry by kind** (`spec.md:372-380`, §5.2):
  - `line`: `{points:[[x0,y0],[x1,y1]]}`
  - `freehand`: `{points:[...]}` (2 or more points). This is a **polyline**, not a curve.
  - `circle`: `{center, radius, start_angle∈[0,2π), clockwise}`
  - `box`: `{origin, width, height}`
  - `block`: `{origin, rows, cols, spacing:[dx,dy]}`

  There is no arc segment, spline, Bézier, ellipse, stagger or rotation. A rotated box or block
  can't be expressed: `box` and `block` are axis-aligned.

- **Transition** (`schema.ts:491-550`, spec `:169-185`): `dest_shape_id` (nullable, D-16),
  `path_style` (direct/arc/follow_the_leader), `path_params`, `order_mode` (`inherit|slot`,
  `:509`), `slot_count` (1–10000), and `start_beat`/`end_beat`. Two CHECKs:
  - I-T5 `timeline_transitions_ftl_shape_check` (`:535`): follow the leader needs a shape.
  - Arc bulge ≤ ½ (`:539`).
- **`timeline_slot_destinations`** (`schema.ts:599-622`): one `(transition_id, slot_index, x, y)`
  row per slot of a shapeless transition.
- **Assignment** (`schema.ts:552`): marcher → `(transition, slot)` over `[start,end)` at a
  `layer`. UNIQUE `(transition, slot)` and `(transition, marcher)`.

### 1.2 `dest_shape_id` versus `slot_destinations` (D-16, Appendix F)

- D-16 (`spec.md:127`): a transition's slot destinations come from a shape **or** from
  individually placed points, **never both**. I-T6 (`spec.md:429`) enforces this with triggers
  `timeline_sd_ins`, `timeline_sd_upd`, the shape-set trigger and the slot-count trigger
  (`electron/database/migrations/triggers.ts:253-275`). Completeness (one point per slot) is
  checked at commit through `timeline_commit_violations` (`triggers.ts:127-131`).
- Appendix F (`spec.md:1549-1580`): the resolver reads destinations through one function
  (`destinationsOf`, `packages/core/src/timeline/geom.ts:145`). Nothing downstream can tell
  which source the points came from.
- Q-14 (`spec.md:1435`), still open: a shape with a few slots overridden is not allowed. The
  workaround is to convert the transition to points by copying the samples. After that, the
  points stop following the shape.

### 1.3 Sampling (R-13, `spec.md:666-682`; code in `packages/core/src/timeline/geom.ts`)

- Open kinds (`line`, `freehand`): `tᵢ = i/(n−1)` by arc length. Closed kinds (`circle`,
  `box`): `tᵢ = i/n`. Block: row-major, `origin + ((i mod C)·dx, ⌊i/C⌋·dy)`.
  - `paramT` `geom.ts:123`, `sampleDestinations(shape, n)` `geom.ts:127`, `destPath` `geom.ts:79`
    (the exact parameterization FTL uses), `pointAtDistance` `geom.ts:51`.
- `slot_count` is the transition's, not the shape's. One shape can serve transitions with
  different slot counts, and the spacing comes out of `n`. A block must satisfy
  `rows×cols ≥ slot_count` (I-T4, triggers `triggers.ts:244`, `:286`).
  - So in the spec, "16 marchers evenly on a circle" is a circle shape plus a transition with
    `slot_count=16`. The shape has no count.
- Sampling is always **even by arc length**. Uneven spacing (staggers, gaps, dressed ends) can't
  be expressed by a shape. It needs individual points.

### 1.4 Order: `order_mode` and follow the leader (I-T5)

- Only follow the leader (FTL) reads order (D-9 `spec.md:120`, R-12 `spec.md:653-664`). Under
  `inherit`, founders are ordered by their slot in the upstream transition. Under `slot`, they
  are ordered by their own slot index.
- FTL needs a destination shape because the trail ends in `destPath(shape)` (I-T5, CHECK in the
  schema). It can't use a block (I-T3). FTL founders go to `p_{n−m+q}` by trail order (R-9), so
  slot numbering doesn't decide their targets.

### 1.5 Does a shape already sit at a point in time?

**No. A shape is timeless by design.** It gets a time only by being the destination of a
transition. Marchers arrive on it at the transition's `end_beat`. Since C-11
(`implementation-plan.md:147`) that is the timeline's end. Under UI-10 the timeline is the edit
window `[S, P)`, so it is the playhead P.

- So "a shape at the current beat" maps naturally to "the destinations of the window's move,
  which ends at P". That matches the owner's in-place intent. The spec has no notion of a shape
  that holds marchers at a beat other than an arrival.
- One shape row can be shared by several transitions (`timeline_idx_tr_shape`). Editing it then
  moves every move that arrives on it. That is spec-intended (`ui.md:1096-1102`, "it names the
  transitions that use the shape"), but it is the opposite of in-place: one edit changes other
  times.

### 1.6 What ui.md says, and what is built in timeline mode

| Piece                                                                                                                         | Status today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TimelineShapesEditor` (`src/components/inspector/TimelineShapesEditor.tsx`, 873 lines). P8.2, `ui.md:1080-1127`              | **Built and mounted** inside the inspector's Timeline section (`TimelineInspectorSection.tsx:539`). It creates a shape of any of the 5 kinds "through the selected marchers" (`newShapeThrough`, `src/timeline/timelineShapeEditor.ts:401`), picks a shape, and edits name, kind and numeric geometry, plus delete. Each change is one undoable edit via `createTimelineShape`, `updateTimelineShape` and `deleteTimelineShape` (`src/db-functions/timelineShapes.ts:18,40,64`). **It only writes `timeline_shapes` rows. It moves no marcher.** |
| `timelineShapeEditor.ts` (623 lines)                                                                                          | Pure planner: `buildShapeEditTargets` (:123), `newShapeThrough` (:401), `convertShape` between kinds (:485), `planShapeEdit` (:552), `planNewShape` (:592), `applyShapeEdit` (:609), `shapeBounds` (:220), `gridFor` (:278), `shapeFrameFor` (:91, 16 steps across, a block spacing of 2 steps).                                                                                                                                                                                                                                                 |
| `timelineShapeCanvas.ts` (368 lines)                                                                                          | Pure handle math: `shapeOutline` (:71), `shapeHandles` (:138), `translateShape` (:190), `dragHandle` (:232). A zustand bridge `useTimelineShapeCanvasStore` (:361) passes `{target, pending, commit}` between the inspector editor and the canvas.                                                                                                                                                                                                                                                                                               |
| `useTimelineShapeCanvas.ts` and `TimelineShapeOverlay.ts` (`src/global/classes/canvasObjects/`). P7.11, `ui.md:1129-1148`     | **Built and wired** in `Canvas.tsx:696`. Draws the picked shape (outline, block cells), round reshape handles and a square move handle. A drag redraws locally and commits one geometry edit on release. `isTimelineShapeHandle` keeps the handles out of marcher selection (`canvasListeners.selection.ts:139,223,261`). Hidden while playing.                                                                                                                                                                                                  |
| Transition editor destination picker (`TimelineTransitionEditor.tsx:511`). P8.3, `ui.md:1020-1048`                            | **Built**, but it lives under "Per-marcher details" and edits **one marcher's** transition. Since UI-9, each marcher has its own one-slot transition, so picking a shape there puts one marcher on the shape's first sample. Practically useless for group shapes.                                                                                                                                                                                                                                                                               |
| Casting (`timelineCasting.ts`, `TimelineAssignmentsEditor`). P8.4, UI-7 `ui.md:88`, `:1050-1078`                              | **Built**: "Cast selected marchers" and "Recast by nearest slot". Meaningful only for multi-slot transitions, which UI-9 no longer creates.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Create Track into a shape (`createTrackInTransaction`, `src/db-functions/timelineCommands.ts:355`, shape target `:257`). UI-6 | **Legacy and unreachable.** UI-9/UI-10 supersede it (`ui.md:16`, `:248-251`). `Timeline.tsx:509` still forwards `onCreateTrack`, but `PageTimeline.tsx` never passes it, so only Storybook uses it. It is the **only** writer that makes a multi-slot transition into a shape with nearest-slot casting, so its code is the closest reuse for "put N marchers onto shape S" (`transitionSlotPoints`, `stealLayer` `:274`, `shapeCapacity`).                                                                                                      |
| Shape-backed transitions after a drag                                                                                         | A canvas drag on a marcher in a shape-backed transition **converts the transition to individual points** (the Q-14 workaround, `src/db-functions/timelineMoves.ts:52-56`; `ui.md:1155-1157`). There are no shape locks.                                                                                                                                                                                                                                                                                                                          |
| Validation scope                                                                                                              | The current MVP validation **excludes shapes** (`validation-plan.md:30-37`, README:11). Shapes are slice 2 after the owner's verdict (`validation-plan.md:152`).                                                                                                                                                                                                                                                                                                                                                                                 |

Net: shapes exist as stored, editable geometry with a canvas overlay. **No UI path in timeline
mode puts a group of marchers onto a shape.** The in-place tools that do move marchers (line
tool, circle, align and distribute) compute points and write them as individual destinations
(§3).

---

## 2. Legacy page-mode shapes and the positioning tools

### 2.1 Page shapes (SVG paths)

- Tables `shapes`, `shape_pages`, `shape_page_marchers` (`implementation-plan.md:27`). These
  are **frozen in timeline mode** (C-10, `implementation-plan.md:129`): BEFORE triggers
  `page_era_frozen_<table>_*` reject writes, and the app refuses first
  (`src/db-functions/pageShapesGate.ts:6,19`, `pageEraFreeze.ts:6,20`).
- `StaticMarcherShape.ts` (580 lines) is a Fabric path with control points that doesn't touch
  the database. Its path supports SVG commands `M L Q C Z` (`:28`). The command enum is in
  `SvgCommand.ts`. `distributeAlongPath` (`:372`) splits the path into segments, gives each
  segment a share of the marchers proportional to its length, puts endpoints on vertices, and
  keeps the **given marcher order**. It measures lengths with core's `Path`
  (`packages/core/src/path-utility`, which has Line, Arc, CubicCurve, QuadraticCurve and Spline
  segments, a `SplineFactory`, a `ControlPointManager` and an `SvgParser`).
- `MarcherShape.ts` (395 lines) is the database-backed subclass: `addSegment` (:124),
  `deleteSegment` (:171), `updateSegment` (:187), `useCreateMarcherShape` (:268),
  `_createMarcherShape` (:299). `ShapePath.ts` (69 lines) is the `fabric.Path` drawn.
  `ShapePoint.ts` and `ShapePointController.ts` are the point model and the draggable control
  handles.
- UI: the inspector's `ShapeEditor.tsx` (388 lines) edits segments (type line, quadratic or
  cubic; add, delete, copy to page). It renders nothing in timeline mode (P7.11). Shapes are
  drawn by `components/canvas/hooks/shapes.ts`, which is off in timeline mode (`:31`).
- **Curves are lost on conversion**: C-8 (`implementation-plan.md:103-117`) decided that page
  SVG shapes convert to individual destinations, and "only the editable curve is lost".

### 2.2 How a user makes a line today (both modes)

1. Select 3 or more marchers. The inspector's MarcherEditor shows **Create line**
   (`MarcherEditor.tsx:799-812`, action `alignmentEventLine`, key **L**).
2. `useAlignmentEventStore` (`src/stores/AlignmentEventStore.ts`, events
   `default | line | lasso`) switches the canvas listeners: `Canvas.tsx:252-258` calls
   `canvas.setListeners(new LineListeners(...))`. This is the existing **canvas tool-mode
   mechanism**.
3. `LineListeners.ts` (298 lines) draws a `MarcherLine` (`MarcherLine.ts`, `fabric.Line`) with
   the mouse. It sorts marchers by the line's dominant axis (`LineListeners.ts:186-226`), not by
   nearest slot. Then `MarcherLine.distributeMarchers` (:143) spaces them evenly and the preview
   is published as `alignmentEventNewMarcherPages`.
4. `AlignmentEditor.tsx` (75 lines) shows **Create Shape** (`createMarcherShape`, key Enter;
   disabled in timeline mode, `useCursorActionHandlers.ts:68-80`), **Apply coordinates**
   (`applyQuickShape`, Shift+Enter) and **Cancel** (Escape).

   In timeline mode, Apply goes through `useUpdateCoordinates` (§3), so it already works as an
   in-place shape tool with a preview.

### 2.3 Every positioning or alignment tool, and where its UI lives

| Tool                                      | Action id (`src/shortcuts/definitions.ts`)                                                         | Key                        | UI surface                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Align vertically / horizontally           | `alignVertically`, `alignHorizontally` (:345,:351)                                                 | Alt+V, Alt+H               | MarcherEditor "Align" row (`MarcherEditor.tsx:263-276`)                                                                     |
| Distribute vertically / horizontally      | `evenlyDistribute*` (:357,:363)                                                                    | Shift+V, Shift+H           | MarcherEditor "Distribute" row (with a step-interval input)                                                                 |
| Flip horizontal / vertical                | `flipHorizontal`, `flipVertical` (:369,:375)                                                       | Alt+F, Alt+Shift+F         | MarcherEditor (:290,:303)                                                                                                   |
| Swap 2 marchers                           | `swapMarchers` (:381)                                                                              | Mod+S                      | MarcherEditor (:786)                                                                                                        |
| Snap to fraction, Lock X/Y                | `snapToNearestCustomFraction`, `lockX`, `lockY`                                                    | 1, Y, X                    | Toolbar Alignment tab (`components/toolbar/tabs/AlignmentTab.tsx`)                                                          |
| Set all or selected to previous/next page | `setAll…`, `setSelected…`                                                                          |                            | Toolbar dropdown "Place all marchers" plus MarcherEditor (:407,:413)                                                        |
| Line tool                                 | `alignmentEventLine`, `applyQuickShape`, `createMarcherShape`, `cancelAlignmentUpdates` (:453-482) | L, Shift+Enter, Enter, Esc | MarcherEditor button, AlignmentEditor                                                                                       |
| **Circle**                                | `createCircle` (:494, category `shape`)                                                            | **O**                      | `ShapeSelector.tsx` inspector panel: a 4-column grid with one circle button and the text "more shapes coming soon" (:56-66) |
| Nudge                                     | `moveSelectedMarchers*` (generated)                                                                | WASD / arrows              | none                                                                                                                        |
| Rotation                                  |                                                                                                    |                            | `MarcherRotationInput`                                                                                                      |

- `createCircle` runs core's `createCircle` (`packages/core/src/shapes/ellipse.ts:19`). It takes
  the bounding-box center and radius = max(w,h)/2, spaces the marchers evenly, and assigns them
  with the Hungarian algorithm (`computeOptimalCoordinateMapping`, `shapes/utils.ts:78`). Bug:
  the `circleArgs {0,0,10}` passed by `useCursorActionHandlers.ts:142-160` are ignored. There
  are no parameters, preview or handles.
- `src/utilities/CoordinateActions.ts` holds the pure transforms: `alignVertically` :193,
  `alignHorizontally` :226, `evenlyDistributeHorizontally` :261, `evenlyDistributeVertically`
  :328, `moveMarchersXY` :400, `flipHorizontal` :533, `flipVertical` :547, and bbox/center
  helpers.
- The **shortcuts and command palette** from #1031 (`src/shortcuts/`) already have category
  `shape` (`definitions.ts:13`) with a palette icon (`palette/actionSource.tsx:37`). Today only
  `createCircle` uses it.

---

## 3. The in-place write path in timeline mode

### 3.1 The one call to use

Every coordinate tool computes new x/y for the selected marchers and then goes through one seam
(`src/timeline/timelineCoordinateWrites.ts:23-45`):

```
useUpdateSelectedMarchersOnSelectedPage()        hooks/queries/useMarcherPages.ts:401
  → useUpdateSelectedMarchers(pageId).mutate(transform)   :279
     timeline mode → transformMarchersInSelection({db, marcherIds, transform})
                                                  timelineCoordinateWrites.ts:244
        plan = planCanvasEdit()                   :106   (window / home / isolation / refuse)
        current = timelineCoordinateRecords(plan.beat, ids)  :215 (resolver positions at P,
                                                   or the isolation plan's, editingPositionAt)
        next = transform(current)
        moveMarchersAndOfferFollowUp({target: plan.target, moves})   timelineMoveThemToo.ts:288
          → moveMarchersInTarget({db, target, moves})               db-functions/timelineMoves.ts:1082
             one transactionWithHistory(db, "moveMarchers", …)      = one undo step
               kind "range"    → moveMarchersInRangeInTransaction   :840 (UI-10 window [S,P))
               kind "timeline" → moveMarchersInTimelineInTransaction :495 (isolation, ghosts)
               kind "home"     → updateMarcherHomesInTransaction
          → toasts: pass-through (timelinePassThrough.ts), Move them too, Only Page N
```

The alternative entry for tools that already have the final coordinates is `useUpdateCoordinates()`
(`src/shortcuts/handlers/useUpdateCoordinates.ts:22`), which plans and calls
`moveMarchersInTargetMutationOptions` (`useMarcherPages.ts:188`). The line tool's Apply and the
alignment handlers use it. Canvas drags use `canvasCoordinateWriter`
(`timelineCoordinateWrites.ts:379`).

**A shape tool should call `transformMarchersInSelection`** (or `useUpdateSelectedMarchers`)
with a pure `transform(current) → [{marcher_id,x,y}]`. That gets it, for free:

- the UI-10 window and the auto-created timeline (one per range);
- auto-joining marchers with their own one-slot shapeless transitions
  (`addMarchersToTimelineInTransaction`, `timelineMembership.ts:220`);
- the sparse model (UI-18): marchers already at their target write nothing (`samePosition`,
  `timelineMoves.ts:136`, tolerance 1e-6);
- isolation editing (the plan dot is the marcher), pass-through and follow-up toasts;
- the write lock and stale-plan safety (`timelinePositionsSettled`, `:194`);
- undo.

### 3.2 What gets stored

Each moved marcher's **own one-slot shapeless direct transition** in the window's timeline gets
its slot destination set (`updateTimelineSlotDestinationInTransaction`,
`timelineTransitionsInTransaction.ts:538`). It goes one layer above any timeline that wholly
contains it (UI-9 Layers). If the marcher sat in a shape-backed transition, that transition is
switched to points first (`setTimelineTransitionDestinationInTransaction`, `:459`, the Q-14
workaround).

**Nothing stores the shape.** After a circle, the database holds N independent points. That is
fine for "in place", but the shape can't be re-edited as a circle later.

### 3.3 Undo and history

- `transactionWithHistory` (`src/db-functions/history.ts:100`) is both the undo-group wrapper
  and the spec §6 write wrapper: it checks `timeline_commit_violations`, drains
  `timeline_change_log`, and notifies the resolver after commit.
- `withTimelineWriteLock` (`:57`) serializes timeline writes.
- One tool application is one undo step. Writes that change nothing throw `NothingWritten` and
  open no step (`timelineMoves.ts:1121`).
- The resolver store follows the change log, so no query invalidation is needed.
- Live-preview drags (handles) must **not** write per mouse move. The pattern to copy is
  `TimelineShapeOverlay`: local redraw, then commit on release.

### 3.4 The window rules a tool inherits

- The edit window is `[S, P)`. With P at or before S, it is the page box holding P. At beat 0 it
  edits homes (UI-10, `ui.md:294-299`).
- Isolation edits the isolated timeline's end and snaps the playhead there
  (`snapIsolatedPlayheadToEnd` :72, `atIsolatedEnd` :83).
- With no selection, the write is refused with `CANVAS_EDIT_REFUSALS.noTimeline` (:61).

---

## 4. UI surfaces available to host a tool system

### 4.1 Actions layer (`src/shortcuts/`, from #1031)

- **Definitions** are static: `STATIC_ACTIONS` in `definitions.ts` with `ActionDefinition`
  (:16-40): `labelKey`, `keywordsKey`, `category` (includes `shape`), `scope`
  (`global|canvas|timeline`), `defaultBindings`, `args`, `toggleOnKey/OffKey`, `ignoreRepeat`.
  `ActionId = keyof typeof ACTIONS` (:528), so **a new tool needs a compile-time entry** (and
  i18n keys).
  - Parameterized families are generated: `buildNudgeActions` and `buildTapBeatsActions` use
    `args`. A tool family such as `shapeTool:{kind}` could be generated the same way.
- **Handlers** register at runtime: `useActionHandler(id, run, {enabled})`
  (`useActionHandler.ts:9`). The registry is a stack, and the top-most handler wins
  (`registry.ts:20,26`), so a modal tool can temporarily override Enter or Esc while active.
  Handler hooks are collected in `EditorActionHandlers` (`ActionHandlers.tsx:20`).
- **UI**: `ActionButton` (`shortcuts/ActionButton.tsx`) wraps any button with the action's
  label, shortcut tooltip and enabled state. The command palette lists every action that isn't
  hidden. `registerPaletteSource` (`palette/sources.ts:39`) adds dynamic items, for example one
  per shape kind or preset.
- **Keymap**: user-customizable bindings (`keymap.ts`, `bindings.ts`, `ShortcutsDialog`). Taken
  keys relevant to shapes: **L** (line mode), **O** (circle), **Enter** (create shape),
  **Shift+Enter** (apply), **Esc** (cancel), **V** (default cursor mode), **K** (keep).

### 4.2 Canvas (Fabric)

- **Tool mode** works by swapping listeners: `canvas.setListeners(new XListeners({canvas}))`
  (`Canvas.tsx:252`), with `DefaultListeners` and `LineListeners` implementing `CanvasListeners`
  (`components/canvas/listeners/`). `LineListeners` makes marchers not selectable and sets a
  crosshair cursor (:28-35). This is the hook for "click-drag to draw a shape".
- **Handles and overlay**: the pattern is `TimelineShapeOverlay` (outline, cells, round
  reshape handles, square move handle, drag threshold, theme colors, excluded from marcher
  selection), plus the pure handle math in `timelineShapeCanvas.ts`. Page mode's
  `ShapePointController` and `ControlPoint` handle Bézier control points.
- **Preview of marchers**: `LineListeners` draws static ghost marchers and pathways to the
  proposed spots (`drawNewMarcherPaths`) and publishes them with `setGlobalNewMarcherPages`.

### 4.3 Inspector

- `Inspector.tsx` stacks `TimelineMoveCardSlot`, `PageEditor`, `MarcherEditor` (align,
  distribute, flip, line, rotation, tags), `ShapeEditor` (page mode only), `AlignmentEditor`
  (line tool state), **`ShapeSelector`** (the shape picker grid, :56) and
  `TimelineInspectorSection` (explanations, transition and assignment editors,
  `TimelineShapesEditor`, diagnostics).
- `timelineInspector.ts` is the pure data model for "why is this marcher here"
  (`buildMarcherInspection` :137). It is not a tool host.
- `InspectorCollapsible` is the section wrapper.

### 4.4 UI primitives (`packages/ui/src/components/base/`)

- Available: `Button`, `Input`, `UnitInput`, **`DragInput`** (scrub-to-change number with a
  unit and rounding), **`Slider`**, `Select`, `RadioGroup`, `ToggleGroup`, `Switch`,
  `Checkbox`, `Tabs`, `Dialog`, `AlertDialog`, `Badge`, `Note`, `ListItem`, `TextArea`,
  `Skeleton`.
- **There is no Popover or Tooltip primitive in `base`.** The desktop uses
  `@radix-ui/react-popover` directly in 11 files (for example `CoordinateRoundingSettings.tsx`,
  `TimelineControls.tsx`, `TimelinePrimitives.tsx`, `ColorPicker.tsx`). It also uses Radix
  dropdown-menu (`AlignmentTab.tsx`), context-menu and tooltip directly. A shared Popover would
  be new or extracted.
- Icons: `@phosphor-icons/react` (`CircleIcon`, `ShapesIcon` and others already used).

---

## 5. Marcher-to-slot assignment and ordering logic

| Logic                               | Where                                                                                                                                                                            | Behavior                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Hungarian solve                     | `packages/core/src/shapes/utils.ts:5` (`hungarianAlgorithm`), `:78` (`computeOptimalCoordinateMapping`)                                                                          | Minimum total distance. The wrapper needs as many targets as marchers.                                                        |
| Nearest-slot casting with vacancies | `src/timeline/timelineCasting.ts`: `nearestSlots` :73, `castDistance` :99, `castSlots` (:112-), `transitionSlotPoints` :55, `castsByNearestSlot` :28, `MAX_CAST_SLOTS = 500` :35 | Same solve, slot indexes out, slots ≥ marchers. Cubic: 500 slots take about 30 ms. FTL takes the lowest vacant slots instead. |
| Cast and recast writes              | `src/db-functions/timelineAssignmentEdits.ts`: `castMarchersIntoTransition` :231, `recastTransition` :326, `setAssignmentSlot` :397                                              | Recast is refused if it doesn't shorten total distance.                                                                       |
| Line ordering                       | `LineListeners.ts:186-226`                                                                                                                                                       | Sort by the dominant axis of the drawn line (left→right or top→bottom, by drawing direction). Not optimal, but predictable.   |
| Path ordering                       | `StaticMarcherShape.distributeAlongPath` :372                                                                                                                                    | Keeps the given marcher order and distributes per segment.                                                                    |
| Circle                              | core `createCircle`                                                                                                                                                              | Even angles from 0 rad, then Hungarian.                                                                                       |
| Distribute                          | `CoordinateActions.evenlyDistribute*`                                                                                                                                            | Sort by x (or y), then fixed step.                                                                                            |
| FTL trail order                     | core resolver R-9/R-12                                                                                                                                                           | Order from the upstream slot (`inherit`) or own slot (`slot`).                                                                |

What a shape tool needs: sample N points from the tool's geometry, then assign marchers to
points. The options are nearest (Hungarian), along-path order (sort by projection onto the path
parameter), or the selection or drill order. That should be one shared, swappable "ordering"
step. `nearestSlots` (with vacancies and the 500 cap) is the reusable core.

---

## 6. Risks and constraints

1. **No group transition in the UI-9/UI-10 model.** "One transition per marcher per timeline"
   (`ui.md:144-146`, `timelineMembership.ts:253-264`) and "dragging adds" give every marcher
   its own one-slot shapeless transition. A shape-backed multi-slot transition in the same
   timeline would collide with that rule.
   - `moveMarchersInTimelineInTransaction` already refuses a marcher with "more than one move in
     this timeline" (`timelineMoves.ts:482`, `:595`).
   - So **persisting** a shape link (`dest_shape_id`) needs a model decision. **Writing points**
     through the existing seam needs none.
2. **Points lose the shape.** In-place writes store individual destinations, so re-opening "the
   circle" to tweak its radius needs either a stored shape linked to the move or a
   non-persistent re-fit from current positions. Any later drag of a shape-backed marcher also
   converts its transition to points (Q-14).
3. **Shapes edited at one time move other times.** A `timeline_shapes` row is shared and has no
   time (D-5). Editing it moves every transition arriving on it. That conflicts with "in place"
   unless each tool application gets its own shape row.
4. **The geometry vocabulary is too small.** There is no arc, spline/Bézier, ellipse, rotation,
   stagger or uneven spacing. `kind` is a table CHECK (`schema.ts:478`). Adding a kind needs a
   migration, which is a SQLite table rebuild with history triggers re-created (P3.5), plus
   `validateShapeGeometry`, `sampleDestinations`/`destPath` in core, the converter and the ADR.
   That is a durable decision (`docs/conventions/architecture-decisions.md`). Writing points
   avoids all of it.
5. **FTL needs a shape** (I-T5, `E-T5` refusal on drag). Any future "follow the leader into a
   line" needs a stored shape on a group transition, not points.
6. **Frozen page-era tables** (C-10): legacy `MarcherShape`, `ShapePage` and `shapes` can't be
   written in timeline mode, so the page-mode shape tools can't be reused as-is. Create Shape is
   disabled and Apply coordinates works.
7. **Shapes are out of the current validation scope** (`validation-plan.md:30-37`). The owner
   must open slice 2.
8. **Key collisions**: Enter is `createMarcherShape` (a timeline-own-keys workaround exists,
   `ui.md:660-666`), O is `createCircle`, L is the line mode, and Esc already has several
   handlers (`cancelAlignmentUpdates`, `exitTimelineFocus`, leave isolation).
9. **Drags are not disabled in timeline mode** (UI-10 removed the off-end refusal). They are
   refused only with no window (`noTimeline`), while the isolation plan loads, or before the
   resolver is ready (`TimelineNotReadyError`). The overlay and the static render hide while
   playing or scrubbing. While a shape is picked, its handles sit above marchers and block
   marcher presses (`ui.md:1142-1145`).
10. **Selected page leftovers**: `useUpdateSelectedMarchers` and `useEditorReadiness` still read
    `useSelectedPage` (P8.12, `ui.md:184`). Timeline mode ignores it, but new code shouldn't
    add more reads (there is a dev warning).
11. **Performance**: casting is cubic (cap 500). A shape edit used by a deep chain dirties about
    1.4k origins (`findings.md:43`, walk ≈1–3.5 ms). That is fine per commit, but not on every
    mouse move, so preview must be local.
12. **Coordinates**: everything is in canvas pixels ("field units", `pixelsPerStep` per step,
    `timelineShapeEditor.ts:86`). Tool parameters in steps must convert through
    `fieldProperties.pixelsPerStep`.

---

## What a shape tool system can reuse vs must build

**Reuse as-is**

- The commit path: `transformMarchersInSelection` / `useUpdateSelectedMarchers(transform)`
  → `moveMarchersInTarget`. It handles window, auto-join, sparse no-op, isolation, toasts and
  one undo step. A tool only supplies `current positions → new positions`.
- Reading positions at P: `timelineCoordinateRecords(plan.beat, ids)` and `editingPositionAt`.
- Assignment: `nearestSlots` and `castSlots` (`timelineCasting.ts`), core `hungarianAlgorithm`.
- Sampling math: core `sampleDestinations`, `destPath`, `pointAtDistance`, `paramT` for
  line, polyline, circle, box and block. Validation: `validateShapeGeometry` and
  `validateDestination`. Core `Path` (path-utility) has arc, cubic, quadratic and spline
  segments with `getTotalLength`, a good base for curve sampling.
- Fitting a starting shape through the selection: `newShapeThrough`, `shapeBounds` and
  `gridFor` (`timelineShapeEditor.ts`).
- Canvas handles: the `TimelineShapeOverlay` pattern (drag threshold, local redraw, commit on
  release, excluded from selection) and `timelineShapeCanvas.ts` (`shapeHandles`, `dragHandle`,
  `translateShape`), plus the listener-swap tool mode (`canvas.setListeners`) and
  `LineListeners`' ghost preview.
- The actions layer: `category: "shape"`, `ActionButton`, generated action families with
  `args`, `registerPaletteSource`, the handler stack for modal Enter and Esc.
- UI primitives: `DragInput`, `UnitInput`, `Slider`, `ToggleGroup`, `RadioGroup`, `Select`,
  `Tabs`; Radix Popover as used in `CoordinateRoundingSettings.tsx`. The host panel is the
  `ShapeSelector` grid.

**Must build**

- A **tool registry** (kind → param schema, defaults from the selection, `sample(params, n)`,
  handles, icon, action id). Today each tool is ad hoc: line = listeners + store,
  circle = one-shot action, align = transform.
- A single **active-tool session**: selection snapshot, live parameters, preview of ghost
  marchers and paths at P, Apply/Cancel, Enter and Esc via the handler stack. One canvas
  listener class should be parameterized by the tool, replacing per-tool `LineListeners`.
- A **parameter panel** (inspector card or popover) generated from the tool's schema: counts,
  spacing in steps, radius, angle, arc sweep, rows/cols, stagger, rotation, ordering mode.
- A shared **ordering step** (nearest, along path, drill order, reverse) with the ≤500 cap
  fallback.
- **New geometry**: arc, spline/Bézier, ellipse, rotated box/block, staggered block, uneven
  spacing. As pure samplers producing points, this needs no schema change. As stored kinds it
  needs a migration and an ADR.
- A decision on **persistence**: write points only (re-editing then means re-fitting), or store
  a shape and link it to the move. The second means a group transition per tool application,
  which conflicts with UI-9's one-transition-per-marcher rule, so it is an owner and ADR
  decision. The Q-14 override table (`spec.md:1435`) is the model's suggested route if a shape
  plus nudges is wanted.
- **Cleanup**: retire or re-home `ShapeSelector`'s lone circle (and fix the ignored
  `circleArgs`). Decide whether `TimelineShapesEditor` (shapes that move nobody) becomes part of
  the new system or is hidden. Remove the unreachable Create Track shape target, or re-use its
  code.
