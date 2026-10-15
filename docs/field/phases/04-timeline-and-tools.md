# Phase 4: Timeline interactions, tools and exports

Port the remaining field behavior and the outputs that draw the field.

## Tickets

- **#202 Timeline interactions.** The kept-mark hover tooltip, Escape leaving
  isolation (except during an alignment event, overlay or clip gesture), the
  first press after a paused preview only clearing it, and dimmed marchers
  that still can't be selected, including while a tool is active.
- **#203 Line tool.** The line tool (L) as today, with its previews in the
  overlay.
- **#204 Box shape tool.** Rebuilt on the editor and overlay from box v1's
  design (fork PR #181): its state machine and geometry. #181 stays held and
  isn't merged on Fabric.
- **#207 Video export and field previews.** Video frames rendered through
  the new field off screen, at today's quality or better. Field previews
  (such as the launch page's) use the new field.

## Exit gate

- Each ticket's scenarios pass on the new field.
- Video export and previews no longer need Fabric.

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

### #202 Timeline interactions

**One hook in the editor.** `FieldEditorPorts.takePress` is asked first on
every edit press (primary button, not a pan); true makes the editor ignore
the whole press (no click, drag or drop; the pointer is still captured, so
its moves and release do nothing either). The new field passes
`src/field/takeFieldPress.ts`, which takes a press in two cases:

- **A paused preview holds a frame** (`cursorBeat !== null && playback ===
null`): it clears the cursor and takes the press, as Fabric's `Canvas.tsx`
  swallow does (story 60). **#196:** this is what keeps a drag during a held
  frame from writing held-frame positions; no change needed in the move
  gesture. A taken press also forgets the last click, so it can't be the
  first half of #195's double-click lasso. Only edit presses are checked: a right- or middle-press after a
  held preview pans on the new field and leaves the preview held, where
  Fabric swallowed it too (its pan listens to the same mouse events). On the
  #208 list.
- **The line tool is on** (`alignmentEvent === "line"`): every press is
  taken, so no marcher can be selected mid-tool, which closes Fabric's known
  gap (docs/timeline/ui.md: a marcher whose dimming ends mid-tool becomes
  selectable). **#203:** replace this branch with the line tool's own press
  handling (a gesture or mode in the editor), and keep it from selecting any
  marcher; the `change:` scenario below must keep passing. Ctrl/Cmd+A during
  the tool is unchanged (`selectAll` doesn't ask the hook).

**Escape** is the app's, not the field's: `useIsolationEscape` in
`TimelineIsolationBar.tsx` listens on the window in the capture phase and
skips alignment events, open overlays (`overlayOpen`) and clip gestures
(`clipGestureActive`). It works unchanged with the new field mounted.

**A test-only hook.** A user holds a preview frame only mid-scrub over
playback, with the button still down on the timeline, so a scenario can't
also press the field. `window.openmarchPreview.hold(beat)` (Playwright
sessions only, at the bottom of `TimelineSelectionStore.ts`) cues the beat
while paused. `src/utilities/playwrightSession.ts` is the shared check (the
collisions hook uses it too).

**Scenarios** (Fabric first, then unchanged on the new field):
`timeline-interactions.spec.mts` (the kept-mark tooltip's delay, the 1.5×
dot-radius hit, the mark beside the dot, no tooltip while a button is down,
hidden on press and on leaving the field; Escape with marchers selected, with
the line tool on, with a dialog open; the line-tool `change:`) and
`paused-preview.spec.mts` (a click and a drag after a held preview). Shared
timeline steps (`goToPage`, `isolate`, `emptyField`) moved to
`e2e/browser/timeline.mts`. Escape during a clip gesture has no scenario: the
demo shows' moves are page moves, which have no clip, and the rule is the
timeline's alone (`TimelineClipResize.test.tsx` pins it).

**Fabric bug found, not fixed (freeze):** the kept-mark tooltip stays up when
the pointer leaves the field over the grid. Fabric's `mouse:out` names the
object last under the pointer (the field grid, or a marcher), and
`useTimelineKeptMarks` hides only when there is none. The scenario is
`test.fail` on Fabric; the new field hides it when the pointer leaves its element. On the #208
list.
