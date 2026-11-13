/**
 * Pins on the open path, pathways step 5 (spec Appendix M): where its walker is at the playhead
 * (the playhead marker), the count each pinned point carries, the count any point is passed on
 * now, and what a drop of the marker means. Pure: the field mode and the path bar read these.
 *
 * A group path's clock is measured on its reference walk `W` (from its stored ends F and G), and
 * its line is drawn from its members' middles now (AP-R5), so the two differ only on the first and
 * last legs: a place on `W` is drawn at the same share of the drawn leg there, and at the same
 * distance from the first point on the shared part.
 */
import {
    clockBeatAt,
    clockPlace,
    groupSchedule,
    placeOfPoint,
    routeClock,
    routePointAtDistance,
    type RouteClock,
    type RoutePath,
    type RoutePin,
} from "@openmarch/core";
import type { XY } from "@/shapes/types";
import type { PinDrop } from "@/db-functions/timelineRoutePins";
import { curveOf, type PathShape } from "./pathEdit";
import type { PathTarget } from "./pathTarget";

const tuple = (p: XY): [number, number] => [p.x, p.y];
const xy = (p: readonly [number, number]): XY => ({ x: p[0], y: p[1] });

/** Whether `target` takes pins: a stored path, not a trail (trails take corner counts, step 6) */
export const takesPins = (target: PathTarget): boolean =>
    target.routeId !== null && !target.trail;

/** The walk the clock is measured on (R-15): `W` for a group path, the own path otherwise */
function knotPath(target: PathTarget, shape: PathShape): RoutePath {
    if (!target.group) return curveOf(shape);
    const ends = shape.ends ?? { from: shape.from, to: shape.to };
    return groupSchedule({
        from: tuple(ends.from),
        to: tuple(ends.to),
        points: shape.points.map((p) => ({
            ...(p.id === undefined ? {} : { id: p.id }),
            at: tuple(p.at),
            ...((p.tension ?? 0) > 0 ? { tension: p.tension } : {}),
            ...(p.bulge ? { bulge: p.bulge } : {}),
        })),
        ...(shape.toBulge ? { toBulge: shape.toBulge } : {}),
    }).W;
}

const countsOf = (target: PathTarget) => target.end - target.start;

/** The clock of `target`'s pins on `path`, or null with none that count (steady speed) */
function clockOf(
    target: PathTarget,
    shape: PathShape,
    path: RoutePath,
): RouteClock | null {
    const pins = target.pins ?? [];
    if (pins.length === 0) return null;
    const clock = routeClock(
        path,
        shape.points,
        { v: 1, pins: [...pins] },
        countsOf(target),
    );
    return clock?.active ? clock : null;
}

/** Place `x` on the knot path, drawn on the shape's line (see the module note) */
function drawnAt(
    target: PathTarget,
    shape: PathShape,
    path: RoutePath,
    x: number,
): XY {
    const shown = curveOf(shape);
    if (!target.group) return xy(routePointAtDistance(shown, x));
    const m = path.V.length - 2;
    if (m < 1 || shown.V.length - 2 !== m)
        return xy(routePointAtDistance(shown, (x / (path.L || 1)) * shown.L));
    const d1 = path.D[1]!;
    const dm = path.D[m]!;
    const s1 = shown.D[1]!;
    const sm = shown.D[m]!;
    const along =
        x < d1
            ? (x / d1) * s1
            : x <= dm
              ? s1 + (x - d1)
              : sm + ((x - dm) / (path.L - dm)) * (shown.L - sm);
    return xy(routePointAtDistance(shown, along));
}

/**
 * The playhead marker: where the path's walker (its reference walk, for a group path) is at
 * `beat`, or null when the playhead isn't strictly inside the move.
 */
export function playheadMarkerAt(
    target: PathTarget,
    shape: PathShape,
    beat: number,
): XY | null {
    if (!takesPins(target)) return null;
    const u = beat - target.start;
    const c = countsOf(target);
    if (!(u > 0 && u < c)) return null;
    const path = knotPath(target, shape);
    const clock = clockOf(target, shape, path);
    const x = clock ? clockPlace(clock, u) : (u / c) * path.L;
    return drawnAt(target, shape, path, x);
}

/** The count (beats into the move) point `index` of the shape is passed on now */
export function passingCount(
    target: PathTarget,
    shape: PathShape,
    index: number,
): number {
    const path = knotPath(target, shape);
    const x = placeOfPoint(path, index);
    const clock = clockOf(target, shape, path);
    if (clock) return clockBeatAt(clock, x);
    return path.L > 0 ? (countsOf(target) * x) / path.L : 0;
}

/** Each pinned point's count tag: where it is drawn and its count */
export function pinTags(
    target: PathTarget,
    shape: PathShape,
): { at: XY; text: string; pointId: string }[] {
    const pins: readonly RoutePin[] = target.pins ?? [];
    return pins.flatMap((pin) => {
        const point = shape.points.find((p) => p.id === pin.point);
        return point
            ? [{ at: point.at, text: formatCount(pin.at), pointId: pin.point }]
            : [];
    });
}

/** A count as the bar and tags write it: whole, or with a half or one decimal */
export function formatCount(count: number): string {
    if (Number.isInteger(count)) return `${count}`;
    if (Number.isInteger(count * 2)) return `${Math.floor(count)}½`;
    return count.toFixed(1);
}

/** The nearest place on the shape's drawn line to `at`: which leg (piece), and where */
function nearestOnLine(
    shape: PathShape,
    at: XY,
): { piece: number; point: XY; dist: number } {
    const path = curveOf(shape);
    const p = tuple(at);
    let best = { piece: 0, point: xy(path.V[0]!), dist: Infinity };
    const consider = (
        piece: number,
        a: readonly [number, number],
        b: readonly [number, number],
    ) => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t =
            len2 > 0
                ? Math.max(
                      0,
                      Math.min(
                          1,
                          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2,
                      ),
                  )
                : 0;
        const q: [number, number] = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best.dist) best = { piece, point: xy(q), dist: d };
    };
    path.pieces.forEach((piece, j) => {
        const D0 = path.D[j]!;
        const len = path.D[j + 1]! - D0;
        if (piece.kind === "line") {
            consider(j, path.V[j]!, path.V[j + 1]!);
            return;
        }
        const n = 48;
        let prev = path.V[j]!;
        for (let i = 1; i <= n; i++) {
            const next =
                i === n
                    ? path.V[j + 1]!
                    : routePointAtDistance(path, D0 + (len * i) / n);
            consider(j, prev, next);
            prev = next;
        }
    });
    return best;
}

/**
 * What a drop of the playhead marker at `at` means (AP-P2): a point within `snap` field units
 * (it pins that point), or a place on a straight leg (it adds a corner there and pins it; for a
 * group path only between its first and last points, whose legs are each member's own). Null
 * on a curve or an arc, or off the path's shared part: the drop refuses.
 */
export function pinDropAt(
    target: PathTarget,
    shape: PathShape,
    at: XY,
    snap: number,
): { drop: PinDrop; at: XY } | null {
    const pointNear = shape.points.findIndex(
        (p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) <= snap,
    );
    if (pointNear >= 0) {
        const p = shape.points[pointNear]!;
        return p.id
            ? { drop: { kind: "point", pointId: p.id }, at: p.at }
            : null;
    }
    const near = nearestOnLine(shape, at);
    const path = curveOf(shape);
    const piece = path.pieces[near.piece];
    if (piece?.kind !== "line") return null;
    const last = path.pieces.length - 1;
    if (target.group && (near.piece === 0 || near.piece === last)) return null;
    const next = path.source[near.piece + 1]!;
    return {
        drop: {
            kind: "stretch",
            before: next < 0 ? shape.points.length : next,
            at: [near.point.x, near.point.y],
        },
        at: near.point,
    };
}

/** Where the marker is drawn while dragged: the drop's place, or the nearest place on the line */
export function markerDragAt(
    target: PathTarget,
    shape: PathShape,
    at: XY,
    snap: number,
): { at: XY; drop: PinDrop | null } {
    const hit = pinDropAt(target, shape, at, snap);
    if (hit) return { at: hit.at, drop: hit.drop };
    return { at: nearestOnLine(shape, at).point, drop: null };
}

/**
 * Big steps with pins (spec J.6, Appendix M): how much faster than one steady speed the path is
 * walked anywhere in places `[xa, xb]` on its knot path, the fastest stretch of the clock there
 * (1 with no pins). A leg's distance times this is the distance Big steps judges over the move.
 */
export function pinSpeedFactor(
    target: PathTarget,
    shape: PathShape,
    xa: number,
    xb: number,
): number {
    const path = knotPath(target, shape);
    const clock = clockOf(target, shape, path);
    if (!clock || !(path.L > 0)) return 1;
    const steady = path.L / countsOf(target);
    let factor = 0;
    for (let i = 0; i + 1 < clock.xs.length; i++) {
        const x0 = clock.xs[i]!;
        const x1 = clock.xs[i + 1]!;
        if (!(x1 > x0) || x1 <= xa || x0 >= xb) continue;
        const du = clock.us[i + 1]! - clock.us[i]!;
        factor = Math.max(factor, (x1 - x0) / du / steady);
    }
    return factor || 1;
}

/** The count (beats into the move) the knot path's walker reaches place `x`, pins and all */
export function countAtPlace(
    target: PathTarget,
    shape: PathShape,
    x: number,
): number {
    const path = knotPath(target, shape);
    const clock = clockOf(target, shape, path);
    if (clock) return clockBeatAt(clock, x);
    return path.L > 0 ? (countsOf(target) * x) / path.L : 0;
}
