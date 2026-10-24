import { NUDGE_ACTION_IDS } from "@/shortcuts/definitions";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { changeFiles, type BoxParams } from "../box/boxGeometry";
import { toolEnvFor } from "./toolEnv";
import { cancelGesture, edit, redo, undo } from "./toolMachine";
import {
    closeShapeTool,
    updateTool,
    useShapeToolStore,
} from "./shapeToolStore";

/** Adds `delta` files to the open box, as one undo step */
export function stepFiles(delta: number): void {
    const field = currentShapeField();
    if (!field) return;
    updateTool((tool) => {
        if (tool.params === null || tool.gesture) return tool;
        const env = toolEnvFor(field, { shift: false, alt: false });
        const params = changeFiles(
            tool.params as BoxParams,
            tool.marchers.length,
            delta,
            env,
        );
        return edit(tool, params, shapeContextFor(field));
    });
}

/**
 * The keys the open shape tool takes over. Mounted only while it's open, after the editor's own
 * handlers, so these sit on top of them and the keys go back once the tool closes.
 *
 * - Escape: a gesture goes back to where it started; otherwise the tool closes, placing nothing.
 * - Undo and Redo step through the shape's own edits; the show is untouched until Place.
 * - The nudge keys do nothing, rather than move the marchers under the shape.
 */
export function ShapeToolKeys(): null {
    useActionHandler("cancelAlignmentUpdates", () => {
        const { tool } = useShapeToolStore.getState();
        if (tool?.gesture) updateTool(cancelGesture);
        else closeShapeTool();
    });
    useActionHandler("performUndo", () => updateTool(undo));
    useActionHandler("performRedo", () => updateTool(redo));
    useActionHandlerGroup(NUDGE_ACTION_IDS, () => {});
    return null;
}
