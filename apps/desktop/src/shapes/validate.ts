import type { Walk } from "./geometry/segments";
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
    // Off the field (sims, round 6: a locked interval grew an arc past the sideline unnoticed)
    const field = ctx.field;
    if (field) {
        const off = slots.flatMap((slot, i) =>
            slot.x < 0 ||
            slot.y < 0 ||
            slot.x > field.width ||
            slot.y > field.height
                ? [i]
                : [],
        );
        if (off.length > 0)
            issues.push({
                level: "warning",
                message:
                    off.length === 1
                        ? "1 marcher would stand off the field"
                        : `${off.length} marchers would stand off the field`,
                slots: off,
            });
    }
    return issues;
}

/**
 * Walks that need steps bigger than the field's step size warning allows, over the move's counts.
 * A warning with the slots of those marchers, naming the biggest.
 */
export function validateStepSizes(
    targets: readonly Walk[],
    assignment: readonly number[],
    ctx: ShapeContext,
): ShapeIssue[] {
    const steps = ctx.steps;
    if (!steps || steps.counts <= 0) return [];
    let longest = 0;
    const over: number[] = [];
    targets.forEach((t, i) => {
        const d = Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
        if (d / steps.counts > steps.maxPerCount) over.push(assignment[i]!);
        longest = Math.max(longest, d);
    });
    if (over.length === 0) return [];
    return [
        {
            level: "warning",
            message:
                over.length === 1
                    ? `1 marcher needs steps longer than the ${steps.limit} limit (${steps.describe(longest)}, drawn in orange). Set the limit in Field › Customize.`
                    : `${over.length} marchers need steps longer than the ${steps.limit} limit (longest ${steps.describe(longest)}, drawn in orange). Set the limit in Field › Customize.`,
            slots: over,
            mark: "steps",
        },
    ];
}
