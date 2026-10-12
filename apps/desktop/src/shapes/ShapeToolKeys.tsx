import { NUDGE_ACTION_IDS, type NudgeArgs } from "@/shortcuts/definitions";
import { resolveNudgeDistance } from "@/shortcuts/nudge";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { currentCanvas, shapeContextFor } from "./canvas/shapeCanvasContext";
import { useShapeToolStore } from "./shapeToolStore";
import { offerBringBack } from "./canvas/unplacedToast";

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
 * - Undo and Redo step through the shape's own edits.
 */
export function ShapeToolKeys(): null {
    useActionHandler("cancelAlignmentUpdates", () => {
        const store = useShapeToolStore.getState();
        if (store.dragging) {
            store.cancelDrag();
            return;
        }
        // Escape while bending a just-drawn arc keeps the bend it has
        if (store.bending) {
            store.endBend();
            return;
        }
        // Escape in the toolbar's tabs (the View ribbon) leaves the toolbar, not the shape (sims,
        // round 13: closing the View menu threw away the block)
        const focused = document.activeElement;
        if (
            focused instanceof HTMLElement &&
            focused.closest('[role="tablist"], [role="tabpanel"]')
        ) {
            focused.blur();
            return;
        }
        // A way back, in case the Escape was meant for something else (sims, round 12: Escape
        // closing a settings panel also dropped the shape)
        const left = store.session;
        store.close();
        if (left) offerBringBack(left);
    });

    // Undo and Redo step through the shape's edits while it's open; the show is untouched until
    // Place, so its own history would undo something else (the last placed shape)
    useActionHandler("performUndo", () => useShapeToolStore.getState().undo());
    useActionHandler("performRedo", () => useShapeToolStore.getState().redo());

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
