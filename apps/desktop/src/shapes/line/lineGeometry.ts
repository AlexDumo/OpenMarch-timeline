import {
    fieldToFrame,
    frameToField,
    pivotPoint,
    type ShapeFrame,
} from "../frame/frame";
import { linePull } from "../frame/edgeGuides";
import { pivotOf } from "../frame/pivot";
import { makePath, type Path } from "../geometry/path";
import { chordOffsets } from "../spacing";
import type { ToolEnv } from "../tool/toolKind";
import type { Slot, XY } from "../types";

/**
 * A Line as the shape host draws it (#523, spec #522): points the line passes through, and how
 * its marchers are spaced along it. This first version draws two points with straight segments
 * between them; the params already hold what later versions add (more points with tensions, a
 * closed flag, interval groups), so recipes saved now read the same then. Everything here is pure.
 */

/** A point the line passes through. Tension 0 is a corner; above 0 a smooth point (later) */
export interface LinePoint extends XY {
    readonly tension: number;
}

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

/**
 * What an interval measures (spec #522, "Measured"): `x` (↔) is how far neighbors are apart side
 * to side, `y` (↕) front to back. Absent is the true distance, straight across.
 */
export type LineMeasured = "x" | "y";

export interface LineParams {
    /** In order from the first marcher's end; two for now */
    readonly points: readonly LinePoint[];
    /** A closed line joins its last point to its first (later); open when absent */
    readonly closed?: boolean;
    readonly spacing: LineSpacing;
    /** The true distance when absent */
    readonly measured?: LineMeasured;
}

const FIT: LineSpacing = { mode: "fit" };

const halfStep = (env: Pick<ToolEnv, "stepPx">) => env.stepPx / 2;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const length = (d: XY) => Math.hypot(d.x, d.y);
const corner = ({ x, y }: XY): LinePoint => ({ x, y, tension: 0 });

const isPoint = (q: unknown): q is LinePoint =>
    typeof q === "object" &&
    q !== null &&
    Number.isFinite((q as LinePoint).x) &&
    Number.isFinite((q as LinePoint).y) &&
    // Smooth points come later (#525): a curve saved by a newer build isn't read as straight
    (q as LinePoint).tension === 0;

const isGroup = (g: unknown): g is LineGroup =>
    typeof g === "object" &&
    g !== null &&
    Number.isFinite((g as LineGroup).interval) &&
    (g as LineGroup).interval > 0 &&
    // A counted group is a mixed interval (#526), which this version can't lay out
    (g as LineGroup).count === undefined;

const ANCHORS: readonly unknown[] = ["start", "center", "end"];
// `pivot` is the host's (ADR 0006, amendment of 2026-10-20), stored beside the kind's own numbers
const KEYS = new Set(["points", "closed", "spacing", "measured", "pivot"]);

/**
 * Whether `params` is a line this version can lay out exactly as it was saved. Anything a newer
 * build adds (more points, tensions, closing, mixed groups, corners) is refused, so the
 * recipe shows as plain positions instead of being misread and rewritten on the first edit (ADR
 * 0006, decision 5). Each later ticket widens this as it adds the layout.
 */
export function isLineParams(params: unknown): params is LineParams {
    if (typeof params !== "object" || params === null) return false;
    if (Object.keys(params).some((key) => !KEYS.has(key))) return false;
    const p = params as Partial<LineParams>;
    if (p.closed !== undefined && p.closed !== false) return false;
    if (p.measured !== undefined && p.measured !== "x" && p.measured !== "y")
        return false;
    if (!Array.isArray(p.points) || p.points.length !== 2) return false;
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

/** The path through the line's points */
export function linePath(p: LineParams): Path {
    const segments = p.points
        .slice(1)
        .map((b, i) => ({ type: "line" as const, a: p.points[i]!, b }));
    return makePath(segments);
}

/** The interval a typed spacing keeps, in field units; null in Fit */
export function typedInterval(p: LineParams): number | null {
    return p.spacing.mode === "fit" ? null : p.spacing.groups[0]!.interval;
}

const coord = (q: XY, axis: LineMeasured) => (axis === "x" ? q.x : q.y);

/**
 * Why the line can't be measured along `axis` (↔ or ↕), or null when it can: it has to keep going
 * one way that way from its first point to its last, never turning back or standing still, so
 * each spot has one place on it. Any number of points.
 */
export function measuredBlock(
    p: LineParams,
    axis: LineMeasured,
): "none" | "turns" | null {
    const d = p.points
        .slice(1)
        .map((b, i) => coord(b, axis) - coord(p.points[i]!, axis));
    if (d.every((v) => Math.abs(v) < 1e-9)) return "none";
    if (p.closed) return "turns";
    return d.every((v) => v > 1e-9) || d.every((v) => v < -1e-9)
        ? null
        : "turns";
}

/**
 * What the line's intervals measure as it's laid out: its Measured setting, or the true distance
 * (null) when that's absent or the line no longer goes one way along it (an end turned square)
 */
export function measuredAxis(p: LineParams): LineMeasured | null {
    return p.measured && measuredBlock(p, p.measured) === null
        ? p.measured
        : null;
}

/** The line's length as its intervals measure it */
function measuredLength(p: LineParams): number {
    const axis = measuredAxis(p);
    if (!axis) return linePath(p).length;
    return Math.abs(coord(p.points.at(-1)!, axis) - coord(p.points[0]!, axis));
}

/** The gaps between neighbors a typed spacing keeps, in field units, first to last */
function gapsOf(p: LineParams, n: number): number[] {
    const interval = typedInterval(p) ?? 0;
    return Array.from({ length: Math.max(0, n - 1) }, () => interval);
}

/**
 * The spot on a line measured along `axis` where that coordinate is `c`, exactly: on the segment
 * that reaches it, or past an end along the end segment. Tagged with its distance along the line.
 */
function atCoord(p: LineParams, axis: LineMeasured, c: number): Slot {
    const points = p.points;
    let s = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const ca = coord(a, axis);
        const cb = coord(b, axis);
        const len = length(sub(b, a));
        if (i < points.length - 1 && (cb - c) * (cb - ca) < 0) {
            s += len;
            continue;
        }
        const t = (c - ca) / (cb - ca);
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        return { ...at, [axis]: c, s: s + len * t };
    }
    return { ...points[0]!, s: 0 };
}

/**
 * The interval between neighbors, in field units: the typed one, or in Fit the one the drawn
 * line works out to, measured as the line measures it
 */
export function lineInterval(p: LineParams, n: number): number {
    return typedInterval(p) ?? (n > 1 ? measuredLength(p) / (n - 1) : 0);
}

/**
 * The `n` spots along the line, tagged with their distance along it. Measured ↔ or ↕, neighbors
 * are the interval apart that way, exactly, from an end; with `stepPx`, a centered run on the
 * path starts a whole number of half steps from the line's start, so it stays on the grid with it.
 */
export function lineSpots(p: LineParams, n: number, stepPx?: number): Slot[] {
    if (n <= 0) return [];
    const axis = measuredAxis(p);
    if (axis) return measuredSpots(p, n, axis, stepPx);
    const path = linePath(p);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    if (typedInterval(p) === null) {
        if (n === 1) return [at(path.length / 2)];
        return Array.from({ length: n }, (_, i) =>
            at((path.length * i) / (n - 1)),
        );
    }
    const gaps = gapsOf(p, n);
    const run = chordOffsets(path, 0, gaps).at(-1)!;
    const from = runStart(p, path.length, run);
    return chordOffsets(path, from, gaps).map(at);
}

/** How far along the line, as it's measured, a typed run of `run` starts */
function runStart(p: LineParams, total: number, run: number): number {
    // Keep interval is sized to its run, which sits on it whole; on the path it sits at its anchor
    const anchor = p.spacing.mode === "path" ? p.spacing.anchor : "center";
    return anchor === "start"
        ? 0
        : anchor === "end"
          ? total - run
          : (total - run) / 2;
}

/** {@link lineSpots} on a line measured along `axis` */
function measuredSpots(
    p: LineParams,
    n: number,
    axis: LineMeasured,
    stepPx: number | undefined,
): Slot[] {
    const first = coord(p.points[0]!, axis);
    const last = coord(p.points.at(-1)!, axis);
    const total = Math.abs(last - first);
    const way = Math.sign(last - first);
    const at = (c: number) => atCoord(p, axis, first + way * c);
    if (typedInterval(p) === null) {
        if (n === 1) return [at(total / 2)];
        return Array.from({ length: n }, (_, i) =>
            // The last spot is exactly on the end
            i === n - 1 ? at(total) : at((total * i) / (n - 1)),
        );
    }
    const gaps = gapsOf(p, n);
    const run = gaps.reduce((a, b) => a + b, 0);
    let from = runStart(p, total, run);
    // A centered run (Keep interval's is the whole line) starts on a half step from the start
    const centered =
        p.spacing.mode === "keep" ||
        (p.spacing.mode === "path" && p.spacing.anchor === "center");
    if (stepPx && centered)
        from = Math.round(from / (stepPx / 2)) * (stepPx / 2);
    let c = from;
    return [at(c), ...gaps.map((gap) => at((c += gap)))];
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

/** A straight line drawn from `from` to `to`, in Fit; undefined while it's under half a step */
export function drawLine(
    from: XY,
    to: XY,
    env: ToolEnv,
): LineParams | undefined {
    const a = landPoint(from, env);
    const b = endAt(a, to, env);
    if (length(sub(b, a)) < halfStep(env) - 1e-9) return undefined;
    const line: LineParams = { points: [corner(a), corner(b)], spacing: FIT };
    return yardToYard(a, b, env) ? { ...line, measured: "x" } : line;
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
 * Point `index` dragged to `to`. In Fit and on the path the point goes there (landed); in Keep
 * interval the line turns about its other end, its length (so its interval) kept.
 */
export function dragPoint(
    base: LineParams,
    n: number,
    index: number,
    to: XY,
    env: ToolEnv,
): LineParams {
    const other = base.points[index === 0 ? base.points.length - 1 : 0]!;
    let point: XY;
    if (base.spacing.mode === "keep" && n > 1) {
        const u = directionFrom(other, to, env);
        if (!u) return base;
        const was = length(sub(base.points[index]!, other));
        // Measured ↔ or ↕, the line keeps its length that way, which is what its interval keeps
        const axis = measuredAxis(base);
        const keep =
            axis && Math.abs(coord(u, axis)) > 1e-9
                ? measuredLength(base) / Math.abs(coord(u, axis))
                : was;
        point = { x: other.x + u.x * keep, y: other.y + u.y * keep };
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
 * The line as long as `n` marchers `interval` apart need, grown or shrunk from its pivot (or the
 * run's anchor, `env.anchor`), in Keep interval. A line on the path keeps its drawn length and
 * takes the interval.
 */
export function withInterval(
    p: LineParams,
    n: number,
    interval: number,
    env: ToolEnv,
): LineParams {
    const groups = [{ interval }];
    if (p.spacing.mode === "path")
        return { ...p, spacing: { ...p.spacing, groups } };
    return sizedToRun({ ...p, spacing: { mode: "keep", groups } }, n, env);
}

/**
 * A line in Keep interval as long as its run, grown or shrunk from its pivot. Measured ↔ or ↕,
 * it's the run that way, its start then moved along it onto the grid that way (when snapping) so
 * every spot's x (or y) lands on it.
 */
function sizedToRun(p: LineParams, n: number, env: ToolEnv): LineParams {
    if (n <= 1) return p;
    const run = gapsOf(p, n).reduce((a, b) => a + b, 0);
    const axis = measuredAxis(p);
    if (!axis) return resized(p, run, env);
    const extent = measuredLength(p);
    const ends = 2 * lineFrame(p).halfWidth;
    const grown = resized(p, (ends * run) / extent, env);
    if (!env.snap) return grown;
    const first = grown.points[0]!;
    const off = coord(env.gridSnap(first), axis) - coord(first, axis);
    const d = sub(grown.points.at(-1)!, first);
    const k = off / coord(d, axis);
    if (!Number.isFinite(k)) return grown;
    // That way the move is exactly `off`, so the start is exactly on the grid
    return {
        ...grown,
        points: grown.points.map((q) => ({
            ...q,
            x: q.x + d.x * k,
            y: q.y + d.y * k,
            [axis]: coord(q, axis) + off,
        })),
    };
}

/**
 * The line measured along `axis` (↔, ↕) or by the true distance (null), from the Measured menu.
 * The typed interval stays the same number, now measured the new way, so Keep interval resizes;
 * Fit leaves the line as it is. A line that doesn't go one way along `axis` can't take it.
 */
export function withMeasured(
    p: LineParams,
    n: number,
    axis: LineMeasured | null,
    env: ToolEnv,
): LineParams {
    if ((p.measured ?? null) === axis) return p;
    if (axis && measuredBlock(p, axis) !== null) return p;
    const { measured: _was, ...rest } = p;
    const next: LineParams = axis ? { ...rest, measured: axis } : rest;
    return next.spacing.mode === "keep" ? sizedToRun(next, n, env) : next;
}

/**
 * The line `size` long from end to end, its pivot staying where it is on the field: every point
 * keeps its place along and across the frame, stretched along it
 */
function resized(p: LineParams, size: number, env: ToolEnv): LineParams {
    const frame = lineFrame(p);
    // A line with no length has no direction to grow along
    if (!(frame.halfWidth > 1e-9)) return p;
    const key = env.pivot ?? pivotOf(p);
    const fixed = env.anchor ?? pivotPoint(frame, key);
    const grown = { ...frame, halfWidth: size / 2 };
    const now = pivotPoint(grown, key);
    const moved = {
        ...grown,
        center: {
            x: grown.center.x + fixed.x - now.x,
            y: grown.center.y + fixed.y - now.y,
        },
    };
    const k = grown.halfWidth / frame.halfWidth;
    const points = p.points.map((q) => {
        const local = fieldToFrame(frame, q);
        return { ...q, ...frameToField(moved, { x: local.x * k, y: local.y }) };
    });
    return { ...p, points };
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
    if (p.points.slice(1).some((b, i) => near(p.points[i]!, b))) return true;
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
