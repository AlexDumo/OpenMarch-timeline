import { cross, sub } from "./geometry/vec";
import type { ShapeContext, ShapeIssue, Slot, XY } from "./types";

/** Checks every kind gets. Kind-specific ones come from `ShapeKind.validate`. */

/** Marchers closer than this many steps get a warning */
export const MIN_SPACING_STEPS = 1;
const SAME_SPOT_STEPS = 0.01;

export function validateSlots(
    slots: readonly Slot[],
    ctx: ShapeContext,
): ShapeIssue[] {
    const issues: ShapeIssue[] = [];
    const close = MIN_SPACING_STEPS * ctx.stepPx;
    const same = SAME_SPOT_STEPS * ctx.stepPx;

    // Grid hash with cell = the warning distance, so only neighbor cells are compared.
    const cells = new Map<string, number[]>();
    const cellOf = (v: number) => Math.floor(v / close);
    const sameSpot = new Set<number>();
    const tooClose = new Set<number>();
    slots.forEach((slot, i) => {
        if (!Number.isFinite(slot.x) || !Number.isFinite(slot.y)) {
            issues.push({
                level: "error",
                message: "The shape has a spot with no position",
                slots: [i],
            });
            return;
        }
        const cx = cellOf(slot.x);
        const cy = cellOf(slot.y);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
                    const d = Math.hypot(
                        slots[j]!.x - slot.x,
                        slots[j]!.y - slot.y,
                    );
                    if (d < same) {
                        sameSpot.add(i);
                        sameSpot.add(j);
                    } else if (d < close - 1e-9) {
                        tooClose.add(i);
                        tooClose.add(j);
                    }
                }
            }
        }
        const key = `${cx},${cy}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(i);
        else cells.set(key, [i]);
    });

    if (sameSpot.size > 0) {
        issues.push({
            level: "error",
            message: `${sameSpot.size} marchers would stand on the same spot`,
            slots: [...sameSpot],
        });
    }
    if (tooClose.size > 0) {
        issues.push({
            level: "warning",
            message: `${tooClose.size} marchers are closer than ${MIN_SPACING_STEPS} step`,
            slots: [...tooClose],
        });
    }
    return issues;
}

/**
 * Marchers whose straight paths to their spots cross: they'd walk through each other. A warning,
 * with the slots of the crossing marchers, so the preview can mark them and the designer can try
 * another order.
 *
 * @param assignment each target's slot index, in `targets` order
 */
export function validatePaths(
    targets: readonly { readonly from: XY; readonly to: XY }[],
    assignment: readonly number[],
): ShapeIssue[] {
    const crossing = new Set<number>();
    let pairs = 0;
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            if (segmentsCross(targets[i]!, targets[j]!)) {
                pairs++;
                crossing.add(assignment[i]!);
                crossing.add(assignment[j]!);
            }
        }
    }
    if (pairs === 0) return [];
    return [
        {
            level: "warning",
            message: `${pairs} ${pairs === 1 ? "pair of paths crosses" : "pairs of paths cross"}: those marchers would walk through each other. Another order may untangle them.`,
            slots: [...crossing],
        },
    ];
}

/** Whether two paths cross strictly inside both (touching at an end doesn't count) */
function segmentsCross(
    p: { readonly from: XY; readonly to: XY },
    q: { readonly from: XY; readonly to: XY },
): boolean {
    const d1 = sub(p.to, p.from);
    const d2 = sub(q.to, q.from);
    const denom = cross(d1, d2);
    if (Math.abs(denom) < 1e-12) return false;
    const w = sub(q.from, p.from);
    const t = cross(w, d2) / denom;
    const u = cross(w, d1) / denom;
    const inside = (v: number) => v > 1e-6 && v < 1 - 1e-6;
    return inside(t) && inside(u);
}
