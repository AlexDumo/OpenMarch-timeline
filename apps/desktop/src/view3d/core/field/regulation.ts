import {
    FieldProperties,
    fieldFootprint,
    stepMeters,
    type Checkpoint,
    type FieldFootprint,
} from "@openmarch/core";
import { fieldFamily } from "../venueSettings";
import type { FieldSurfaceStyle } from "./plan";

/** A football field's goal lines and end lines, in meters from midfield. */
const GOAL_LINE = 50 * 0.9144;
const END_LINE = 60 * 0.9144;
/** Checkpoints this close to a regulation line count as that line. */
const TOLERANCE = 0.5;

/**
 * The field a stadium paints: on a football field, the drill grid plus any
 * goal and end lines it is missing, so the turf always shows both end zones
 * even when the show's grid stops at the goal lines (or short of them).
 * Other fields come back unchanged, so grids never grow end zones.
 *
 * Only the 3D venue uses this; performers keep the show's own grid.
 */
export function withFootballEndZones(fp: FieldProperties): FieldProperties {
    if (fieldFamily(fp) !== "football") return fp;
    const m = stepMeters(fp);
    const xs = fp.xCheckpoints;
    let id = Math.max(0, ...xs.map((c) => c.id)) + 1;
    const added: Checkpoint[] = [];
    const line = (name: string, terseName: string, meters: number) =>
        added.push({
            id: id++,
            name,
            terseName,
            axis: "x",
            stepsFromCenterFront: meters / m,
            useAsReference: false,
            visible: true,
        });
    for (const sx of [-1, 1]) {
        const reach = Math.max(
            0,
            ...xs.map((c) => sx * c.stepsFromCenterFront),
        );
        if (reach * m >= END_LINE - TOLERANCE) continue;
        const hasGoal = xs.some(
            (c) =>
                c.visible !== false &&
                Math.abs(c.stepsFromCenterFront * m - sx * GOAL_LINE) <
                    TOLERANCE,
        );
        if (!hasGoal) line("goal line", "G", sx * GOAL_LINE);
        line("end line", "EL", sx * END_LINE);
    }
    if (added.length === 0) return fp;
    return new FieldProperties({ ...fp, xCheckpoints: [...xs, ...added] });
}

/**
 * The area a venue kit builds around: the field it paints, which for turf
 * includes the end zones `withFootballEndZones` adds.
 */
export function venueFootprint(
    fp: FieldProperties,
    style: FieldSurfaceStyle,
): FieldFootprint {
    return fieldFootprint(style === "turf" ? withFootballEndZones(fp) : fp);
}
