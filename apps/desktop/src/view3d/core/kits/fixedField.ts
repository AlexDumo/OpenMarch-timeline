import type { FieldFootprint } from "../types";

const FT = 0.3048;
/** A football field with end zones: 360 ft by 160 ft. */
const FIELD_LENGTH = 360 * FT;
const FIELD_WIDTH = 160 * FT;
/** Meters a footprint may fall short of the field and still be it. */
const TOLERANCE = 0.05;

/**
 * The field a fixed-field venue (`KIT_FIXED_FIELD`) is built round. Such a
 * venue never resizes to the show: a show on a football field (or a bigger
 * one) is used as it is, and a smaller floor (indoor, SoundSport) gets a
 * regulation football field centered on it. `ownField` then says the kit
 * paints that field itself, and the show's floor lies on it as a tarp
 * (`kitFieldStyle`).
 */
export function fixedFieldFootprint(footprint: FieldFootprint): {
    footprint: FieldFootprint;
    ownField: boolean;
} {
    const length = footprint.maxX - footprint.minX;
    const width = footprint.maxZ - footprint.minZ;
    if (length >= FIELD_LENGTH - TOLERANCE && width >= FIELD_WIDTH - TOLERANCE)
        return { footprint, ownField: false };
    const cx = (footprint.minX + footprint.maxX) / 2;
    const cz = (footprint.minZ + footprint.maxZ) / 2;
    return {
        footprint: {
            minX: cx - FIELD_LENGTH / 2,
            maxX: cx + FIELD_LENGTH / 2,
            minZ: cz - FIELD_WIDTH / 2,
            maxZ: cz + FIELD_WIDTH / 2,
        },
        ownField: true,
    };
}
