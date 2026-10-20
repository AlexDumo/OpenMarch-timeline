import type { QueryClient } from "@tanstack/react-query";
import type { OrderMode } from "../assign";
import { filesOf, type BoxParams } from "../box/boxGeometry";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { writePlacement } from "../tool/shapePlacement";
import { liveTargets } from "./liveBox";
import type { PlacedBox } from "./placedBox";

/**
 * How the box's members are laid out after an edit: the order picked, or "kept" when a turn or
 * flip kept everyone on their own spot (so it's neither Least travel nor Drill order any more),
 * or as it was
 */
function orderAfter(
    box: PlacedBox,
    params: BoxParams,
    order: OrderMode | undefined,
): string {
    if (order) return order;
    const turned =
        params.rotation !== box.params.rotation ||
        (params.flipX ?? false) !== (box.params.flipX ?? false) ||
        (params.flipY ?? false) !== (box.params.flipY ?? false);
    return turned && filesOf(params) === filesOf(box.params)
        ? "kept"
        : box.recipe.orderMode;
}

/**
 * Saves a selected box drawn with `params` through `writePlacement`: its members move to their spots
 * in it and its recipe is saved, as one edit at the edit window (a canvas edit). A box held from
 * an earlier move gets its own copy on this one; the earlier one stays.
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
    await writePlacement(
        {
            recipe: {
                ...box.recipe,
                params: { ...params, spots },
                orderMode: orderAfter(box, params, order),
            },
            members: targets,
            replaces: box.recipe,
        },
        queryClient,
        "Error editing the box",
    );
}
