import {
    routePath,
    routePiecePoint,
    routePolyline,
    type RoutePath,
} from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import {
    landClicked,
    landPoint,
    MAX_TENSION,
    SMOOTH,
} from "@/shapes/line/lineGeometry";
import type {
    KindHonors,
    ToolEnv,
    ToolHandle,
    ToolHandleMenu,
    ToolMenuSection,
} from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";

/**
 * A path's points as the shape tool's Line edits its points (pathways steps 1 and 2): the same
 * handle interfaces (`ToolHandle`, `ToolHandleMenu`), the same landing (`landClicked`, `landPoint`),
 * the same roles, and the Line's curves: a point is a corner or smooth with a roundness (its
 * `tension`, 0 to 2, 1 the plain curve), a selected smooth point shows its tangent bar, a
 * double-click swaps corner and smooth, and the point and leg menus are the Line's. What differs is
 * the ends: a path's two ends are fixed (where the marcher starts and its end spot), so they have
 * no handles, no roundness and no menu. The curve itself is the resolver's (spec R-14, `routePath`
 * in `@openmarch/core`), so what's drawn is what's walked. Everything is pure.
 */

/** A point as the pen holds it: a stored point keeps its `id`, a new one has none yet. */
export interface PathPoint {
    readonly id?: string;
    readonly at: XY;
    /** Roundness above 0 makes it smooth; 0 or none is a corner */
    readonly tension?: number;
}

/** A path as it's edited: its fixed ends and the points between them, in walking order */
export interface PathShape {
    /** Where the marcher stands at the move's start (R-14's A) */
    readonly from: XY;
    /** Its end spot (R-14's B) */
    readonly to: XY;
    readonly points: readonly PathPoint[];
    /**
     * The ends the curve's first and last tangents read (R-14's F and G): the route's stored
     * `from` and `to` while they're kept (AP-R1), else the real ends
     */
    readonly ends?: { readonly from: XY; readonly to: XY };
}

/** Point `i`'s handle, as a Line's point `i` is keyed */
export const pointKey = (i: number) => `p${i}`;
/** Leg `i`'s midpoint handle (from the point before point `i`), as a Line's segment midpoint */
export const midpointKey = (i: number) => `m${i}`;
/** An end of smooth point `i`'s tangent bar: `t<i>` toward the next point, `tb<i>` back */
export const tangentKey = (i: number, side: 1 | -1) =>
    `${side === 1 ? "t" : "tb"}${i}`;

const POINT = /^p(\d+)$/;
const MIDPOINT = /^m(\d+)$/;
const TANGENT = /^(t|tb)(\d+)$/;

/** The point a handle key names, or -1 */
export function pointOf(shape: PathShape, key: string | null): number {
    const m = key ? POINT.exec(key) : null;
    const i = m ? Number(m[1]) : -1;
    return i >= 0 && i < shape.points.length ? i : -1;
}

/** The leg a midpoint key names, or -1 */
export function legOf(shape: PathShape, key: string | null): number {
    const m = key ? MIDPOINT.exec(key) : null;
    const i = m ? Number(m[1]) : -1;
    return i >= 0 && i <= shape.points.length ? i : -1;
}

/** The point and side a tangent bar end's key names, or null */
export function tangentOf(
    shape: PathShape,
    key: string | null,
): { index: number; side: 1 | -1 } | null {
    const m = key ? TANGENT.exec(key) : null;
    if (!m) return null;
    const index = Number(m[2]);
    if (index < 0 || index >= shape.points.length) return null;
    return { index, side: m[1] === "t" ? 1 : -1 };
}

/** Whether point `i` is smooth */
export const isSmooth = (shape: PathShape, i: number): boolean =>
    (shape.points[i]?.tension ?? 0) > 0;

/** Every point the marcher walks through, ends included */
export const pathPoints = (shape: PathShape): XY[] => [
    shape.from,
    ...shape.points.map((c) => c.at),
    shape.to,
];

const tuple = (p: XY): [number, number] => [p.x, p.y];
const xy = (p: readonly [number, number]): XY => ({ x: p[0], y: p[1] });
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const paths = new WeakMap<PathShape, RoutePath>();

/** The walked path R-14 makes of `shape` (cached per shape object) */
export function curveOf(shape: PathShape): RoutePath {
    let path = paths.get(shape);
    if (!path) {
        path = routePath(
            tuple(shape.from),
            shape.points.map((p) =>
                (p.tension ?? 0) > 0
                    ? { at: tuple(p.at), tension: p.tension }
                    : { at: tuple(p.at) },
            ),
            tuple(shape.to),
            {
                from: tuple(shape.ends?.from ?? shape.from),
                to: tuple(shape.ends?.to ?? shape.to),
            },
        );
        paths.set(shape, path);
    }
    return path;
}

/** Whether any point of the path is smooth */
export const hasCurves = (shape: PathShape): boolean =>
    shape.points.some((p) => (p.tension ?? 0) > 0);

/**
 * The line the field draws: through the points when every one is a corner, else along R-14's
 * curve (the samples it measures each curved piece on)
 */
export function pathOutline(shape: PathShape): XY[] {
    if (!hasCurves(shape)) return pathPoints(shape);
    return routePolyline(curveOf(shape)).map(xy);
}

/**
 * The piece of the walked path that runs along leg `leg` (from the point before point `leg` to
 * point `leg`), or -1 when cleaning merged it away (a point on top of its neighbor)
 */
function pieceOfLeg(shape: PathShape, leg: number): number {
    const { source } = curveOf(shape);
    const want = (k: number) => (k < 0 || k >= shape.points.length ? -1 : k);
    const a = want(leg - 1);
    const b = want(leg);
    for (let j = 0; j + 1 < source.length; j++) {
        const sa = source[j]!;
        const sb = source[j + 1]!;
        const atStart = a < 0 ? j === 0 : sa === a;
        const atEnd = b < 0 ? j + 1 === source.length - 1 : sb === b;
        if (atStart && atEnd) return j;
    }
    return -1;
}

/** Where leg `leg`'s midpoint handle sits: halfway along it, on its curve, as a Line's does */
export function legMidpoint(shape: PathShape, leg: number): XY {
    const points = pathPoints(shape);
    const j = pieceOfLeg(shape, leg);
    if (j < 0) return mid(points[leg]!, points[leg + 1]!);
    const path = curveOf(shape);
    return xy(routePiecePoint(path, j, (path.D[j + 1]! - path.D[j]!) / 2));
}

/**
 * Smooth point `i`'s handle on `side` as R-14 draws it (its tangent bar's end), or null for a
 * corner or a point cleaning dropped
 */
export function tangentHandle(
    shape: PathShape,
    i: number,
    side: 1 | -1,
): XY | null {
    if (!isSmooth(shape, i)) return null;
    const path = curveOf(shape);
    const k = path.source.indexOf(i);
    if (k < 0) return null;
    // A smooth point's pieces are both cubic; its out handle is the next piece's first control,
    // its in handle the previous piece's second
    const piece = path.pieces[side === 1 ? k : k - 1];
    if (!piece || piece.kind !== "cubic") return null;
    return xy(side === 1 ? piece.c1 : piece.c2);
}

/**
 * The handles a path draws: a square on each point, which a click selects; a small round one in
 * the middle of each leg, on its curve, which adds a point there (a Line's points and midpoints,
 * #524, #557); and, for the selected smooth point only, its tangent bar's two ends (#525). The
 * fixed ends have none.
 */
export function pathHandles(
    shape: PathShape,
    selected: string | null = null,
): ToolHandle[] {
    const points = shape.points.map((c, i) => ({
        key: pointKey(i),
        at: c.at,
        cursor: "move",
        selects: true,
    }));
    const midpoints = Array.from(
        { length: shape.points.length + 1 },
        (_, i) => ({
            key: midpointKey(i),
            at: legMidpoint(shape, i),
            cursor: "pointer",
            adds: true,
        }),
    );
    const index = pointOf(shape, selected);
    const bar = shape.points[index];
    const tangents = bar
        ? ([1, -1] as const).flatMap((side) => {
              const at = tangentHandle(shape, index, side);
              return at
                  ? [
                        {
                            key: tangentKey(index, side),
                            at,
                            cursor: "pointer",
                            bar: bar.at,
                        },
                    ]
                  : [];
          })
        : [];
    return [...points, ...midpoints, ...tangents];
}

/** The handle within reach of `at`, nearest first (as a shape's handles are found), or null */
export function pathHandleAt(
    shape: PathShape,
    at: XY,
    env: Pick<ToolEnv, "hitRadius">,
    selected: string | null = null,
): ToolHandle | null {
    let best: { handle: ToolHandle; d: number } | null = null;
    for (const handle of pathHandles(shape, selected)) {
        const d = Math.hypot(handle.at.x - at.x, handle.at.y - at.y);
        if (d <= env.hitRadius && (!best || d < best.d)) best = { handle, d };
    }
    return best?.handle ?? null;
}

/** How far `at` is from the segment `a`–`b` */
function fromSegment(at: XY, a: XY, b: XY): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t =
        l2 === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / l2),
              );
    return Math.hypot(at.x - (a.x + dx * t), at.y - (a.y + dy * t));
}

/**
 * Whether a press at `at` is on the drawn path: within the handle reach (`hitRadius`, a few screen
 * pixels at any zoom) of its line, curves included, as a press is on a Line (`onLine`). Only a
 * double-click or a right-click there is the path's; empty field around it stays the field's.
 */
export function onPath(
    shape: PathShape,
    at: XY,
    env: Pick<ToolEnv, "hitRadius">,
): boolean {
    const line = pathOutline(shape);
    return line
        .slice(1)
        .some((b, i) => fromSegment(at, line[i]!, b) <= env.hitRadius);
}

/**
 * Where a point clicked at `at` lands while drawing, after the points so far (the marcher's
 * start, then the points placed): as a Line's clicked point lands, on the half-step grid or a
 * field line, at 45° from the last with `constrain`, and off the grid with `fine`
 */
export function landCorner(shape: PathShape, at: XY, env: ToolEnv): XY {
    return landClicked([shape.from, ...shape.points.map((c) => c.at)], at, env);
}

/**
 * `to` along the way from `from` through `was`, as far as the pointer goes that way: a point
 * dragged with `constrain` keeps its direction from the point before, only its distance changing,
 * as a Line's corner does. On half steps while snapping.
 */
function alongKept(from: XY, was: XY, to: XY, env: ToolEnv): XY {
    const dx = was.x - from.x;
    const dy = was.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return landPoint(to, env);
    const u = { x: dx / len, y: dy / len };
    let t = (to.x - from.x) * u.x + (to.y - from.y) * u.y;
    if (env.snap) {
        const half = env.stepPx / 2;
        t = Math.round(t / half) * half;
    }
    return { x: from.x + u.x * t, y: from.y + u.y * t };
}

/** Point `index` dragged to `to`: landed as a Line's point is, its direction kept with `constrain` */
export function dragPoint(
    shape: PathShape,
    index: number,
    to: XY,
    env: ToolEnv,
): readonly PathPoint[] {
    const points = pathPoints(shape);
    const was = points[index + 1]!;
    const before = points[index]!;
    const at = env.constrain
        ? alongKept(before, was, to, env)
        : landPoint(to, env);
    return shape.points.map((c, i) => (i === index ? { ...c, at } : c));
}

/** Point `index` with roundness `tension`: 0 a corner (no tension kept), more smooth */
export function withTension(
    shape: PathShape,
    index: number,
    tension: number,
): readonly PathPoint[] {
    return shape.points.map((c, i) => {
        if (i !== index) return c;
        const { tension: _was, ...rest } = c;
        return tension > 0 ? { ...rest, tension } : rest;
    });
}

/** Whether the points are the same, tension included */
export const samePoints = (
    a: readonly PathPoint[],
    b: readonly PathPoint[],
): boolean =>
    a.length === b.length &&
    a.every(
        (p, i) =>
            p.id === b[i]!.id &&
            p.at.x === b[i]!.at.x &&
            p.at.y === b[i]!.at.y &&
            (p.tension ?? 0) === (b[i]!.tension ?? 0),
    );

/** A point double-clicked turns smooth, or a corner again (a Line's #557) */
export const toggleSmooth = (
    shape: PathShape,
    index: number,
): readonly PathPoint[] =>
    withTension(shape, index, isSmooth(shape, index) ? 0 : SMOOTH);

/**
 * Where smooth point `index`'s handle on `side` sits at roundness 1, as a Line's `fullHandle`: the
 * point's handle with its roundness taken out; null for a corner
 */
function fullHandle(shape: PathShape, index: number, side: 1 | -1): XY | null {
    const at = tangentHandle(shape, index, side);
    const q = shape.points[index];
    const t = q?.tension ?? 0;
    if (!at || !q || !(t > 0)) return null;
    return { x: q.at.x + (at.x - q.at.x) / t, y: q.at.y + (at.y - q.at.y) / t };
}

/**
 * Roundness from a drag to `to` along point `index`'s tangent at roundness 1 (`full`, its handle
 * on that side): how far out along it the pointer went, 0 to {@link MAX_TENSION}, in tenths when
 * snapping, as a Line's tangent bar end sets it (`dragTension`)
 */
function roundnessAlong(q: XY, full: XY, to: XY, env: ToolEnv): number {
    const d = { x: full.x - q.x, y: full.y - q.y };
    const l2 = d.x * d.x + d.y * d.y;
    if (!(l2 > 1e-12)) return 0;
    let t = Math.min(
        MAX_TENSION,
        Math.max(0, ((to.x - q.x) * d.x + (to.y - q.y) * d.y) / l2),
    );
    if (env.snap) t = Math.round(t * 10) / 10;
    return t;
}

/**
 * One end of point `index`'s tangent bar dragged to `to`: the roundness as far out along the
 * curve's way on `side` as the pointer went, a corner at or behind the point (a Line's #525, #557)
 */
export function dragTangent(
    shape: PathShape,
    index: number,
    side: 1 | -1,
    to: XY,
    env: ToolEnv,
): readonly PathPoint[] {
    const full = fullHandle(shape, index, side);
    const q = shape.points[index];
    if (!full || !q) return shape.points;
    return withTension(shape, index, roundnessAlong(q.at, full, to, env));
}

/**
 * The pen's press-and-drag on a point just placed (the last): it turns smooth, its roundness
 * following the drag along its tangent, either way, as dragging either end of its tangent bar
 * does. Back on the point it's a corner again.
 */
export function dragNewPoint(
    shape: PathShape,
    to: XY,
    env: ToolEnv,
): readonly PathPoint[] {
    const index = shape.points.length - 1;
    if (index < 0) return shape.points;
    // Its tangent at roundness 1, from the point with that roundness
    const smooth: PathShape = {
        ...shape,
        points: withTension(shape, index, SMOOTH),
    };
    const q = smooth.points[index]!.at;
    const best = ([1, -1] as const).reduce((t, side) => {
        const full = fullHandle(smooth, index, side);
        return full ? Math.max(t, roundnessAlong(q, full, to, env)) : t;
    }, 0);
    return withTension(shape, index, best);
}

/**
 * A new point in the middle of leg `leg`, on its curve, which becomes point `leg`: a corner
 * between corners, else as smooth as the smoother end, the fixed ends counting as corners (a
 * Line's `splitSegment`, #525)
 */
export function splitLeg(shape: PathShape, leg: number): readonly PathPoint[] {
    const at = legMidpoint(shape, leg);
    const t = Math.max(
        shape.points[leg - 1]?.tension ?? 0,
        shape.points[leg]?.tension ?? 0,
    );
    return [
        ...shape.points.slice(0, leg),
        t > 0 ? { at, tension: t } : { at },
        ...shape.points.slice(leg),
    ];
}

const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Whether leg `leg` runs straight: a line piece, or a curve whose handles both lie along it, inside
 * it, as a Line's `lineSegments` makes such a segment a line
 */
export function legStraight(shape: PathShape, leg: number): boolean {
    const j = pieceOfLeg(shape, leg);
    if (j < 0) return true;
    const path = curveOf(shape);
    const piece = path.pieces[j]!;
    if (piece.kind === "line") return true;
    const a = xy(path.V[j]!);
    const b = xy(path.V[j + 1]!);
    const d = sub(b, a);
    const l2 = dot(d, d);
    const along = (c: XY) => {
        const t = dot(sub(c, a), d);
        return Math.abs(cross(d, sub(c, a))) <= 1e-9 * l2 && t >= 0 && t <= l2;
    };
    return along(xy(piece.c1)) && along(xy(piece.c2));
}

/**
 * Leg `leg` made straight (both its points corners) or curved (both smooth, a corner made
 * {@link SMOOTH}), as a Line's `setSegmentCurved` (#569); the fixed ends have no roundness
 */
export function setLegCurved(
    shape: PathShape,
    leg: number,
    curved: boolean,
): readonly PathPoint[] {
    return shape.points.map((c, i) => {
        if (i !== leg - 1 && i !== leg) return c;
        const t = c.tension ?? 0;
        const { tension: _t, ...rest } = c;
        if (!curved) return rest;
        return { ...rest, tension: t > 0 ? t : SMOOTH };
    });
}

/**
 * Handle `key` dragged to `to` from `base`, the path at the press: a point moves; a midpoint adds
 * a point there and drags it, reading neither constrain nor from center, as a Line's midpoint
 * does; a tangent bar's end sets its point's roundness. The points after it, or `base`'s for a key
 * it doesn't know.
 */
export function dragPathHandle(
    base: PathShape,
    key: string,
    to: XY,
    env: ToolEnv,
): readonly PathPoint[] {
    const leg = legOf(base, key);
    if (leg >= 0)
        return dragPoint({ ...base, points: splitLeg(base, leg) }, leg, to, {
            ...env,
            constrain: false,
            fromCenter: false,
        });
    const tangent = tangentOf(base, key);
    if (tangent) return dragTangent(base, tangent.index, tangent.side, to, env);
    const index = pointOf(base, key);
    return index < 0 ? base.points : dragPoint(base, index, to, env);
}

/** What a click on handle `key` does: a midpoint adds a point there; null for nothing */
export function clickPathHandle(
    shape: PathShape,
    key: string,
): readonly PathPoint[] | null {
    const leg = legOf(shape, key);
    return leg >= 0 ? splitLeg(shape, leg) : null;
}

/**
 * What `constrain` does on a path's handles, for the chip: a point keeps its direction, as a
 * Line's corner does; a midpoint and a tangent bar's end take neither role
 */
export function pathHonors(shape: PathShape, key: string): KindHonors {
    return pointOf(shape, key) >= 0 ? { constrain: "keepDirection" } : {};
}

/** A point's menu: Corner | Smooth with Roundness under it, as a Line's; Delete point */
function pointMenu(shape: PathShape, index: number): ToolMenuSection[] {
    const smooth = isSmooth(shape, index);
    return [
        {
            label: tolgee.t("pathways.menu.pointType", "Corner type"),
            look: "segmented",
            hint: tolgee.t(
                "pathways.menu.swapHint",
                "Double-click a point to swap",
            ),
            items: [
                {
                    value: "corner",
                    label: tolgee.t("pathways.menu.corner", "Corner"),
                    checked: !smooth,
                },
                {
                    value: "smooth",
                    label: tolgee.t("pathways.menu.smooth", "Smooth"),
                    checked: smooth,
                },
                ...(smooth
                    ? [
                          {
                              value: "roundness",
                              label: tolgee.t(
                                  "pathways.menu.roundness",
                                  "Roundness",
                              ),
                          },
                      ]
                    : []),
            ],
        },
        {
            items: [
                {
                    value: "delete",
                    label: tolgee.t(
                        "pathways.menu.deletePoint",
                        "Delete point",
                    ),
                    icon: "trash",
                    destructive: true,
                },
            ],
        },
    ];
}

/** A leg's menu: Add point here; Straight | Curved, as a Line's segment menu */
function legMenu(shape: PathShape, leg: number): ToolMenuSection[] {
    const straight = legStraight(shape, leg);
    const curves = !legStraight(
        { ...shape, points: setLegCurved(shape, leg, true) },
        leg,
    );
    return [
        {
            items: [
                {
                    value: "add",
                    label: tolgee.t("pathways.menu.addPoint", "Add point here"),
                },
            ],
        },
        {
            items: [
                {
                    value: "straight",
                    label: tolgee.t("pathways.menu.straight", "Straight"),
                    checked: straight,
                },
                {
                    value: "curved",
                    label: tolgee.t("pathways.menu.curved", "Curved"),
                    checked: !straight,
                    ...(curves
                        ? {}
                        : {
                              disabled: tolgee.t(
                                  "pathways.menu.noCurve",
                                  "The path runs straight through here",
                              ),
                          }),
                },
            ],
        },
    ];
}

/**
 * A path's right-click menus, as a Line's point and segment menus (#569): a point's Corner |
 * Smooth, its Roundness (which selects it, showing its tangent bar) and Delete point; a leg's Add
 * point here and Straight | Curved. A path has no marchers on its points and no ends to close.
 * Deleting the last point removes the path (one undo step: the app's pick does it), so no path
 * with no point is left behind.
 */
export const PATH_MENU: ToolHandleMenu<PathShape> = {
    sections(shape, _n, key) {
        const index = pointOf(shape, key);
        if (index >= 0) return pointMenu(shape, index);
        const leg = legOf(shape, key);
        return leg >= 0 ? legMenu(shape, leg) : null;
    },
    pick(shape, _n, key, value) {
        const with_ = (points: readonly PathPoint[]) => ({ ...shape, points });
        const leg = legOf(shape, key);
        if (leg >= 0) {
            if (value === "add")
                return {
                    params: with_(splitLeg(shape, leg)),
                    selected: pointKey(leg),
                };
            if (value === "straight" || value === "curved") {
                const points = setLegCurved(shape, leg, value === "curved");
                return samePoints(points, shape.points)
                    ? null
                    : { params: with_(points) };
            }
            return null;
        }
        const index = pointOf(shape, key);
        if (index < 0) return null;
        switch (value) {
            case "corner":
                return isSmooth(shape, index)
                    ? { params: with_(withTension(shape, index, 0)) }
                    : null;
            // Smooth shows the point's bar straight away, as Roundness does
            case "smooth":
                return {
                    params: isSmooth(shape, index)
                        ? shape
                        : with_(withTension(shape, index, SMOOTH)),
                    selected: key,
                };
            case "roundness":
                return isSmooth(shape, index)
                    ? { params: shape, selected: key }
                    : null;
            case "delete":
                return {
                    params: with_(shape.points.filter((_, i) => i !== index)),
                    selected: null,
                };
            default:
                return null;
        }
    },
};
