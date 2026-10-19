import { RoughGenerator } from "roughjs/bin/generator";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { omDotCenters, parseOmFill, type Point } from "./omFills";
import { registerOmFillers } from "./roughFiller";

/**
 * Counts the dots Excalidraw draws for an element with a dot fill, by running the same rough.js
 * generator call with the same options (Excalidraw 0.18.1 `scene/Shape.ts`). Rough's jitter is
 * seeded by the element, so the count matches the drawing.
 */

const generator = new RoughGenerator();

const ROUGHNESS_CARTOONIST = 2;
const PROPORTIONAL_RADIUS = 0.25;
const ADAPTIVE_RADIUS = 32;

type ShapeLike = Pick<
    ExcalidrawElement,
    | "type"
    | "width"
    | "height"
    | "roughness"
    | "roundness"
    | "seed"
    | "strokeWidth"
    | "strokeStyle"
    | "strokeColor"
    | "fillStyle"
    | "backgroundColor"
> & { points?: readonly (readonly [number, number])[] };

function cornerRadius(x: number, el: ShapeLike): number {
    const type = el.roundness?.type;
    if (type === 1 || type === 2) return x * PROPORTIONAL_RADIUS;
    if (type === 3) {
        const fixed = el.roundness?.value ?? ADAPTIVE_RADIUS;
        return x <= fixed / PROPORTIONAL_RADIUS
            ? x * PROPORTIONAL_RADIUS
            : fixed;
    }
    return 0;
}

function adjustRoughness(el: ShapeLike): number {
    const maxSize = Math.max(el.width, el.height);
    const minSize = Math.min(el.width, el.height);
    const roundable = ["rectangle", "diamond", "line"].includes(el.type);
    if (
        (minSize >= 20 && maxSize >= 50) ||
        (minSize >= 15 && !!el.roundness && roundable)
    )
        return el.roughness;
    return Math.min(el.roughness / (maxSize < 10 ? 3 : 2), 2.5);
}

function roughOptions(el: ShapeLike, continuousPath = false) {
    return {
        seed: el.seed,
        disableMultiStroke: el.strokeStyle !== "solid",
        strokeWidth:
            el.strokeStyle !== "solid" ? el.strokeWidth + 0.5 : el.strokeWidth,
        fillWeight: el.strokeWidth / 2,
        hachureGap: el.strokeWidth * 4,
        roughness: adjustRoughness(el),
        stroke: el.strokeColor,
        preserveVertices: continuousPath || el.roughness < ROUGHNESS_CARTOONIST,
        fillStyle: el.fillStyle as string,
        fill: el.backgroundColor,
        ...(el.type === "ellipse" ? { curveFitting: 1 } : {}),
    };
}

function drawable(el: ShapeLike) {
    const w = el.width;
    const h = el.height;
    switch (el.type) {
        case "rectangle": {
            if (el.roundness) {
                const r = cornerRadius(Math.min(w, h), el);
                return generator.path(
                    `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`,
                    roughOptions(el, true),
                );
            }
            return generator.rectangle(0, 0, w, h, roughOptions(el));
        }
        case "ellipse":
            return generator.ellipse(w / 2, h / 2, w, h, roughOptions(el));
        case "diamond":
            return generator.polygon(
                [
                    [w / 2, 0],
                    [w, h / 2],
                    [w / 2, h],
                    [0, h / 2],
                ],
                roughOptions(el),
            );
        default:
            return null;
    }
}

/** Whether an element's fill is one of ours and it has a color to draw the dots in */
export function hasDotFill(
    el: Pick<ExcalidrawElement, "fillStyle" | "backgroundColor">,
) {
    return (
        !!parseOmFill(el.fillStyle as string) &&
        el.backgroundColor !== "transparent"
    );
}

/** The number of dots drawn for an element, or null if it has no dot fill */
export function countDots(el: ShapeLike): number | null {
    const fill = parseOmFill(el.fillStyle as string);
    if (!fill || el.backgroundColor === "transparent") return null;
    registerOmFillers();
    const shape = drawable(el);
    if (shape) {
        const fillSet = shape.sets.find((set) => set.type === "fillPath");
        if (!fillSet) return 0;
        return fillSet.ops.filter((op) => op.op === "move").length;
    }
    // Closed lines and free drawing: the outline as drawn, without rough's jitter
    if (el.points && el.points.length > 2) {
        const poly = el.points.map(([x, y]) => [x, y] as Point);
        return omDotCenters([poly], fill, el.strokeWidth * 4).centers.length;
    }
    return 0;
}
