import tolgee from "@/global/singletons/Tolgee";
import { landClicked, landPoint } from "@/shapes/line/lineGeometry";
import type {
    KindHonors,
    ToolEnv,
    ToolHandle,
    ToolHandleMenu,
} from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";

/**
 * A path's corners as the shape tool's Line edits its points (pathways step 1): the same handle
 * interfaces (`ToolHandle`, `ToolHandleMenu`), the same landing (`landClicked`, `landPoint`) and the
 * same roles, so drawing and editing a path works as drawing and editing a Line does. What differs
 * is the ends: a path's two ends are fixed (where the marcher starts and its end spot), so they
 * have no handles, and every corner is a corner (curves come in step 2). Everything is pure.
 */

/** A corner as the pen holds it: a stored corner keeps its `id`, a new one has none yet. */
export interface PathCorner {
    readonly id?: string;
    readonly at: XY;
}

/** A path as it's edited: its fixed ends and the corners between them, in walking order */
export interface PathShape {
    /** Where the marcher stands at the move's start (R-14's A) */
    readonly from: XY;
    /** Its end spot (R-14's B) */
    readonly to: XY;
    readonly corners: readonly PathCorner[];
}

/** Corner `i`'s handle, as a Line's point `i` is keyed */
export const cornerKey = (i: number) => `p${i}`;
/** Leg `i`'s midpoint handle (from the point before corner `i`), as a Line's segment midpoint */
export const midpointKey = (i: number) => `m${i}`;

const CORNER = /^p(\d+)$/;
const MIDPOINT = /^m(\d+)$/;

/** The corner a handle key names, or -1 */
export function cornerOf(shape: PathShape, key: string | null): number {
    const m = key ? CORNER.exec(key) : null;
    const i = m ? Number(m[1]) : -1;
    return i >= 0 && i < shape.corners.length ? i : -1;
}

/** The leg a midpoint key names, or -1 */
export function legOf(shape: PathShape, key: string | null): number {
    const m = key ? MIDPOINT.exec(key) : null;
    const i = m ? Number(m[1]) : -1;
    return i >= 0 && i <= shape.corners.length ? i : -1;
}

/** Every point the marcher walks through, ends included */
export const pathPoints = (shape: PathShape): XY[] => [
    shape.from,
    ...shape.corners.map((c) => c.at),
    shape.to,
];

const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The handles a path draws: a square on each corner, which a click selects, and a small round one
 * in the middle of each leg, which adds a corner there (a Line's points and midpoints, #524, #557).
 * The fixed ends have none.
 */
export function pathHandles(shape: PathShape): ToolHandle[] {
    const points = pathPoints(shape);
    const corners = shape.corners.map((c, i) => ({
        key: cornerKey(i),
        at: c.at,
        cursor: "move",
        selects: true,
    }));
    const midpoints = points.slice(1).map((b, i) => ({
        key: midpointKey(i),
        at: mid(points[i]!, b),
        cursor: "pointer",
        adds: true,
    }));
    return [...corners, ...midpoints];
}

/** The handle within reach of `at`, nearest first (as a shape's handles are found), or null */
export function pathHandleAt(
    shape: PathShape,
    at: XY,
    env: Pick<ToolEnv, "hitRadius">,
): ToolHandle | null {
    let best: { handle: ToolHandle; d: number } | null = null;
    for (const handle of pathHandles(shape)) {
        const d = Math.hypot(handle.at.x - at.x, handle.at.y - at.y);
        if (d <= env.hitRadius && (!best || d < best.d)) best = { handle, d };
    }
    return best?.handle ?? null;
}

/**
 * Where a corner clicked at `at` lands while drawing, after the points so far (the marcher's
 * start, then the corners placed): as a Line's clicked point lands, on the half-step grid or a
 * field line, at 45° from the last with `constrain`, and off the grid with `fine`
 */
export function landCorner(shape: PathShape, at: XY, env: ToolEnv): XY {
    return landClicked(
        [shape.from, ...shape.corners.map((c) => c.at)],
        at,
        env,
    );
}

/**
 * `to` along the way from `from` through `was`, as far as the pointer goes that way: a corner
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

/** Corner `index` dragged to `to`: landed as a Line's point is, its direction kept with `constrain` */
export function dragCorner(
    shape: PathShape,
    index: number,
    to: XY,
    env: ToolEnv,
): readonly PathCorner[] {
    const points = pathPoints(shape);
    const was = points[index + 1]!;
    const before = points[index]!;
    const at = env.constrain
        ? alongKept(before, was, to, env)
        : landPoint(to, env);
    return shape.corners.map((c, i) => (i === index ? { ...c, at } : c));
}

/** A new corner in the middle of leg `leg`, which becomes corner `leg` */
export function splitLeg(shape: PathShape, leg: number): readonly PathCorner[] {
    const points = pathPoints(shape);
    const at = mid(points[leg]!, points[leg + 1]!);
    return [
        ...shape.corners.slice(0, leg),
        { at },
        ...shape.corners.slice(leg),
    ];
}

/**
 * Handle `key` dragged to `to` from `base`, the path at the press: a corner moves; a midpoint adds
 * a corner there and drags it, reading neither constrain nor from center, as a Line's midpoint
 * does. The corners after it, or `base`'s for a key it doesn't know.
 */
export function dragPathHandle(
    base: PathShape,
    key: string,
    to: XY,
    env: ToolEnv,
): readonly PathCorner[] {
    const leg = legOf(base, key);
    if (leg >= 0)
        return dragCorner({ ...base, corners: splitLeg(base, leg) }, leg, to, {
            ...env,
            constrain: false,
            fromCenter: false,
        });
    const index = cornerOf(base, key);
    return index < 0 ? base.corners : dragCorner(base, index, to, env);
}

/** What a click on handle `key` does: a midpoint adds a corner there; null for nothing */
export function clickPathHandle(
    shape: PathShape,
    key: string,
): readonly PathCorner[] | null {
    const leg = legOf(shape, key);
    return leg >= 0 ? splitLeg(shape, leg) : null;
}

/**
 * What `constrain` does on a path's handles, for the chip: a corner keeps its direction, as a
 * Line's corner does; a midpoint takes neither role
 */
export function pathHonors(shape: PathShape, key: string): KindHonors {
    return cornerOf(shape, key) >= 0 ? { constrain: "keepDirection" } : {};
}

/**
 * A path's right-click menus, as a Line's point and segment menus (#569): a corner's Delete corner,
 * a leg's Add corner here. A Line's Corner | Smooth waits for curves (step 2), and a path has no
 * marchers on its corners or ends to close. Deleting the last corner removes the path (one undo
 * step: the app's pick does it), so no path with no corner is left behind.
 */
export const PATH_MENU: ToolHandleMenu<PathShape> = {
    sections(shape, _n, key) {
        if (cornerOf(shape, key) >= 0)
            return [
                {
                    items: [
                        {
                            value: "delete",
                            label: tolgee.t(
                                "pathways.menu.deleteCorner",
                                "Delete corner",
                            ),
                            icon: "trash",
                            destructive: true,
                        },
                    ],
                },
            ];
        if (legOf(shape, key) >= 0)
            return [
                {
                    items: [
                        {
                            value: "add",
                            label: tolgee.t(
                                "pathways.menu.addCorner",
                                "Add corner here",
                            ),
                        },
                    ],
                },
            ];
        return null;
    },
    pick(shape, _n, key, value) {
        const leg = legOf(shape, key);
        if (leg >= 0 && value === "add")
            return {
                params: { ...shape, corners: splitLeg(shape, leg) },
                selected: cornerKey(leg),
            };
        const index = cornerOf(shape, key);
        if (index >= 0 && value === "delete")
            return {
                params: {
                    ...shape,
                    corners: shape.corners.filter((_, i) => i !== index),
                },
                selected: null,
            };
        return null;
    },
};
