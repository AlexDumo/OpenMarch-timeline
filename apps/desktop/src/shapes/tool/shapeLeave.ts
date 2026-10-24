import { cancelGesture } from "./toolMachine";
import {
    closeShapeTool,
    useShapeToolStore,
    type OpenShape,
} from "./shapeToolStore";

/**
 * How an open shape ends without Enter (spec #344, "Leaving"):
 *
 * - The group moves on or the show plays (a selection change, playback, Visuals, isolating a
 *   move): the shape is placed where it was drawn, as one undo step, with no toast. Nothing
 *   drawn is lost. Moving around the timeline doesn't end it (#416, `shapeMoment.ts`).
 * - Escape: the shape is discarded, and that is an undo step of its own: undo right after it
 *   brings the shape back with its numbers, who goes where and its own history.
 *
 * Placing itself is the host's place function, passed in.
 */

/** Places `tool` at the edit window it opened at */
export type PlaceShape = (
    tool: OpenShape["tool"],
    openedAt: OpenShape["openedAt"],
) => Promise<void>;

/** Closes the open tool and places its shape, if one was drawn; a drag under way is dropped */
export function leaveShapeTool(place: PlaceShape): void {
    const { tool, openedAt } = useShapeToolStore.getState();
    if (!tool) return;
    closeShapeTool();
    const settled = cancelGesture(tool);
    if (settled.params !== null) void place(settled, openedAt);
}

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
