/**
 * Performers on platforms (C4.5): each performer's lift at the moment they are placed, from the
 * props standing then (`propsAt`) and the platform under their dot (`liftAt`).
 */
import type { FieldProperties } from "@openmarch/core";
import type { CountClock } from "@/timeline/countGrid";
import { playbackBeat } from "@/timeline/positionBuffer";
import { liftPlatforms, writeLifts } from "@/view3d/core/props/platformLift";
import { propsAt, type PropInput } from "@/view3d/core/props/propLayout";
import type { ShowPositions } from "@/view3d/positions";

/** As in `@openmarch/core` `world.ts`. */
const METERS_PER_INCH = 0.0254;

/** How far a dot goes in half a count at the show's step size: the width of a step up or down. */
export const stepRamp = (fieldProperties: FieldProperties): number =>
    (fieldProperties.stepSizeInches * METERS_PER_INCH) / 2;

/**
 * Writes each performer's lift at show time `ms` into `out`, the performers placed at `xz` at that
 * same time. A show with no platforms writes 0 for everyone without placing its props.
 */
export function writePerformerLifts(
    {
        props,
        positions,
        countGrid,
        ms,
        fieldProperties,
    }: {
        props: readonly PropInput[];
        positions: ShowPositions | null;
        /** The show's counts, for the beat at `ms` */
        countGrid: CountClock;
        ms: number;
        fieldProperties: FieldProperties;
    },
    xz: Float32Array,
    placed: Uint8Array,
    out: Float32Array,
): void {
    if (!positions || !props.some((p) => p.surface === "platform")) {
        out.fill(0);
        return;
    }
    const solids = propsAt(props, playbackBeat(countGrid, ms), (id) =>
        positions.positionAt(id, ms, fieldProperties),
    );
    writeLifts(
        liftPlatforms(solids),
        xz,
        placed,
        stepRamp(fieldProperties),
        out,
    );
}
