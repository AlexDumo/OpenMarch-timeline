import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { historyKeys } from "@/hooks/queries/useHistory";
import { db } from "@/global/database/db";
import { saveShapeRecipeInTransaction } from "@/db-functions/shapeRecipes";
import { transformMarchersInSelection } from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { boxTool } from "../box/boxTool";
import { openTool, targetsOf } from "./toolMachine";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "./shapeToolStore";

/**
 * Places the tool's marchers on its shape as one edit, through the same path as a canvas drag
 * (they leave the start flag and arrive at the playhead), then closes the tool. The shape's
 * recipe is saved in the same edit (ADR 0006).
 */
export function useApplyShape(): () => Promise<void> {
    const queryClient = useQueryClient();
    return useCallback(async () => {
        const field = currentShapeField();
        const { tool } = useShapeToolStore.getState();
        if (!field || !tool || tool.gesture || tool.params === null) return;
        const targets = targetsOf(tool, shapeContextFor(field));
        if (targets.length === 0) return;
        const to = new Map(targets.map((t) => [t.id, t.to]));
        const transform = (current: readonly { marcher_id: number }[]) =>
            current.flatMap((c) => {
                const spot = to.get(c.marcher_id);
                return spot
                    ? [{ marcher_id: c.marcher_id, x: spot.x, y: spot.y }]
                    : [];
            });
        const kind = tool.kind.shape;
        try {
            await transformMarchersInSelection({
                db,
                marcherIds: tool.marchers.map((m) => m.id),
                transform,
                writesShapes: true,
                afterWrite: async (tx, timelineId) => {
                    await saveShapeRecipeInTransaction({
                        tx,
                        timelineId,
                        recipe: {
                            kind: kind.id,
                            kindVersion: kind.version,
                            // The spot count keeps holes when members leave later
                            params: {
                                ...(tool.params as object),
                                spots: targets.length,
                            },
                            orderMode: tool.order,
                            reverse: false,
                        },
                        members: targets.map((t) => ({
                            marcherId: t.id,
                            slot: t.slot,
                            x: t.to.x,
                            y: t.to.y,
                        })),
                    });
                },
            });
        } catch (e) {
            toastTimelineError(e, "Error placing the shape");
            return;
        }
        // Not a React Query mutation, so refresh what one would
        void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
        closeShapeTool();
    }, [queryClient]);
}

/** Opens the box tool on the selected marchers */
export function useOpenBoxTool(): () => void {
    const { selectedMarchers } = useEditorReadiness();
    return useCallback(() => {
        const field = currentShapeField();
        if (!field || selectedMarchers.length === 0) return;
        const ids = selectedMarchers.map((m) => m.id);
        openShapeTool(openTool(boxTool, marchersOnField(field, ids)));
    }, [selectedMarchers]);
}

/** Opens and places the shape tool from shortcuts, buttons and the command palette */
export function useShapeToolActions(): void {
    const { ready, selectedMarchers } = useEditorReadiness();
    const placeable = useShapeToolStore(
        (s) => s.tool !== null && s.tool.params !== null && !s.tool.gesture,
    );
    const apply = useApplyShape();
    const openBox = useOpenBoxTool();

    useActionHandler("shapeBlock", openBox, {
        enabled: ready && selectedMarchers.length > 0,
    });
    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        { enabled: placeable },
    );
}
