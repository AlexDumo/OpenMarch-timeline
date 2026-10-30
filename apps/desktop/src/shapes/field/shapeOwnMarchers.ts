import { useMemo } from "react";
import { useShapeHidden, useShapeToolStore } from "../tool/shapeToolStore";

/**
 * While a shape is open and showing, its own marchers' start flag positions (the previous paths,
 * #331) give way to the shape's ghosts and walks, which are their "where from" (#417): the old
 * routes lead to spots the shape replaces, and their dots would stack on the ghosts. Everyone
 * else keeps theirs. The stored setting doesn't change; placing or dismissing brings them back.
 */
export function withoutShapeMarchers(
    ids: readonly number[] | undefined,
    members: ReadonlySet<number> | null,
): readonly number[] | undefined {
    if (!ids || !members) return ids;
    return ids.filter((id) => !members.has(id));
}

/** The open shape's marchers while it shows, or null */
export function useShowingShapeMarchers(): ReadonlySet<number> | null {
    const marchers = useShapeToolStore((s) => s.tool?.marchers ?? null);
    const hidden = useShapeHidden();
    return useMemo(
        () => (marchers && !hidden ? new Set(marchers.map((m) => m.id)) : null),
        [marchers, hidden],
    );
}
