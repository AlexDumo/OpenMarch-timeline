# Phase 5: Parity gate and switch

## Tickets

- **#208 Parity gate run.** The full gate from
  [the plan](../implementation-plan.md#parity-gate): the scenario suite on
  both drivers, render comparisons across the corpus, export diffs, the
  in-app benchmark on a real low-end Chromebook and an integrated-GPU laptop,
  and the owner's hands-on checklist in a lab build. Needs the owner.
- **#209 Switch to the new field and delete Fabric.** The new field becomes
  the only field. Deletes Fabric, its speed workarounds and unit tests, the
  Fabric driver of the field test API and the dev switch. There's no rollback
  setting. Merging needs the owner's explicit OK. Features still in
  progress on Fabric aren't ported; they follow
  [the porting guide](../porting-fabric-features.md) after the switch.

## Exit gate

#209 merged. The field freeze ends: remove the freeze notes from
`apps/desktop/AGENTS.md`, `apps/desktop/src/components/canvas/README.md`
and [the README](../README.md).

## Handoff notes

Append notes the next tickets need: file locations, seams, surprises.

**From #223 (undo/redo shortcuts dropped).** The undo and redo scenarios
(move-marchers "undo and redo a move", edit-positions' undo steps) failed
because the shortcut handler dropped presses, not because of the field. It
gated on the `canUndo`/`canRedo` queries, which refetch only after a write
commits, and on an in-flight flag that stayed set until the previous action's
queries were fetched again. A press right after an edit, or a redo right after an
undo, was ignored. Now presses queue in order (`historyPressQueue.ts`), and
`performHistoryAction` reports `nothingToDo` from inside its lock turn. For
#208: scenarios can press Ctrl+Z or Ctrl+Shift+Z as soon as the saved data
shows the previous step, with no wait for the history queries. On the new
field, move-marchers still fails at the drag until #196.

**From #239 (porting guide).** [porting-fabric-features.md](../porting-fabric-features.md)
maps Fabric seams to the new ones and lists the in-flight Fabric work with a
plan for each. For #209: P7.11's spec-shape handles (`useTimelineShapeCanvas.ts`,
`TimelineShapeOverlay.ts`, the inspector's `TimelineShapesEditor`) have no
port in any ticket, so deleting Fabric removes them unless the owner decides
otherwise (box v1 #181 deletes them too). Move the Fabric-free helpers out of
`global/classes/canvasObjects/` before deleting the folder
(`stepSizeWarning.ts`, see #201's notes). #182 mounts `TapTheBeatPanel` in
Fabric's `Canvas.tsx`; whichever of #182 and #209 lands second moves it
beside the field.
