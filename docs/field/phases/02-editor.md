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
- **Field pointer handlers (#193+) skip pan presses**: call `isPanPress(event)`
  from `fieldNavigation.ts` (right, middle, Ctrl+left on a Mac) and only
  handle the rest. Navigation doesn't stop their propagation, so
  document-level "pointer down outside" handlers still see them. Touch
  presses aren't pan presses (touch editing is out of scope).
- `activeGesture()` returns `"pan"` while `panning`; editor gestures should
  combine with it rather than replace it.
- `zoomAt`/`clampPan` are what "zoom to collisions" (#201) should use, with
  `CanvasStore.zoomToCollisions`'s numbers.

**Behavior notes.**

- The view opens once the field and a page are loaded, and centers again
  250 ms later, as Fabric's canvas does: the panels around the field settle
  after it mounts. A resize keeps the zoom and the top-left anchor; in
  fullscreen it fits again.
- The new field applies the pan limit after every navigation. Fabric skipped
  it for right-drag, the zoom buttons and touch pinch (a right-drag could take
  the field off screen until the next wheel event). Flagged on the PR for the
  owner.
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
