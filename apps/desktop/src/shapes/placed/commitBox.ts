import type { QueryClient } from "@tanstack/react-query";
import type { OrderMode } from "../assign";
import type { XY } from "../types";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { writePlacement } from "../tool/shapePlacement";
import { liveTargets, newLayout } from "./liveBox";
import type { PlacedBox } from "./placedBox";

/**
 * How the shape's members are laid out after an edit: the order picked, or "kept" when a turn or
 * flip kept everyone on their own spot (so it's neither Least travel nor Drill order any more),
 * or as it was
 */
export function orderAfter(
    box: PlacedBox,
    params: unknown,
    order: OrderMode | undefined,
): string {
    if (order) return order;
    const was = box.kind.frameOf(box.params, box.spots);
    const now = box.kind.frameOf(params, box.spots);
    const turned =
        now.rotation !== was.rotation ||
        now.flipX !== was.flipX ||
        now.flipY !== was.flipY;
    return turned && !newLayout(box, params) ? "kept" : box.recipe.orderMode;
}

/**
 * Saves a selected placed shape drawn with `params` through `writePlacement`: its members move to
 * their spots in it and its recipe is saved, as one edit at the edit window (a canvas edit). A
 * shape held from an earlier move gets its own copy on this one; the earlier one stays.
 */
export async function commitBox(
    box: PlacedBox,
    params: unknown,
    queryClient: QueryClient,
    /** Lay the members out again in this order (Recalculate, Close up) */
    order?: OrderMode,
    /** Where members come from when laid out again (Recalculate: the start flag) */
    origins?: ReadonlyMap<number, XY>,
): Promise<void> {
    const field = currentShapeField();
    if (!field) return;
    const { members: targets, spots } = liveTargets(
        box,
        params,
        shapeContextFor(field),
        order,
        origins,
    );
    await writePlacement(
        {
            recipe: {
                ...box.recipe,
                params: { ...(params as object), spots },
                orderMode: orderAfter(box, params, order),
            },
            members: targets,
            replaces: box.recipe,
        },
        queryClient,
        "Error editing the shape",
    );
}
