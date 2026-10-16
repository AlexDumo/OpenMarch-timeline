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
    // Lines that cross with the marchers there at different times: not a collision, but said, so
    // a crossing seen on the field isn't a mystery (sims, round 15)
    const apartSlots = new Set<number>();
    let apart = 0;
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            const a = targets[i]!;
            const b = targets[j]!;
            // Walks whose lines cross only meet if both reach the crossing at about the same
            // time; one passing where the other was, after it left, is follow-the-leader or a
            // gate, not a collision (sims, round 11: a circle opened into an arc in order
            // showed 129 "walk through each other")
            const approach = closestApproach(a, b);
            const cross = walksCross(a, b);
            if (cross && approach >= close) {
                apart++;
                apartSlots.add(assignment[i]!);
                apartSlots.add(assignment[j]!);
            }
            if (cross && approach < close) {
                crossings++;
                crossingSlots.add(assignment[i]!);
                crossingSlots.add(assignment[j]!);
            } else if (
                // Pairs that start or end that close are already flagged by the spots
                Math.hypot(a.from.x - b.from.x, a.from.y - b.from.y) >= close &&
                Math.hypot(a.to.x - b.to.x, a.to.y - b.to.y) >= close &&
                approach < close
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
            // The fix, when there is one, is offered beside the warning (sims, draw round 1:
            // "Nearest untangles them" was promised even where Nearest made it worse)
            message: `${pairs(crossings)} of marchers would walk through each other (drawn in red). Point here to see who.`,
            slots: [...crossingSlots],
            mark: "collision",
        });
    if (passes > 0)
        issues.push({
            level: "warning",
            message: `${pairs(passes)} of marchers pass closer than ${MIN_SPACING_STEPS} step mid-move (drawn in red). Point here to see who.`,
            slots: [...closeSlots],
            mark: "close",
        });
    if (apart > 0)
        issues.push({
            level: "info",
            message: `${pairs(apart)} of walks cross paths at different times: no collision, one marcher is past before the other arrives. Point here to see them.`,
            slots: [...apartSlots],
        });
    // Say so when the walks are clear, so a quiet preview reads as checked, not unchecked
    // (sims, round 9: "the app gave me no sign either way")
    const moving = targets.some(
        (t) => Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y) > 1e-6,
    );
    if (crossings === 0 && passes === 0 && moving && targets.length > 1)
        issues.push({
            level: "info",
            // "At the same moment": a walk may cross a spot someone else has already left (sims,
            // round 13: "5's arrow runs through 7's start circle, who do I believe?")
            message: `Walks checked count by count: no two marchers come within ${MIN_SPACING_STEPS} step of each other at the same moment.`,
        });
    return issues;
}
