import { create } from "zustand";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import type { ToolState } from "./toolMachine";
import { isAwayFrom, momentOf, type ShapeMoment } from "./shapeMoment";

/**
 * The open shape tool, if any. Every change goes through the pure functions in `toolMachine.ts`;
 * this store only holds the result so the canvas, the readout and the keys see the same state.
 *
 * `openedAt` is what the edit window was when the tool opened: the shape is placed there, even
 * from another moment (`shapeLeave.ts`). `moment` is where the timeline was then (#416): away
 * from it the shape is hidden behind a chip that goes back. `discarded` is the shape Escape just
 * threw away, which undo can still bring back.
 */
export const useShapeToolStore = create<{
    tool: ToolState | null;
    openedAt: CanvasEditPlan | null;
    moment: ShapeMoment | null;
    discarded: OpenShape | null;
}>(() => ({ tool: null, openedAt: null, moment: null, discarded: null }));

/** A shape tool, the edit window it opened at and the moment it belongs to */
export interface OpenShape {
    readonly tool: ToolState;
    readonly openedAt: CanvasEditPlan | null;
    readonly moment: ShapeMoment | null;
}

/** Applies `change` to the open tool; nothing happens when it's closed */
export function updateTool(change: (tool: ToolState) => ToolState): void {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return;
    const next = change(tool);
    if (next !== tool) useShapeToolStore.setState({ tool: next });
}

/** Opens `tool` at the moment now; a discarded shape can't come back once another one opens */
export function openShapeTool(
    tool: ToolState,
    openedAt: CanvasEditPlan | null,
    moment: ShapeMoment | null = momentOf(),
): void {
    useShapeToolStore.setState({ tool, openedAt, moment, discarded: null });
}

export function closeShapeTool(): void {
    if (useShapeToolStore.getState().tool)
        useShapeToolStore.setState({
            tool: null,
            openedAt: null,
            moment: null,
        });
}

/** Whether a shape is open and the timeline is away from its moment (#416) */
export function isShapeAway(): boolean {
    const { tool, moment } = useShapeToolStore.getState();
    return tool !== null && isAwayFrom(moment);
}

/** {@link isShapeAway} for components: true while the open shape's moment is somewhere else */
export function useShapeAway(): boolean {
    const moment = useShapeToolStore((s) => (s.tool ? s.moment : null));
    const key = useTimelineSelectionStore((s) => momentOf(s).key);
    return moment !== null && key !== moment.key;
}
