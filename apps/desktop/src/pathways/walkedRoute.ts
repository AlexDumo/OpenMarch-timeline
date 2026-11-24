import type { XY } from "./orderSweep";
import type { TrailTarget } from "./pathTarget";

/** Points closer than this (field units) are one point of the way */
const SAME_POINT = 1e-6;

/**
 * The way a trail's line walks, as one line (owner, 2026-11-17: "we should have at least some sort
 * of visibility to know how the marchers got there and the path that they took"): from the tail's
 * start along the line-up to the leader's start (a box's snake through its spots, in the order the
 * line leaves it, row ends cut across, SN-3), then along the trail (`route`, from the leader's start
 * to its head or the entrance), then, for a line that ends in a form's end spots, through them to
 * the leader's (the end line, R-13′). Each member walks a stretch of it, from its start to its end
 * spot. A trail dragged out of a line (`along`) or round an outline (`around`) ends on its route,
 * so no end line follows. Consecutive repeats are dropped.
 */
export function walkedRoute(
    trail: Pick<TrailTarget, "members" | "along" | "around" | "endLine">,
    route: readonly XY[],
): XY[] {
    const lineUp = trail.members.map((m) => m.from);
    const endLine =
        trail.along || trail.around
            ? []
            : (trail.endLine ?? trail.members.map((m) => m.to));
    const out: XY[] = [];
    for (const p of [...lineUp, ...route, ...endLine]) {
        const last = out.at(-1);
        if (
            last &&
            Math.abs(last.x - p.x) <= SAME_POINT &&
            Math.abs(last.y - p.y) <= SAME_POINT
        )
            continue;
        out.push({ x: p.x, y: p.y });
    }
    return out;
}
