import type { FieldProperties } from "@openmarch/core";
import { fieldLinesFor, type FieldLines } from "../venueSettings";
import { type FieldCenterArt, type TurfColors } from "../field";
import { DIESEL_FIELD, DIESEL_TURF } from "./markDiesel/turf";
import type { Object3D } from "three";
import type { FieldFootprint, KitBuilder, VenueKitId } from "../types";
import { buildArena } from "./arena";
import { buildBighs } from "./bighs";
import { buildBlank } from "./blank";
import { buildCollege } from "./college";
import { KIT_FIELD_STYLE, kitFieldStyle } from "./fieldStyle";
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

export { KIT_FIELD_STYLE, kitFieldStyle };

/**
 * The field a venue with a field of its own (`KITS_WITH_OWN_FIELD`) paints
 * under a floor, or in place of the show's lines (`fieldLines`).
 */
export const KIT_OWN_FIELD: Readonly<
    Partial<Record<VenueKitId, FieldProperties>>
> = { markDiesel: DIESEL_FIELD };

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
 * Centers the field surface on the field the kit is built round
 * (`footprint`) when it paints the venue's own field (`painted`, from
 * `kitFieldProperties`) in place of the show's: a show field short of
 * regulation size has its sidelines elsewhere. Otherwise leaves it be.
 */
export function placeKitField(
    mesh: Object3D,
    painted: FieldProperties,
    show: FieldProperties,
    footprint: FieldFootprint,
): void {
    if (painted === show) return;
    mesh.position.x = (footprint.minX + footprint.maxX) / 2;
    mesh.position.z = (footprint.minZ + footprint.maxZ) / 2;
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
