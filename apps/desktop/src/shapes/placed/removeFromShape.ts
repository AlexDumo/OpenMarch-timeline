import type { QueryClient } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { writePlacement } from "../tool/shapePlacement";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext } from "../types";
import { carriedOnto } from "./commitBox";
import { liveTargets } from "./liveBox";
import { closedUpParams, type PlacedBox, type StoredParams } from "./placedBox";

/**
 * **Remove from shape** (ADR 0006 revision of 2026-11-22, §9.1): takes members whose spots are
 * open out of a placed shape, spots and all. The shape deals its spots again for the members
 * left, as placing it with that many marchers does: a closed kind in its mode and settings (as
 * Close up has it), an open one (a line, an arc) with its spots spread again along it, each
 * member by least travel. Members on their spots move to their new ones; members still away keep
 * their own timing and are only listed on theirs. One undo step.
 */

/** What removing `marcherIds` from `box` saves: null when none of them has a spot in it, or no one is left */
export function removedFromShape(
    box: PlacedBox,
    marcherIds: Iterable<number>,
    env: ToolEnv,
    ctx: ShapeContext,
): {
    readonly params: StoredParams;
    readonly members: {
        marcherId: number;
        slot: number;
        x: number;
        y: number;
    }[];
    readonly spots: number;
} | null {
    const gone = new Set(marcherIds);
    // Only open spots are taken out: a member on its spot is dragged off it instead
    const removed = box.open.filter((o) => gone.has(o.marcherId));
    if (removed.length === 0) return null;
    const left = box.recipe.members.filter((m) => !gone.has(m.marcherId));
    if (left.length === 0) return null;
    const n = left.length;
    const params = closedUpParams(box, n, env) ?? box.params;
    const fewer: PlacedBox = {
        ...box,
        spots: n,
        recipe: { ...box.recipe, members: left },
    };
    const out = liveTargets(fewer, params, ctx, true, undefined, "nearest");
    return {
        params: { ...(params as object), spots: out.spots },
        members: out.members,
        spots: out.spots,
    };
}

/**
 * Removes `marcherIds` from `box` at the edit window `plan`: its recipe saved without them, as one
 * edit with its members' new spots. At a count it's only carried onto, that count gets its own
 * mark of the shape, as any edit there does; the earlier mark keeps them. False when nothing was
 * written.
 */
export async function writeRemoveFromShape({
    box,
    marcherIds,
    env,
    ctx,
    queryClient,
    plan,
}: {
    box: PlacedBox;
    marcherIds: Iterable<number>;
    env: ToolEnv;
    ctx: ShapeContext;
    queryClient: QueryClient;
    plan: CanvasEditPlan;
}): Promise<boolean> {
    const out = removedFromShape(box, marcherIds, env, ctx);
    if (!out) return false;
    const away = new Set(
        box.open.filter((o) => !o.taken).map((o) => o.marcherId),
    );
    return writePlacement(
        {
            recipe: { ...box.recipe, params: out.params },
            members: out.members,
            replaces: box.recipe,
            setAll: carriedOnto(plan, box),
            listedOnly: away,
        },
        queryClient,
        tolgee.t(
            "shapes.placed.removeFromShape.error",
            "Couldn't remove the marcher from the shape",
        ),
        plan,
    );
}
