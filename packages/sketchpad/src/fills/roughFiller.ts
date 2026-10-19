import { omDotCenters, parseOmFill, type Point } from "./omFills";

/** The parts of rough.js's filler contract we use */
interface Op {
    op: "move" | "bcurveTo" | "lineTo";
    data: number[];
}
interface OpSet {
    type: "path" | "fillPath" | "fillSketch";
    ops: Op[];
}
interface RoughOptions {
    fillStyle?: string;
    hachureGap: number;
    strokeWidth: number;
}
interface Filler {
    fillPolygons(polygonList: Point[][], o: RoughOptions): OpSet;
}

const KAPPA = 0.5522847498;

function circleOps(cx: number, cy: number, r: number): Op[] {
    const k = KAPPA * r;
    return [
        { op: "move", data: [cx + r, cy] },
        { op: "bcurveTo", data: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
        { op: "bcurveTo", data: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
        { op: "bcurveTo", data: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
        { op: "bcurveTo", data: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
    ];
}

const filler: Filler = {
    fillPolygons(polygonList, o) {
        const fill = parseOmFill(o.fillStyle)!;
        const { centers, radius } = omDotCenters(
            polygonList,
            fill,
            o.hachureGap,
        );
        const ops: Op[] = [];
        for (const [x, y] of centers) ops.push(...circleOps(x, y, radius));
        // fillPath: a solid fill in the element's background color, on canvas and in SVG
        return { type: "fillPath", ops };
    },
};

/** The hook the patched rough.js calls before its own filler lookup */
export function getOmFiller(o: RoughOptions): Filler | null {
    return parseOmFill(o.fillStyle) ? filler : null;
}

declare global {
    var __openmarchRoughFiller:
        | ((o: RoughOptions, helper: unknown) => Filler | null)
        | undefined;
}

/**
 * Sends `om-*` fill styles to our fillers. Called when the package loads, before any scene
 * renders. Safe to call more than once.
 */
export function registerOmFillers(): void {
    globalThis.__openmarchRoughFiller = getOmFiller;
}
