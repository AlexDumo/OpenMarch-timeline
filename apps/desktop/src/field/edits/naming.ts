import type { Checkpoint, FieldProperties } from "@openmarch/core";
import { snapSteps } from "./fieldModel";
import type { FieldAxis } from "./types";

export interface AutoCheckpointNames {
    readonly name: string;
    readonly terseName: string;
    /** The yard number painted on the field, when the position has one */
    readonly fieldLabel?: string;
}

/** 47.5, not 47.50000001 */
function formatSteps(n: number): string {
    return String(snapSteps(n, 0.01));
}

/**
 * The names a checkpoint gets from its position, as the templates name theirs:
 * - X on a football field (`useHashes`): yard lines, 8 steps to 5 yards from the 50 ("47.5 yard
 *   line", "47.5"; a yard number on multiples of 10). Past the goal line: "end zone 5", "EZ5"
 *   ("end zone", "EZ" at 10 yards, as the end zone templates).
 * - X elsewhere: grid lines every 4 steps from the "5 line" at center ("4.5 line", "4.5").
 * - Y: steps behind the front ("12 steps from front", "F12").
 *
 * Names carry no side: as in the templates, the side comes from the sign of the steps.
 */
export function autoCheckpointNames(
    field: Pick<FieldProperties, "useHashes">,
    axis: FieldAxis,
    steps: number,
): AutoCheckpointNames {
    if (axis === "x") {
        if (field.useHashes) {
            const yardLine = 50 - (Math.abs(steps) * 5) / 8;
            if (yardLine >= -1e-9) {
                const yards = formatSteps(Math.max(0, yardLine));
                const labelled = yardLine > 0 && Math.abs(yardLine % 10) < 1e-9;
                return {
                    name: `${yards} yard line`,
                    terseName: yards,
                    ...(labelled ? { fieldLabel: yards } : {}),
                };
            }
            const into = -yardLine;
            if (Math.abs(into - 10) < 1e-9)
                return { name: "end zone", terseName: "EZ" };
            const yards = formatSteps(into);
            return { name: `end zone ${yards}`, terseName: `EZ${yards}` };
        }
        const line = formatSteps(5 - Math.abs(steps) / 4);
        return { name: `${line} line`, terseName: line };
    }
    const behind = formatSteps(Math.abs(steps));
    return { name: `${behind} steps from front`, terseName: `F${behind}` };
}

/** Whether a checkpoint still has the automatic names for where it is (so they may follow it) */
export function hasAutoNames(
    field: Pick<FieldProperties, "useHashes">,
    checkpoint: Checkpoint,
): boolean {
    const auto = autoCheckpointNames(
        field,
        checkpoint.axis,
        checkpoint.stepsFromCenterFront,
    );
    return (
        checkpoint.name === auto.name && checkpoint.terseName === auto.terseName
    );
}
