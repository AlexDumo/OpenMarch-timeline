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
import { FIT, pathReadouts, SPACING_GROUP } from "./pathKind";

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
    return {
        ...params,
        bulge: dot(sub(middle, mid(a, b)), chordNormal(params)),
    };
}

export const arcKind: ShapeKind<ArcParams> = {
    id: "arc",
    version: 1,
    label: "Arc",
    icon: "CircleHalf",
    family: "path",
    groups: [SPACING_GROUP],

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
        { key: "a", role: "point", at: p.a },
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

    outline(p, n, ctx) {
        const path = arcPath(p);
        const slots = sampleAlong(path, p.spacing, n, ctx.stepPx);
        const first = Math.min(0, slots[0]?.s ?? 0);
        const last = Math.max(path.length, slots.at(-1)?.s ?? 0);
        const count = Math.max(
            2,
            Math.ceil((last - first) / (ctx.stepPx / 2)) + 1,
        );
        const points: XY[] = [];
        for (let i = 0; i < count; i++)
            points.push(path.at(first + ((last - first) * i) / (count - 1)));
        return [points];
    },

    generate: (p, n, ctx) => sampleAlong(arcPath(p), p.spacing, n, ctx.stepPx),

    orderKey: (p, point) => [arcPath(p).project(point)],

    readouts(p, n, ctx) {
        const readouts = pathReadouts(arcPath(p), p.spacing, n, ctx);
        const segment = arcSegment(p);
        if (segment.type === "arc") {
            readouts.push({
                label: "Radius",
                value: `${Math.round((segment.r / ctx.stepPx) * 100) / 100} steps`,
            });
        }
        return readouts;
    },

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
