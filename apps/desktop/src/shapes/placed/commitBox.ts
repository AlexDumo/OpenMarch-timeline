import type { QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { saveShapeRecipeInTransaction } from "@/db-functions/shapeRecipes";
import { historyKeys } from "@/hooks/queries/useHistory";
import { transformMarchersInSelection } from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import type { OrderMode } from "../assign";
import type { BoxParams } from "../box/boxGeometry";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { liveTargets } from "./liveBox";
import type { PlacedBox } from "./placedBox";

/**
 * Saves a selected box drawn with `params`: its members move to their spots in it and its recipe
 * is saved, as one edit at the edit window (a canvas edit). A box held from an earlier move gets
 * its own copy on this one; the earlier one stays.
 */
export async function commitBox(
    box: PlacedBox,
    params: BoxParams,
    queryClient: QueryClient,
    /** Lay the members out again in this order (the editor's Least travel / Drill order) */
    order?: OrderMode,
): Promise<void> {
    const field = currentShapeField();
    if (!field) return;
    const { members: targets, spots } = liveTargets(
        box,
        params,
        shapeContextFor(field),
        order,
    );
    const to = new Map(targets.map((t) => [t.marcherId, t]));
    try {
        await transformMarchersInSelection({
            db,
            marcherIds: targets.map((t) => t.marcherId),
            transform: (current) =>
                current.flatMap((c) => {
                    const t = to.get(c.marcher_id);
                    return t
                        ? [{ marcher_id: c.marcher_id, x: t.x, y: t.y }]
                        : [];
                }),
            writesShapes: true,
            afterWrite: async (tx, timelineId) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: {
                        ...box.recipe,
                        params: { ...params, spots },
                        ...(order ? { orderMode: order } : {}),
                    },
                    members: targets,
                    replaces:
                        box.recipe.timelineId === timelineId
                            ? box.recipe.id
                            : undefined,
                });
            },
        });
    } catch (e) {
        toastTimelineError(e, "Error editing the box");
        return;
    }
    // Not a React Query mutation, so refresh what one would
    void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
}
