import { CircleIcon } from "@phosphor-icons/react";
import { fitCircle } from "../geometry/fit";
import { makePath, type Path } from "../geometry/path";
import { centroid, dist, polar, scaleAbout, snapAngle } from "../geometry/vec";
import { gapsInSteps, sampleAlong } from "../spacing";
import type {
    ShapeContext,
    ShapeIssue,
    ShapeKind,
    Spacing,
    XY,
} from "../types";
import {
    FIT,
    pathReadouts,
    SPACING_GROUP,
    pathGuide,
    pathOutline,
} from "./pathKind";

/**
 * A full circle. `start` (radians, canvas axes) is where the first marcher stands; marchers go
 * around toward +y from there (clockwise on the canvas).
 */
export interface CircleParams {
    readonly center: XY;
    readonly r: number;
    readonly start: number;
    readonly spacing: Spacing;
}

const TAU = 2 * Math.PI;

const circlePath = (p: CircleParams): Path =>
    makePath(
        [
            {
                type: "arc",
                center: p.center,
                r: p.r,
                start: p.start,
                sweep: TAU,
            },
        ],
        true,
    );

/** Where the radius handle sits: on the rim at the start angle */
const rimPoint = (p: CircleParams): XY => polar(p.center, p.r, p.start);

export const circleKind: ShapeKind<CircleParams> = {
    id: "circle",
    version: 1,
    label: "Circle",
    icon: CircleIcon,
    family: "path",
    defaultOrder: "nearest",
    groups: [SPACING_GROUP],
    measures: [
        {
            key: "radius",
            label: "Radius",
            unit: "length",
            min: 0.25,
            size: true,
            get: (p) => p.r,
            set: (p, r) => ({ ...p, r }),
        },
    ],

    path: circlePath,
    scale: (p, pivot, k) => ({
        ...p,
        center: scaleAbout(p.center, pivot, k),
        r: p.r * k,
    }),
    // Keeping a locked interval, the circle keeps its center and start: only the radius follows
    float: (p, length) => ({ ...p, r: length / TAU }),

    fit({ current }, ctx: ShapeContext) {
        const fitted = fitCircle(current);
        // A nearly straight row fits a huge circle; start from the group's middle instead.
        if (fitted && fitted.r <= 400 * ctx.stepPx && fitted.r > 0) {
            const first = current[0]!;
            return {
                center: fitted.center,
                r: fitted.r,
                start: Math.atan2(
                    first.y - fitted.center.y,
                    first.x - fitted.center.x,
                ),
                spacing: FIT,
            };
        }
        const center = centroid(current);
        const mean =
            current.length === 0
                ? 0
                : current.reduce((sum, q) => sum + dist(q, center), 0) /
                  current.length;
        return {
            center,
            r: Math.max(2 * ctx.stepPx, mean),
            // The first marcher stands toward the front (+y)
            start: Math.PI / 2,
            spacing: FIT,
        };
    },

    handles: (p) => [
        { key: "move", role: "move", at: p.center },
        { key: "radius", role: "point", at: rimPoint(p), start: true },
    ],

    drag(p, key, to, { shift }) {
        if (key === "move") {
            return { ...p, center: to };
        }
        if (key === "radius") {
            const rim = shift ? snapAngle(p.center, to, Math.PI / 4) : to;
            const r = dist(p.center, rim);
            if (r === 0) return { ...p, r };
            return {
                ...p,
                r,
                start: Math.atan2(rim.y - p.center.y, rim.x - p.center.x),
            };
        }
        return p;
    },

    outline: (p, n, ctx) => pathOutline(circlePath(p), p.spacing, n, ctx),

    guide: (p, _n, ctx) => pathGuide(circlePath(p), p.spacing, ctx),

    generate: (p, n, ctx) =>
        sampleAlong(circlePath(p), p.spacing, n, ctx.stepPx),

    orderKey: (p, point) => [circlePath(p).project(point)],

    readouts(p, n, ctx) {
        const readouts = pathReadouts(circlePath(p), p.spacing, n, ctx);
        if (p.spacing.mode === "fit" && readouts[0]) {
            readouts[0] = { ...readouts[0], label: "Circumference" };
        }
        return readouts;
    },

    validate(p, slots, ctx) {
        if (!(p.r > 0)) {
            return [{ level: "error", message: "The circle has no radius" }];
        }
        const issues: ShapeIssue[] = [];
        if (p.spacing.mode === "interval") {
            // Interval lays n - 1 gaps from the start; more than the circumference laps it.
            const run =
                gapsInSteps(p.spacing.runs, slots.length - 1).reduce(
                    (sum, g) => sum + g,
                    0,
                ) * ctx.stepPx;
            if (run >= TAU * p.r - 1e-9) {
                issues.push({
                    level: "warning",
                    message:
                        "The intervals go all the way around the circle, so marchers overlap",
                });
            }
        }
        return issues;
    },
};
