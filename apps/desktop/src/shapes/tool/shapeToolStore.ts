import { create } from "zustand";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import type { ToolState } from "./toolMachine";

/**
 * The open shape tool, if any. Every change goes through the pure functions in `toolMachine.ts`;
 * this store only holds the result so the canvas, the readout and the keys see the same state.
 *
 * `openedAt` is what the edit window was when the tool opened: a shape placed because the moment
 * moved on (`shapeLeave.ts`) goes where it was drawn, not to the new moment. `discarded` is the
 * shape Escape just threw away, which undo can still bring back.
 */
export const useShapeToolStore = create<{
    tool: ToolState | null;
    openedAt: CanvasEditPlan | null;
    discarded: OpenShape | null;
}>(() => ({ tool: null, openedAt: null, discarded: null }));

/** A shape tool and the edit window it opened at */
export interface OpenShape {
    readonly tool: ToolState;
    readonly openedAt: CanvasEditPlan | null;
}

/** Applies `change` to the open tool; nothing happens when it's closed */
export function updateTool(change: (tool: ToolState) => ToolState): void {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return;
    const next = change(tool);
    if (next !== tool) useShapeToolStore.setState({ tool: next });
}

/** Opens `tool`; a discarded shape can't come back once another one opens */
export function openShapeTool(
    tool: ToolState,
    openedAt: CanvasEditPlan | null,
): void {
    useShapeToolStore.setState({ tool, openedAt, discarded: null });
}

export function closeShapeTool(): void {
    if (useShapeToolStore.getState().tool)
        useShapeToolStore.setState({ tool: null, openedAt: null });
}
