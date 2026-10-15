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

### #194 Navigation

**Files.**

- `apps/desktop/src/field/editor/view.ts`: the view rules as plain
  functions, with Fabric's numbers: zoom limits (0.2 to 25), `zoomAt` (keeps
  the point under the cursor), `clampPan` (the field scrolls at most one element's size past an edge),
  `baseZoom` and `centerAtBase` (the opening and Reset view), `fullscreenFit`,
  `wheel` (mouse mode zooms, trackpad mode pans, Ctrl/Cmd or a pinch zooms in
  both), `pinchStep` (touch) and `isPanButton`. Unit tests in
  `editor/__test__/view.test.ts`.
- `apps/desktop/src/field/three/fieldNavigation.ts`: the thin DOM side.
  `attachFieldNavigation(surface, field, settings)`, `isPanPress`,
  `resetView` and `fitFullscreen`; `threeZoomControls`, which the existing
  `CanvasZoomControls` drives (its prop is now the `ZoomControlsCanvas`
  interface, which `OpenMarchCanvas` already satisfies; no Fabric behavior
  changed).
- `fieldView.ts`: the store now also holds `baseZoom` (100% in the zoom
  controls), `panning` and the `field` size. `fitView` is gone; the field
  opens at `centerAtBase`, as Fabric's.

**Seams for the editor tickets.**

- Navigation listens on `ThreeField`'s root div (the one with
  `data-testid="threeField"`), so it reaches the SVG overlay too. It
  measures from the canvas element, and leaves presses on controls
  (buttons, links, inputs, menus, dialogs) to them.
- **One pan-button rule:** `isPanButton` in `editor/view.ts` (right, middle,
  Ctrl+left on a Mac). `FieldEditor.isEditButton` uses it, so the editor
  skips exactly the presses navigation pans with; DOM code can use
  `isPanPress(event)` from `fieldNavigation.ts`. Navigation doesn't stop
  their propagation, so document-level "pointer down outside" handlers still
  see them. Touch presses aren't pan presses (touch editing is out of scope).
- The test API's `activeGesture()` is `"pan"` while `panning`, otherwise the
  editor's gesture.
- App actions that move the view call `setView` from `fieldNavigation.ts`
  (zoom and pan limits, and it counts as the user's navigation). "Zoom to
  collisions" (#201, `field/zoomToCollisions.ts`) does.

**Behavior notes.**

- The view opens once the field and a page are loaded, and centers again on
  each resize until 250 ms later, as the panels around the field settle (Fabric
  centers once more at 250 ms). Unlike Fabric, none of that undoes a zoom or
  pan the user has already made. A resize keeps the zoom and the top-left anchor; in
  fullscreen it fits again.
- **Decided (for the #208 checklist):** the new field applies the pan limit
  after every navigation. Fabric skipped it for right-drag, the zoom buttons
  and touch pinch (a right-drag could take the field off screen until the
  next wheel event). Accepted as a fix.
- **Decided (for the #208 checklist):** on a Mac, Ctrl+click without a drag
  no longer selects: it's a pan press (Ctrl-drag pans, per the rules table,
  and Ctrl+click is the Mac's secondary click). Accepted.
- The resize and the zoom buttons' limits are Fabric's as is: a resize
  doesn't re-apply the pan limit, and the buttons disable by the percentage
  (relative to the base zoom), so they can stay enabled at the real limits.
- Fullscreen fit is Fabric's as is, including that it measures the room with
  the 128 px above the field, so a height-limited fit runs the field's back
  edge up to about 40 px off the bottom (1600 × 1000 window). The
  `navigation` scenario pins this; fixing it is a separate decision.
- The fullscreen perspective tilt (`PerspectiveButton`) isn't on the new
  field yet; it isn't navigation.
- Scenarios: `e2e/browser/tests/navigation.spec.mts`. The fixture option
  `uiSettings` starts the app with given UI settings (mouse mode is
  `{ mouseSettings: { trackpadMode: false } }`). Touch goes through CDP
  `Input.dispatchTouchEvent`, one session per gesture.
