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

export interface LineParams {
    /** In order from the first marcher's end; two for now */
    readonly points: readonly LinePoint[];
    /** A closed line joins its last point to its first (later); open when absent */
    readonly closed?: boolean;
    readonly spacing: LineSpacing;
}

const FIT: LineSpacing = { mode: "fit" };

const halfStep = (env: Pick<ToolEnv, "stepPx">) => env.stepPx / 2;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const length = (d: XY) => Math.hypot(d.x, d.y);
const corner = ({ x, y }: XY): LinePoint => ({ x, y, tension: 0 });

/** Whether `params` is a line this version can read back from a recipe */
export function isLineParams(params: unknown): params is LineParams {
    if (typeof params !== "object" || params === null) return false;
    const p = params as Partial<LineParams>;
    return (
        Array.isArray(p.points) &&
        p.points.length >= 2 &&
        p.points.every(
            (q) =>
                typeof q === "object" &&
                q !== null &&
                Number.isFinite(q.x) &&
                Number.isFinite(q.y),
        ) &&
        typeof p.spacing === "object" &&
        p.spacing !== null &&
        (p.spacing.mode === "fit" ||
            ((p.spacing.mode === "keep" || p.spacing.mode === "path") &&
                Array.isArray(p.spacing.groups) &&
                p.spacing.groups.length > 0 &&
                p.spacing.groups.every((g) => g.interval > 0)))
    );
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

/**
 * The interval between neighbors, in field units: the typed one, or in Fit the one the drawn
 * line works out to
 */
export function lineInterval(p: LineParams, n: number): number {
    return typedInterval(p) ?? (n > 1 ? linePath(p).length / (n - 1) : 0);
}

/** The `n` spots along the line, tagged with their distance along it */
export function lineSpots(p: LineParams, n: number): Slot[] {
    if (n <= 0) return [];
    const path = linePath(p);
    const at = (s: number): Slot => ({ ...path.at(s), s });
    const interval = typedInterval(p);
    if (interval === null) {
        if (n === 1) return [at(path.length / 2)];
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
        point = { x: other.x + u.x * was, y: other.y + u.y * was };
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
    const kept: LineParams = { ...p, spacing: { mode: "keep", groups } };
    return n > 1 ? resized(kept, (n - 1) * interval, env) : kept;
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

/** Whether a press at `at` is on the line: within half its interval of it, or of its spots */
export function onLine(p: LineParams, n: number, at: XY): boolean {
    const reach = Math.max(lineInterval(p, n) / 2, 1e-9);
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
