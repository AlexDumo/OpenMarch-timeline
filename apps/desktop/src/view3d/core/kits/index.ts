import type { FieldProperties } from "@openmarch/core";
import {
    KITS_WITH_OWN_FIELD,
    fieldFamily,
    fieldLinesFor,
    type FieldLines,
} from "../venueSettings";
import {
    type FieldCenterArt,
    type FieldSurfaceStyle,
    type TurfColors,
} from "../field";
import { DIESEL_FIELD, DIESEL_TURF } from "./markDiesel/turf";
import type { KitBuilder, VenueKitId } from "../types";
import { buildArena } from "./arena";
import { buildBighs } from "./bighs";
import { buildBlank } from "./blank";
import { buildCollege } from "./college";
import { buildGym } from "./gym";
import { buildHs } from "./hs";
import { buildMarkDiesel } from "./markDiesel";
import { dieselFieldArt } from "./markDiesel/brand";
import { buildProKit } from "./pro";

/**
 * The venue kit registry (P3.1, design.md section 6). The scene looks a kit up
 * by the show's `VenueSettings.kit` and never imports a kit module directly.
 */
export const KIT_BUILDERS: Readonly<Record<VenueKitId, KitBuilder>> = {
    hs: buildHs,
    bighs: buildBighs,
    college: buildCollege,
    pro: buildProKit,
    markDiesel: buildMarkDiesel,
    gym: buildGym,
    arena: buildArena,
    blank: buildBlank,
};

/**
 * The field surface style each kit sits on (design.md section 4): turf for the
 * stadiums, the field image or a generated tarp for the gym and the arena, and the 2D
 * canvas's theme colors for the blank kit.
 */
export const KIT_FIELD_STYLE: Readonly<Record<VenueKitId, FieldSurfaceStyle>> =
    {
        hs: "turf",
        bighs: "turf",
        college: "turf",
        pro: "turf",
        markDiesel: "turf",
        gym: "tarp",
        arena: "tarp",
        blank: "theme",
    };

/**
 * The field a venue with a field of its own (`KITS_WITH_OWN_FIELD`) paints
 * under a floor, or in place of the show's lines (`fieldLines`).
 */
export const KIT_OWN_FIELD: Readonly<
    Partial<Record<VenueKitId, FieldProperties>>
> = { markDiesel: DIESEL_FIELD };

/**
 * The surface style a kit paints the show's field in: `KIT_FIELD_STYLE`,
 * except that in a venue with its own field a field that isn't a football
 * field (indoor, SoundSport, any grid) is a tarp (the show's field image,
 * or the generated tarp) laid on the venue's turf. A football field stays
 * turf whatever its step size.
 */
export function kitFieldStyle(
    kitId: VenueKitId,
    fieldProperties: FieldProperties,
): FieldSurfaceStyle {
    const style = KIT_FIELD_STYLE[kitId];
    if (
        !KITS_WITH_OWN_FIELD.includes(kitId) ||
        fieldFamily(fieldProperties) === "football"
    )
        return style;
    return "tarp";
}

/**
 * The field a kit paints: the show's, or, when the show asks for the
 * stadium's lines (`fieldLines`) and its field is turf, the venue's own
 * field (`KIT_OWN_FIELD`). Marchers keep the show's coordinates either way.
 */
export function kitFieldProperties(
    kitId: VenueKitId,
    fieldProperties: FieldProperties,
    fieldLines: FieldLines | undefined,
): FieldProperties {
    const own = KIT_OWN_FIELD[kitId];
    if (
        !own ||
        fieldLinesFor(kitId, fieldLines) !== "stadium" ||
        kitFieldStyle(kitId, fieldProperties) !== "turf"
    )
        return fieldProperties;
    return own;
}

/**
 * Midfield art a kit paints in place of the OpenMarch logo
 * (`FieldSurfaceInput.centerArt`).
 */
export const KIT_FIELD_ART: Readonly<
    Partial<Record<VenueKitId, FieldCenterArt>>
> = { markDiesel: dieselFieldArt };

/**
 * Grass colors a kit paints in place of the shared turf's
 * (`FieldSurfaceInput.turf`). Kits without an entry are unchanged.
 */
export const KIT_FIELD_TURF: Readonly<Partial<Record<VenueKitId, TurfColors>>> =
    { markDiesel: DIESEL_TURF };

/** Crowd density used when a kit doesn't suggest one (`KitResult`). */
export const DEFAULT_CROWD_DENSITY = 0.6;
