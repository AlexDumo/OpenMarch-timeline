import { FieldProperties, type RgbaColor } from "@openmarch/core";
import type { FieldRect } from "@/field/editor/selectionArea";
import {
    BASELINE_BELOW_CENTER,
    planField2d,
    textCenterY,
    type FieldPlanOptions,
    type FieldPlanText,
} from "@/field/fieldPlan";
import { fieldShapeMesh, type FieldShapeMesh } from "./fieldShapes";

/**
 * The field's rectangles and text in field units.
 *
 * The layout is `planField2d` (`src/field/fieldPlan.ts`), the one the drill
 * chart export draws. This module only turns the plan's lines and border into
 * rectangles for one instanced draw, its text into SDF labels and its filled
 * shapes into triangles. Change what the field shows there, once, for both.
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
    /** The center of the text's box, in field units; it turns about it. */
    x: number;
    y: number;
    /** Field units per em (the font size). */
    size: number;
    /** The baseline's offset below `y`, in em. */
    baseline: number;
    /** Radians; π reads from the back sideline. */
    rotation: number;
    /** Where `x` is on the text. */
    align: "left" | "center" | "right";
    /** Extra space between characters, in em. */
    letterSpacing: number;
    color: RgbaColor;
    font: "number" | "label";
};

export type FieldGeometry = {
    /** The field's background, under the field image. */
    background: FieldRects;
    /** The lines and border, over the field image. */
    rects: FieldRects;
    texts: FieldText[];
    /** The painted yard numbers, triangulated, over the lines. */
    shapes: FieldShapeMesh;
};

type Rect = [minX: number, minY: number, maxX: number, maxY: number];

const ALIGN: Record<FieldPlanText["anchor"], FieldText["align"]> = {
    start: "left",
    middle: "center",
    end: "right",
};

/** The pit strip's fill: the field's background, this much as strong, so it reads as off the field */
export const PIT_STRIP_FILL_ALPHA = 0.45;
/** The yard lines run on across the pit strip this faint, to place speakers and the podium by */
export const PIT_STRIP_LINE_ALPHA = 0.35;

export type FieldGeometryOptions = FieldPlanOptions & {
    /**
     * The strips beside the field: the pit strip in front of the front sideline (`pitStripOf`)
     * and the back strip behind the back sideline (`backStripOf`), when there are any
     */
    strips?: readonly FieldRect[];
};

/**
 * Plans the field of `fieldProperties` with the user's line settings. The
 * field image is its own layer (`planFieldImage`). The strips beside the
 * field, when there are any, are drawn after it: a fainter fill, their edges
 * and the yard lines run on across them.
 */
export function fieldGeometry(
    fieldProperties: FieldProperties,
    options: FieldGeometryOptions = { gridLines: true, halfLines: true },
): FieldGeometry {
    const plan = planField2d(fieldProperties, options);

    const rects: { rect: Rect; color: RgbaColor }[] = plan.lines.map((l) => {
        const half = l.width / 2;
        const rect: Rect =
            l.x1 === l.x2
                ? [
                      l.x1 - half,
                      Math.min(l.y1, l.y2),
                      l.x1 + half,
                      Math.max(l.y1, l.y2),
                  ]
                : [
                      Math.min(l.x1, l.x2),
                      l.y1 - half,
                      Math.max(l.x1, l.x2),
                      l.y1 + half,
                  ];
        return { rect, color: l.color };
    });
    // The border's four sides. A translucent stroke's sides don't overlap, so
    // it stays even; an opaque one's left and right sides run the full height,
    // so no antialiased seam shows where they meet the top and bottom (#249).
    const { border } = plan;
    const sw = border.strokeWidth;
    const x0 = border.x - sw / 2;
    const y0 = border.y - sw / 2;
    const x1 = border.x + border.width + sw / 2;
    const y1 = border.y + border.height + sw / 2;
    const inset = border.color.a < 1 ? sw : 0;
    const sides: Rect[] = [
        [x0, y0, x1, y0 + sw],
        [x0, y1 - sw, x1, y1],
        [x0, y0 + inset, x0 + sw, y1 - inset],
        [x1 - sw, y0 + inset, x1, y1 - inset],
    ];
    for (const rect of sides) rects.push({ rect, color: border.color });
    const strips = options.strips ?? [];
    for (const strip of strips)
        rects.push(...stripRects(plan, strip, fieldProperties));

    const texts = plan.texts.map(
        (t): FieldText => ({
            text: t.text,
            x: t.x,
            y: textCenterY(t),
            size: t.fontSize,
            baseline: BASELINE_BELOW_CENTER,
            rotation: t.flipped ? Math.PI : 0,
            align: ALIGN[t.anchor],
            letterSpacing: t.letterSpacing / t.fontSize,
            color: t.color,
            font: t.role === "yardNumber" ? "number" : "label",
        }),
    );

    const background: { rect: Rect; color: RgbaColor }[] = [
        { rect: [0, 0, plan.width, plan.height], color: plan.background },
    ];
    for (const strip of strips)
        background.push({
            rect: [strip.left, strip.top, strip.right, strip.bottom],
            color: {
                ...plan.background,
                a: plan.background.a * PIT_STRIP_FILL_ALPHA,
            },
        });
    return {
        background: packRects(background),
        rects: packRects(rects),
        texts,
        shapes: fieldShapeMesh(plan.shapes),
    };
}

/**
 * A strip's left, right and far edges (away from the field: the bottom of the pit strip, the top
 * of the back strip), and each yard line run on across it, faintly
 */
function stripRects(
    plan: ReturnType<typeof planField2d>,
    strip: FieldRect,
    fieldProperties: FieldProperties,
): { rect: Rect; color: RgbaColor }[] {
    const theme = fieldProperties.theme;
    const edge = { ...theme.tertiaryStroke };
    const yardColor = {
        ...theme.primaryStroke,
        a: theme.primaryStroke.a * PIT_STRIP_LINE_ALPHA,
    };
    const half = FieldProperties.GRID_STROKE_WIDTH / 2;
    const { left, right, top, bottom } = strip;
    // A strip that ends at the field's top edge is behind it
    const far = bottom <= 0 ? top : bottom;
    const out: { rect: Rect; color: RgbaColor }[] = [
        { rect: [left - half, top, left + half, bottom], color: edge },
        { rect: [right - half, top, right + half, bottom], color: edge },
        {
            rect: [left - half, far - half, right + half, far + half],
            color: edge,
        },
    ];
    for (const line of plan.lines) {
        if (line.role !== "yardLine" || line.x1 !== line.x2) continue;
        const w = line.width / 2;
        out.push({
            rect: [line.x1 - w, top, line.x1 + w, bottom],
            color: yardColor,
        });
    }
    return out;
}

function packRects(rects: { rect: Rect; color: RgbaColor }[]): FieldRects {
    const bounds = new Float32Array(rects.length * 4);
    const colors = new Float32Array(rects.length * 4);
    rects.forEach(({ rect, color }, i) => {
        bounds.set(rect, i * 4);
        colors.set(rgba01(color), i * 4);
    });
    return { bounds, colors, count: rects.length };
}

/** A theme color as 0–1 components. */
export function rgba01(color: RgbaColor): [number, number, number, number] {
    return [color.r / 255, color.g / 255, color.b / 255, color.a];
}
