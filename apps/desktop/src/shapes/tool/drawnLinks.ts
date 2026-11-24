import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import type { LineParams } from "../line/lineGeometry";
import { placedBoxesAt } from "../placed/placedBoxStore";
import { keepDrawnAttach, linksKind } from "../placed/shapeLinks";
import type { ToolState } from "./toolMachine";

/**
 * Linking a new Line, Curve or Arc to a placed one while it's drawn (#1235): the shape tool's
 * field mode snaps its ends onto placed shapes' free ends (`shapeToolMode.ts`), and every change
 * to the open shape keeps only the attachments still on their joint ({@link keepToolLinks}), so
 * what Place writes links exactly as a link made after placing.
 */

/** The beat the open shape will be placed at: its edit window's, else the playhead's */
export function toolBeat(openedAt: CanvasEditPlan | null): number {
    return openedAt?.ok
        ? openedAt.beat
        : displayedBeat(useTimelineSelectionStore.getState());
}

/**
 * `tool` with only the attachments its shape will link with once placed at `beat`: each end
 * still on the free end of a placed shape it names (`keepDrawnAttach`). The same state when that
 * changes nothing.
 */
export function keepToolLinks(tool: ToolState, beat: number): ToolState {
    if (tool.params === null || !linksKind(tool.kind)) return tool;
    const p = tool.params as LineParams;
    if (!p.attach) return tool;
    const kept = keepDrawnAttach(p, placedBoxesAt(beat), beat);
    return kept === p ? tool : { ...tool, params: kept };
}
