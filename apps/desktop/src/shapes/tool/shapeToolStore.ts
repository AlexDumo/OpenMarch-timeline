import { create } from "zustand";
import type { ToolState } from "./toolMachine";

/**
 * The open shape tool, if any. Every change goes through the pure functions in `toolMachine.ts`;
 * this store only holds the result so the canvas, the readout and the keys see the same state.
 */
export const useShapeToolStore = create<{ tool: ToolState | null }>(() => ({
    tool: null,
}));

/** Applies `change` to the open tool; nothing happens when it's closed */
export function updateTool(change: (tool: ToolState) => ToolState): void {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return;
    const next = change(tool);
    if (next !== tool) useShapeToolStore.setState({ tool: next });
}

export function openShapeTool(tool: ToolState): void {
    useShapeToolStore.setState({ tool });
}

export function closeShapeTool(): void {
    if (useShapeToolStore.getState().tool)
        useShapeToolStore.setState({ tool: null });
}
