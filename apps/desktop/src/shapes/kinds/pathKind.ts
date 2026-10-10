import type { Path } from "../geometry/path";
import { spacedLength } from "../spacing";
import type { ParamGroup, Readout, ShapeContext, Spacing } from "../types";

/** Shared pieces of path kinds (line, arc, curve, ...), so spacing reads the same in each. */

export const SPACING_GROUP: ParamGroup<{ spacing: Spacing }> = {
    label: "Spacing",
    fields: [{ type: "spacing", key: "spacing", label: "Spacing" }],
};

/** Path kinds start by fitting the marchers' current extent: spacing derived, nothing moves far. */
export const FIT: Spacing = { mode: "fit" };

export const formatSteps = (fieldUnits: number, ctx: ShapeContext): string => {
    const steps = fieldUnits / ctx.stepPx;
    const rounded = Math.round(steps * 100) / 100;
    return `${rounded} ${Math.abs(rounded) === 1 ? "step" : "steps"}`;
};

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
