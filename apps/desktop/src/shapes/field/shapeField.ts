import type { FieldProperties } from "@openmarch/core";
import type Marcher from "@/global/classes/Marcher";
import type { XY } from "../types";

/**
 * The field on screen as the shape tool and placed boxes read it: its properties, the view's
 * zoom, the marchers and where each is drawn. The three.js field registers one while it's
 * mounted (`setShapeField`); the shape code reads it per event, never through `window.canvas`.
 */
export interface ShapeField {
    readonly fieldProperties: FieldProperties;
    /** The view's zoom, in CSS pixels per field unit */
    zoom(): number;
    /** The show's marchers, for drill numbers and drill order */
    marchers(): readonly Marcher[];
    /** Where the marchers with `ids` are drawn now, skipping any not drawn or hidden */
    drawn(ids: readonly number[]): Map<number, XY>;
}

type ShapeFieldSource = {
    fieldProperties(): FieldProperties | null | undefined;
    zoom(): number;
    marchers(): readonly Marcher[] | undefined;
    drawn(ids: readonly number[]): Map<number, XY>;
};

let source: ShapeFieldSource | null = null;

/** The field on screen, or undefined while none is (or its properties haven't loaded) */
export function currentShapeField(): ShapeField | undefined {
    const fieldProperties = source?.fieldProperties();
    if (!source || !fieldProperties) return undefined;
    const { zoom, marchers, drawn } = source;
    return {
        fieldProperties,
        zoom,
        marchers: () => marchers() ?? [],
        drawn,
    };
}

/** Called by the field when it mounts (its readers) and unmounts (null) */
export function setShapeField(field: ShapeFieldSource | null): void {
    source = field;
}
