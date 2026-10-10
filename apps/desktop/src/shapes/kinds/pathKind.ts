import type { Path } from "../geometry/path";
import { sampleAlong, spacedLength } from "../spacing";
import type { ParamGroup, Readout, ShapeContext, Spacing, XY } from "../types";

/** Shared pieces of path kinds (line, arc, curve, ...), so spacing reads the same in each. */

export const SPACING_GROUP: ParamGroup<{ spacing: Spacing }> = {
    label: "Spacing",
    fields: [{ type: "spacing", key: "spacing", label: "Spacing" }],
};

/** Path kinds start by fitting the marchers' current extent: spacing derived, nothing moves far. */
export const FIT: Spacing = { mode: "fit" };

/** Steps to the nearest quarter, with ≈ when that rounds something off */
export const formatSteps = (fieldUnits: number, ctx: ShapeContext): string => {
    const steps = fieldUnits / ctx.stepPx;
    const quarter = Math.round(steps * 4) / 4;
    const approx = Math.abs(steps - quarter) > 0.01 ? "≈ " : "";
    return `${approx}${quarter} ${Math.abs(quarter) === 1 ? "step" : "steps"}`;
};

/** Points along `path` from `from` to `to`, about every half step */
function span(path: Path, from: number, to: number, ctx: ShapeContext): XY[] {
    const count = Math.max(
        2,
        Math.min(4096, Math.ceil(Math.abs(to - from) / (ctx.stepPx / 2)) + 1),
    );
    const points: XY[] = [];
    for (let i = 0; i < count; i++)
        points.push(path.at(from + ((to - from) * i) / (count - 1)));
    return points;
}

/**
 * A path kind's outline: the whole path when fitting, or just the stretch an interval run
 * covers (which may run past the path's ends).
 */
export function pathOutline(
    path: Path,
    spacing: Spacing,
    n: number,
    ctx: ShapeContext,
): XY[][] {
    if (spacing.mode === "fit") return [span(path, 0, path.length, ctx)];
    const slots = sampleAlong(path, spacing, n, ctx.stepPx);
    return [span(path, slots[0]?.s ?? 0, slots.at(-1)?.s ?? 0, ctx)];
}

/** A path kind's faint guide: the drawn path, when an interval run doesn't follow it exactly */
export function pathGuide(
    path: Path,
    spacing: Spacing,
    ctx: ShapeContext,
): XY[][] {
    return spacing.mode === "interval" ? [span(path, 0, path.length, ctx)] : [];
}

export function pathReadouts(
    path: Path,
    spacing: Spacing,
    n: number,
    ctx: ShapeContext,
): Readout[] {
    const covered = spacedLength(path, spacing, n, ctx.stepPx);
    const readouts: Readout[] = [
        { label: "Length", value: formatSteps(covered, ctx) },
    ];
    if (spacing.mode === "fit") {
        const gaps = path.closed ? n : n - 1;
        if (gaps > 0) {
            readouts.push({
                label: "Interval",
                value: formatSteps(path.length / gaps, ctx),
            });
        }
    }
    return readouts;
}
