import type { QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import {
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { historyKeys } from "@/hooks/queries/useHistory";
import {
    transformMarchersInSelection,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import type { ShapeContext } from "../types";
import { targetsOf, type ToolState } from "./toolMachine";

/**
 * What placing a shape writes: its recipe, and where each member stands in it (ADR 0006). Spots
 * and who goes where are separate: `recipe.params.spots` counts the spots, `members` says who
 * stands on which.
 */
export interface ShapePlacement {
    readonly recipe: ShapeRecipeRecord;
    readonly members: readonly ShapeRecipeMember[];
    /**
     * The recipe this placement edits (a placed shape changed again): replaced when it belongs to
     * the move being written, kept as the earlier move's own otherwise
     */
    readonly replaces?: {
        readonly id: number;
        readonly timelineId: number | null;
    };
}

/** What placing the open shape would write; null while there is nothing to place */
export function placementOf(
    tool: ToolState,
    ctx: ShapeContext,
): ShapePlacement | null {
    if (tool.gesture || tool.params === null) return null;
    const targets = targetsOf(tool, ctx);
    if (targets.length === 0) return null;
    const kind = tool.kind.shape;
    return {
        recipe: {
            kind: kind.id,
            kindVersion: kind.version,
            // The spot count keeps holes when members leave later
            params: { ...(tool.params as object), spots: tool.spots },
            // Drill order is gone (#429); the column stays for older files
            orderMode: "nearest",
            reverse: false,
        },
        members: targets.map((t) => ({
            marcherId: t.id,
            slot: t.slot,
            x: t.to.x,
            y: t.to.y,
        })),
    };
}

/**
 * Writes a placement: the one write behind every shape placed (#344), a new one (`placeShape`)
 * or an edit of a placed one (`commitBox`). Its members move to their spots through the same path as a canvas drag (they
 * leave the start flag and arrive at the playhead), and the recipe is saved in the same edit, so
 * the two are one undo step. False when the write failed (a toast says why).
 */
export async function writePlacement(
    placement: ShapePlacement,
    queryClient: QueryClient,
    /** The toast's title if the write fails */
    failure: string,
    /**
     * The edit window to write to, the current one unless given: a shape placed because the
     * moment moved on goes where it was drawn, and the playhead stays where it was moved to
     */
    plan: CanvasEditPlan | null = null,
): Promise<boolean> {
    const { members, replaces } = placement;
    const to = new Map(members.map((m) => [m.marcherId, m]));
    try {
        await transformMarchersInSelection({
            db,
            marcherIds: members.map((m) => m.marcherId),
            transform: (current) =>
                current.flatMap((c) => {
                    const spot = to.get(c.marcher_id);
                    return spot
                        ? [{ marcher_id: c.marcher_id, x: spot.x, y: spot.y }]
                        : [];
                }),
            ...(plan ? { plan, keepPlayhead: true } : {}),
            writesShapes: true,
            afterWrite: async (tx, timelineId) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: placement.recipe,
                    members,
                    replaces:
                        replaces && replaces.timelineId === timelineId
                            ? replaces.id
                            : undefined,
                });
            },
        });
    } catch (e) {
        toastTimelineError(e, failure);
        return false;
    }
    // Not a React Query mutation, so refresh what one would
    void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
    return true;
}
