import { NUDGE_ACTION_IDS, type NudgeArgs } from "@/shortcuts/definitions";
import { resolveNudgeDistance } from "@/shortcuts/nudge";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { currentCanvas, shapeContextFor } from "./canvas/shapeCanvasContext";
import { useShapeToolStore } from "./shapeToolStore";

const NUDGE_DELTA = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
} as const;

/**
 * The keys the open shape tool takes over. Mounted only while a session is open, after the
 * editor's own handlers, so these sit on top of them and the keys go back once the tool closes.
 *
 * - Escape ("Cancel or deselect"): a drag goes back to where it started, otherwise the tool closes
 *   and the marchers stay selected.
 * - The nudge keys move the shape, not the marchers, by the same distances.
 */
export function ShapeToolKeys(): null {
    useActionHandler("cancelAlignmentUpdates", () => {
        const store = useShapeToolStore.getState();
        if (store.dragging) store.cancelDrag();
        else store.close();
    });

    useActionHandlerGroup(NUDGE_ACTION_IDS, (_id, args) => {
        const canvas = currentCanvas();
        if (!canvas || !args) return;
        const nudge = args as unknown as NudgeArgs;
        const steps = resolveNudgeDistance(
            nudge,
            canvas.uiSettings.coordinateRounding ?? {},
        );
        const unit = NUDGE_DELTA[nudge.direction];
        const px = steps * canvas.fieldProperties.pixelsPerStep;
        useShapeToolStore
            .getState()
            .nudge(
                { x: unit.x * px, y: unit.y * px },
                shapeContextFor(canvas, nudge.snap),
            );
    });
    return null;
}
