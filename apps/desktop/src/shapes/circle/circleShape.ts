import tolgee from "@/global/singletons/Tolgee";
import { fieldToFrame } from "../frame/frame";
import type { ShapeKind } from "../types";
import {
    circleFrame,
    circleOutline,
    circleSpots,
    type CircleParams,
} from "./circleGeometry";

/**
 * The circle tool's shape kind, as recipes store it (#389): `circle`, version 2. Version 1 is
 * the path circle of the old shapes panel, whose params (a radius and a spacing along the path)
 * these are not; the circle tool's params are its center, interval, turn, flip and distribution,
 * and its spots come from the host's distributor.
 */
export const circleShape: ShapeKind<CircleParams> = {
    id: "circle",
    version: 2,
    get label() {
        return tolgee.t("shapes.kinds.circle.label", "Circle");
    },
    family: "fill",
    defaultOrder: "nearest",
    groups: [],
    fit: () => ({ center: { x: 0, y: 0 }, interval: 10, rotation: 0 }),
    // The tool's handles are the circle tool's own (`circleTool.ts`)
    handles: () => [],
    drag: (p) => p,
    outline: (p, n) => {
        const outline = circleOutline(p, n);
        return [[...outline, outline[0]!]];
    },
    generate: (p, n) => circleSpots(p, n),
    /** Round from the first spot, the way the spots go */
    orderKey(p, point, _ctx, n) {
        const local = fieldToFrame(circleFrame(p, n), point);
        const x = p.flipX ? -local.x : local.x;
        const y = p.flipY ? -local.y : local.y;
        // 0 at the front, growing toward the left as the spots go round
        const a = Math.atan2(-x, y);
        return [a < 0 ? a + 2 * Math.PI : a];
    },
};
