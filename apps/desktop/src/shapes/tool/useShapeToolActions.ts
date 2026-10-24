import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { placementOf, writePlacement } from "./shapePlacement";
import { kindPickGate, pickShapeKind } from "./pickKind";
import { SHAPE_TOOLS } from "./shapeTools";
import type { ToolState } from "./toolMachine";
import { useShapePaletteSource } from "../command/useShapePaletteSource";
import { keepSavedShapeInShow } from "../library/saveShape";
import { leaveShapeTool } from "./shapeLeave";
import { closeShapeTool, useShapeToolStore } from "./shapeToolStore";

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
    const placed = await writePlacement(
        placement,
        queryClient,
        "Error placing the shape",
        plan,
    );
    // A show that uses a saved shape keeps a copy of it (#353)
    if (placed) await keepSavedShapeInShow(tool.kind, queryClient);
    return placed;
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

/** Opens and places the shape tool from shortcuts, buttons and the command palette */
export function useShapeToolActions(): void {
    const { ready, selectedPerformers } = useEditorReadiness();
    const placeable = useShapeToolStore(
        (s) => s.tool !== null && s.tool.params !== null && !s.tool.gesture,
    );
    const apply = useApplyShape();
    const shapeOpen = useShapeToolStore((s) => s.tool !== null);
    useShapePaletteSource(ready, selectedPerformers, apply);

    // A kind's key arms it, or turns the open shape into it
    useActionHandlerGroup(
        SHAPE_TOOLS.map((entry) => entry.action),
        (id) => {
            const entry = SHAPE_TOOLS.find((e) => e.action === id);
            if (entry) pickShapeKind(entry.kind, selectedPerformers);
        },
        { enabled: ready && kindPickGate(shapeOpen, selectedPerformers).ok },
    );
    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        { enabled: placeable },
    );
}
