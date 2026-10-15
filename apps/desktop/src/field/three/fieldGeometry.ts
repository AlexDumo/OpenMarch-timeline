import {
    rgbaToString,
    stepMeters,
    type FieldProperties,
    type FieldTheme,
    type RgbaColor,
} from "@openmarch/core";
import { planField } from "@/view3d/core/field";
import { DEFAULT_VENUE_PARAMS } from "@/view3d/core/venueSettings";

/**
 * The field's lines and text in field units, for the new 2D field.
 *
 * The geometry is the 3D View's (ADR 0005 D-2.5): `planField` with the
 * `theme` style plans the same field `OpenMarchCanvas.createFieldGrid` draws,
 * in world meters, and this module only maps it to field units. Change what
 * the field shows there, once, for both views.
 *
 * Only the checkpoint labels outside the field's edges are planned here: the
 * 3D surface stops at the field's edges, so it has none.
 */

export type FieldRects = {
    /** minX, minY, maxX, maxY per rectangle, in field units, in paint order. */
    bounds: Float32Array;
    /** r, g, b, a per rectangle, 0 to 1. */
    colors: Float32Array;
    count: number;
};

export type FieldText = {
    text: string;
    /** The text's center, in field units. */
    x: number;
    y: number;
    /** Cap height in field units. */
    capHeight: number;
    /** Radians; π reads from the back sideline. */
    rotation: number;
    /** Where `x` is on the text. */
    align: "left" | "center" | "right";
    color: string;
    font: "number" | "label";
};

export type FieldGeometry = {
    rects: FieldRects;
    texts: FieldText[];
};

/** The cap height of fabric's text, as a share of its font size (as `themePlan.ts`). */
export const CAP_HEIGHT = 0.7;

/** The checkpoint labels' font size, as `createFieldGrid`. */
const EDGE_LABEL_SIZE = 20;
/** fabric's line height for one line of text. */
const LINE_HEIGHT = 1.16;

/** Plans the field of `fieldProperties`, painted with `theme`. */
export function fieldGeometry(
    fieldProperties: FieldProperties,
    theme: FieldTheme = fieldProperties.theme,
): FieldGeometry {
    const plan = planField({
        fieldProperties,
        theme,
        style: "theme",
        params: DEFAULT_VENUE_PARAMS,
        // The background image is #200.
        image: null,
    });
    const { xPixels, yPixels } = fieldProperties.centerFrontPoint;
    const unitsPerMeter =
        fieldProperties.pixelsPerStep / stepMeters(fieldProperties);
    const toX = (x: number) => xPixels + x * unitsPerMeter;
    const toY = (z: number) => yPixels + z * unitsPerMeter;

    const rects = plan.items.filter((item) => item.type === "rect");
    const bounds = new Float32Array(rects.length * 4);
    const colors = new Float32Array(rects.length * 4);
    rects.forEach((rect, i) => {
        bounds.set(
            [toX(rect.minX), toY(rect.minZ), toX(rect.maxX), toY(rect.maxZ)],
            i * 4,
        );
        colors.set(parseRgba(rect.color), i * 4);
    });

    const texts: FieldText[] = plan.items
        .filter((item) => item.type === "text")
        .map((text) => ({
            text: text.text,
            x: toX(text.x),
            y: toY(text.z),
            capHeight: text.height * unitsPerMeter,
            rotation: text.rotation,
            align: "center",
            color: text.color,
            font: "number",
        }));
    texts.push(...edgeLabels(fieldProperties, theme));

    return {
        rects: { bounds, colors, count: rects.length },
        texts,
    };
}

/** The checkpoint labels outside the field's edges, placed as `createFieldGrid` places them. */
function edgeLabels(
    fieldProperties: FieldProperties,
    theme: FieldTheme,
): FieldText[] {
    const { centerFrontPoint, pixelsPerStep, width } = fieldProperties;
    const color = rgbaToString(theme.externalLabel);
    const capHeight = EDGE_LABEL_SIZE * CAP_HEIGHT;
    /** From a fabric text's top to the middle of its line. */
    const halfLine = (EDGE_LABEL_SIZE * LINE_HEIGHT) / 2;
    const label = (
        text: string,
        x: number,
        y: number,
        align: FieldText["align"],
    ): FieldText => ({
        text,
        x,
        y,
        capHeight,
        rotation: 0,
        align,
        color,
        font: "label",
    });
    const texts: FieldText[] = [];
    for (const checkpoint of fieldProperties.xCheckpoints) {
        if (!checkpoint.visible) continue;
        const x =
            centerFrontPoint.xPixels +
            checkpoint.stepsFromCenterFront * pixelsPerStep;
        if (fieldProperties.bottomLabelsVisible)
            texts.push(
                label(
                    checkpoint.terseName,
                    x,
                    centerFrontPoint.yPixels + 5 + halfLine,
                    "center",
                ),
            );
        if (fieldProperties.topLabelsVisible)
            texts.push(
                label(checkpoint.terseName, x, -25 + halfLine, "center"),
            );
    }
    const padding = 10;
    for (const checkpoint of fieldProperties.yCheckpoints) {
        if (!checkpoint.visible) continue;
        const y =
            centerFrontPoint.yPixels +
            checkpoint.stepsFromCenterFront * pixelsPerStep;
        if (fieldProperties.leftLabelsVisible)
            texts.push(label(checkpoint.terseName, -padding, y, "right"));
        if (fieldProperties.rightLabelsVisible)
            texts.push(label(checkpoint.terseName, width + padding, y, "left"));
    }
    return texts;
}

/** A theme color as 0–1 components. */
export function rgba01(color: RgbaColor): [number, number, number, number] {
    return [color.r / 255, color.g / 255, color.b / 255, color.a];
}

/** `rgba(r, g, b, a)` (as `rgbaToString` writes it) to 0–1 components. */
export function parseRgba(css: string): [number, number, number, number] {
    const match = /rgba?\(([^)]+)\)/.exec(css);
    if (!match) return [0, 0, 0, 1];
    const [r = 0, g = 0, b = 0, a = 1] = match[1]
        .split(",")
        .map((part) => Number.parseFloat(part));
    return [r / 255, g / 255, b / 255, a];
}
