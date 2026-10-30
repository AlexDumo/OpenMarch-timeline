import {
    fieldToFrame,
    frameToField,
    pivotPoint,
    type ShapeFrame,
} from "../frame/frame";
import { linePull } from "../frame/edgeGuides";
import { pivotOf } from "../frame/pivot";
import { catmullRomControls, mirroredAt } from "../geometry/catmullRom";
import { makePath, type Path, type Segment } from "../geometry/path";
import { cross, dot, lerp } from "../geometry/vec";
import { chordOffsets } from "../spacing";
import type { ToolEnv } from "../tool/toolKind";
import type { Slot, XY } from "../types";

/**
 * A Line as the shape host draws it (#523, #524, #525, spec #522): points the line passes through,
 * and how its marchers are spaced along it. A point with no tension is a corner, where the line
 * turns sharply; a point with tension is smooth, and the line bends through it (centripetal
 * Catmull-Rom, the tension scaling its handles). Every corner holds a marcher unless the corners
 * switch is off; a smooth point never does. The params already hold what later versions add (a
 * closed flag, interval groups), so recipes saved now read the same then. Everything here is pure.
 */

/**
 * A point the line passes through. Tension 0 is a corner; above 0 a smooth point, 1 the plain
 * Catmull-Rom curve, more rounder (up to {@link MAX_TENSION})
 */
export interface LinePoint extends XY {
    readonly tension: number;
}

/** The tension a point made smooth starts with: the plain Catmull-Rom curve (#525) */
export const SMOOTH = 1;
/** The roundest a point can be */
export const MAX_TENSION = 2;

/**
 * A run of marchers at one interval (spec #522, "Mixed intervals"). `count` absent is "the rest":
 * with a single group, every gap is `interval`.
 */
export interface LineGroup {
    /** Field units between neighbors, straight across (the chord) */
    readonly interval: number;
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
    /** A closed line joins its last point to its first (later); open when absent */
    readonly closed?: boolean;
    readonly spacing: LineSpacing;
    /**
     * False: the intervals run around the corners. Absent (or true): every corner holds a marcher
     * (#524)
     */
    readonly corners?: boolean;
}

const FIT: LineSpacing = { mode: "fit" };

const halfStep = (env: Pick<ToolEnv, "stepPx">) => env.stepPx / 2;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const length = (d: XY) => Math.hypot(d.x, d.y);
const corner = ({ x, y }: XY): LinePoint => ({ x, y, tension: 0 });
const withTension =
    (tension: number) =>
    ({ x, y }: XY): LinePoint => ({ x, y, tension });

const isPoint = (q: unknown): q is LinePoint =>
    typeof q === "object" &&
    q !== null &&
    Number.isFinite((q as LinePoint).x) &&
    Number.isFinite((q as LinePoint).y) &&
    Number.isFinite((q as LinePoint).tension) &&
    (q as LinePoint).tension >= 0 &&
    (q as LinePoint).tension <= MAX_TENSION;

const isGroup = (g: unknown): g is LineGroup =>
    typeof g === "object" &&
    g !== null &&
    Number.isFinite((g as LineGroup).interval) &&
    (g as LineGroup).interval > 0 &&
    // A counted group is a mixed interval (#526), which this version can't lay out
    (g as LineGroup).count === undefined;

const ANCHORS: readonly unknown[] = ["start", "center", "end"];
// `pivot` is the host's (ADR 0006, amendment of 2026-10-20), stored beside the kind's own numbers
const KEYS = new Set(["points", "closed", "spacing", "corners", "pivot"]);

/**
 * Whether `params` is a line this version can lay out exactly as it was saved. Anything a newer
 * build adds (closing, mixed groups, Measured) is refused, so the recipe shows as plain
 * positions instead of being misread and rewritten on the first edit (ADR 0006, decision 5). Each
 * later ticket widens this as it adds the layout.
 */
export function isLineParams(params: unknown): params is LineParams {
    if (typeof params !== "object" || params === null) return false;
    if (Object.keys(params).some((key) => !KEYS.has(key))) return false;
    const p = params as Partial<LineParams>;
    if (p.closed !== undefined && p.closed !== false) return false;
    if (p.corners !== undefined && typeof p.corners !== "boolean") return false;
    if (!Array.isArray(p.points) || p.points.length < 2) return false;
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
    if (!Array.isArray(sp.groups) || sp.groups.length !== 1) return false;
    if (!sp.groups.every(isGroup)) return false;
    return sp.mode === "keep" || ANCHORS.includes(sp.anchor);
}

/**
 * The line's segments, from each point to the next: straight where it doesn't bend, else a cubic
 * whose handles are the Catmull-Rom curve's at each smooth point, scaled by its tension (none at a
 * corner)
 */
export function lineSegments(p: LineParams): Segment[] {
    const points = p.points;
    return points.slice(1).map((b, i): Segment => {
        const a = points[i]!;
        const line: Segment = { type: "line", a, b };
        if (a.tension === 0 && b.tension === 0) return line;
        const full = catmullRomControls(
            mirroredAt(points, i - 1),
            a,
            b,
            mirroredAt(points, i + 2),
        );
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

/** The path through the line's points */
export function linePath(p: LineParams): Path {
    return makePath(lineSegments(p));
}

/** Whether any point of the line is smooth */
const smooth = (p: LineParams) => p.points.some((q) => q.tension > 0);

/**
 * The points a stretch of the line can be drawn through: its points when it's straight from point
 * to point, else about 24 a segment along its curves
 */
export function lineOutline(p: LineParams): XY[] {
    if (!smooth(p)) return p.points.map(({ x, y }) => ({ x, y }));
    const path = linePath(p);
    return path.polyline(path.length / (24 * (p.points.length - 1)));
}

/** Where segment `index`'s midpoint handle sits: halfway along it, on its curve */
export function segmentMidpoint(p: LineParams, index: number): XY {
    const segment = lineSegments(p)[index]!;
    const path = makePath([segment]);
    return path.at(path.length / 2);
}

/**
 * The stretches between the points that hold a marcher (#524, #525): from an end or a corner to
 * the next, smooth points inside them. `from` and `to` are point indices.
 */
export function lineRuns(
    p: LineParams,
): { readonly from: number; readonly to: number }[] {
    const last = p.points.length - 1;
    const runs: { from: number; to: number }[] = [];
    let from = 0;
    for (let i = 1; i <= last; i++) {
        if (i < last && p.points[i]!.tension > 0) continue;
        runs.push({ from, to: i });
        from = i;
    }
    return runs;
}

/** Each run's path, in order */
function runPaths(p: LineParams): Path[] {
    const segments = lineSegments(p);
    return lineRuns(p).map(({ from, to }) =>
        makePath(segments.slice(from, to)),
    );
}

/**
 * The interval at which `gaps` neighbors, measured straight across (the chord), reach exactly from
 * one end of `path` to the other. On a straight path it's the length over the gaps.
 */
function evenChord(path: Path, gaps: number): number {
    if (gaps <= 0 || !(path.length > 0)) return 0;
    const arc = path.length / gaps;
    // A chord is as long as its arc only on a straight stretch
    if (
        length(sub(path.at(path.length), path.at(0))) >=
        path.length * (1 - 1e-9)
    )
        return arc;
    const reach = (c: number) =>
        chordOffsets(path, 0, Array<number>(gaps).fill(c)).at(-1)!;
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

/** `gaps` neighbors evenly apart straight across, from one end of `path` to the other */
function evenSpots(path: Path, gaps: number, from = 0): Slot[] {
    const offsets = chordOffsets(
        path,
        0,
        Array<number>(gaps).fill(evenChord(path, gaps)),
    );
    // The last on the end exactly, whatever the search left
    offsets[gaps] = path.length;
    return offsets.map((s) => ({ ...path.at(s), s: from + s }));
}

/** The interval a typed spacing keeps, in field units; null in Fit */
export function typedInterval(p: LineParams): number | null {
    return p.spacing.mode === "fit" ? null : p.spacing.groups[0]!.interval;
}

/**
 * The interval between neighbors, in field units: the typed one, or in Fit the one the drawn
 * line works out to
 */
export function lineInterval(p: LineParams, n: number): number {
    const typed = typedInterval(p);
    if (typed !== null) return typed;
    if (n <= 1) return 0;
    // Along a curve, the straight distance between neighbors (#525)
    return smooth(p)
        ? evenChord(linePath(p), n - 1)
        : linePath(p).length / (n - 1);
}

/**
 * How many gaps each run (corner to corner, {@link lineRuns}) holds when every corner holds a
 * marcher (#524): a whole number each, in proportion to its length, at least one. Null when the
 * corners don't hold marchers: the switch is off, there's no corner, the run is laid on the path,
 * or there are fewer gaps than runs.
 */
export function cornerGaps(p: LineParams, n: number): number[] | null {
    if (p.corners === false || p.spacing.mode === "path") return null;
    const runs = lineRuns(p);
    if (runs.length < 2) return null;
    const lengths = runPaths(p).map((path) => path.length);
    const gaps = n - 1;
    const total = lengths.reduce((sum, l) => sum + l, 0);
    if (gaps < lengths.length || !(total > 0)) return null;
    const ideal = lengths.map((l) => (gaps * l) / total);
    const counts = ideal.map((x) => Math.max(1, Math.floor(x + 1e-9)));
    let sum = counts.reduce((a, b) => a + b, 0);
    // Largest remainders first, and never under one gap a segment
    while (sum < gaps) {
        const i = argMax(ideal.map((x, k) => x - counts[k]!));
        counts[i]!++;
        sum++;
    }
    while (sum > gaps) {
        const i = argMax(
            ideal.map((x, k) => (counts[k]! > 1 ? counts[k]! - x : -Infinity)),
        );
        counts[i]!--;
        sum--;
    }
    return counts;
}

const argMax = (xs: readonly number[]): number =>
    xs.reduce((best, x, i) => (x > xs[best]! ? i : best), 0);

/**
 * In Fit with every corner holding a marcher, the narrowest and widest interval of its runs, in
 * field units; null otherwise
 */
export function intervalRange(
    p: LineParams,
    n: number,
): { readonly min: number; readonly max: number } | null {
    const gaps = p.spacing.mode === "fit" ? cornerGaps(p, n) : null;
    if (!gaps) return null;
    const each = runPaths(p).map((path, i) => evenChord(path, gaps[i]!));
    return { min: Math.min(...each), max: Math.max(...each) };
}

/**
 * In Keep interval with every corner holding a marcher, whether a run isn't a whole number of
 * intervals long: a corner dragged with `fine` (#524)
 */
export function cornerOffInterval(p: LineParams, n: number): boolean {
    const interval = typedInterval(p);
    const gaps = interval === null ? null : cornerGaps(p, n);
    if (!gaps) return false;
    return runPaths(p).some(
        (path, i) =>
            Math.abs(evenChord(path, gaps[i]!) - interval!) >
            1e-6 * Math.max(1, interval!),
    );
}

/**
 * The spots of a line whose corners hold marchers: run by run from its first point, each
 * `gaps[i]` even gaps straight across, then the last point. In Keep interval a run is a whole
 * number of intervals, so even gaps are the interval; a corner `fine` left off its interval spreads
 * its runs' gaps evenly instead of running past the corner and stacking marchers on it.
 */
function cornerSpots(p: LineParams, gaps: readonly number[]): Slot[] {
    const spots: Slot[] = [];
    let s = 0;
    runPaths(p).forEach((path, i) => {
        spots.push(...evenSpots(path, gaps[i]!, s).slice(0, -1));
        s += path.length;
    });
    const last = p.points.at(-1)!;
    spots.push({ x: last.x, y: last.y, s });
    return spots;
}

/** The `n` spots along the line, tagged with their distance along it */
export function lineSpots(p: LineParams, n: number): Slot[] {
    if (n <= 0) return [];
    const path = linePath(p);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    const interval = typedInterval(p);
    const corners = cornerGaps(p, n);
    if (corners) return cornerSpots(p, corners);
    if (interval === null) {
        if (n === 1) return [at(path.length / 2)];
        // Along a curve, neighbors evenly apart straight across (#525)
        if (smooth(p)) return evenSpots(path, n - 1);
        return Array.from({ length: n }, (_, i) =>
            at((path.length * i) / (n - 1)),
        );
    }
    const gaps = Array.from({ length: n - 1 }, () => interval);
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
 * with no depth. A line is never flipped: a flip reverses it instead.
 */
export function lineFrame(p: LineParams): ShapeFrame {
    const a = p.points[0]!;
    const b = p.points.at(-1)!;
    const d = sub(b, a);
    return {
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        halfWidth: length(d) / 2,
        halfDepth: 0,
        rotation: length(d) > 0 ? Math.atan2(d.y, d.x) : 0,
        flipX: false,
        flipY: false,
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
    return { points: [a, b].map(withTension(tension)), spacing: FIT };
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
 * where it's dragged.
 */
export function dragPoint(
    base: LineParams,
    n: number,
    index: number,
    to: XY,
    env: ToolEnv,
): LineParams {
    const last = base.points.length - 1;
    const end = index === 0 || index === last;
    const other = base.points[index === 0 ? 1 : index - 1]!;
    const keep = base.spacing.mode === "keep" && n > 1;
    let point: XY | null;
    if (keep && end) {
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

/**
 * Whether point `index` is a corner holding a marcher with a straight run on each side: the runs
 * whose lengths {@link cornerOnIntervals} can make whole intervals
 */
function straightCorner(p: LineParams, n: number, index: number): boolean {
    if (p.points[index]!.tension !== 0 || !cornerGaps(p, n)) return false;
    const runs = lineRuns(p);
    const r = runs.findIndex((run) => run.to === index);
    const segments = lineSegments(p);
    return [runs[r], runs[r + 1]].every(
        (run) =>
            run !== undefined &&
            run.to - run.from === 1 &&
            segments[run.from]!.type === "line",
    );
}

/**
 * Where corner `index` can stand with its neighbors where they are and each of its two straight
 * runs a whole number of the typed interval long, the gaps between them as many as now: the spot
 * nearest `to`, or null when there's none
 */
function cornerOnIntervals(
    p: LineParams,
    n: number,
    index: number,
    to: XY,
): XY | null {
    const gaps = cornerGaps(p, n)!;
    const interval = typedInterval(p)!;
    const a = p.points[index - 1]!;
    const b = p.points[index + 1]!;
    const r = lineRuns(p).findIndex((run) => run.to === index);
    const total = gaps[r]! + gaps[r + 1]!;
    let best: XY | null = null;
    for (let k = 1; k < total; k++)
        for (const q of circlesMeet(a, k * interval, b, (total - k) * interval))
            if (!best || length(sub(q, to)) < length(sub(best, to))) best = q;
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
    const a = p.points[index];
    const b = p.points[index + 1];
    if (!a || !b) return p;
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
 * run's anchor, `env.anchor`), in Keep interval. With every corner holding a marcher each segment
 * becomes a whole number of intervals long, its direction kept (#524). A line on the path keeps
 * its drawn length and takes the interval.
 */
export function withInterval(
    p: LineParams,
    n: number,
    interval: number,
    env: Pick<ToolEnv, "pivot" | "anchor">,
): LineParams {
    const groups = [{ interval }];
    if (p.spacing.mode === "path")
        return { ...p, spacing: { ...p.spacing, groups } };
    const kept: LineParams = { ...p, spacing: { mode: "keep", groups } };
    if (n <= 1) return kept;
    const gaps = cornerGaps(kept, n);
    if (gaps) return pinned(kept, onIntervals(kept, gaps, interval), env);
    if (p.points.length === 2)
        return scaled(kept, ((n - 1) * interval) / linePath(p).length, env);
    return scaled(kept, runScale(kept, n, interval), env);
}

/**
 * Each run (corner to corner) scaled about its start so its `gaps[i]` gaps are `interval` straight
 * across, in its own direction and shape, from the first point
 */
function onIntervals(
    p: LineParams,
    gaps: readonly number[],
    interval: number,
): LineParams {
    const points = [...p.points];
    const paths = runPaths(p);
    let at: XY = p.points[0]!;
    lineRuns(p).forEach(({ from, to }, r) => {
        const each = evenChord(paths[r]!, gaps[r]!);
        const k = each > 0 ? interval / each : 1;
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
 * How much bigger the line must be for `n` marchers `interval` apart around its corners to reach
 * from end to end
 */
function runScale(p: LineParams, n: number, interval: number): number {
    const path = linePath(p);
    if (!(path.length > 0)) return 1;
    // The run of chords on the line `k` times as big, against its length
    const over = (k: number) =>
        chordOffsets(path, 0, Array(n - 1).fill(interval / k)).at(-1)! -
        path.length;
    let lo = 1e-6;
    let hi = Math.max(1, ((n - 1) * interval) / path.length) * 2;
    while (over(hi) > 0) hi *= 2;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (over(mid) > 0) lo = mid;
        else hi = mid;
    }
    return hi;
}

/** The line `k` times as big, its pivot staying where it is on the field */
function scaled(
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
            : withInterval({ ...p, spacing: FIT }, n, groups[0]!.interval, env);
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
    const outline = lineOutline(p);
    if (outline.slice(1).some((b, i) => near(outline[i]!, b))) return true;
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

/**
 * Where point `index`'s handles would be at tension 1, on the side its tension handle shows: the
 * way to the next point, or from the one before for the last
 */
function fullHandle(p: LineParams, index: number): XY {
    const points = p.points;
    const last = points.length - 1;
    if (index < last)
        return catmullRomControls(
            mirroredAt(points, index - 1),
            points[index]!,
            points[index + 1]!,
            mirroredAt(points, index + 2),
        ).c1;
    return catmullRomControls(
        mirroredAt(points, index - 2),
        points[index - 1]!,
        points[index]!,
        mirroredAt(points, index + 1),
    ).c2;
}

/**
 * Where smooth point `index`'s tension handle sits: along the line's way through it, as far out
 * as its tension takes the curve's handle (#525); null for a corner
 */
export function tensionHandle(p: LineParams, index: number): XY | null {
    const q = p.points[index];
    if (!q || q.tension === 0) return null;
    return lerp(q, fullHandle(p, index), q.tension);
}

/**
 * Point `index`'s tension handle dragged to `to`: the tension as far out along the curve's way
 * as the pointer went, in tenths when snapping, 0 (a corner) at or behind the point (#525)
 */
export function dragTension(
    base: LineParams,
    index: number,
    to: XY,
    env: ToolEnv,
): LineParams {
    const q = base.points[index];
    if (!q) return base;
    const d = sub(fullHandle(base, index), q);
    const l2 = dot(d, d);
    if (!(l2 > 1e-12)) return base;
    let tension = Math.min(MAX_TENSION, Math.max(0, dot(sub(to, q), d) / l2));
    if (env.snap) tension = Math.round(tension * 10) / 10;
    return setTension(base, index, tension);
}

/** How far along the line a field point is, for keeping marchers' order along it */
export const alongLine = (p: LineParams, point: XY): number =>
    linePath(p).project(point);
