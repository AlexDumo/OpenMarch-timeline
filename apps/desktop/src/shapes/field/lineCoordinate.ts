import { ReadableCoords } from "@/global/classes/ReadableCoords";

/**
 * A field line as the coordinate sheet names a spot on it, in its terse wording ("On 50",
 * "S1: 4 OUT 35", "12 BE BH"): the snap guide's name (#427). The sheet's own formatter, so the two
 * always agree, with its reference checkpoints and its rule for a line equally far from two (the
 * one nearer the center, or the front). Null before the field is known.
 */
export function lineCoordinate(axis: "x" | "y", at: number): string | null {
    try {
        const field = ReadableCoords.getFieldProperties();
        const coords = new ReadableCoords(
            axis === "x"
                ? { x: at, y: field.centerFrontPoint.yPixels }
                : { x: field.centerFrontPoint.xPixels, y: at },
        );
        return axis === "x" ? coords.toTerseStringX() : coords.toTerseStringY();
    } catch {
        // No field properties yet
        return null;
    }
}
