import { hungarianAlgorithm } from "@openmarch/core";
import type { AnyShapeKind, ShapeContext, Slot, XY } from "./types";

/**
 * Which marcher goes to which slot. The tool assigns once when it opens (or when the order mode
 * changes) and keeps that assignment while handles are dragged, so marchers don't swap spots
 * under the cursor. Reassigning is explicit.
 */

export type OrderMode =
    /** Least total squared travel, so straight moves don't pass through each other */
    | "nearest"
    /** Marchers keep their order along the shape (their current order projected onto it) */
    | "keep"
    /** Drill number order along the shape's natural slot order */
    | "drill";

export interface AssignMarcher {
    readonly id: number;
    /** Where the marcher is drawn now, at the moment being edited: what a shape fits through */
    readonly at: XY;
    /**
     * Where the marcher starts the move being edited (its position at the start flag), when that
     * differs from `at`. Who goes where is decided from here, so the move reads cleanly from where
     * marchers really come from, not from the spots the edit replaces.
     */
    readonly from?: XY;
    /** Sort position by drill number (drill prefix, then number) */
    readonly drillRank: number;
}

/** Above this many marchers, nearest falls back to keep order (the solve is cubic). */
export const NEAREST_LIMIT = 500;

const compareKeys = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
};

/**
 * @returns the slot index for each marcher, in `marchers` order
 */
export function assignSlots<P>({
    kind,
    params,
    slots,
    marchers,
    mode,
    reverse = false,
    ctx,
}: {
    kind: AnyShapeKind;
    params: P;
    slots: readonly Slot[];
    marchers: readonly AssignMarcher[];
    mode: OrderMode;
    reverse?: boolean;
    ctx: ShapeContext;
}): number[] {
    const n = marchers.length;
    if (slots.length !== n)
        throw new Error("Each marcher needs exactly one slot");
    if (n === 0) return [];

    if (mode === "nearest" && n <= NEAREST_LIMIT) {
        const cost = marchers.map((m) =>
            slots.map((s) => {
                const p = m.from ?? m.at;
                return (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
            }),
        );
        // assignment[slot + 1] = marcher + 1
        const assignment = hungarianAlgorithm(cost, n);
        const result = new Array<number>(n);
        for (let slot = 0; slot < n; slot++)
            result[assignment[slot + 1]! - 1] = slot;
        return result;
    }

    const slotOrder = slots
        .map((slot, index) => ({
            index,
            key: kind.orderKey(params, slot, ctx, n),
        }))
        .sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
        .map((entry) => entry.index);
    if (reverse) slotOrder.reverse();

    const marcherOrder =
        mode === "drill"
            ? marchers
                  .map((m, index) => ({ index, rank: m.drillRank }))
                  .sort((a, b) => a.rank - b.rank || a.index - b.index)
                  .map((entry) => entry.index)
            : marchers
                  .map((m, index) => ({
                      index,
                      key: kind.orderKey(params, m.from ?? m.at, ctx, n),
                      rank: m.drillRank,
                  }))
                  .sort((a, b) => compareKeys(a.key, b.key) || a.rank - b.rank)
                  .map((entry) => entry.index);

    const result = new Array<number>(n);
    marcherOrder.forEach((marcherIndex, i) => {
        result[marcherIndex] = slotOrder[i]!;
    });
    return result;
}
