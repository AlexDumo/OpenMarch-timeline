import tolgee from "@/global/singletons/Tolgee";
import type { ShapeKind } from "../types";
import { alongLine, isClosed, type LineParams } from "./lineGeometry";
import { lineFillSpots } from "./lineFill";

/**
 * The Line's shape kind, as recipes store it (#523): `line`, version 2. Version 1 is the path line
 * of the old shapes panel (two ends and a `Spacing`), whose params these are not; the Line's params
 * are its points (each with a tension), whether it's closed, and its spacing; a closed one also
 * how it's filled (#529).
 */
export const lineShape: ShapeKind<LineParams> = {
    id: "line",
    version: 2,
    get label() {
        return tolgee.t("shapes.kinds.line.label", "Line");
    },
    family: "path",
    defaultOrder: "nearest",
    groups: [],
    fit: () => ({
        points: [
            { x: 0, y: 0, tension: 0 },
            { x: 10, y: 0, tension: 0 },
        ],
        spacing: { mode: "fit" },
    }),
    // The tool's handles are the Line tool's own (`lineTool.ts`)
    handles: () => [],
    drag: (p) => p,
    outline: (p) => {
        const points = p.points.map(({ x, y }) => ({ x, y }));
        return [isClosed(p) ? [...points, points[0]!] : points];
    },
    generate: (p, n) => lineFillSpots(p, n),
    /** From the first point along the line, the way the spots go */
    orderKey: (p, point) => [alongLine(p, point)],
};
