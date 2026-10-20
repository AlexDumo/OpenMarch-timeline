import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { historyKeys } from "@/hooks/queries/useHistory";
import { db } from "@/global/database/db";
import { saveShapeRecipeInTransaction } from "@/db-functions/shapeRecipes";
import {
    planCanvasEdit,
    transformMarchersInSelection,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { boxTool } from "../box/boxTool";
import { openTool, targetsOf, type ToolState } from "./toolMachine";
import { leaveShapeTool } from "./shapeLeave";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "./shapeToolStore";

/**
 * The host's place function (spec #344): every shape is placed through here, whether by Place
 * (Enter) or by leaving it open (`shapeLeave.ts`). The tool's marchers go to their spots as one
 * edit, through the same path as a canvas drag (they leave the start flag and arrive at the
 * playhead), and the shape's recipe is saved in the same edit (ADR 0006). `plan` is the edit
 * window to write to, the current one unless given. Resolves false when nothing was placed.
 */
export async function placeShape(
    tool: ToolState,
    queryClient: QueryClient,
    plan: CanvasEditPlan | null = null,
): Promise<boolean> {
    const field = currentShapeField();
    if (!field || tool.gesture || tool.params === null) return false;
    const targets = targetsOf(tool, shapeContextFor(field));
    if (targets.length === 0) return false;
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
            ...(plan
                ? // Placed on leaving: the playhead stays where it was moved to
                  { plan, keepPlayhead: true }
                : {}),
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
                        orderMode: tool.kept ? "kept" : tool.order,
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
        return false;
    }
    // Not a React Query mutation, so refresh what one would
    void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
    return true;
}

/** Place (Enter): places the open shape at the edit window now, then closes the tool */
export function useApplyShape(): () => Promise<void> {
    const queryClient = useQueryClient();
    return useCallback(async () => {
        const { tool } = useShapeToolStore.getState();
        if (!tool) return;
        if (await placeShape(tool, queryClient)) closeShapeTool();
    }, [queryClient]);
}

/** Leaving the open shape (a scrub, a selection change): placed where it was drawn */
export function useLeaveShapeTool(): () => void {
    const queryClient = useQueryClient();
    return useCallback(
        () =>
            leaveShapeTool(async (tool, openedAt) => {
                await placeShape(tool, queryClient, openedAt);
            }),
        [queryClient],
    );
}

/** Opens the box tool on the selected performers: a selected prop takes no spot (C2.2) */
export function useOpenBoxTool(): () => void {
    const { selectedPerformers } = useEditorReadiness();
    return useCallback(() => {
        const field = currentShapeField();
        if (!field || selectedPerformers.length === 0) return;
        const ids = selectedPerformers.map((m) => m.id);
        openShapeTool(
            openTool(boxTool, marchersOnField(field, ids)),
            planCanvasEdit(),
        );
    }, [selectedPerformers]);
}

/** Opens and places the shape tool from shortcuts, buttons and the command palette */
export function useShapeToolActions(): void {
    const { ready, selectedPerformers } = useEditorReadiness();
    const placeable = useShapeToolStore(
        (s) => s.tool !== null && s.tool.params !== null && !s.tool.gesture,
    );
    const apply = useApplyShape();
    const openBox = useOpenBoxTool();

    useActionHandler("shapeBlock", openBox, {
        enabled: ready && selectedPerformers.length > 0,
    });
    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        { enabled: placeable },
    );
}
