import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
    planCanvasEdit,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { boxTool } from "../box/boxTool";
import { placementOf, writePlacement } from "./shapePlacement";
import { shapeSelectionGate } from "./selectionGate";
import { openTool, type ToolState } from "./toolMachine";
import { leaveShapeTool } from "./shapeLeave";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "./shapeToolStore";

/**
 * The host's place function (spec #344): every open shape is placed through here, whether by
 * Place (Enter) or by leaving it open (`shapeLeave.ts`). Its marchers go to their spots and its
 * recipe is saved as one edit (`writePlacement`, the same write a placed shape's edits use).
 * `plan` is the edit window to write to, the current one unless given. Resolves false when
 * nothing was placed.
 */
export async function placeShape(
    tool: ToolState,
    queryClient: QueryClient,
    plan: CanvasEditPlan | null = null,
): Promise<boolean> {
    const field = currentShapeField();
    if (!field) return false;
    const placement = placementOf(tool, shapeContextFor(field));
    if (!placement) return false;
    return writePlacement(
        placement,
        queryClient,
        "Error placing the shape",
        plan,
    );
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

/** Opens the box tool on the selected performers, if the selection gate lets it */
export function useOpenBoxTool(): () => void {
    const { selectedPerformers } = useEditorReadiness();
    return useCallback(() => {
        const field = currentShapeField();
        const gate = shapeSelectionGate(selectedPerformers);
        if (!field || !gate.ok) return;
        openShapeTool(
            openTool(boxTool, marchersOnField(field, gate.ids)),
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
        enabled: ready && shapeSelectionGate(selectedPerformers).ok,
    });
    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        { enabled: placeable },
    );
}
