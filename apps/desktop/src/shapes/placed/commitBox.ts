import type { QueryClient } from "@tanstack/react-query";
import type { XY } from "../types";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { writePlacement } from "../tool/shapePlacement";
import { liveTargets } from "./liveBox";
import type { PlacedBox } from "./placedBox";

/**
 * Saves a selected placed shape drawn with `params` through `writePlacement`: its members move to
 * their spots in it and its recipe is saved, as one edit at the edit window (a canvas edit). A
 * shape held from an earlier move gets its own copy on this one; the earlier one stays.
 */
export async function commitBox(
    box: PlacedBox,
    params: unknown,
    queryClient: QueryClient,
    /** Lay the members out again by least travel (Recalculate, Close up) */
    layOutAgain?: boolean,
    /** Where members come from when laid out again (Recalculate: the start flag) */
    origins?: ReadonlyMap<number, XY>,
): Promise<void> {
    const field = currentShapeField();
    if (!field) return;
    const { members: targets, spots } = liveTargets(
        box,
        params,
        shapeContextFor(field),
        layOutAgain,
        origins,
    );
    await writePlacement(
        {
            recipe: {
                ...box.recipe,
                params: { ...(params as object), spots },
                // Drill order is gone (#429); the column stays for older files
                orderMode: "nearest",
            },
            members: targets,
            replaces: box.recipe,
        },
        queryClient,
        "Error editing the shape",
    );
}
