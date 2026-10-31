import {
    fieldToFrame,
    frameToField,
    pivotPoint,
    type ShapeFrame,
} from "../frame/frame";
import { linePull } from "../frame/edgeGuides";
import { pivotOf } from "../frame/pivot";
import { catmullRomSpan } from "../geometry/catmullRom";
import { makePath, type Path, type Segment } from "../geometry/path";
import { cross, dot, lerp } from "../geometry/vec";
import { chordOffsets, groupGaps, layGroups } from "../spacing";
import {
    canLayOut,
    storedDistribution,
    type Distribution,
} from "../distribute/distribution";
import type { ToolEnv } from "../tool/toolKind";
import type { Slot, XY } from "../types";

/**
 * A Line as the shape host draws it (#523, #524, #525, spec #522): points the line passes through,
 * and how its marchers are spaced along it: by one interval, or by groups of marchers at their own
 * intervals (#526). A point with no tension is a corner, where the line turns sharply; a point with
 * tension is smooth, and the line bends through it (centripetal Catmull-Rom, the tension scaling
 * its handles). Every corner holds a marcher unless the corners switch is off; a smooth point
 * between the ends never does, and the two ends always hold one, smooth or not. A closed line
 * (#529) joins its last point to its first and runs smoothly round through a smooth first point;
 * it can be filled like a box (`lineFill.ts`). Everything here is pure.
 */

/**
 * A point the line passes through. Tension 0 is a corner; above 0 a smooth point, 1 the plain
 * Catmull-Rom curve, more rounder (up to {@link MAX_TENSION})
 */
export interface LinePoint extends XY {
    readonly tension: number;
    /**
     * Whether a marcher stands on this point whatever the line's corners switch says (#569): true
     * always one, false none forced here, so the intervals run straight through. Absent: as the
     * line ({@link holdsMarcher}). An open line's ends always hold one.
     */
    readonly marcher?: boolean;
}

/** The tension a point made smooth starts with: the plain Catmull-Rom curve (#525) */
export const SMOOTH = 1;
/** The roundest a point can be */
export const MAX_TENSION = 2;

/**
 * A run of marchers at one interval (spec #522, "Mixed intervals"). `count` absent is "the rest",
 * at most one group in a list; with a single group, every gap is `interval`. How the groups share
 * the marchers is `layGroups` (`spacing.ts`).
 */
export interface LineGroup {
    /** Field units between neighbors, straight across (the chord) */
    readonly interval: number;
    /** Marchers in the group, a whole number from 1; absent for the rest */
    readonly count?: number;
}

/** Where a run sits on a longer drawn line (Interval on the path) */
export type LineAnchor = "start" | "center" | "end";

/**
 * How the marchers are spaced (docs/timeline/research/shapes/05-interval-modes.md):
 *
 * - `fit`: the line as drawn, the interval worked out from it;
 * - `keep` (Keep interval): the interval fixed, the line's length following from its pivot;
 * - `path` (Interval on the path): both fixed, the run laid on the drawn line from `anchor`.
 */
export type LineSpacing =
    | { readonly mode: "fit" }
    | { readonly mode: "keep"; readonly groups: readonly LineGroup[] }
    | {
          readonly mode: "path";
          readonly groups: readonly LineGroup[];
          readonly anchor: LineAnchor;
      };

/**
 * What an interval measures (spec #522, "Measured"): `x` (↔) is how far neighbors are apart side
 * to side, `y` (↕) front to back. Absent is the true distance, straight across.
 */
export type LineMeasured = "x" | "y";

export interface LineParams {
    /** In order from the first marcher's end; two or more */
    readonly points: readonly LinePoint[];
    /**
     * A closed line joins its last point to its first (#529): its marchers have a gap on every
     * stretch, n gaps for n marchers, and it can be filled like a box. Open when absent.
     */
    readonly closed?: boolean;
    readonly spacing: LineSpacing;
    /**
     * False: the intervals run around the corners. Absent (or true): every corner holds a marcher
     * (#524)
     */
    readonly corners?: boolean;
    /**
     * How a closed line is filled, the host's (ADR 0006, amendment of 2026-10-22): Outline (the
     * line itself) when absent. Only on a closed line.
     */
    readonly distribution?: Distribution;
    /** The true distance when absent (#527) */
    readonly measured?: LineMeasured;
}

/** Whether `p` joins its last point to its first */
export const isClosed = (p: Pick<LineParams, "closed">): boolean =>
    p.closed === true;

const FIT: LineSpacing = { mode: "fit" };

const halfStep = (env: Pick<ToolEnv, "stepPx">) => env.stepPx / 2;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const length = (d: XY) => Math.hypot(d.x, d.y);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const corner = ({ x, y }: XY): LinePoint => ({ x, y, tension: 0 });
const withTension =
    (tension: number) =>
    ({ x, y }: XY): LinePoint => ({ x, y, tension });

/** A point's own fields: anything else is a later build's (ADR 0006, decision 5) */
const POINT_KEYS = new Set(["x", "y", "tension", "marcher"]);

const isPoint = (q: unknown): q is LinePoint =>
    typeof q === "object" &&
    q !== null &&
    Object.keys(q).every((key) => POINT_KEYS.has(key)) &&
    ((q as LinePoint).marcher === undefined ||
        typeof (q as LinePoint).marcher === "boolean") &&
    Number.isFinite((q as LinePoint).x) &&
    Number.isFinite((q as LinePoint).y) &&
    Number.isFinite((q as LinePoint).tension) &&
    (q as LinePoint).tension >= 0 &&
    (q as LinePoint).tension <= MAX_TENSION;

const isGroup = (g: unknown): g is LineGroup => {
    if (typeof g !== "object" || g === null) return false;
    const { interval, count } = g as LineGroup;
    if (!Number.isFinite(interval) || !(interval > 0)) return false;
    return count === undefined || (Number.isInteger(count) && count >= 1);
};

const ANCHORS: readonly unknown[] = ["start", "center", "end"];
// `pivot` is the host's (ADR 0006, amendment of 2026-10-20), stored beside the kind's own numbers
const KEYS = new Set([
    "points",
    "closed",
    "spacing",
    "corners",
    "distribution",
    "measured",
    "pivot",
]);

/**
 * Whether `params` is a line this version can lay out exactly as it was saved. Anything a newer
 * build adds is refused, so the recipe shows as plain positions instead of being misread and
 * rewritten on the first edit (ADR 0006, decision 5). Each later ticket widens this as it adds
 * the layout.
 */
export function isLineParams(params: unknown): params is LineParams {
    if (typeof params !== "object" || params === null) return false;
    if (Object.keys(params).some((key) => !KEYS.has(key))) return false;
    const p = params as Partial<LineParams>;
    if (p.closed !== undefined && typeof p.closed !== "boolean") return false;
    if (p.corners !== undefined && typeof p.corners !== "boolean") return false;
    if (p.measured !== undefined && p.measured !== "x" && p.measured !== "y")
        return false;
    if (!Array.isArray(p.points) || p.points.length < (p.closed ? 3 : 2))
        return false;
    // A closed line's fill (#529): one this version fills, and never on an open line
    if (p.distribution !== undefined) {
        if (p.closed !== true) return false;
        if (!storedDistribution(p, 1) || !canLayOut(p)) return false;
    }
    if (!p.points.every(isPoint)) return false;
    const spacing: unknown = p.spacing;
    if (typeof spacing !== "object" || spacing === null) return false;
    const sp = spacing as {
        mode?: unknown;
        groups?: unknown;
        anchor?: unknown;
    };
    if (sp.mode === "fit") return true;
    if (sp.mode !== "keep" && sp.mode !== "path") return false;
    if (!Array.isArray(sp.groups) || sp.groups.length === 0) return false;
    if (!sp.groups.every(isGroup)) return false;
    // Mixed intervals (#526): any groups, at most one of them the rest
    const rests = (sp.groups as LineGroup[]).filter(
        (g) => g.count === undefined,
    );
    if (rests.length > 1) return false;
    if (sp.mode === "keep") return true;
    // A closed line has no ends to lay a run from
    return !p.closed && ANCHORS.includes(sp.anchor);
}

/**
 * The line's segments, from each point to the next: straight where it doesn't bend, else a cubic
 * whose handles are the Catmull-Rom curve's at each smooth point, scaled by its tension (none at a
 * corner). A closed line's last runs from its last point to its first, its curve's neighbors
 * wrapping round (#529).
 */
export function lineSegments(p: LineParams): Segment[] {
    const points = p.points;
    const closed = isClosed(p);
    const count = closed ? points.length : points.length - 1;
    return Array.from({ length: count }, (_, i): Segment => {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const line: Segment = { type: "line", a, b };
        if (a.tension === 0 && b.tension === 0) return line;
        const full = catmullRomSpan(points, i, closed);
        const c1 = lerp(a, full.c1, a.tension);
        const c2 = lerp(b, full.c2, b.tension);
        // Handles along the segment and inside it (an end beside a corner) bend nothing
        const d = sub(b, a);
        const l2 = dot(d, d);
        const along = (c: XY) => {
            const t = dot(sub(c, a), d);
            return (
                Math.abs(cross(d, sub(c, a))) <= 1e-9 * l2 && t >= 0 && t <= l2
            );
        };
        return along(c1) && along(c2) ? line : { type: "cubic", a, c1, c2, b };
    });
}

/** The path through the line's points, round to its first again when closed */
export function linePath(p: LineParams): Path {
    return makePath(lineSegments(p), isClosed(p));
}

/** How many gaps `n` marchers have along the line: one per marcher on a closed line (#529) */
export const gapCount = (p: LineParams, n: number): number =>
    isClosed(p) ? n : n - 1;

/** Whether any point of the line is smooth */
const smooth = (p: LineParams) => p.points.some((q) => q.tension > 0);

/** How many pieces a curved segment of a closed outline is cut into */
const CURVE_PIECES = 32;

/**
 * The points a stretch of the line can be drawn through: its points when it's straight from point
 * to point, else about 24 a segment along its curves. A closed line's go once round, the last
 * not repeating the first ({@link closedOutline}).
 */
export function lineOutline(p: LineParams): XY[] {
    if (isClosed(p)) return closedOutline(p).points;
    if (!smooth(p)) return p.points.map(({ x, y }) => ({ x, y }));
    const path = linePath(p);
    return path.polyline(path.length / (24 * (p.points.length - 1)));
}

/**
 * A closed line's outline as a polygon (#529): every point, and along each curved segment
 * {@link CURVE_PIECES} pieces of it, so a region filled from it follows the curve as drawn.
 * `corners` are the indices in `points` of the line's corners (tension 0).
 */
export function closedOutline(p: LineParams): {
    readonly points: XY[];
    readonly corners: number[];
} {
    const points: XY[] = [];
    const corners: number[] = [];
    lineSegments(p).forEach((segment, i) => {
        if (p.points[i]!.tension === 0) corners.push(points.length);
        const { x, y } = p.points[i]!;
        points.push({ x, y });
        if (segment.type === "line") return;
        const path = makePath([segment]);
        for (let k = 1; k < CURVE_PIECES; k++)
            points.push(path.at((path.length * k) / CURVE_PIECES));
    });
    return { points, corners };
}

/** Where segment `index`'s midpoint handle sits: halfway along it, on its curve */
export function segmentMidpoint(p: LineParams, index: number): XY {
    const segment = lineSegments(p)[index]!;
    const path = makePath([segment]);
    return path.at(path.length / 2);
}

/**
 * Whether point `index` holds a marcher, in a line whose held points do (Fit and Keep interval,
 * {@link cornerGaps}): an open line's ends always; a point with its own answer (#569) as it says,
 * so one can opt out of the corners switch or in with it off; any other point when it's a corner
 * and the switch is on. A smooth point holds none unless it says so.
 */
export function holdsMarcher(p: LineParams, index: number): boolean {
    const q = p.points[index];
    if (!q) return false;
    const last = p.points.length - 1;
    if (!isClosed(p) && (index === 0 || index === last)) return true;
    if (q.marcher !== undefined) return q.marcher;
    return q.tension === 0 && p.corners !== false;
}

/**
 * The stretches between the points that hold a marcher (#524, #525, #569,
 * {@link holdsMarcher}): from an end or a held point to the next, the points that hold none
 * inside them. `from` and `to` are point indices. A closed line's run from held point to held
 * point round from its first, the last back past its first point to that one (`to` counting on
 * past the last point, #529); with none, one stretch from its first point all the way round.
 */
export function lineStretches(
    p: LineParams,
): { readonly from: number; readonly to: number }[] {
    const count = p.points.length;
    if (isClosed(p)) {
        const held = p.points.flatMap((_, i) =>
            holdsMarcher(p, i) ? [i] : [],
        );
        if (held.length === 0) return [{ from: 0, to: count }];
        return held.map((from, k) => ({
            from,
            to: held[k + 1] ?? held[0]! + count,
        }));
    }
    const last = count - 1;
    const stretches: { from: number; to: number }[] = [];
    let from = 0;
    for (let i = 1; i <= last; i++) {
        if (!holdsMarcher(p, i)) continue;
        stretches.push({ from, to: i });
        from = i;
    }
    return stretches;
}

/** Each stretch's path, in order; a closed line's segments taken round past its last */
function stretchPaths(p: LineParams): Path[] {
    const segments = lineSegments(p);
    return lineStretches(p).map(({ from, to }) =>
        makePath(
            Array.from(
                { length: to - from },
                (_, i) => segments[(from + i) % segments.length]!,
            ),
        ),
    );
}

/** Whether `path` runs straight from end to end */
const straight = (path: Path) =>
    length(sub(path.at(path.length), path.at(0))) >= path.length * (1 - 1e-9);

/**
 * How much `gaps`, measured straight across (the chord) and in order, must be scaled to reach
 * exactly from one end of `path` to the other. On a straight path it's the length over their sum.
 */
function chordScale(path: Path, gaps: readonly number[]): number {
    const whole = sum(gaps);
    if (!(whole > 0) || !(path.length > 0)) return 0;
    const arc = path.length / whole;
    // A chord is as long as its arc only on a straight stretch
    if (straight(path)) return arc;
    const reach = (k: number) =>
        chordOffsets(
            path,
            0,
            gaps.map((gap) => gap * k),
        ).at(-1)!;
    // Each chord reaches at least its own length along, so the arc's share reaches the end
    let lo = 0;
    let hi = arc;
    while (hi - lo > arc * 1e-10) {
        const mid = (lo + hi) / 2;
        if (reach(mid) < path.length) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * The interval at which `gaps` neighbors, measured straight across, reach exactly from one end of
 * `path` to the other
 */
const evenChord = (path: Path, gaps: number): number =>
    gaps > 0 ? chordScale(path, Array<number>(gaps).fill(1)) : 0;

/**
 * Neighbors `gaps` apart straight across (scaled to fit, in order), from one end of `path` to the
 * other, tagged from `from`
 */
function runSpots(path: Path, gaps: readonly number[], from = 0): Slot[] {
    const k = chordScale(path, gaps);
    const offsets = chordOffsets(
        path,
        0,
        gaps.map((gap) => gap * k),
    );
    // The last on the end exactly, whatever the search left
    offsets[gaps.length] = path.length;
    return offsets.map((s) => ({ ...path.at(s), s: from + s }));
}

/**
 * Whether the line is spaced by groups (#526) rather than one interval for everyone: more than
 * one group, or a group with a count
 */
export const hasGroups = (p: LineParams): boolean =>
    p.spacing.mode !== "fit" &&
    (p.spacing.groups.length > 1 || p.spacing.groups[0]!.count !== undefined);

/**
 * The interval a typed spacing keeps, in field units, the smallest of its groups' when it has
 * several; null in Fit
 */
export function typedInterval(p: LineParams): number | null {
    if (p.spacing.mode === "fit") return null;
    return Math.min(...p.spacing.groups.map((g) => g.interval));
}

/**
 * The gaps between the `n` marchers in a typed spacing, in field units, in order from the first
 * point; null in Fit. A closed line's run goes once round (#529): its last gap, from the last
 * marcher back to the first, is the seam between the last group and the first.
 */
export function lineGaps(p: LineParams, n: number): number[] | null {
    if (p.spacing.mode === "fit") return null;
    const { groups } = p.spacing;
    const gaps = groupGaps(groups, n, (g) => g.interval);
    if (!isClosed(p) || n < 2) return gaps;
    const laid = layGroups(groups, n);
    const first = groups[laid.findIndex((g) => g.count > 0)]!;
    const last = groups[laid.findLastIndex((g) => g.count > 0)]!;
    return [...gaps, Math.max(first.interval, last.interval)];
}

const coord = (q: XY, axis: LineMeasured) => (axis === "x" ? q.x : q.y);

/**
 * How the drawn line moves along `axis`, step by step from its first point: each straight segment
 * one step, each curve sampled finely (`line` false)
 */
function axisSteps(
    p: LineParams,
    axis: LineMeasured,
): { readonly d: number; readonly line: boolean }[] {
    return lineSegments(p).flatMap(
        (segment): { d: number; line: boolean }[] => {
            if (segment.type === "line")
                return [
                    {
                        d: coord(segment.b, axis) - coord(segment.a, axis),
                        line: true,
                    },
                ];
            const path = makePath([segment]);
            const points = path.polyline(path.length / 32);
            return points.slice(1).map((q, i) => ({
                d: coord(q, axis) - coord(points[i]!, axis),
                line: false,
            }));
        },
    );
}

/**
 * Why the line can't be measured along `axis` (↔ or ↕), or null when it can: over its whole drawn
 * path (curves sampled) it has to keep going one way that way, so each spot has one place on it.
 * `none`: it doesn't go that way at all; `turns`: it turns back; `square`: a straight part of it
 * stands still that way (runs square to it).
 */
export function measuredBlock(
    p: LineParams,
    axis: LineMeasured,
): "none" | "turns" | "square" | null {
    const steps = axisSteps(p, axis);
    if (steps.every(({ d }) => Math.abs(d) < 1e-9)) return "none";
    if (p.closed) return "turns";
    const on = steps.some(({ d }) => d > 1e-9);
    const back = steps.some(({ d }) => d < -1e-9);
    if (on && back) return "turns";
    return steps.some(({ d, line }) => line && Math.abs(d) < 1e-9)
        ? "square"
        : null;
}

/**
 * What the line's intervals measure as it's laid out: its Measured setting, or the true distance
 * (null) when that's absent or the line no longer goes one way along it (a part turned square)
 */
export function measuredAxis(p: LineParams): LineMeasured | null {
    return p.measured && measuredBlock(p, p.measured) === null
        ? p.measured
        : null;
}

/** How far apart `a` and `b` are along `axis` */
const extent = (a: XY, b: XY, axis: LineMeasured) =>
    Math.abs(coord(b, axis) - coord(a, axis));

/** The line's length along `axis`, end to end */
const axisLength = (p: LineParams, axis: LineMeasured) =>
    extent(p.points[0]!, p.points.at(-1)!, axis);

/** Each stretch's length along `axis` ({@link lineStretches}) */
const stretchExtents = (p: LineParams, axis: LineMeasured): number[] =>
    lineStretches(p).map(({ from, to }) =>
        extent(p.points[from]!, p.points[to]!, axis),
    );

/**
 * Where each of `gaps` puts a neighbor, from `from`: within a run of equal gaps `start + i * gap`
 * rather than a running sum, so a spot on the grid isn't pushed off it by rounding
 */
function offsetsOf(gaps: readonly number[], from: number): number[] {
    const out = [from];
    let start = from;
    let gap = NaN;
    let i = 0;
    for (const g of gaps) {
        if (g !== gap) {
            start = out.at(-1)!;
            gap = g;
            i = 0;
        }
        out.push(start + ++i * g);
    }
    return out;
}

/**
 * The spot on `segments` (a line going one way along `axis`) where that coordinate is `c`,
 * exactly: on the segment that reaches it, or past an end along the end segment. Tagged with its
 * distance along them from `s0`.
 */
function atCoord(
    segments: readonly Segment[],
    axis: LineMeasured,
    c: number,
    s0 = 0,
): Slot {
    let s = s0;
    for (let i = 0; i < segments.length; i++) {
        const path = makePath([segments[i]!]);
        const a = path.at(0);
        const b = path.at(path.length);
        const ca = coord(a, axis);
        const cb = coord(b, axis);
        // Past this segment's far end: on to the next
        if (i < segments.length - 1 && (cb - c) * (cb - ca) < 0) {
            s += path.length;
            continue;
        }
        if (segments[i]!.type === "line") {
            const t = (c - ca) / (cb - ca);
            return { ...lerp(a, b, t), [axis]: c, s: s + path.length * t };
        }
        // Along a curve, found on it; past its ends along its end tangents
        const way = Math.sign(cb - ca);
        const off = (at: number) => (coord(path.at(at), axis) - c) * way;
        const span = Math.max(path.length, 1e-9);
        let lo = 0;
        let hi = path.length;
        for (let k = 0; k < 60 && off(lo) > 0; k++) lo -= span;
        for (let k = 0; k < 60 && off(hi) < 0; k++) hi += span;
        for (let k = 0; k < 60; k++) {
            const mid = (lo + hi) / 2;
            if (off(mid) < 0) lo = mid;
            else hi = mid;
        }
        const at = (lo + hi) / 2;
        return { ...path.at(at), [axis]: c, s: s + at };
    }
    const first = segments[0] ? makePath([segments[0]]).at(0) : { x: 0, y: 0 };
    return { ...first, s: s0 };
}

/**
 * Neighbors `gaps` apart along `axis` (scaled to fit, in order), from one end of `segments` to
 * the other, tagged from `from`: a stretch between corners of a measured line
 */
function axisRunSpots(
    segments: readonly Segment[],
    axis: LineMeasured,
    gaps: readonly number[],
    from: number,
): Slot[] {
    const path = makePath(segments);
    const first = coord(path.at(0), axis);
    const last = coord(path.at(path.length), axis);
    const total = Math.abs(last - first);
    const way = Math.sign(last - first);
    const whole = sum(gaps);
    let k = whole > 0 ? total / whole : 0;
    // A stretch as long as its run takes its gaps as they are, so each lands on the grid
    if (Math.abs(k - 1) < 1e-9) k = 1;
    const offsets = offsetsOf(
        gaps.map((gap) => gap * k),
        0,
    );
    // The last on the end exactly
    offsets[gaps.length] = total;
    return offsets.map((o) => atCoord(segments, axis, first + way * o, from));
}

/**
 * The interval between neighbors, in field units: the typed one, or in Fit the one the drawn
 * line works out to, measured as the line measures it
 */
export function lineInterval(p: LineParams, n: number): number {
    const typed = typedInterval(p);
    if (typed !== null) return typed;
    if (n <= 1) return 0;
    const axis = measuredAxis(p);
    if (axis) return axisLength(p, axis) / (n - 1);
    const gaps = gapCount(p, n);
    // Along a curve, the straight distance between neighbors (#525)
    return smooth(p) ? evenChord(linePath(p), gaps) : linePath(p).length / gaps;
}

/**
 * How many gaps each stretch (corner to corner, {@link lineStretches}) holds when every corner
 * holds a marcher (#524): a whole number each, at least one. With one interval for everyone (or in
 * Fit) they're in proportion to the stretches' lengths; with groups (#526) each corner takes the
 * seam between gaps nearest it along the run, so a stretch that is a whole run of the groups' gaps
 * holds exactly those. Measured ↔ or ↕ (#527), a stretch's length is how far it goes that way.
 * Null when no point between the ends holds a marcher ({@link holdsMarcher}: the switch off or no
 * corner, and no point asking for one, #569), the run is laid on the path (whatever the points
 * say), or there are fewer gaps than stretches. A closed line's stretches have n gaps between
 * them, round from its first held point (#529).
 */
export function cornerGaps(p: LineParams, n: number): number[] | null {
    if (p.spacing.mode === "path") return null;
    const held = isClosed(p)
        ? p.points.some((_, i) => holdsMarcher(p, i))
        : lineStretches(p).length > 1;
    if (!held) return null;
    const axis = measuredAxis(p);
    const lengths = axis
        ? stretchExtents(p, axis)
        : stretchPaths(p).map((path) => path.length);
    const gaps = gapCount(p, n);
    const total = sum(lengths);
    if (gaps < lengths.length || !(total > 0)) return null;
    if (hasGroups(p)) return seamGaps(lengths, lineGaps(p, n)!);
    const ideal = lengths.map((l) => (gaps * l) / total);
    const counts = ideal.map((x) => Math.max(1, Math.floor(x + 1e-9)));
    let left = sum(counts);
    // Largest remainders first, and never under one gap a stretch
    while (left < gaps) {
        const i = argMax(ideal.map((x, k) => x - counts[k]!));
        counts[i]!++;
        left++;
    }
    while (left > gaps) {
        const i = argMax(
            ideal.map((x, k) => (counts[k]! > 1 ? counts[k]! - x : -Infinity)),
        );
        counts[i]!--;
        left--;
    }
    return counts;
}

/**
 * How many of `gaps`, in order, each stretch of `lengths` holds: each corner at the seam whose
 * share of the run is nearest its share of the line, at least one gap a stretch
 */
function seamGaps(
    lengths: readonly number[],
    gaps: readonly number[],
): number[] {
    const total = sum(lengths);
    const run = sum(gaps);
    const counts: number[] = [];
    let along = 0;
    let seam = 0;
    let reach = 0;
    lengths.slice(0, -1).forEach((l, i) => {
        along += l;
        const want = (along / total) * run;
        // Room for one gap in each stretch still to come
        const last = gaps.length - (lengths.length - 1 - i);
        let best = seam + 1;
        let at = reach + gaps[seam]!;
        let bestAt = at;
        for (let j = seam + 2; j <= last; j++) {
            at += gaps[j - 1]!;
            if (Math.abs(at - want) < Math.abs(bestAt - want) - 1e-9) {
                best = j;
                bestAt = at;
            }
        }
        counts.push(best - seam);
        seam = best;
        reach = bestAt;
    });
    counts.push(gaps.length - seam);
    return counts;
}

/**
 * The gaps each stretch holds, in field units, when every corner holds a marcher: in Fit even
 * shares (1 each, scaled to the stretch), typed the line's gaps in order along it ({@link
 * lineGaps}), {@link cornerGaps} of them a stretch. Null when the corners don't hold marchers.
 */
export function cornerRuns(p: LineParams, n: number): number[][] | null {
    const counts = cornerGaps(p, n);
    if (!counts) return null;
    const gaps = lineGaps(p, n) ?? Array<number>(gapCount(p, n)).fill(1);
    let at = 0;
    return counts.map((count) => gaps.slice(at, (at += count)));
}

const argMax = (xs: readonly number[]): number =>
    xs.reduce((best, x, i) => (x > xs[best]! ? i : best), 0);

/**
 * In Fit with every corner holding a marcher, the narrowest and widest interval of its stretches, in
 * field units; null otherwise
 */
export function intervalRange(
    p: LineParams,
    n: number,
): { readonly min: number; readonly max: number } | null {
    const gaps = p.spacing.mode === "fit" ? cornerGaps(p, n) : null;
    if (!gaps) return null;
    const axis = measuredAxis(p);
    const each = axis
        ? stretchExtents(p, axis).map((l, i) => l / gaps[i]!)
        : stretchPaths(p).map((path, i) => evenChord(path, gaps[i]!));
    return { min: Math.min(...each), max: Math.max(...each) };
}

/**
 * In Keep interval with every corner holding a marcher, whether a stretch isn't as long as its run
 * of gaps, straight across (a whole number of intervals): a corner dragged with `fine` (#524).
 * Measured ↔ or ↕, as long that way.
 */
export function cornerOffInterval(p: LineParams, n: number): boolean {
    const runs = p.spacing.mode === "fit" ? null : cornerRuns(p, n);
    if (!runs) return false;
    const axis = measuredAxis(p);
    if (axis)
        return stretchExtents(p, axis).some(
            (l, i) => Math.abs(l - sum(runs[i]!)) > 1e-6 * Math.max(l, 1),
        );
    return stretchPaths(p).some(
        (path, i) => Math.abs(chordScale(path, runs[i]!) - 1) > 1e-6,
    );
}

/**
 * The spots of a line whose corners hold marchers: stretch by stretch from its first point, each
 * holding its run of gaps straight across, then the last point. In Keep interval a stretch is as
 * long as its run, so the gaps are as typed; a corner `fine` left off its interval scales its
 * stretches' gaps to fit (even gaps, with one interval) instead of running past the corner and
 * stacking marchers on it. Measured ↔ or ↕ (#527), each stretch holds its gaps that way. A closed
 * line's start at its first corner and end back on it (#529).
 */
function cornerSpots(p: LineParams, runs: readonly number[][]): Slot[] {
    const spots: Slot[] = [];
    const axis = measuredAxis(p);
    const segments = lineSegments(p);
    const stretches = lineStretches(p);
    const whole = makePath(segments).length;
    let s = sum(
        segments.slice(0, stretches[0]!.from).map((g) => makePath([g]).length),
    );
    stretchPaths(p).forEach((path, i) => {
        const { from, to } = stretches[i]!;
        spots.push(
            ...(axis
                ? axisRunSpots(segments.slice(from, to), axis, runs[i]!, s)
                : runSpots(path, runs[i]!, s)
            ).slice(0, -1),
        );
        s += path.length;
    });
    if (isClosed(p))
        return spots.map((spot) => ({ ...spot, s: spot.s! % whole }));
    const last = p.points.at(-1)!;
    spots.push({ x: last.x, y: last.y, s });
    return spots;
}

/**
 * The `n` spots along the line, tagged with their distance along it. Measured ↔ or ↕ (#527),
 * neighbors are their gaps apart that way, exactly; with `stepPx`, a centered run starts a whole
 * number of half steps from the line's start that way, so it stays on the grid with it.
 */
export function lineSpots(p: LineParams, n: number, stepPx?: number): Slot[] {
    if (n <= 0) return [];
    const path = linePath(p);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    const corners = cornerRuns(p, n);
    if (corners) return cornerSpots(p, corners);
    const closed = isClosed(p);
    const axis = measuredAxis(p);
    if (axis) return measuredSpots(p, n, axis, stepPx);
    const gaps = lineGaps(p, n);
    if (gaps === null) {
        if (n === 1) return [at(closed ? 0 : path.length / 2)];
        const count = gapCount(p, n);
        // Along a curve, neighbors evenly apart straight across (#525); a closed line's last
        // back on its first
        if (smooth(p))
            return runSpots(path, Array<number>(count).fill(1)).slice(0, n);
        return Array.from({ length: n }, (_, i) =>
            at((path.length * i) / count),
        );
    }
    // A closed line's run goes round from its first point, its last gap back to it
    if (closed) return chordOffsets(path, 0, gaps.slice(0, -1)).map(at);
    // Keep interval is sized to its run, which sits on it whole; on the path it sits at its anchor
    const anchor = p.spacing.mode === "path" ? p.spacing.anchor : "center";
    return anchoredSpots(p, gaps, anchor);
}

/** {@link lineSpots} on a line measured along `axis`, its corners holding no marchers */
function measuredSpots(
    p: LineParams,
    n: number,
    axis: LineMeasured,
    stepPx: number | undefined,
): Slot[] {
    const segments = lineSegments(p);
    const first = coord(p.points[0]!, axis);
    const total = axisLength(p, axis);
    const way = Math.sign(coord(p.points.at(-1)!, axis) - first);
    const at = (c: number) => atCoord(segments, axis, first + way * c);
    const gaps = lineGaps(p, n);
    if (gaps === null) {
        if (n === 1) return [at(total / 2)];
        return Array.from({ length: n }, (_, i) =>
            // The last spot is exactly on the end
            i === n - 1 ? at(total) : at((total * i) / (n - 1)),
        );
    }
    const run = sum(gaps);
    // Keep interval is sized to its run, which sits on it whole; on the path it sits at its anchor
    const anchor = p.spacing.mode === "path" ? p.spacing.anchor : "center";
    let from =
        anchor === "start"
            ? 0
            : anchor === "end"
              ? total - run
              : (total - run) / 2;
    // A centered run starts on a half step from the start
    if (stepPx && anchor === "center")
        from = Math.round(from / (stepPx / 2)) * (stepPx / 2);
    return offsetsOf(gaps, from).map(at);
}

const reversed = (segment: Segment): Segment =>
    segment.type === "cubic"
        ? {
              type: "cubic",
              a: segment.b,
              c1: segment.c2,
              c2: segment.c1,
              b: segment.a,
          }
        : segment.type === "line"
          ? { type: "line", a: segment.b, b: segment.a }
          : {
                ...segment,
                start: segment.start + segment.sweep,
                sweep: -segment.sweep,
            };

/**
 * A run of `gaps`, straight across, laid on the line at `anchor`: from its start, back from its
 * end, or centered with as much of the path spare before it as after it (#523, #525). Along a
 * curve the chords cover less path the more it bends there, so the end and the center are found on
 * the path itself, not from the run's length measured somewhere else. A run longer than the line
 * runs past its ends.
 */
function anchoredSpots(
    p: LineParams,
    gaps: readonly number[],
    anchor: LineAnchor,
): Slot[] {
    const segments = lineSegments(p);
    const path = makePath(segments);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    if (anchor === "start") return chordOffsets(path, 0, gaps).map(at);
    if (anchor === "end") {
        const back = makePath(segments.map(reversed).reverse());
        return chordOffsets(back, 0, [...gaps].reverse())
            .map((s) => ({ ...back.at(s), s: path.length - s }))
            .reverse();
    }
    // The path spare before the run less the path spare after it, which grows as the run starts
    // further along
    const lopsided = (from: number) =>
        from - (path.length - chordOffsets(path, from, gaps).at(-1)!);
    const span = Math.max(path.length, sum(gaps), 1e-9);
    let lo = -span;
    let hi = span;
    for (let i = 0; i < 60 && lopsided(lo) > 0; i++) lo -= span;
    for (let i = 0; i < 60 && lopsided(hi) < 0; i++) hi += span;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (lopsided(mid) < 0) lo = mid;
        else hi = mid;
    }
    return chordOffsets(path, (lo + hi) / 2, gaps).map(at);
}

/**
 * A closed line's turn (#529), within an eighth of a turn of 0: the sides of its outline as drawn
 * ({@link closedOutline}, a curve in short pieces), their directions taken a quarter turn at a
 * time so a side and the one square to it agree, averaged by length. It doesn't depend on which
 * point was clicked first or which way round. Only when sides square to each other make up most
 * of the outline (a rectangle, turned or not) does it follow them; anything else (a triangle, a
 * hexagon, a round curve) stands square to the field, so its ranks square to the field like a
 * box's.
 */
function closedTurn(outline: readonly XY[]): number {
    let x = 0;
    let y = 0;
    let around = 0;
    outline.forEach((a, i) => {
        const d = sub(outline[(i + 1) % outline.length]!, a);
        const angle = 4 * Math.atan2(d.y, d.x);
        x += length(d) * Math.cos(angle);
        y += length(d) * Math.sin(angle);
        around += length(d);
    });
    if (Math.hypot(x, y) < around / 2) return 0;
    const turn = Math.atan2(y, x) / 4;
    // A rectangle square to the field is 0, not float noise either side of it
    return Math.abs(turn) < 1e-12 ? 0 : turn;
}

/**
 * The line's frame: centered between its ends, turned along them, as long as they are apart and
 * with no depth. A closed line's is around its outline as drawn, turned square to the field
 * ({@link closedTurn}), so the same outline fills the same way however it was clicked. A line is
 * never flipped: a flip reverses it instead.
 */
export function lineFrame(p: LineParams): ShapeFrame {
    const a = p.points[0]!;
    const b = p.points.at(-1)!;
    const d = sub(b, a);
    const open: ShapeFrame = {
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        halfWidth: length(d) / 2,
        halfDepth: 0,
        rotation: length(d) > 0 ? Math.atan2(d.y, d.x) : 0,
        flipX: false,
        flipY: false,
    };
    if (!isClosed(p)) return open;
    const outline = closedOutline(p).points;
    const turned: ShapeFrame = { ...open, rotation: closedTurn(outline) };
    const local = outline.map((q) => fieldToFrame(turned, q));
    const xs = local.map((q) => q.x);
    const ys = local.map((q) => q.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    return {
        ...turned,
        center: frameToField(turned, {
            x: (left + right) / 2,
            y: (top + bottom) / 2,
        }),
        halfWidth: (right - left) / 2,
        halfDepth: (bottom - top) / 2,
    };
}

/**
 * The line moved, turned or flipped into `frame`: each point keeps its place in the frame, mirrored
 * when `frame` is flipped
 */
export function withLineFrame(p: LineParams, frame: ShapeFrame): LineParams {
    const was = lineFrame(p);
    const points = p.points.map((q) => {
        const local = fieldToFrame(was, q);
        return {
            ...q,
            ...frameToField(frame, {
                x: frame.flipX ? -local.x : local.x,
                y: frame.flipY ? -local.y : local.y,
            }),
        };
    });
    return { ...p, points };
}

/**
 * Where a dragged or drawn point lands: on a field line within the pull radius (a yard line, a
 * hash), else on the half-step grid, each axis on its own. `fine` keeps the pulls off the
 * ladder; the Snap toggle off does neither.
 */
export function landPoint(raw: XY, env: ToolEnv): XY {
    const grid = env.gridSnap(raw);
    if (env.pull === false || !env.fieldLines) return grid;
    const pull = linePull(
        [raw],
        env.fieldLines,
        Math.min(env.pullRadius ?? 0, env.stepPx / 4),
    );
    return {
        x: pull.x === null ? grid.x : raw.x + pull.x,
        y: pull.y === null ? grid.y : raw.y + pull.y,
    };
}

/**
 * `to` on the nearest 45° from `from`, as far along as the pointer went, on the half-step grid
 * when snapping (both offsets the same size on a diagonal)
 */
function at45(from: XY, to: XY, env: ToolEnv): XY {
    const d = sub(to, from);
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(d.y, d.x) / step) * step;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const t = d.x * u.x + d.y * u.y;
    const free = { x: from.x + u.x * t, y: from.y + u.y * t };
    if (!env.snap) return free;
    const unit = halfStep(env);
    const along =
        Math.round((Math.max(Math.abs(u.x), Math.abs(u.y)) * t) / unit) * unit;
    const sx = Math.abs(u.x) < 1e-9 ? 0 : Math.sign(u.x);
    const sy = Math.abs(u.y) < 1e-9 ? 0 : Math.sign(u.y);
    return { x: from.x + sx * along, y: from.y + sy * along };
}

/** Where an end goes when dragged to `to` with `other` fixed: landed, or at 45° with constrain */
const endAt = (other: XY, to: XY, env: ToolEnv): XY =>
    env.constrain ? at45(other, to, env) : landPoint(to, env);

/**
 * A straight line drawn from `from` to `to`, in Fit, its two points of `tension` (a Curve's are
 * smooth, #525); undefined while it's under half a step
 */
export function drawLine(
    from: XY,
    to: XY,
    env: ToolEnv,
    tension = 0,
): LineParams | undefined {
    const a = landPoint(from, env);
    const b = endAt(a, to, env);
    if (length(sub(b, a)) < halfStep(env) - 1e-9) return undefined;
    const line: LineParams = {
        points: [a, b].map(withTension(tension)),
        spacing: FIT,
    };
    return tension === 0 && yardToYard(a, b, env)
        ? { ...line, measured: "x" }
        : line;
}

/**
 * Whether a line from `a` to `b` runs diagonally from one yard line to another (spec #522): such
 * a line starts measured side to side (↔), the common diagonal needing no setting
 */
function yardToYard(a: XY, b: XY, env: ToolEnv): boolean {
    const yards = env.fieldLines?.x ?? [];
    const onYard = (x: number) =>
        yards.some((line) => Math.abs(line - x) < 1e-6);
    return (
        Math.abs(a.x - b.x) > 1e-6 &&
        Math.abs(a.y - b.y) > 1e-6 &&
        onYard(a.x) &&
        onYard(b.x)
    );
}

/**
 * A Curve drawn by a drag (#525): its two ends and, between them, a smooth point a quarter as far
 * off the line as they are apart, to the left of the way it was dragged, so it starts as a gentle
 * bow rather than straight; straight while the drag is too short for the bow to land between its
 * ends, undefined while it's under half a step
 */
export function drawCurve(
    from: XY,
    to: XY,
    env: ToolEnv,
): LineParams | undefined {
    const line = drawLine(from, to, env, SMOOTH);
    if (!line) return undefined;
    const [a, b] = line.points as [LinePoint, LinePoint];
    const d = sub(b, a);
    const bow = landPoint(
        { x: (a.x + b.x) / 2 + d.y / 4, y: (a.y + b.y) / 2 - d.x / 4 },
        env,
    );
    const onEnd = (q: XY) => q.x === bow.x && q.y === bow.y;
    if (onEnd(a) || onEnd(b)) return line;
    return { ...line, points: [a, withTension(SMOOTH)(bow), b] };
}

/**
 * Where a clicked point lands (#524): the first on a field line or the grid, each next one too, or
 * at 45° from the last with constrain
 */
export function landClicked(previous: readonly XY[], at: XY, env: ToolEnv): XY {
    const last = previous.at(-1);
    return last ? endAt(last, at, env) : landPoint(at, env);
}

/**
 * A line through clicked points, in Fit (#524), each of `tension` (a Curve's are smooth, #525), a
 * point landed on the one before it dropped; undefined while that leaves under two, or a line
 * under half a step long
 */
export function drawPoints(
    clicked: readonly XY[],
    env: ToolEnv,
    tension = 0,
): LineParams | undefined {
    const points = clicked.filter(
        (q, i) =>
            i === 0 || q.x !== clicked[i - 1]!.x || q.y !== clicked[i - 1]!.y,
    );
    if (points.length < 2) return undefined;
    const p: LineParams = {
        points: points.map(withTension(tension)),
        spacing: FIT,
    };
    if (linePath(p).length < halfStep(env) - 1e-9) return undefined;
    return p;
}

/**
 * Which way an end dragged to `to` points from the fixed end `other`, in Keep interval: the
 * offset on half steps (an end kept off the grid still turns square to the field), or at 45° with
 * constrain. Null for no direction.
 */
function directionFrom(other: XY, to: XY, env: ToolEnv): XY | null {
    let d = sub(env.constrain ? at45(other, to, env) : to, other);
    if (env.snap && !env.constrain) {
        const unit = halfStep(env);
        d = {
            x: Math.round(d.x / unit) * unit,
            y: Math.round(d.y / unit) * unit,
        };
    }
    const l = length(d);
    return l < 1e-9 ? null : { x: d.x / l, y: d.y / l };
}

/**
 * Point `index` dragged to `to`. In Fit and on the path the point goes there (landed). In Keep
 * interval an end turns about its neighbor, its segment's length (so its intervals) kept, and a
 * corner holding a marcher between straight segments lands where each of them is a whole number
 * of intervals long (#524); `fine` frees it. A smooth point, or a corner beside a curve, goes
 * where it's dragged. Measured ↔ or ↕ in Keep interval (#527), an end keeps how far it is that
 * way and takes the pointer's place the other way, and a corner lands a whole run of gaps that way
 * from the point before it. An end dropped on the other end closes the line (#529).
 */
export function dragPoint(
    base: LineParams,
    n: number,
    index: number,
    to: XY,
    env: ToolEnv,
): LineParams {
    const last = base.points.length - 1;
    const closed = isClosed(base);
    const end = !closed && (index === 0 || index === last);
    if (end && last >= 2) {
        const otherEnd = base.points[index === 0 ? last : 0]!;
        if (length(sub(to, otherEnd)) <= env.hitRadius)
            return closeLine(
                {
                    ...base,
                    points: base.points.filter((_, i) => i !== index),
                },
                n,
                env,
            );
    }
    const other = base.points[index === 0 ? (closed ? last : 1) : index - 1]!;
    const keep = base.spacing.mode === "keep" && n > 1;
    const axis = keep ? measuredAxis(base) : null;
    let point: XY | null;
    if (axis && end) {
        point = measuredEnd(base.points[index]!, other, to, axis, env);
    } else if (axis && env.snap && !end && straightCorner(base, n, index)) {
        point = cornerOnAxis(base, n, index, to, axis, env);
    } else if (keep && end) {
        const u = directionFrom(other, to, env);
        if (!u) return base;
        const was = length(sub(base.points[index]!, other));
        point = { x: other.x + u.x * was, y: other.y + u.y * was };
    } else if (keep && env.snap && !end && straightCorner(base, n, index)) {
        point = cornerOnIntervals(base, n, index, to);
        if (!point) return base;
    } else {
        point = endAt(other, to, env);
        if (length(sub(point, other)) < 1e-9) return base;
    }
    const was = base.points[index]!;
    if (was.x === point.x && was.y === point.y) return base;
    const points = base.points.map((q, i) =>
        i === index ? { ...q, x: point.x, y: point.y } : q,
    );
    return { ...base, points };
}

/** The other axis */
const across = (axis: LineMeasured): LineMeasured => (axis === "x" ? "y" : "x");

/** The point `along` that way on `axis` and `side` the other way */
const pointOn = (axis: LineMeasured, along: number, side: number): XY =>
    axis === "x" ? { x: along, y: side } : { x: side, y: along };

/**
 * Where an end of a line measured along `axis` goes, dragged to `to` in Keep interval: where it is
 * that way, so its run keeps its length, and where the pointer lands the other way; with
 * constrain, level with `other` or at 45° from it, whichever is nearer
 */
function measuredEnd(
    was: XY,
    other: XY,
    to: XY,
    axis: LineMeasured,
    env: ToolEnv,
): XY {
    const side = across(axis);
    let c = coord(landPoint(to, env), side);
    if (env.constrain) {
        const reach = extent(was, other, axis);
        const o = coord(other, side);
        c = [o, o - reach, o + reach].reduce((best, v) =>
            Math.abs(v - coord(to, side)) < Math.abs(best - coord(to, side))
                ? v
                : best,
        );
    }
    return pointOn(axis, coord(was, axis), c);
}

/**
 * Where corner `index` of a line measured along `axis` can stand in Keep interval: a whole run of
 * the gaps its two stretches hold from the point before it that way, at the seam nearest `to`, and
 * where the pointer lands the other way
 */
function cornerOnAxis(
    p: LineParams,
    n: number,
    index: number,
    to: XY,
    axis: LineMeasured,
    env: ToolEnv,
): XY {
    const runs = cornerRuns(p, n)!;
    const r = lineStretches(p).findIndex((stretch) => stretch.to === index);
    const both = [...runs[r]!, ...runs[r + 1]!];
    const a = p.points[index - 1]!;
    const way = Math.sign(coord(p.points[index + 1]!, axis) - coord(a, axis));
    const seams = offsetsOf(both, 0).slice(1, -1);
    const want = (coord(to, axis) - coord(a, axis)) * way;
    const best = seams.reduce((b, o) =>
        Math.abs(o - want) < Math.abs(b - want) ? o : b,
    );
    return pointOn(
        axis,
        coord(a, axis) + way * best,
        coord(landPoint(to, env), across(axis)),
    );
}

/**
 * The stretches either side of point `index`: the one ending on it and the one after, round a
 * closed line (#529); undefined where there's none
 */
function stretchesAt(p: LineParams, index: number) {
    const stretches = lineStretches(p);
    const count = p.points.length;
    const r = stretches.findIndex((stretch) => stretch.to % count === index);
    if (r < 0) return { r, before: undefined, after: undefined };
    const after = isClosed(p)
        ? stretches[(r + 1) % stretches.length]
        : stretches[r + 1];
    return { r, before: stretches[r], after };
}

/**
 * Whether point `index` is a corner holding a marcher with a straight stretch on each side: the
 * stretches whose lengths {@link cornerOnIntervals} can make whole runs of gaps
 */
function straightCorner(p: LineParams, n: number, index: number): boolean {
    if (p.points[index]!.tension !== 0 || !holdsMarcher(p, index)) return false;
    if (!cornerGaps(p, n)) return false;
    const { before, after } = stretchesAt(p, index);
    const segments = lineSegments(p);
    return [before, after].every(
        (stretch) =>
            stretch !== undefined &&
            stretch.to - stretch.from === 1 &&
            segments[stretch.from % segments.length]!.type === "line",
    );
}

/**
 * Where corner `index` can stand with its neighbors where they are and each of its two straight
 * stretches a whole run of the gaps the two hold now, in order (one typed interval, or the groups'
 * gaps, #526): the spot nearest `to`, or null when there's none
 */
function cornerOnIntervals(
    p: LineParams,
    n: number,
    index: number,
    to: XY,
): XY | null {
    const runs = cornerRuns(p, n)!;
    const { r } = stretchesAt(p, index);
    const both = [...runs[r]!, ...runs[(r + 1) % runs.length]!];
    const whole = sum(both);
    const count = p.points.length;
    const a = p.points[(index - 1 + count) % count]!;
    const b = p.points[(index + 1) % count]!;
    let best: XY | null = null;
    let ra = 0;
    for (let k = 1; k < both.length; k++) {
        ra += both[k - 1]!;
        for (const q of circlesMeet(a, ra, b, whole - ra))
            if (!best || length(sub(q, to)) < length(sub(best, to))) best = q;
    }
    return best;
}

/** Where the circle about `a` of radius `ra` meets the one about `b` of radius `rb` */
function circlesMeet(a: XY, ra: number, b: XY, rb: number): XY[] {
    const d = sub(b, a);
    const l = length(d);
    if (l < 1e-9 || l > ra + rb + 1e-9 || l < Math.abs(ra - rb) - 1e-9)
        return [];
    const along = (l * l + ra * ra - rb * rb) / (2 * l);
    const h = Math.sqrt(Math.max(0, ra * ra - along * along));
    const u = { x: d.x / l, y: d.y / l };
    const mid = { x: a.x + u.x * along, y: a.y + u.y * along };
    if (h < 1e-9) return [mid];
    return [
        { x: mid.x - u.y * h, y: mid.y + u.x * h },
        { x: mid.x + u.y * h, y: mid.y - u.x * h },
    ];
}

/**
 * The line with a point added halfway along segment `index`, on its curve: a corner between two
 * corners, so a straight line looks the same, else as smooth as the smoother end (#525)
 */
export function splitSegment(p: LineParams, index: number): LineParams {
    if (index < 0 || index >= lineSegments(p).length) return p;
    // A closed line's last segment runs back to its first point (#529)
    const a = p.points[index]!;
    const b = p.points[(index + 1) % p.points.length]!;
    const mid = withTension(Math.max(a.tension, b.tension))(
        segmentMidpoint(p, index),
    );
    return {
        ...p,
        points: [
            ...p.points.slice(0, index + 1),
            mid,
            ...p.points.slice(index + 1),
        ],
    };
}

/**
 * The line as long as `n` marchers `interval` apart need, grown or shrunk from its pivot (or the
 * run's anchor, `env.anchor`), in Keep interval. With every corner holding a marcher each stretch
 * becomes a whole number of intervals long, its direction and shape kept (#524). A line on the path keeps
 * its drawn length and takes the interval. One group of {@link withGroups}.
 */
export function withInterval(
    p: LineParams,
    n: number,
    interval: number,
    env: SizeEnv,
): LineParams {
    return withGroups(p, n, [{ interval }], env);
}

/**
 * The line spaced by `groups` (#526), sized to them from its pivot (or `env.anchor`): in Keep
 * interval as long as their gaps add up to, and with every corner holding a marcher each stretch
 * as long as its run of the gaps ({@link cornerRuns}), its direction kept (#524). A line on the
 * path keeps its drawn length and takes the groups. Measured ↔ or ↕ (#527), the lengths are that
 * way, and when snapping its start then slides along it onto the grid that way, so every spot
 * lands on it.
 */
export function withGroups(
    p: LineParams,
    n: number,
    groups: readonly LineGroup[],
    env: SizeEnv,
): LineParams {
    if (p.spacing.mode === "path" && !isClosed(p))
        return { ...p, spacing: { ...p.spacing, groups } };
    const kept: LineParams = { ...p, spacing: { mode: "keep", groups } };
    if (n <= 1) return kept;
    const axis = measuredAxis(kept);
    const runs = cornerRuns(kept, n);
    const gaps = lineGaps(kept, n)!;
    const size = sum(gaps);
    // A closed line can't set each stretch on its own and still meet its first point: it's grown
    // as a whole to its gaps round (#529), a corner off its interval noted
    if (runs && isClosed(p))
        return smooth(p)
            ? scaled(kept, runScale(kept, gaps), env)
            : scaled(kept, size / linePath(p).length, env);
    if (runs)
        return onGrid(pinned(kept, onIntervals(kept, runs), env), axis, env);
    if (axis)
        return onGrid(
            scaled(kept, size / axisLength(kept, axis), env),
            axis,
            env,
        );
    if (p.points.length === 2)
        return scaled(kept, size / linePath(p).length, env);
    return scaled(kept, runScale(kept, gaps), env);
}

/** What sizing a line in Keep interval needs: where it grows from, and the grid */
export type SizeEnv = Pick<ToolEnv, "pivot" | "anchor"> &
    Partial<Pick<ToolEnv, "snap" | "gridSnap">>;

/**
 * A line measured along `axis` slid along itself (first point to last) until its start is on the
 * grid that way, when snapping: exactly, so its spots are too
 */
function onGrid(
    p: LineParams,
    axis: LineMeasured | null,
    env: SizeEnv,
): LineParams {
    if (!axis || !env.snap || !env.gridSnap) return p;
    const first = p.points[0]!;
    const off = coord(env.gridSnap(first), axis) - coord(first, axis);
    const d = sub(p.points.at(-1)!, first);
    const k = off / coord(d, axis);
    if (off === 0 || !Number.isFinite(k)) return p;
    return {
        ...p,
        points: p.points.map((q) => ({
            ...q,
            ...pointOn(
                axis,
                coord(q, axis) + off,
                coord(q, across(axis)) + coord(d, across(axis)) * k,
            ),
        })),
    };
}

/**
 * Each stretch (corner to corner) scaled about its start so its run of gaps reaches it end to end
 * straight across (measured ↔ or ↕, that way), in its own direction and shape, from the first
 * point
 */
function onIntervals(p: LineParams, runs: readonly number[][]): LineParams {
    const points = [...p.points];
    const paths = stretchPaths(p);
    const axis = measuredAxis(p);
    const extents = axis ? stretchExtents(p, axis) : [];
    let at: XY = p.points[0]!;
    lineStretches(p).forEach(({ from, to }, r) => {
        const fit = axis
            ? extents[r]! / sum(runs[r]!)
            : chordScale(paths[r]!, runs[r]!);
        const k = fit > 0 ? 1 / fit : 1;
        const start = p.points[from]!;
        for (let i = from + 1; i <= to; i++) {
            const q = p.points[i]!;
            points[i] = {
                ...q,
                x: at.x + (q.x - start.x) * k,
                y: at.y + (q.y - start.y) * k,
            };
        }
        at = points[to]!;
    });
    return { ...p, points };
}

/**
 * How much bigger the line must be for a run of `gaps` around its corners to reach from end to end
 */
function runScale(p: LineParams, gaps: readonly number[]): number {
    const path = linePath(p);
    if (!(path.length > 0)) return 1;
    // The run of chords on the line `k` times as big, against its length
    const over = (k: number) =>
        chordOffsets(
            path,
            0,
            gaps.map((gap) => gap / k),
        ).at(-1)! - path.length;
    let lo = 1e-6;
    let hi = Math.max(1, sum(gaps) / path.length) * 2;
    while (over(hi) > 0) hi *= 2;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (over(mid) > 0) lo = mid;
        else hi = mid;
    }
    return hi;
}

/** The line `k` times as big, its pivot staying where it is on the field */
export function scaled(
    p: LineParams,
    k: number,
    env: Pick<ToolEnv, "pivot" | "anchor">,
): LineParams {
    // A line with no length has no direction to grow along
    if (!(lineFrame(p).halfWidth > 1e-9) || !Number.isFinite(k)) return p;
    const first = p.points[0]!;
    const grown = {
        ...p,
        points: p.points.map((q) => ({
            ...q,
            x: first.x + (q.x - first.x) * k,
            y: first.y + (q.y - first.y) * k,
        })),
    };
    return pinned(p, grown, env);
}

/** `next` moved so its pivot is where `was`'s is on the field (or the run's anchor) */
function pinned(
    was: LineParams,
    next: LineParams,
    env: Pick<ToolEnv, "pivot" | "anchor">,
): LineParams {
    const key = env.pivot ?? pivotOf(was);
    const fixed = env.anchor ?? pivotPoint(lineFrame(was), key);
    const now = pivotPoint(lineFrame(next), key);
    const d = sub(fixed, now);
    return {
        ...next,
        points: next.points.map((q) => ({ ...q, x: q.x + d.x, y: q.y + d.y })),
    };
}

/** The line in another spacing mode, its points as they are; Keep interval sized to its run */
export function withSpacing(
    p: LineParams,
    n: number,
    mode: "fit" | "keep" | LineAnchor,
    env: ToolEnv,
): LineParams {
    const interval = lineInterval(p, n);
    if (mode === "fit")
        return p.spacing.mode === "fit" ? p : { ...p, spacing: FIT };
    // Nothing to space with one marcher, or a line with no length: Fit is all there is
    if (!(interval > 0)) return p;
    const groups = p.spacing.mode === "fit" ? [{ interval }] : p.spacing.groups;
    if (mode === "keep")
        return p.spacing.mode === "keep"
            ? p
            : withGroups({ ...p, spacing: FIT }, n, groups, env);
    return { ...p, spacing: { mode: "path", groups, anchor: mode } };
}

/**
 * The line measured along `axis` (↔, ↕) or by the true distance (null), from the Measured menu
 * (#527). The typed interval (or groups) stays the same, now measured the new way, so Keep interval
 * resizes; Fit leaves the line as it is. A line that doesn't go one way along `axis` can't take it.
 */
export function withMeasured(
    p: LineParams,
    n: number,
    axis: LineMeasured | null,
    env: SizeEnv,
): LineParams {
    if ((p.measured ?? null) === axis) return p;
    if (axis && measuredBlock(p, axis) !== null) return p;
    const { measured: _was, ...rest } = p;
    const next: LineParams = axis ? { ...rest, measured: axis } : rest;
    return keptToRun(next, n, env);
}

/**
 * A line in Keep interval sized to its run again (its groups as they are), after a change that can
 * leave it longer or shorter than its marchers need; anything else as it is
 */
export function keptToRun(p: LineParams, n: number, env: SizeEnv): LineParams {
    return p.spacing.mode === "keep" && n > 1
        ? withGroups(p, n, p.spacing.groups, env)
        : p;
}

/**
 * After a turn or flip (the kind's `settle`): a line in Keep interval measured ↔ or ↕ covers a
 * different distance that way once turned, so it's sized to its run again (#527)
 */
export function settleLine(p: LineParams, n: number, env: SizeEnv): LineParams {
    return measuredAxis(p) ? keptToRun(p, n, env) : p;
}

/** The line moved by `delta`, its first point on the half-step grid when snapping */
export function moveLine(
    base: LineParams,
    delta: XY,
    env: ToolEnv,
): LineParams {
    const first = base.points[0]!;
    const landed = env.gridSnap({ x: first.x + delta.x, y: first.y + delta.y });
    const d = sub(landed, first);
    if (d.x === 0 && d.y === 0) return base;
    return {
        ...base,
        points: base.points.map((q) => ({ ...q, x: q.x + d.x, y: q.y + d.y })),
    };
}

/** How far `at` is from the segment from `a` to `b` */
function fromSegment(at: XY, a: XY, b: XY): number {
    const d = sub(b, a);
    const l2 = d.x * d.x + d.y * d.y;
    const t =
        l2 === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(1, ((at.x - a.x) * d.x + (at.y - a.y) * d.y) / l2),
              );
    return length(sub(at, { x: a.x + d.x * t, y: a.y + d.y * t }));
}

/**
 * Whether a press at `at` is on the line: within half its interval of it, or of its spots, but
 * never more than a step away (or the handle reach, when that's larger), so a long line with few
 * marchers doesn't take presses meant for the empty field
 */
export function onLine(
    p: LineParams,
    n: number,
    at: XY,
    env?: Pick<ToolEnv, "stepPx" | "hitRadius">,
): boolean {
    const half = lineInterval(p, n) / 2;
    const reach = Math.max(
        env ? Math.max(Math.min(half, env.stepPx), env.hitRadius) : half,
        1e-9,
    );
    const near = (a: XY, b: XY) => fromSegment(at, a, b) <= reach;
    const outline = lineOutline(p);
    if (isClosed(p)) outline.push(outline[0]!);
    if (outline.slice(1).some((b, i) => near(outline[i]!, b))) return true;
    // A run on the path can reach past the drawn line's ends
    const spots = lineSpots(p, n, env?.stepPx);
    return spots.length > 1 && near(spots[0]!, spots.at(-1)!);
}

/**
 * A new line through `frame`, as if drawn along its longer side, through its middle: the shape
 * turned into a line keeps its frame. A frame with no size gets a line of 2-step intervals.
 */
export function lineInFrame(
    frame: ShapeFrame,
    n: number,
    env: ToolEnv,
): LineParams {
    const across = frame.halfWidth >= frame.halfDepth;
    let half = Math.max(frame.halfWidth, frame.halfDepth);
    if (half < halfStep(env)) half = Math.max(1, n - 1) * env.stepPx;
    const end = (side: number) =>
        frameToField(
            frame,
            across ? { x: side * half, y: 0 } : { x: 0, y: side * half },
        );
    const flipped = across ? frame.flipX : frame.flipY;
    const [a, b] = flipped ? [end(1), end(-1)] : [end(-1), end(1)];
    return {
        points: [corner(env.gridSnap(a)), corner(env.gridSnap(b))],
        spacing: FIT,
    };
}

/**
 * {@link lineInFrame} as a Curve (#525): its two ends and, between them, a point half as far off
 * the line as they are apart, every point smooth
 */
export function curveInFrame(
    frame: ShapeFrame,
    n: number,
    env: ToolEnv,
): LineParams {
    const line = lineInFrame(frame, n, env);
    const [a, b] = line.points as [LinePoint, LinePoint];
    const d = sub(b, a);
    // Toward the back of the field for a line drawn left to right
    const apex = env.gridSnap({
        x: (a.x + b.x) / 2 + d.y / 4,
        y: (a.y + b.y) / 2 - d.x / 4,
    });
    return { ...line, points: [a, apex, b].map(withTension(SMOOTH)) };
}

/** The line with point `index` of `tension` (0 a corner, more a smooth point, #525) */
export function setTension(
    p: LineParams,
    index: number,
    tension: number,
): LineParams {
    const was = p.points[index];
    if (!was || was.tension === tension) return p;
    return {
        ...p,
        points: p.points.map((q, i) => (i === index ? { ...q, tension } : q)),
    };
}

/** A point's own answer to whether it holds a marcher dropped: it follows the line again */
const followsLine = ({ marcher: _marcher, ...q }: LinePoint): LinePoint => q;

/**
 * The line with point `index` holding a marcher always (true), never forced to (false), or as the
 * line says (undefined), from the point's menu (#569). Keep interval is sized to its run again,
 * since its stretches change.
 */
export function setPointMarcher(
    p: LineParams,
    n: number,
    index: number,
    marcher: boolean | undefined,
    env: SizeEnv,
): LineParams {
    const was = p.points[index];
    if (!was || was.marcher === marcher) return p;
    const next: LineParams = {
        ...p,
        points: p.points.map((q, i) =>
            i !== index
                ? q
                : marcher === undefined
                  ? followsLine(q)
                  : { ...q, marcher },
        ),
    };
    return keptToRun(next, n, env);
}

/** The fewest points a line can have: two open, three closed (#529) */
export const minPoints = (p: LineParams): number => (isClosed(p) ? 3 : 2);

/**
 * The line without point `index` (#569), never under {@link minPoints}; Keep interval sized to
 * its run again
 */
export function deletePoint(
    p: LineParams,
    n: number,
    index: number,
    env: SizeEnv,
): LineParams {
    if (!p.points[index] || p.points.length <= minPoints(p)) return p;
    const next = { ...p, points: p.points.filter((_, i) => i !== index) };
    // A new end holds a marcher whatever it said
    const last = next.points.length - 1;
    const points = isClosed(next)
        ? next.points
        : next.points.map((q, i) =>
              i === 0 || i === last ? followsLine(q) : q,
          );
    return keptToRun({ ...next, points }, n, env);
}

/**
 * A closed line opened at point `index` (#569): that point both of its ends, the others in order
 * round from it, its fill dropped. Keep interval sized to its run again (an open line has one
 * gap fewer).
 */
export function openAt(
    p: LineParams,
    n: number,
    index: number,
    env: SizeEnv,
): LineParams {
    const at = p.points[index];
    if (!isClosed(p) || !at) return p;
    const { closed: _closed, distribution: _distribution, ...rest } = p;
    const end = followsLine(at);
    const points = [
        end,
        ...p.points.slice(index + 1),
        ...p.points.slice(0, index),
        end,
    ];
    return keptToRun({ ...rest, points }, n, env);
}

/** Whether segment `index` runs straight from its point to the next */
export const segmentStraight = (p: LineParams, index: number): boolean =>
    lineSegments(p)[index]?.type === "line";

/**
 * The line with segment `index` straight (both its points corners) or curved (both smooth, a
 * corner made {@link SMOOTH}) (#569)
 */
export function setSegmentCurved(
    p: LineParams,
    index: number,
    curved: boolean,
): LineParams {
    const count = p.points.length;
    if (index < 0 || index >= lineSegments(p).length) return p;
    const ends = new Set([index, (index + 1) % count]);
    const tension = (q: LinePoint) =>
        curved ? (q.tension > 0 ? q.tension : SMOOTH) : 0;
    if (p.points.every((q, i) => !ends.has(i) || q.tension === tension(q)))
        return p;
    return {
        ...p,
        points: p.points.map((q, i) =>
            ends.has(i) ? { ...q, tension: tension(q) } : q,
        ),
    };
}

/**
 * Which way from a smooth point one end of its tangent bar sits (#557): `1` toward the next point,
 * `-1` back toward the one before
 */
export type TangentSide = 1 | -1;

/**
 * Where point `index`'s handle on `side` would be at tension 1: the curve's own handle there, or,
 * at an open line's end, where there's no segment that way, the other side's mirrored through the
 * point so the bar still runs both ways
 */
function fullHandle(p: LineParams, index: number, side: TangentSide): XY {
    const count = p.points.length;
    const closed = isClosed(p);
    const has = (s: TangentSide) =>
        closed || (s === 1 ? index < count - 1 : index > 0);
    const own = (s: TangentSide) =>
        s === 1
            ? catmullRomSpan(p.points, index, closed).c1
            : catmullRomSpan(p.points, (index - 1 + count) % count, closed).c2;
    if (has(side)) return own(side);
    const q = p.points[index]!;
    const other = own(side === 1 ? -1 : 1);
    return { x: 2 * q.x - other.x, y: 2 * q.y - other.y };
}

/**
 * Where one end of smooth point `index`'s tangent bar sits (#525, #557): along the line's way
 * through it on `side`, as far out as its tension takes the curve's handle; null for a corner
 */
export function tensionHandle(
    p: LineParams,
    index: number,
    side: TangentSide = 1,
): XY | null {
    const q = p.points[index];
    if (!q || q.tension === 0) return null;
    return lerp(q, fullHandle(p, index, side), q.tension);
}

/**
 * One end of point `index`'s tangent bar dragged to `to`: the tension as far out along the curve's
 * way on `side` as the pointer went, in tenths when snapping, 0 (a corner) at or behind the point
 * (#525, #557)
 */
export function dragTension(
    base: LineParams,
    index: number,
    to: XY,
    env: ToolEnv,
    side: TangentSide = 1,
): LineParams {
    const q = base.points[index];
    if (!q) return base;
    const d = sub(fullHandle(base, index, side), q);
    const l2 = dot(d, d);
    if (!(l2 > 1e-12)) return base;
    let tension = Math.min(MAX_TENSION, Math.max(0, dot(sub(to, q), d) / l2));
    if (env.snap) tension = Math.round(tension * 10) / 10;
    return setTension(base, index, tension);
}

/** How far along the line a field point is, for keeping marchers' order along it */
export const alongLine = (p: LineParams, point: XY): number =>
    linePath(p).project(point);

/**
 * The line closed (#529): its last point joined to its first, filled as its outline. A typed
 * interval or groups (#526) are kept, the line grown or shrunk from its pivot to its gaps round;
 * a run on the path keeps its spacing that way. Under three points there's nothing to close.
 */
export function closeLine(
    p: LineParams,
    n: number,
    env: Pick<ToolEnv, "pivot" | "anchor">,
): LineParams {
    if (isClosed(p) || p.points.length < 3) return p;
    const closed: LineParams = { ...p, closed: true };
    if (p.spacing.mode === "fit") return closed;
    return withGroups(closed, n, p.spacing.groups, env);
}

/**
 * The line opened (#529) so its marchers keep their spots: from one of its spots round to the
 * one before it, through every point between. Filled any other way, it opens to the spots its
 * outline has. Fit shares a cornered line's gaps by its stretches' lengths, which an open line can
 * share out differently, and a curve's new ends bend it a little differently, so it opens at the
 * first spot (from its first point) that gives the same spots, the corners switch as it is or
 * turned over; failing that, at its first spot.
 */
export function openLine(p: LineParams, n: number): LineParams {
    if (!isClosed(p)) return p;
    const { closed: _closed, distribution: _distribution, ...rest } = p;
    if (n < 2) return rest;
    const outline: LineParams = { ...rest, closed: true };
    const path = linePath(outline);
    const spots = lineSpots(outline, n);
    const tolerance = 1e-6 * Math.max(1, path.length);
    const same = (q: LineParams) => {
        const now = lineSpots(q, n);
        return spots.every((spot) =>
            now.some((x) => length(sub(x, spot)) < tolerance),
        );
    };
    const flipped = (q: LineParams): LineParams =>
        q.corners === false
            ? (({ corners: _c, ...r }) => r)(q)
            : { ...q, corners: false };
    let first: LineParams | null = null;
    for (let k = 0; k < n; k++) {
        const opened = openedAt(outline, path, spots, k);
        if (!opened) continue;
        first ??= opened;
        if (same(opened)) return opened;
        if (same(flipped(opened))) return flipped(opened);
    }
    return first ?? rest;
}

/**
 * The closed line opened from spot `k` round to the spot before it, through the points between;
 * a new end inside a segment as smooth as the smoother of its points. Null when that leaves under
 * two points.
 */
function openedAt(
    outline: LineParams,
    path: Path,
    spots: readonly Slot[],
    k: number,
): LineParams | null {
    const { closed: _closed, ...rest } = outline;
    const L = path.length;
    const sOf = (spot: Slot) => spot.s ?? path.project(spot);
    const round = (s: number) => ((s % L) + L) % L;
    const from = sOf(spots[k]!);
    const span = round(
        sOf(spots[(k - 1 + spots.length) % spots.length]!) - from,
    );
    const eps = 1e-9 * Math.max(1, L);
    const count = outline.points.length;
    // Each point's way along the path, and each segment's start
    const starts: number[] = [];
    let along = 0;
    for (const segment of lineSegments(outline)) {
        starts.push(along);
        along += makePath([segment]).length;
    }
    const between = outline.points
        .map((q, i) => ({ q, at: round(starts[i]! - from) }))
        .filter(({ at }) => at > eps && at < span - eps)
        .sort((a, b) => a.at - b.at)
        .map(({ q }) => q);
    /** The point at `s` along: one of the line's, or a new one on the segment there */
    const pointAt = (s: number): LinePoint => {
        const x = path.at(s);
        const on = outline.points.find((q) => length(sub(q, x)) < eps);
        if (on) return on;
        const i = Math.max(
            0,
            starts.findLastIndex((t) => t <= round(s) + eps),
        );
        const a = outline.points[i]!;
        const b = outline.points[(i + 1) % count]!;
        return withTension(Math.max(a.tension, b.tension))(x);
    };
    const points = [pointAt(from), ...between, pointAt(from + span)];
    return points.length < 2 ? null : { ...rest, points };
}
