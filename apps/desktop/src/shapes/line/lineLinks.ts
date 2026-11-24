import type { XY } from "../types";
import {
    isClosed,
    LINE_ENDS,
    type AttachRef,
    type LineEnd,
    type LineParams,
} from "./lineGeometry";

/**
 * A Line's ends attached to other placed Lines' ends (#1235, ADR 0006's linked-shapes amendment),
 * as far as the line itself goes: where its ends are, attaching and detaching one, and stretching
 * it when the shape at a joint moves the joint. Which shapes are linked is the placed shapes'
 * (`placed/shapeLinks.ts`). Everything here is pure.
 */

/** Where end `end` of the line is */
export const endPoint = (p: LineParams, end: LineEnd): XY => {
    const q = end === "start" ? p.points[0]! : p.points.at(-1)!;
    return { x: q.x, y: q.y };
};

/** The other end */
export const otherEnd = (end: LineEnd): LineEnd =>
    end === "start" ? "end" : "start";

/** Whether `p` is an open line, whose ends can attach */
export const hasEnds = (p: LineParams): boolean => !isClosed(p);

/** `p` with end `end` attached to `ref`, or detached when `ref` is undefined */
export function withAttach(
    p: LineParams,
    end: LineEnd,
    ref: AttachRef | undefined,
): LineParams {
    const now = { ...p.attach };
    if (ref) now[end] = { recipe: ref.recipe, end: ref.end };
    else delete now[end];
    const { attach: _attach, ...rest } = p;
    return Object.keys(now).length > 0 ? { ...rest, attach: now } : rest;
}

const close = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

/**
 * The line stretched so its ends land on `to` (an end left out stays where it is): turned and
 * scaled about the end that stays, every point with it, so its form is kept and only its size and
 * direction change. A bend keeps its sweep, an ellipse turns with it, and an offset (rise over run)
 * turns and scales with it; its turn and pivot, being its own, stay. With both ends moved by the
 * same amount it's moved. Unchanged when the ends are already there, or a line with its ends
 * together, or one stretched to nothing, which can't be turned or scaled: then it's moved by the
 * end that moved.
 */
export function stretchEnds(
    p: LineParams,
    to: Readonly<Partial<Record<LineEnd, XY>>>,
): LineParams {
    const a = endPoint(p, "start");
    const b = endPoint(p, "end");
    const a2 = to.start ?? a;
    const b2 = to.end ?? b;
    if (close(a, a2) && close(b, b2)) return p;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const d2 = { x: b2.x - a2.x, y: b2.y - a2.y };
    const dd = d.x * d.x + d.y * d.y;
    if (dd < 1e-12 || Math.hypot(d2.x, d2.y) < 1e-9) {
        const by = to.start
            ? { x: a2.x - a.x, y: a2.y - a.y }
            : { x: b2.x - b.x, y: b2.y - b.y };
        return {
            ...p,
            points: p.points.map((q) => ({
                ...q,
                x: q.x + by.x,
                y: q.y + by.y,
            })),
        };
    }
    // The complex factor taking d to d2: z' = a2 + (z - a) k
    const k = {
        x: (d2.x * d.x + d2.y * d.y) / dd,
        y: (d2.y * d.x - d2.x * d.y) / dd,
    };
    const times = (v: XY): XY => ({
        x: v.x * k.x - v.y * k.y,
        y: v.x * k.y + v.y * k.x,
    });
    const turned = (Math.atan2(k.y, k.x) * 180) / Math.PI;
    const points = p.points.map((q, i) => {
        const rel = times({ x: q.x - a.x, y: q.y - a.y });
        // The ends land exactly where they were asked to
        const at =
            i === 0
                ? a2
                : i === p.points.length - 1
                  ? b2
                  : {
                        x: a2.x + rel.x,
                        y: a2.y + rel.y,
                    };
        return {
            ...q,
            x: at.x,
            y: at.y,
            ...(q.ellipse && {
                ellipse: {
                    ...q.ellipse,
                    axis: (((q.ellipse.axis + turned) % 360) + 360) % 360,
                },
            }),
        };
    });
    return {
        ...p,
        points,
        ...(p.offset && { offset: times(p.offset) }),
    };
}

/** The line moved by `delta`, every point */
export function shiftLine(p: LineParams, delta: XY): LineParams {
    if (Math.abs(delta.x) < 1e-12 && Math.abs(delta.y) < 1e-12) return p;
    return {
        ...p,
        points: p.points.map((q) => ({
            ...q,
            x: q.x + delta.x,
            y: q.y + delta.y,
        })),
    };
}

/** The ends of `p` that are attached, in order */
export const attachedEnds = (p: LineParams): LineEnd[] =>
    hasEnds(p) ? LINE_ENDS.filter((end) => p.attach?.[end]) : [];
