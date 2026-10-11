import { closestApproach, walksCross, type Walk } from "./geometry/segments";
import type { ShapeContext, ShapeIssue, Slot } from "./types";

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
 * Marchers whose walks to their spots cross, or pass closer than a step mid-move: they'd walk
 * through or into each other. Warnings, with the slots of the marchers involved, so the preview
 * can draw those paths and the designer can try another order.
 *
 * @param assignment each target's slot index, in `targets` order
 */
export function validatePaths(
    targets: readonly Walk[],
    assignment: readonly number[],
    ctx: ShapeContext,
    untangled: boolean,
): ShapeIssue[] {
    const close = MIN_SPACING_STEPS * ctx.stepPx;
    const crossingSlots = new Set<number>();
    const closeSlots = new Set<number>();
    let crossings = 0;
    let passes = 0;
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            const a = targets[i]!;
            const b = targets[j]!;
            if (walksCross(a, b)) {
                crossings++;
                crossingSlots.add(assignment[i]!);
                crossingSlots.add(assignment[j]!);
            } else if (
                // Pairs that start or end that close are already flagged by the spots
                Math.hypot(a.from.x - b.from.x, a.from.y - b.from.y) >= close &&
                Math.hypot(a.to.x - b.to.x, a.to.y - b.to.y) >= close &&
                closestApproach(a, b) < close
            ) {
                passes++;
                closeSlots.add(assignment[i]!);
                closeSlots.add(assignment[j]!);
            }
        }
    }
    const issues: ShapeIssue[] = [];
    const pairs = (k: number) => `${k} ${k === 1 ? "pair" : "pairs"}`;
    if (crossings > 0)
        issues.push({
            level: "warning",
            message: `${pairs(crossings)} of marchers would walk through each other (drawn in red).${untangled ? "" : " Order: Nearest untangles them."}`,
            slots: [...crossingSlots],
        });
    if (passes > 0)
        issues.push({
            level: "warning",
            message: `${pairs(passes)} of marchers pass closer than ${MIN_SPACING_STEPS} step mid-move (drawn in red).`,
            slots: [...closeSlots],
        });
    return issues;
}
