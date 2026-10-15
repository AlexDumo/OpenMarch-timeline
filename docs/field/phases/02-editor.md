# Phase 2: Editor

Build the editor module (plain TypeScript, no React, no three.js) and its
gestures on the new field. Every rule here is in the
[interaction rules table](../implementation-plan.md#interaction-rules).

## Tickets

- **#193 Editor core: click selection.** The editor owns the one selection,
  shared with the app, and hit testing in field coordinates. Click,
  Shift+click, click on empty field, Ctrl/Cmd+A and the hover cursor.
  Selection rings on marchers, and the selection box in the SVG overlay.
- **#194 Navigation.** Wheel zoom at the cursor, trackpad pan, pinch, right-
  and middle-drag pan, limits, zoom controls, fit and touch. Alt no longer
  pans.
- **#195 Marquee and lasso.** Marquee on drag, lasso on double-click-and-drag,
  Shift adds. The lasso closes only within 50 screen px of its start, with
  the green cue.
- **#196 Move and drop.** Drag one marcher or the selection. Under 4 screen
  px is a click. Drops go through the existing drop-to-timeline planner,
  unchanged. Pending positions, snap-back, one undo step, the "move them
  too" toast. Nudges and field actions verified unchanged.
- **#197 Snapping, precision and locks.** Single-marcher vs group snapping,
  Shift, Alt at ¼ speed, Lock X/Y on marchers only.
- **#198 Group scale and rotate handles.** Corner, middle and rotate handles
  in the overlay, with their Shift and Alt rules, no flipping, refit after
  each transform. The inspector's rotation input uses the same transform.

## Order

#193 and #194 start after #192. #195 and #196 follow #193. Then #197, then
#198. #193 → #196 → #197 → #198 is on the critical path.

## Exit gate

- Editor unit tests cover gesture rules, snapping, hit testing and transform
  math.
- Each ticket's scenarios pass on Fabric (with only the rules-table changes
  edited in) and on the new field.

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

### #193 Editor core: click selection

**Files.** The editor is `apps/desktop/src/field/editor/` (no React, no
three.js):

- `fieldEditor.ts`: `FieldEditor`. The renderer reports `pointerDown`,
  `pointerMove`, `pointerUp`, `pointerCancel` and `pointerLeave` with a
  `FieldPointer` (field point, screen point in CSS px from the field element's
  top-left, button, Shift/Alt/Ctrl/Meta). It reads and writes everything else
  through `FieldEditorPorts`: the app's selection, the drawn marchers, the
  zoom, and `canSelect` (false for dimmed marchers, UI-9). `subscribe` fires on
  cursor and gesture changes. `CLICK_SLOP` is the 4 px rule.
- `hitTest.ts`: `marcherAt` (nearest selectable dot within a radius) and
  `hitRadius(zoom)`. `selectionRules.ts`: `selectionAfterClick`.
- `activeFieldEditor.ts`: the mounted field's editor, for app actions. The
  `selectAllMarchers` action uses it when the new field is on screen.

**The seam for #195 and #196.** A primary-button press is a `FieldPress`
(`start` pointer, `hit` marcher or null). Once it moves 4 screen px it's no
longer a click, and `FieldEditor.startDrag(press, pointer)` decides what it
becomes: return a `FieldGesture` (`kind`, `move`, `end`, `cancel`) and the
editor routes the rest of the press to it, and reports its `kind` as
`activeGesture()`. #193 returns null (nothing happens). Marquee and lasso
start from `hit === null`, a move from a hit. The lasso's double-click needs
the previous click's time and place: keep it in the editor, not the renderer.
Right, middle and (on a Mac) Ctrl presses return false from `pointerDown`, so
they're #194's.

**Selection.** The one selection is `SelectedMarchersContext` (Marcher
objects). `ThreeField` gives the editor ids through a ref that holds the last
write until React renders it, so two quick clicks build on each other. Hidden
marchers (#199's `FieldMarchers.hidden`) have no click target and aren't
selected by Ctrl/Cmd+A; the context also drops hidden marchers from the
selection.

**Renderer side** (`src/field/three/`): `fieldPointerInput.ts` attaches the
canvas's pointer events to the editor (touch is left to #194) and shows its
cursor. It cancels the editor's press only when the pointer it captured is
lost, so navigation's own captures don't. `FieldMarchers.setSelection` marks `selected` (`Uint8Array`, by `ids`
index) and bumps `selectionVersion`; `MarchersLayer` draws a 2 px ring in the
same instanced draw (`aSelected`). `selectionRing.ts` sizes dots and rings for
both. `FieldOverlay.tsx` is the SVG overlay over the canvas
(`pointer-events: none`), re-rendering on `FieldMarchers.subscribe`: it draws
the box around 2+ selected marchers. **#198** adds handles there and makes
`handles()` read them; the overlay needs `pointer-events` on the handles only.

**Decided changes.** Four Fabric behaviors differ, all from #189's stories,
each a `change:` scenario in `e2e/browser/tests/click-selection.spec.mts`
marked `test.fail` on Fabric, and in the rules table: a click on one of several
selected marchers narrows to it; a click on empty field inside the box clears;
Shift+click on empty field keeps the selection; a second Ctrl+A keeps
everything selected. **#196:** pressing a selected marcher and dragging must
still move the whole selection: the narrowing happens only on a click.

**Decided for #195 and #196.** A drag that starts on empty field inside a
multi-selection's box moves the selection, as Fabric does (owner decision); a
plain click there still clears it. #196 pins this with a scenario. The editor's
`startDrag` gets `press.hit === null` there, so the box test belongs in
`startDrag`: inside the box it's a move, outside it's a marquee or lasso.

**For #202.** A first press on the field during a paused preview selects on
the new field, where Fabric only clears the preview (story 60). #202 needs a
hook at the start of `FieldEditor.pointerDown` that can swallow the press.

**Not covered yet.** The scenarios check the field's selection against the
inspector and the toolbar's Select tab, not the timeline (it reads the same
context). Dimming (story 20) has unit tests only; a scenario needs an isolated
move. Rings and the box are checked by eye (screenshots on the PR), since the
test API has no reading for them; #198's `handles()` covers the box. The hover
cursor updates on pointer moves only, so it can be stale while marchers move
under a still pointer (playback). Shift+click on empty field keeping the
selection follows the rules table's Shift row (a zero-size Shift marquee adds
nothing); decided by the orchestrator, and on the #208 hands-on checklist.

**Found while testing.** `move-marchers` "undo and redo a move" fails about 2
times in 3 on Fabric in the browser, on `field-renderer` before #193 too.
With `FIELD=three` under parallel load, the undo steps of `edit-positions`
("select all, then align", "copy every position") fail, also on the base;
they pass alone and in Electron.

### #196 Move and drop

**Files.** `src/field/editor/moveGesture.ts`: `MoveGesture`, the drag. It
moves the marchers by the pointer's delta from the press (so a dot keeps its
offset from the pointer) through a `MoveTransform`. `FieldEditor.startMove`
decides what a drag moves: a selected marcher moves the selection (no
narrowing), another marcher is selected first (Shift adds it, then the whole
selection moves), and empty field inside a multi-selection's box moves the
selection (`selectionBoxPadding` port, the box the overlay draws). Elsewhere
on empty field `startDrag` returns null: **#195** adds the marquee and lasso
there, after the `startMove` call. A release past the slop with no move event
in between still drags (start, move and end at once).

**The seam for #197.** `FieldEditorOptions.moveTransform` gets the raw
delta in field units, the pointer (its modifiers) and where the marchers
started, and returns their positions. `followPointer` is today's: snapping,
Alt at ¼ speed and Lock X/Y replace it. Nothing else changes.

**Live, pending and snap-back** are the editor's. It writes positions through
the `showPositions` port, which `ThreeField` maps to
`FieldMarchers.setOverrides`: overridden marchers are drawn there through
every fill (the playhead, isolation), with no React state; marchers dropped
from the map are sampled again. A drop calls the `drop` port and keeps the
marchers where they were dropped until it settles ("saved" once the write
reached the resolver, "refused" otherwise); only the last drop's answer
clears, and a drag in progress stays under the pointer. Hit testing and the
next drag start from the drawn positions, overrides included.

**Drops** go through `src/field/fieldDrop.ts`, which calls Fabric's
`canvasCoordinateWriter` and `moveMarchersInTargetMutationOptions` unchanged
(range, home, isolation, refusals, Move them too, one undo step). Its promise
must settle on every path, or marchers stay pinned.

**Isolation plan.** Only Fabric's canvas mounted `useTimelineFocusRender`,
which publishes the isolated move's plan; without it every drop in isolation
was refused ("still loading"). `ThreeField` calls it with `canvas: null`
(draws nothing). **#201** splits out `useTimelineFocusScene` and calls it from
`useTimelineVisuals`: whichever merges second keeps only that call.

**Scenarios.** `e2e/browser/tests/move-and-drop.spec.mts` (group drag and one
undo, box drag, unselected marcher, the 19 px flick as a `change:`, page and
home drops, Move them too, pending, isolation with the playhead moving to the
end, a pending drop in isolation, Basic's past-the-last-page refusal) and
`field-actions.spec.mts` (nudges with every modifier on the step grid,
distribute, flip, circle, keep, set to next page). `app.mts` gained
`dragFrom`, `dragMarcher`, `goTo` and `selectPage`. Fabric draws dots half a
unit off, so drop expectations allow a field unit. Fabric's handles sit on a
two-marcher selection's corners: pick a pressed marcher clear of them.

The pending scenarios record where the dot is drawn on every frame from the
release (`recordDrawn`): `window.electron` can't be patched in Electron, so
the database can't be held. A drop that settles before the resolver has the
save fails both. The editor logs an error if a drop hasn't settled in 30 s.

**Not covered / open.** The timeline's "nothing selected" state isn't
reachable from the UI any more; the refusal scenario uses Basic's "past the
last page", through the same toast and snap-back. In
isolation with the playhead before the move's end, a pending drop is drawn at
the dragged spot (at the end beat) until the save lands, then moves by the
plan's offset: the writer doesn't return the positions it writes. Shift+press
on an unselected marcher and drag adds it and moves the selection (as
Fabric); for the #208 checklist.

**For #202.** Fabric swallows the first press on the field while a paused
preview frame is held (`Canvas.tsx`, the preview-swallowing effect, story 60);
the new field doesn't yet, so a press there selects or drags. The hook belongs
at the start of `FieldEditor.pointerDown` (see #193's note).
