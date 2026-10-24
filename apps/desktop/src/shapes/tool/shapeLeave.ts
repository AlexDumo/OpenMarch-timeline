import { cancelGesture } from "./toolMachine";
import { closeShapeTool, useShapeToolStore } from "./shapeToolStore";

/**
 * How an open shape ends without Enter (spec #344, "Leaving"; #416):
 *
 * - Nothing else places it. Moving around the timeline, playing, Visuals and a new selection
 *   leave it open; while it can't be seen it waits (`isShapeHidden`) and nothing acts on it.
 * - Escape: the shape is discarded, and that is an undo step of its own: undo right after it
 *   brings the shape back with its numbers, who goes where and its own history.
 */

/** Escape: closes the open tool, placing nothing, and keeps its shape for undo */
export function discardShapeTool(): void {
    const { tool, openedAt, moment } = useShapeToolStore.getState();
    if (!tool) return;
    closeShapeTool();
    const settled = cancelGesture(tool);
    if (settled.params !== null)
        useShapeToolStore.setState({
            discarded: { tool: settled, openedAt, moment },
        });
}

/** Whether undo now would bring back a discarded shape */
export function hasDiscardedShape(): boolean {
    return useShapeToolStore.getState().discarded !== null;
}

/** Undo after Escape: opens the discarded shape again. False when there is none to bring back */
export function restoreDiscardedShape(): boolean {
    const { discarded, tool } = useShapeToolStore.getState();
    if (!discarded || tool) return false;
    useShapeToolStore.setState({
        tool: discarded.tool,
        openedAt: discarded.openedAt,
        moment: discarded.moment,
        discarded: null,
    });
    return true;
}

/** Something else happened since Escape (an edit, a new moment): undo is the show's again */
export function forgetDiscardedShape(): void {
    if (hasDiscardedShape()) useShapeToolStore.setState({ discarded: null });
}
