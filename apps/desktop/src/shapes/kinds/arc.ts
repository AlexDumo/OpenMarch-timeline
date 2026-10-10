import { CircleNotchIcon } from "@phosphor-icons/react";
import { fitCircle, principalExtremes } from "../geometry/fit";
import { makePath, type Path, type Segment } from "../geometry/path";
import {
    add,
    dist,
    dot,
    len,
    mid,
    perp,
    polar,
    scale,
    snapAngle,
    sub,
    unit,
    xy,
} from "../geometry/vec";
import { sampleAlong } from "../spacing";
import type { ShapeContext, ShapeKind, Spacing, XY } from "../types";
import {
    FIT,
    pathReadouts,
    SPACING_GROUP,
    pathGuide,
    pathOutline,
} from "./pathKind";

/**
 * A part of a circle from `a` to `b`. `bulge` is the signed sagitta: how far the arc's middle
 * stands off the chord, along the chord's normal (`perp(b - a)`). Zero is a straight line.
 */
export interface ArcParams {
    readonly a: XY;
    readonly b: XY;
    readonly bulge: number;
    readonly spacing: Spacing;
}

const chordNormal = (p: ArcParams): XY => unit(perp(sub(p.b, p.a)));

/** The arc's middle point, where its bulge handle sits */
export const arcMiddle = (p: ArcParams): XY =>
    add(mid(p.a, p.b), scale(chordNormal(p), p.bulge));

const TAU = 2 * Math.PI;
const positiveAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/** The arc as a path segment; a straight line when the bulge is (nearly) zero */
export function arcSegment(p: ArcParams): Segment {
    const halfChord = dist(p.a, p.b) / 2;
    if (Math.abs(p.bulge) < 1e-9 * Math.max(1, halfChord) || halfChord === 0) {
        return { type: "line", a: p.a, b: p.b };
    }
    const s = p.bulge;
    const r = (halfChord * halfChord + s * s) / (2 * Math.abs(s));
    const n = chordNormal(p);
    const center = add(mid(p.a, p.b), scale(n, s - Math.sign(s) * r));
    const angleOf = (q: XY) => Math.atan2(q.y - center.y, q.x - center.x);
    const start = angleOf(p.a);
    const forward = positiveAngle(angleOf(p.b) - start);
    const toMiddle = positiveAngle(angleOf(arcMiddle(p)) - start);
    const sweep = toMiddle < forward ? forward : forward - TAU;
    return { type: "arc", center, r, start, sweep };
}

const arcPath = (p: ArcParams): Path => makePath([arcSegment(p)]);

/** Arc params for the part of a circle the points cover: it skips the widest empty gap. */
function arcThroughPoints(
    points: readonly XY[],
    ctx: ShapeContext,
): ArcParams | undefined {
    const circle = fitCircle(points);
    if (!circle) return undefined;
    // A nearly straight row fits a huge circle; a line reads better there.
    if (circle.r > 400 * ctx.stepPx) return undefined;
    const angles = points
        .map((q) => Math.atan2(q.y - circle.center.y, q.x - circle.center.x))
        .sort((x, y) => x - y);
    let gapAfter = angles.length - 1;
    let widest = angles[0]! + TAU - angles.at(-1)!;
    for (let i = 0; i < angles.length - 1; i++) {
        const gap = angles[i + 1]! - angles[i]!;
        if (gap > widest) {
            widest = gap;
            gapAfter = i;
        }
    }
    const startAngle = angles[(gapAfter + 1) % angles.length]!;
    const sweep = TAU - widest;
    const a = polar(circle.center, circle.r, startAngle);
    const b = polar(circle.center, circle.r, startAngle + sweep);
    const middle = polar(circle.center, circle.r, startAngle + sweep / 2);
    const params: ArcParams = { a, b, bulge: 0, spacing: FIT };
    const fitted = {
        ...params,
        bulge: dot(sub(middle, mid(a, b)), chordNormal(params)),
    };
    // Start from the left end, as a line does, so "Lay from Start" means the same end. Swapping
    // the ends flips the chord's normal, so the bulge changes sign to keep the same middle.
    return a.x > b.x + 1e-9
        ? { ...fitted, a: b, b: a, bulge: -fitted.bulge }
        : fitted;
}

/** The arc's radius and sweep, when it isn't flat */
function arcGeometry(p: ArcParams): { r: number; sweep: number } | null {
    const segment = arcSegment(p);
    return segment.type === "arc"
        ? { r: segment.r, sweep: Math.abs(segment.sweep) }
        : null;
}

export const arcKind: ShapeKind<ArcParams> = {
    id: "arc",
    version: 1,
    label: "Arc",
    icon: CircleNotchIcon,
    family: "path",
    groups: [SPACING_GROUP],
    measures: [
        {
            key: "radius",
            label: "Radius",
            unit: "length",
            get: (p) => arcGeometry(p)?.r ?? 0,
            // Same ends; the bulge that gives this radius, keeping the arc's side and whether it
            // is more or less than half a circle. A radius under half the chord is a half circle.
            set(p, r) {
                const h = dist(p.a, p.b) / 2;
                const radius = Math.max(r, h);
                const major = Math.abs(p.bulge) > h;
                const rise = Math.sqrt(radius * radius - h * h);
                const sign = p.bulge < 0 ? -1 : 1;
                return {
                    ...p,
                    bulge: sign * (major ? radius + rise : radius - rise),
                };
            },
        },
        {
            key: "sweep",
            label: "Sweep",
            unit: "angle",
            min: 1,
            get: (p) => arcGeometry(p)?.sweep ?? 0,
            // The sagitta of an arc over chord 2h sweeping θ is h·tan(θ/4)
            set(p, sweep) {
                const h = dist(p.a, p.b) / 2;
                const clamped = Math.min(
                    Math.max(sweep, 1e-3),
                    2 * Math.PI - 1e-3,
                );
                const sign = p.bulge < 0 ? -1 : 1;
                return { ...p, bulge: sign * h * Math.tan(clamped / 4) };
            },
        },
    ],

    fit({ current }, ctx) {
        const fitted = arcThroughPoints(current, ctx);
        if (fitted) return fitted;
        const ends = principalExtremes(current);
        const c = current[0] ?? xy(0, 0);
        const [a, b] = ends ?? [
            xy(c.x - 4 * ctx.stepPx, c.y),
            xy(c.x + 4 * ctx.stepPx, c.y),
        ];
        // Straight or too few marchers: start with a gentle arc bowing toward the front (+y).
        const params: ArcParams = { a, b, bulge: 0, spacing: FIT };
        const towardFront = chordNormal(params).y >= 0 ? 1 : -1;
        return { ...params, bulge: (towardFront * dist(a, b)) / 4 };
    },

    handles: (p) => [
        { key: "a", role: "point", at: p.a, start: true },
        { key: "b", role: "point", at: p.b },
        { key: "bulge", role: "bulge", at: arcMiddle(p) },
        { key: "move", role: "move", at: mid(p.a, p.b) },
    ],

    drag(p, key, to, { shift }) {
        if (key === "move") {
            const delta = sub(to, mid(p.a, p.b));
            return { ...p, a: add(p.a, delta), b: add(p.b, delta) };
        }
        if (key === "bulge") {
            return { ...p, bulge: dot(sub(to, mid(p.a, p.b)), chordNormal(p)) };
        }
        if (key !== "a" && key !== "b") return p;
        // Moving an end keeps the arc's proportions: the bulge scales with the chord.
        const ratio = len(sub(p.b, p.a)) === 0 ? 0 : p.bulge / dist(p.a, p.b);
        const next =
            key === "a"
                ? { ...p, a: shift ? snapAngle(p.b, to, Math.PI / 4) : to }
                : { ...p, b: shift ? snapAngle(p.a, to, Math.PI / 4) : to };
        return { ...next, bulge: ratio * dist(next.a, next.b) };
    },

    outline: (p, n, ctx) => pathOutline(arcPath(p), p.spacing, n, ctx),

    guide: (p, _n, ctx) => pathGuide(arcPath(p), p.spacing, ctx),

    generate: (p, n, ctx) => sampleAlong(arcPath(p), p.spacing, n, ctx.stepPx),

    orderKey: (p, point) => [arcPath(p).project(point)],

    readouts: (p, n, ctx) => pathReadouts(arcPath(p), p.spacing, n, ctx),

    validate(p) {
        if (dist(p.a, p.b) === 0) {
            return [
                {
                    level: "error",
                    message: "The arc's ends are on the same spot",
                },
            ];
        }
        if (arcSegment(p).type === "line") {
            return [
                {
                    level: "info",
                    message: "The arc is flat, so it's a straight line",
                },
            ];
        }
        return [];
    },
};
