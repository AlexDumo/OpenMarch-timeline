import {
    fieldToFrame,
    frameToField,
    pivotPoint,
    type ShapeFrame,
} from "../frame/frame";
import { linePull } from "../frame/edgeGuides";
import { pivotOf } from "../frame/pivot";
import { makePath, type Path } from "../geometry/path";
import { chordOffsets, groupGaps, layGroups } from "../spacing";
import {
    canLayOut,
    storedDistribution,
    type Distribution,
} from "../distribute/distribution";
import type { ToolEnv } from "../tool/toolKind";
import type { Slot, XY } from "../types";

/**
 * A Line as the shape host draws it (#523, #524, spec #522): points the line passes through, with
 * straight segments between them, and how its marchers are spaced along it: by one interval, or by
 * groups of marchers at their own intervals (#526). Every corner holds a marcher unless the corners
 * switch is off. The params already hold what later versions add (tensions, a closed flag), so
 * recipes saved now read the same then. Everything here is pure.
 */

/** A point the line passes through. Tension 0 is a corner; above 0 a smooth point (later) */
export interface LinePoint extends XY {
    readonly tension: number;
}

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

export interface LineParams {
    /** In order from the first marcher's end; two or more */
    readonly points: readonly LinePoint[];
    /**
     * A closed line joins its last point to its first (#529): its marchers have a gap on every
     * segment, n gaps for n marchers, and it can be filled like a box. Open when absent.
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

const isPoint = (q: unknown): q is LinePoint =>
    typeof q === "object" &&
    q !== null &&
    Number.isFinite((q as LinePoint).x) &&
    Number.isFinite((q as LinePoint).y) &&
    // Smooth points come later (#525): a curve saved by a newer build isn't read as straight
    (q as LinePoint).tension === 0;

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
    "pivot",
]);

/**
 * Whether `params` is a line this version can lay out exactly as it was saved. Anything a newer
 * build adds (tensions, closing, Measured) is refused, so the recipe shows as plain positions
 * instead of being misread and rewritten on the first edit (ADR 0006, decision 5). Each later
 * ticket widens this as it adds the layout.
 */
export function isLineParams(params: unknown): params is LineParams {
    if (typeof params !== "object" || params === null) return false;
    if (Object.keys(params).some((key) => !KEYS.has(key))) return false;
    const p = params as Partial<LineParams>;
    if (p.closed !== undefined && typeof p.closed !== "boolean") return false;
    if (p.corners !== undefined && typeof p.corners !== "boolean") return false;
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

/** Each segment's ends, in order; a closed line's last runs from its last point to its first */
export function lineSegments(p: LineParams): (readonly [XY, XY])[] {
    const pts = p.points;
    const segments = pts.slice(1).map((b, i) => [pts[i]!, b] as const);
    if (isClosed(p)) segments.push([pts.at(-1)!, pts[0]!]);
    return segments;
}

/** The path through the line's points, round to its first again when closed */
export function linePath(p: LineParams): Path {
    const segments = lineSegments(p).map(([a, b]) => ({
        type: "line" as const,
        a,
        b,
    }));
    return makePath(segments, isClosed(p));
}

/** How many gaps `n` marchers have along the line: one per marcher on a closed line (#529) */
export const gapCount = (p: LineParams, n: number): number =>
    isClosed(p) ? n : n - 1;

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

/**
 * The interval between neighbors, in field units: the typed one, or in Fit the one the drawn
 * line works out to
 */
export function lineInterval(p: LineParams, n: number): number {
    const gaps = gapCount(p, n);
    return typedInterval(p) ?? (n > 1 ? linePath(p).length / gaps : 0);
}

/** Each segment's length, in order */
const segmentLengths = (p: LineParams): number[] =>
    lineSegments(p).map(([a, b]) => length(sub(b, a)));

/**
 * How many gaps each segment holds when every corner holds a marcher (#524): a whole number each,
 * at least one. With one interval for everyone (or in Fit) they're in proportion to the segments'
 * lengths; with groups (#526) each corner takes the seam between gaps nearest it along the run, so
 * a segment that is a whole run of the groups' gaps holds exactly those. Null when the corners
 * don't hold marchers: the switch is off, there's no corner, the run is laid on the path, or there
 * are fewer gaps than segments.
 */
export function cornerGaps(p: LineParams, n: number): number[] | null {
    if (p.corners === false || p.points.length < 3) return null;
    if (p.spacing.mode === "path") return null;
    const lengths = segmentLengths(p);
    const gaps = gapCount(p, n);
    const total = sum(lengths);
    if (gaps < lengths.length || !(total > 0)) return null;
    if (hasGroups(p)) return seamGaps(lengths, lineGaps(p, n)!);
    const ideal = lengths.map((l) => (gaps * l) / total);
    const counts = ideal.map((x) => Math.max(1, Math.floor(x + 1e-9)));
    let left = sum(counts);
    // Largest remainders first, and never under one gap a segment
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
 * How many of `gaps`, in order, each segment holds: each corner at the seam whose share of the run
 * is nearest its share of the line, at least one gap a segment
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
        // Room for one gap in each segment still to come
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
 * The gaps each segment holds, in field units, when every corner holds a marcher: in Fit even
 * shares (1 each, scaled to the segment), typed the line's gaps in order along it ({@link
 * lineGaps}), {@link cornerGaps} of them a segment. Null when the corners don't hold marchers.
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
 * In Fit with every corner holding a marcher, the narrowest and widest interval of its segments,
 * in field units; null otherwise
 */
export function intervalRange(
    p: LineParams,
    n: number,
): { readonly min: number; readonly max: number } | null {
    const gaps = p.spacing.mode === "fit" ? cornerGaps(p, n) : null;
    if (!gaps) return null;
    const each = segmentLengths(p).map((l, i) => l / gaps[i]!);
    return { min: Math.min(...each), max: Math.max(...each) };
}

/**
 * In Keep interval with every corner holding a marcher, whether a segment isn't as long as its run
 * of gaps (a whole number of intervals): a corner dragged with `fine` (#524)
 */
export function cornerOffInterval(p: LineParams, n: number): boolean {
    const runs = p.spacing.mode === "fit" ? null : cornerRuns(p, n);
    if (!runs) return false;
    return segmentLengths(p).some(
        (l, i) => Math.abs(l - sum(runs[i]!)) > 1e-6 * Math.max(1, l),
    );
}

/**
 * The spots of a line whose corners hold marchers: segment by segment from its first point, each
 * holding its run of gaps, then the last point. In Keep interval a segment is as long as its run,
 * so the gaps are as typed; a corner `fine` left off its interval scales its segments' gaps to fit
 * (even gaps, with one interval) instead of running past the corner and stacking marchers on it.
 */
function cornerSpots(p: LineParams, runs: readonly number[][]): Slot[] {
    const spots: Slot[] = [];
    let s = 0;
    lineSegments(p).forEach(([a, b], i) => {
        const d = sub(b, a);
        const l = length(d);
        const run = runs[i]!;
        const whole = sum(run);
        let done = 0;
        for (const gap of run) {
            const t = done / whole;
            spots.push({ x: a.x + d.x * t, y: a.y + d.y * t, s: s + l * t });
            done += gap;
        }
        s += l;
    });
    // A closed line's last segment ends on its first spot
    if (isClosed(p)) return spots;
    const last = p.points.at(-1)!;
    spots.push({ x: last.x, y: last.y, s });
    return spots;
}

/** The `n` spots along the line, tagged with their distance along it */
export function lineSpots(p: LineParams, n: number): Slot[] {
    if (n <= 0) return [];
    const path = linePath(p);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    const corners = cornerRuns(p, n);
    if (corners) return cornerSpots(p, corners);
    const closed = isClosed(p);
    const gaps = lineGaps(p, n);
    if (gaps === null) {
        if (n === 1) return [at(closed ? 0 : path.length / 2)];
        return Array.from({ length: n }, (_, i) =>
            at((path.length * i) / gapCount(p, n)),
        );
    }
    // A closed line's run goes round from its first point, its last gap back to it
    if (closed) return chordOffsets(path, 0, gaps.slice(0, -1)).map(at);
    const run = chordOffsets(path, 0, gaps).at(-1)!;
    // Keep interval is sized to its run, which sits on it whole; on the path it sits at its anchor
    const anchor = p.spacing.mode === "path" ? p.spacing.anchor : "center";
    const from =
        anchor === "start"
            ? 0
            : anchor === "end"
              ? path.length - run
              : (path.length - run) / 2;
    return chordOffsets(path, from, gaps).map(at);
}

/**
 * The line's frame: centered between its ends, turned along them, as long as they are apart and
 * with no depth. A closed line's is turned the same way, around all its points (#529). A line is
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
    const local = p.points.map((q) => fieldToFrame(open, q));
    const xs = local.map((q) => q.x);
    const ys = local.map((q) => q.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    return {
        ...open,
        center: frameToField(open, {
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

/** A straight line drawn from `from` to `to`, in Fit; undefined while it's under half a step */
export function drawLine(
    from: XY,
    to: XY,
    env: ToolEnv,
): LineParams | undefined {
    const a = landPoint(from, env);
    const b = endAt(a, to, env);
    if (length(sub(b, a)) < halfStep(env) - 1e-9) return undefined;
    return { points: [corner(a), corner(b)], spacing: FIT };
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
 * A line through clicked points, in Fit (#524), a point landed on the one before it dropped;
 * undefined while that leaves under two, or a line under half a step long
 */
export function drawPoints(
    clicked: readonly XY[],
    env: ToolEnv,
): LineParams | undefined {
    const points = clicked.filter(
        (q, i) =>
            i === 0 || q.x !== clicked[i - 1]!.x || q.y !== clicked[i - 1]!.y,
    );
    if (points.length < 2) return undefined;
    const p: LineParams = { points: points.map(corner), spacing: FIT };
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
 * corner holding a marcher lands where each of its two segments is a whole number of intervals
 * long (#524); `fine` frees it.
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
    // An end dropped on the other end closes the line (#529)
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
    let point: XY | null;
    if (keep && end) {
        const u = directionFrom(other, to, env);
        if (!u) return base;
        const was = length(sub(base.points[index]!, other));
        point = { x: other.x + u.x * was, y: other.y + u.y * was };
    } else if (keep && env.snap && !end && cornerGaps(base, n)) {
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

/**
 * Where corner `index` can stand with its neighbors where they are and each of its two segments a
 * whole run of the gaps the two hold now, in order (one typed interval, or the groups' gaps,
 * #526): the spot nearest `to`, or null when there's none
 */
function cornerOnIntervals(
    p: LineParams,
    n: number,
    index: number,
    to: XY,
): XY | null {
    const runs = cornerRuns(p, n)!;
    const count = p.points.length;
    const before = (index - 1 + count) % count;
    const both = [...runs[before]!, ...runs[index]!];
    const whole = sum(both);
    const a = p.points[before]!;
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

/** The line with a corner added halfway along segment `index`, so the line looks the same */
export function splitSegment(p: LineParams, index: number): LineParams {
    const segment = lineSegments(p)[index];
    if (!segment) return p;
    const [a, b] = segment;
    const mid = corner({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
 * run's anchor, `env.anchor`), in Keep interval. With every corner holding a marcher each segment
 * becomes a whole number of intervals long, its direction kept (#524). A line on the path keeps
 * its drawn length and takes the interval. One group of {@link withGroups}.
 */
export function withInterval(
    p: LineParams,
    n: number,
    interval: number,
    env: ToolEnv,
): LineParams {
    return withGroups(p, n, [{ interval }], env);
}

/**
 * The line spaced by `groups` (#526), sized to them from its pivot (or `env.anchor`): in Keep
 * interval as long as their gaps add up to, and with every corner holding a marcher each segment
 * as long as its run of the gaps ({@link cornerRuns}), its direction kept (#524). A line on the
 * path keeps its drawn length and takes the groups.
 */
export function withGroups(
    p: LineParams,
    n: number,
    groups: readonly LineGroup[],
    env: ToolEnv,
): LineParams {
    if (p.spacing.mode === "path" && !isClosed(p))
        return { ...p, spacing: { ...p.spacing, groups } };
    const kept: LineParams = { ...p, spacing: { mode: "keep", groups } };
    if (n <= 1) return kept;
    const runs = cornerRuns(kept, n);
    const gaps = lineGaps(kept, n)!;
    const size = sum(gaps);
    // A closed line can't set each segment on its own and still meet its first point: it's
    // grown as a whole to its gaps round (#529), a corner off its interval noted
    if (runs && isClosed(p))
        return scaled(kept, size / linePath(p).length, env);
    if (runs) return pinned(kept, onIntervals(kept, runs), env);
    if (p.points.length === 2)
        return scaled(kept, size / linePath(p).length, env);
    return scaled(kept, runScale(kept, gaps), env);
}

/** Each segment as long as its run of gaps adds up to, in its own direction, from the first point */
function onIntervals(p: LineParams, runs: readonly number[][]): LineParams {
    let at: XY = p.points[0]!;
    const points = p.points.map((q, i) => {
        if (i === 0) return q;
        const a = p.points[i - 1]!;
        const d = sub(q, a);
        const l = length(d);
        const want = sum(runs[i - 1]!);
        at =
            l > 0
                ? { x: at.x + (d.x / l) * want, y: at.y + (d.y / l) * want }
                : at;
        return { ...q, ...at };
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
export function scaled(p: LineParams, k: number, env: ToolEnv): LineParams {
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
function pinned(was: LineParams, next: LineParams, env: ToolEnv): LineParams {
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
    if (lineSegments(p).some(([a, b]) => near(a, b))) return true;
    // A run on the path can reach past the drawn line's ends
    const spots = lineSpots(p, n);
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

/** How far along the line a field point is, for keeping marchers' order along it */
export const alongLine = (p: LineParams, point: XY): number =>
    linePath(p).project(point);

/**
 * The line closed (#529): its last point joined to its first, filled as its outline. A typed
 * interval or groups (#526) are kept, the line grown or shrunk from its pivot to its gaps round;
 * a run on the path keeps its spacing that way. Under three points there's nothing to close.
 */
export function closeLine(p: LineParams, n: number, env: ToolEnv): LineParams {
    if (isClosed(p) || p.points.length < 3) return p;
    const closed: LineParams = { ...p, closed: true };
    if (p.spacing.mode === "fit") return closed;
    return withGroups(closed, n, p.spacing.groups, env);
}

/**
 * The line opened (#529) so its marchers keep their spots: from one of its spots round to the
 * one before it, through every point between. Filled any other way, it opens to the spots its
 * outline has. Fit shares a cornered line's gaps by its segments' lengths, which an open line can
 * share out differently, so it opens at the first spot (from its first point) that gives the same
 * spots, the corners switch as it is or turned over; failing that, at its first point.
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
 * null when that leaves under two points
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
    const from = sOf(spots[k]!);
    const span =
        (((sOf(spots[(k - 1 + spots.length) % spots.length]!) - from) % L) +
            L) %
        L;
    const eps = 1e-9 * Math.max(1, L);
    // Each point's way along from the start, round from it
    let along = 0;
    const between = outline.points
        .map((q, i) => {
            if (i > 0) along += length(sub(q, outline.points[i - 1]!));
            return { q, at: (((along - from) % L) + L) % L };
        })
        .filter(({ at }) => at > eps && at < span - eps)
        .sort((a, b) => a.at - b.at)
        .map(({ q }) => q);
    const start = path.at(from);
    const end = path.at(from + span);
    const onPoint = (x: XY) =>
        outline.points.find((q) => length(sub(q, x)) < eps);
    const points = [
        onPoint(start) ?? corner(start),
        ...between,
        onPoint(end) ?? corner(end),
    ];
    return points.length < 2 ? null : { ...rest, points };
}
