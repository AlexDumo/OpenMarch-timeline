import tolgee from "@/global/singletons/Tolgee";
import type { QueryClient } from "@tanstack/react-query";
import type { XY } from "../types";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    planCanvasEdit,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { writePlacement } from "../tool/shapePlacement";
import { liveTargets } from "./liveBox";
import type { PlacedBox } from "./placedBox";

/** Whether two recipe params say the same, whatever their key order (keys set to undefined are left out) */
export function sameParams(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const entries = (o: object) =>
        Object.entries(o).filter(([, v]) => v !== undefined);
    const ea = entries(a);
    const eb = new Map(entries(b));
    return (
        ea.length === eb.size &&
        ea.every(([k, v]) => eb.has(k) && sameParams(v, eb.get(k)))
    );
}

/**
 * Whether `plan` edits only a page `box` is carried onto: its whole window is past the box's own
 * move. A window reaching back over that move (Expert's start flag left on an earlier page) isn't
 */
export function carriedOnto(plan: CanvasEditPlan, box: PlacedBox): boolean {
    if (!plan.ok) return false;
    const { target } = plan;
    const start =
        target.kind === "range"
            ? target.start
            : target.kind === "point"
              ? target.box.start
              : plan.beat;
    return plan.beat > box.endBeat + 1e-9 && start >= box.endBeat - 1e-9;
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
    const next = { ...(params as object), spots };
    await writePlacement(
        {
            recipe: {
                ...box.recipe,
                params: next,
                // Drill order is gone (#429); the column stays for older files
                orderMode: "nearest",
            },
            members: targets,
            replaces: box.recipe,
            // Changed on a later page it's carried onto: that page gets its own copy, even when
            // nobody moves (a pivot change), and the earlier page keeps its own
            setAll:
                carriedOnto(planCanvasEdit(), box) &&
                !sameParams(next, box.recipe.params),
        },
        queryClient,
        tolgee.t("shapes.placed.editError", "Error editing the shape"),
    );
}
