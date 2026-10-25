import type { Checkpoint, FieldProperties } from "@openmarch/core";
import { sceneToSteps, type ScenePoint } from "./coordinates";

/** Rounds to a quarter step and drops trailing zeros */
export const formatSteps = (steps: number): string => {
    const rounded = Math.round(steps * 4) / 4;
    return String(Number(rounded.toFixed(2)));
};

/** The reference checkpoint nearest `steps`; ties go to the one nearer the centre or front */
export function nearestCheckpoint(
    steps: number,
    checkpoints: readonly Checkpoint[],
): Checkpoint | undefined {
    let best: Checkpoint | undefined;
    for (const c of checkpoints) {
        if (!c.useAsReference) continue;
        if (!best) {
            best = c;
            continue;
        }
        const d = Math.abs(c.stepsFromCenterFront - steps);
        const bestD = Math.abs(best.stepsFromCenterFront - steps);
        if (
            d < bestD - 1e-9 ||
            (Math.abs(d - bestD) <= 1e-9 &&
                Math.abs(c.stepsFromCenterFront) <
                    Math.abs(best.stepsFromCenterFront))
        )
            best = c;
    }
    return best;
}

export interface DrillPosition {
    /** E.g. "4 out S1 35", "on S2 30", "2 S1 of 50" */
    x: string;
    /** E.g. "12 behind FH", "on FSL" */
    y: string;
}

/**
 * Where a scene point is in drill language, from the field's checkpoints, rounded to a quarter
 * step: "4 out S1 35 · 12 behind FH".
 */
export function drillPosition(
    fp: FieldProperties,
    p: ScenePoint,
): DrillPosition {
    const steps = sceneToSteps(fp, p);
    const q = (n: number) => Math.round(n * 4) / 4;
    const sx = q(steps.x);
    const sy = q(steps.y);
    const { terseLeft, terseRight } = fp.sideDescriptions;
    const side = sx < 0 ? terseLeft : terseRight;

    let x = "";
    const xc = nearestCheckpoint(sx, fp.xCheckpoints);
    if (xc) {
        const cpSide = xc.stepsFromCenterFront < 0 ? terseLeft : terseRight;
        const off = Math.abs(xc.stepsFromCenterFront) - Math.abs(sx);
        if (xc.stepsFromCenterFront === 0) {
            x =
                sx === 0
                    ? `on ${xc.terseName}`
                    : `${formatSteps(Math.abs(sx))} ${side} of ${xc.terseName}`;
        } else if (Math.abs(off) < 1e-9) {
            x = `on ${cpSide} ${xc.terseName}`;
        } else {
            x = `${formatSteps(Math.abs(off))} ${off > 0 ? "in" : "out"} ${cpSide} ${xc.terseName}`;
        }
    }

    let y = "";
    const yc = nearestCheckpoint(sy, fp.yCheckpoints);
    if (yc) {
        const off = yc.stepsFromCenterFront - sy;
        if (Math.abs(off) < 1e-9) y = `on ${yc.terseName}`;
        else
            y = `${formatSteps(Math.abs(off))} ${off > 0 ? "behind" : "in front of"} ${yc.terseName}`;
    }
    return { x, y };
}

export const formatDrillPosition = (p: DrillPosition) =>
    [p.x, p.y].filter(Boolean).join(" · ");

/** A size in steps: "16 × 8 steps" */
export function formatStepSize(
    fp: FieldProperties,
    width: number,
    height: number,
) {
    const w = formatSteps(Math.abs(width) / fp.pixelsPerStep);
    const h = formatSteps(Math.abs(height) / fp.pixelsPerStep);
    return `${w} × ${h} steps`;
}
