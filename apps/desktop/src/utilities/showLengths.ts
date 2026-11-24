import type { FieldProperties } from "@openmarch/core";

/**
 * Lengths of 3D things (props, models, front ensemble footprints) in the show's units. They are
 * stored in meters, as the 3D View and model files use them; the UI shows feet when the show's
 * field is imperial and meters when it is metric, like the field's own sizes.
 */
export type MeasurementSystem = FieldProperties["measurementSystem"];

export const METERS_PER_FOOT = 0.3048;

/** `meters` as a number in the show's unit: feet (imperial) or meters (metric) */
export function metersToShown(
    meters: number,
    system: MeasurementSystem,
): number {
    return system === "metric" ? meters : meters / METERS_PER_FOOT;
}

/** A number typed in the show's unit, back in meters */
export function shownToMeters(
    value: number,
    system: MeasurementSystem,
): number {
    return system === "metric" ? value : value * METERS_PER_FOOT;
}

/** A number to two decimals at most, without trailing zeros */
export function shortNumber(value: number): string {
    return String(Number(value.toFixed(2)));
}

/** `meters` in the show's unit as a short number, without the unit */
export function shownLength(meters: number, system: MeasurementSystem): string {
    return shortNumber(metersToShown(meters, system));
}

/** The translation key of the show's unit symbol ("ft" or "m") */
export function lengthUnitKey(system: MeasurementSystem): string {
    return system === "metric" ? "props.units.meters" : "props.units.feet";
}
