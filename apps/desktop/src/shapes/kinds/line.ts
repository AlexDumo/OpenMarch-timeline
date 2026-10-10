import { LineSegmentIcon } from "@phosphor-icons/react";
import { principalExtremes } from "../geometry/fit";
import { makePath, type Path } from "../geometry/path";
import {
    add,
    dist,
    mid,
    scale,
    snapAngle,
    sub,
    unit,
    xy,
} from "../geometry/vec";
import {
    FIT,
    pathReadouts,
    SPACING_GROUP,
    pathGuide,
    pathOutline,
} from "./pathKind";
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
    measures: [
        {
            key: "length",
            label: "Length",
            unit: "length",
            min: 0.25,
            get: (p) => dist(p.a, p.b),
            // From the start end, keeping the direction
            set: (p, length) => ({
                ...p,
                b: add(p.a, scale(unit(sub(p.b, p.a)), length)),
            }),
            // With an interval the marchers set the length
            visibleWhen: (p) => p.spacing.mode === "fit",
        },
        {
            key: "angle",
            label: "Angle",
            unit: "angle",
            // Counterclockwise as seen on screen, 0 along the sidelines
            get: (p) => Math.atan2(-(p.b.y - p.a.y), p.b.x - p.a.x),
            set: (p, angle) => {
                const length = dist(p.a, p.b);
                return {
                    ...p,
                    b: add(
                        p.a,
                        xy(length * Math.cos(angle), -length * Math.sin(angle)),
                    ),
                };
            },
        },
    ],

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
        { key: "a", role: "point", at: p.a, start: true },
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

    outline: (p, n, ctx) => pathOutline(linePath(p), p.spacing, n, ctx),

    guide: (p, _n, ctx) => pathGuide(linePath(p), p.spacing, ctx),

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
