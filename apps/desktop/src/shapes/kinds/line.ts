import { LineSegmentIcon } from "@phosphor-icons/react";
import { principalExtremes } from "../geometry/fit";
import { makePath, type Path } from "../geometry/path";
import { add, dist, mid, snapAngle, sub, xy } from "../geometry/vec";
import { FIT, pathReadouts, SPACING_GROUP } from "./pathKind";
import { sampleAlong } from "../spacing";
import type { ShapeKind, Spacing, XY } from "../types";

export interface LineParams {
    readonly a: XY;
    readonly b: XY;
    readonly spacing: Spacing;
}

const linePath = (p: LineParams): Path =>
    makePath([{ type: "line", a: p.a, b: p.b }]);

export const lineKind: ShapeKind<LineParams> = {
    id: "line",
    version: 1,
    label: "Line",
    icon: LineSegmentIcon,
    family: "path",
    groups: [SPACING_GROUP],

    fit({ current }, ctx) {
        const ends = principalExtremes(current);
        if (!ends) {
            const c = current[0] ?? xy(0, 0);
            const half = 2 * ctx.stepPx;
            return {
                a: xy(c.x - half, c.y),
                b: xy(c.x + half, c.y),
                spacing: FIT,
            };
        }
        return { a: ends[0], b: ends[1], spacing: FIT };
    },

    handles: (p) => [
        { key: "a", role: "point", at: p.a },
        { key: "b", role: "point", at: p.b },
        { key: "move", role: "move", at: mid(p.a, p.b) },
    ],

    drag(p, key, to, { shift }) {
        if (key === "move") {
            const delta = sub(to, mid(p.a, p.b));
            return { ...p, a: add(p.a, delta), b: add(p.b, delta) };
        }
        if (key === "a")
            return { ...p, a: shift ? snapAngle(p.b, to, Math.PI / 4) : to };
        if (key === "b")
            return { ...p, b: shift ? snapAngle(p.a, to, Math.PI / 4) : to };
        return p;
    },

    outline(p, n, ctx) {
        const path = linePath(p);
        const slots = sampleAlong(path, p.spacing, n, ctx.stepPx);
        const first = Math.min(0, slots[0]?.s ?? 0);
        const last = Math.max(path.length, slots.at(-1)?.s ?? 0);
        return [[path.at(first), path.at(last)]];
    },

    generate: (p, n, ctx) => sampleAlong(linePath(p), p.spacing, n, ctx.stepPx),

    orderKey: (p, point) => [linePath(p).project(point)],

    readouts: (p, n, ctx) => pathReadouts(linePath(p), p.spacing, n, ctx),

    validate(p) {
        if (dist(p.a, p.b) === 0) {
            return [
                {
                    level: "error",
                    message: "The line's ends are on the same spot",
                },
            ];
        }
        return [];
    },
};
