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
import {
    closeShapeTool,
    isShapeHidden,
    useShapeHidden,
    useShapeShown,
    useShapeToolStore,
} from "./shapeToolStore";

/**
 * The host's place function (spec #344): every open shape is placed through here, by Place
 * (Enter) and nothing else (#416). Its marchers go to their spots and its
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
        if (!tool || isShapeHidden()) return;
        if (await placeShape(tool, queryClient)) closeShapeTool();
    }, [queryClient]);
}

/** Opens and places the shape tool from shortcuts, buttons and the command palette */
export function useShapeToolActions(): void {
    const { ready, selectedPerformers } = useEditorReadiness();
    const placeable = useShapeToolStore(
        (s) => s.tool !== null && s.tool.params !== null && !s.tool.gesture,
    );
    const apply = useApplyShape();
    const hidden = useShapeHidden();
    const shown = useShapeShown();
    useShapePaletteSource(ready, selectedPerformers, apply);

    // A kind's key arms it, or turns the open shape into it
    useActionHandlerGroup(
        SHAPE_TOOLS.map((entry) => entry.action),
        (id) => {
            const entry = SHAPE_TOOLS.find((e) => e.action === id);
            if (entry) pickShapeKind(entry.kind, selectedPerformers);
        },
        { enabled: ready && kindPickGate(shown, selectedPerformers).ok },
    );
    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        // A shape waiting out of sight isn't placed by a key: Enter acts on what is shown (#416)
        { enabled: placeable && !hidden },
    );
}
