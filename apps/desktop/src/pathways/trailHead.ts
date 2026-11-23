/**
 * Dragging a trail's head, AP-T16 (owner, 2026-11-17: "how do I edit it as if I maybe wanted it
 * to continue going or wanted it to go less? Would I need to redraw it?"). A stored trail dragged
 * out of a line (step 4b, step 11's snake out of a box) shows a grab handle at its head, the
 * leader's end, in the Follow tool's pull arrows (step 4d). Dragging it is step 4b's drag again,
 * carried on from where it stopped: the session becomes the Follow tool's drawing with the stored
 * points as what's already drawn, so the way, the end spots and the real marchers follow the
 * pointer exactly as they did while it was dragged out. Dragging on runs the trail on, dragging
 * back along it cuts it back; the release plans everyone's end spot again as AP-T8 would for the
 * new trail, in one undo step (`dragTrailHead`). Escape cancels with nothing written.
 */
import {
    alongEnds,
    EPS_GEOM,
    makeAlongTrail,
    type FtlTrail,
    type XY as CoreXY,
} from "@openmarch/core";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import {
    dragTrailHead,
    planTrailDrag,
    type TrailSpacing,
} from "@/db-functions/timelineTrailDrag";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { invalidatePlacedBoxes } from "@/shapes/placed/placedBoxStore";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import {
    EVEN_STEP,
    followSpacingOf,
    followTarget,
    type FollowDrag,
} from "./followDrag";
import {
    dragNewPoint,
    landCorner,
    samePoints,
    type PathPoint,
} from "@/shapes/pen/penPath";
import { SMOOTH } from "@/shapes/line/lineGeometry";
import { isFollowTheLeaderOn } from "./followTheLeader";
import {
    shapeOf,
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";

/** A trail's head as the field draws its handle: where it is and the way the trail runs there */
export interface TrailHead {
    readonly at: XY;
    /** A unit direction: the trail's own way at its end */
    readonly dir: XY;
}

/** The pull arrows' reach from the head, in dot radii (the Follow tool's `PULL_ARROW`) */
export const HEAD_REACH_DOTS = 8.6;
/** Where the first arrow starts, in dot radii: a dot standing on the head keeps its own press */
export const HEAD_CLEAR_DOTS = 1.8;
/** How far either side of the arrows still takes the press, in dot radii, at the least */
const HEAD_WIDTH_DOTS = 1.6;

const tuple = (p: XY): CoreXY => [p.x, p.y];

/** R-13″'s projection: the distance along `way` of its point nearest `p` (ties to the larger) */
export const nearestAlong = (way: FtlTrail, p: CoreXY): number =>
    alongEnds(way, [p], [0]).endDist[0]!;
const xy = (p: readonly number[]): XY => ({ x: p[0]!, y: p[1]! });

/**
 * The way the trail's points make from the leader's start `from` (R-13″'s drawn part, the
 * resolver's own, as AP-T8 plans on it), or null with no length
 */
export function wayOf(
    from: XY,
    points: readonly PathPoint[],
): { way: FtlTrail; L: number } | null {
    const last = points.at(-1);
    if (!last) return null;
    const way = makeAlongTrail([tuple(from)], {
        from: tuple(from),
        to: tuple(last.at),
        points: storedPoints(points).map((p) => ({
            at: p.at,
            ...(p.tension === undefined ? {} : { tension: p.tension }),
            ...(p.bulge === undefined ? {} : { bulge: p.bulge }),
        })),
    });
    return way.drawn ? { way, L: way.destOffset } : null;
}

/**
 * Whether the session's trail takes a head drag (AP-T16): a stored trail dragged out of a line
 * (its ends along the way), with Edit path on (owner, 2026-11-17: with it off, clicks on the trail
 * and its head only select), not drawn. A trail into end spots (Follow into a form, Ripple in) or round an
 * outline has its length from those spots, so it has none.
 */
export function canDragHead(s: PathSession | null): s is PathSession {
    const trail = s?.target.trail;
    return (
        !!s &&
        !!trail &&
        // Follow-the-leader switched off while the trail was open (#1095): nothing to drag
        isFollowTheLeaderOn() &&
        s.phase === "open" &&
        !s.follow &&
        !!trail.along &&
        !trail.around &&
        !trail.unfounded &&
        trail.members.length >= 2 &&
        s.target.routeId !== null &&
        s.points.length > 0
    );
}

const heads = new WeakMap<PathSession, TrailHead | null>();

/** The head handle of the session's trail (AP-T16), or null when it has none */
export function trailHeadOf(s: PathSession | null): TrailHead | null {
    if (!canDragHead(s)) return null;
    if (heads.has(s)) return heads.get(s)!;
    const head = computeHead(s);
    heads.set(s, head);
    return head;
}

function computeHead(s: PathSession): TrailHead | null {
    const shape = shapeOf(s);
    const drawn = wayOf(shape.from, s.points);
    if (!drawn) return null;
    const { way, L } = drawn;
    const end = way.at(L);
    // The way's own direction at its end, read just short of it (a curve's or an arc's too)
    const back = way.at(Math.max(0, L - Math.min(L / 2, 2)));
    const dx = end[0] - back[0];
    const dy = end[1] - back[1];
    const d = Math.hypot(dx, dy);
    if (!(d > 0)) return null;
    return { at: xy(end), dir: { x: dx / d, y: dy / d } };
}

/**
 * Whether a press at `at` takes the head (AP-T16): on its arrows, out along the way from the head
 * (`unit` a dot's radius on the field, `radius` the press's reach, a finger's wider), or on the
 * head itself when no dot stands there (a dot under the press is the dot's, P-1)
 */
export function headHit(
    head: TrailHead,
    at: XY,
    radius: number,
    unit: number,
    onDot: boolean,
): boolean {
    const rx = at.x - head.at.x;
    const ry = at.y - head.at.y;
    const t = rx * head.dir.x + ry * head.dir.y;
    const from = onDot ? HEAD_CLEAR_DOTS * unit : 0;
    if (t < from - (onDot ? 0 : radius)) return false;
    const c = Math.min(Math.max(t, from), HEAD_REACH_DOTS * unit);
    const reach = Math.max(radius, HEAD_WIDTH_DOTS * unit);
    return (
        Math.hypot(
            at.x - (head.at.x + head.dir.x * c),
            at.y - (head.at.y + head.dir.y * c),
        ) <= reach
    );
}

// ---------------------------------------------------------------------------
// The drag's trail (pure)
// ---------------------------------------------------------------------------

/**
 * The trail's points with its head dragged to `at` (AP-T16), from the stored `prefix` walked from
 * the leader's start `from`, worked out afresh from the stored points on every move:
 *
 * - **Back along it** (the pointer within `env.hitRadius` of the trail, short of its head): the
 *   trail is cut where the pointer is nearest it, as a route is cut at a count (AP-R7: the points
 *   before stay with their ids, an arc keeps its circle), on a straight leg on whole half steps
 *   from the leg's start (the grid's, unless fine). Never shorter than half a step, the shortest
 *   first leg the Follow tool's drag lands.
 * - **On along a straight last leg** (within that reach of its line, past the head): the head
 *   slides along it, so a straight trail stays one leg.
 * - **Anywhere else**: on from the head with a new corner, landed as a click lands one while a
 *   trail is drawn (`landCorner`).
 */
export function headDragPoints(
    prefix: readonly PathPoint[],
    from: XY,
    at: XY,
    env: ToolEnv,
): PathPoint[] {
    const drawn = wayOf(from, prefix);
    if (!drawn) return [...prefix];
    const { way, L } = drawn;
    const W = way.drawn!.path;
    const half = env.stepPx / 2;
    const quantum = env.snap ? half : 0;
    const land = (t: number) =>
        quantum > 0 ? Math.round(t / quantum) * quantum : t;
    const reach = env.hitRadius;
    const p = tuple(at);
    // Back along the trail
    const s = nearestAlong(way, p);
    const on = way.at(s);
    if (Math.hypot(on[0] - p[0], on[1] - p[1]) <= reach && s < L - EPS_GEOM) {
        const j = pieceAt(W.D, s);
        const cut =
            W.pieces[j]!.kind === "line" ? W.D[j]! + land(s - W.D[j]!) : s;
        return cutAt(prefix, way, Math.max(half, Math.min(cut, L)));
    }
    // On along a straight last leg
    const n = W.V.length;
    if (W.pieces.at(-1)?.kind === "line" && n >= 2) {
        const a = W.V[n - 2]!;
        const b = W.V[n - 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
        const across = Math.abs(-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux);
        if (t > len && across <= reach) {
            const head = prefix.at(-1)!;
            const to = land(t);
            return [
                ...prefix.slice(0, -1),
                { ...head, at: { x: a[0] + ux * to, y: a[1] + uy * to } },
            ];
        }
    }
    // On with a corner at the head
    const next = landCorner({ ...shapeOfPrefix(from, prefix) }, at, env);
    const head = prefix.at(-1)!.at;
    if (next.x === head.x && next.y === head.y) return [...prefix];
    return [...prefix, { at: next }];
}

/** The trail as the pen's handles work on it: from the leader's start to its own last point */
const shapeOfPrefix = (from: XY, points: readonly PathPoint[]) => {
    const to = points.at(-1)?.at ?? from;
    return { from, to, points, ends: { from, to } };
};

/** The piece of a route path holding distance `d` (R-14's rule, as a route is cut, AP-R7) */
function pieceAt(D: readonly number[], d: number): number {
    let j = 0;
    while (j < D.length - 2 && !(d < D[j + 1]!)) j++;
    return j;
}

/**
 * `prefix` cut at distance `d` along its drawn way (AP-R7's half before the count): the points
 * before it, ids kept, then a corner at the cut. An arc leg cut keeps its circle: the new last
 * leg's bulge is its share of the sweep.
 */
export function cutAt(
    prefix: readonly PathPoint[],
    way: FtlTrail,
    d: number,
): PathPoint[] {
    const W = way.drawn!.path;
    if (d >= W.L - EPS_GEOM) return [...prefix];
    const C = way.at(d);
    const far = (k: number) =>
        Math.hypot(W.V[k]![0] - C[0], W.V[k]![1] - C[1]) >= EPS_GEOM;
    const kept: number[] = [];
    for (let k = 1; k < W.V.length - 1; k++)
        if (W.source[k]! >= 0 && W.D[k]! < d && far(k)) kept.push(k);
    const j = pieceAt(W.D, d);
    const piece = W.pieces[j]!;
    const kb = kept.at(-1) ?? 0;
    let bulge: number | undefined;
    if (kb === j && piece.kind === "arc") {
        const f = Math.min(
            1,
            Math.max(0, (d - W.D[j]!) / (W.D[j + 1]! - W.D[j]!)),
        );
        const phi = 2 * Math.atan(2 * piece.k);
        const k = Math.tan((phi * f) / 2) / 2;
        bulge = k === 0 ? undefined : k;
    } else if (kb === j - 1) {
        const before = W.pieces[j - 1];
        bulge = before?.kind === "arc" ? before.k : undefined;
    }
    return [
        ...kept.map((k) => prefix[W.source[k]!]!),
        { at: xy(C), ...(bulge === undefined ? {} : { bulge }) },
    ];
}

// ---------------------------------------------------------------------------
// The spacing it was dragged out with
// ---------------------------------------------------------------------------

/**
 * The spacing a stored trail was dragged out with (DL-7), read back from its end spots: Even N
 * steps when the spots are AP-T8's for Even N on the stored trail, else Keep spacing (its own
 * spots, or spots moved by hand since, which the head drag plans again with Keep spacing).
 */
export function headSpacingOf(s: PathSession, step: number): TrailSpacing {
    const members = s.target.trail?.members ?? [];
    const starts = members.map((m) => tuple(m.from));
    const points = storedPoints(s.points);
    const tol = 0.01 * step;
    const matches = (plan: { spots: readonly CoreXY[] }) =>
        plan.spots.every((p, q) => {
            const to = members[q]!.to;
            return Math.hypot(p[0] - to.x, p[1] - to.y) <= tol;
        });
    const keep = planTrailDrag(starts, points, { kind: "keep" }, step);
    if (matches(keep) || members.length < 2) return { kind: "keep" };
    // Even N: the same gap along the way between every member's spot, the leader's at the end
    const e = members.map((m) => nearestAlong(keep.way, tuple(m.to)));
    const gap = e[1]! - e[0]!;
    const even = e.every(
        (x, q) => q === 0 || Math.abs(x - e[q - 1]! - gap) <= tol,
    );
    const steps = Math.round(gap / step / EVEN_STEP) * EVEN_STEP;
    if (even && gap > 0 && steps >= EVEN_STEP) {
        const spacing: TrailSpacing = { kind: "even", steps };
        if (matches(planTrailDrag(starts, points, spacing, step)))
            return spacing;
    }
    // A form whose tail was slid along the trail (owner, 2026-11-17): every spot on the way, in
    // order, the leader's at the head; its gaps back from the head are its spacing. Spots moved
    // off the way by hand are Keep spacing's, planned again
    const total = keep.way.destOffset;
    const onWay = members.every((m, q) => {
        const at = keep.way.at(e[q]!);
        return Math.hypot(at[0] - m.to.x, at[1] - m.to.y) <= tol;
    });
    const ordered = e.every((x, q) => q === 0 || x > e[q - 1]! + tol);
    if (onWay && ordered && Math.abs(e.at(-1)! - total) <= tol) {
        const spacing: TrailSpacing = {
            kind: "gaps",
            back: e.map((x, q) => (q === e.length - 1 ? 0 : total - x)),
        };
        if (matches(planTrailDrag(starts, points, spacing, step)))
            return spacing;
    }
    return { kind: "keep" };
}

// ---------------------------------------------------------------------------
// The drag
// ---------------------------------------------------------------------------

/**
 * A press on the head (AP-T16): the session becomes step 4b's drawing, grabbed at the leader, its
 * stored points already drawn. `step` is one step in field units. False when there's no head.
 */
export function startHeadDrag(step: number): boolean {
    const { session, saving } = usePathPenStore.getState();
    if (saving || !canDragHead(session) || !trailHeadOf(session)) return false;
    beginTrailDrag(session, step, headSpacingOf(session, step));
    return true;
}

/**
 * The session becomes step 4b's drawing, grabbed at the leader, its stored points already drawn
 * (the head drag, AP-T16, and a marcher of the form dragged, `trailForm.ts`), with `spacing` and,
 * for a marcher's drag, `form`
 */
export function beginTrailDrag(
    session: PathSession,
    step: number,
    spacing: TrailSpacing,
    form?: NonNullable<FollowDrag["head"]>["form"],
): void {
    const trail = session.target.trail!;
    const line = trail.members.map((m) => m.marcherId);
    const leader = line.at(-1)!;
    const follow: FollowDrag = {
        window: { start: session.target.start, end: session.target.end },
        ids: [...line].sort((a, b) => a - b),
        order: line,
        starts: new Map(trail.members.map((m) => [m.marcherId, m.from])),
        box: null,
        grabbed: leader,
        spacing,
        ends: "trail",
        keep: null,
        form: null,
        step,
        head: {
            prefix: session.points,
            restore: session,
            ...(form ? { form } : {}),
        },
    };
    const drills = new Map(trail.members.map((m) => [m.marcherId, m.drill]));
    usePathPenStore.setState({
        session: {
            ...session,
            phase: "drawing",
            follow,
            target: followTarget(session.target, follow, drills),
            pointer: session.points.at(-1)!.at,
            selected: null,
            dragging: null,
            lane: null,
            hoverLane: null,
        },
    });
}

/** The head drag under way, or null */
const headDragOf = (s: PathSession | null) =>
    s?.phase === "drawing" && s.follow?.head ? s.follow : null;

/** Whether the head of a trail is being dragged (AP-T16) */
export const isHeadDrag = (s: PathSession | null): boolean => !!headDragOf(s);

/** The pointer moved to `at` while dragging the head: the trail cut back or run on to it */
export function moveHeadDrag(at: XY, env: ToolEnv): void {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!session || !f?.head) return;
    const from = f.head.restore.target.trail!.members.at(-1)!.from;
    const points = headDragPoints(f.head.prefix, from, at, env);
    if (samePoints(points, session.points)) return;
    usePathPenStore.setState({
        session: { ...session, points, pointer: points.at(-1)!.at },
    });
}

/** Whether a trail's head is being drawn on with clicks, the button up (AP-T16, owner 2026-11-17) */
export const isHeadClicks = (s: PathSession | null): boolean =>
    !!headDragOf(s)?.head?.clicks;

/**
 * A click on the head, the button let go where it was pressed (owner, 2026-11-17: "a way for me
 * to just click and then drag like i would before"): the drag becomes a drawing, as the pen's,
 * carried on from the head. The next leg follows the pointer with the button up, a click places
 * a point (`clickHeadAt`), and Enter writes what's placed (`finishHeadDrag`). False when no head
 * is dragged.
 */
export function clickHead(): boolean {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!session || !f?.head) return false;
    const prefix = f.head.restore.points;
    usePathPenStore.setState({
        session: {
            ...session,
            follow: {
                ...f,
                head: { ...f.head, prefix, clicks: true, history: [] },
            },
            points: prefix,
            pointer: prefix.at(-1)!.at,
        },
    });
    return true;
}

/**
 * A click at `at` while the head is drawn on with clicks: the trail as the pointer has it there
 * (`headDragPoints`: cut back along it, the head slid along a straight last leg, or a point
 * added) becomes what's placed, the point added a smooth one with `smooth` (the Straight | Curve
 * switch, Alt). On the head itself, nothing changes: `"finish"`, as a click on the pen's last
 * point finishes. `"none"` when no head is drawn on with clicks.
 */
export function clickHeadAt(
    at: XY,
    env: ToolEnv,
    smooth: boolean,
): "placed" | "finish" | "none" {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!session || !f?.head?.clicks) return "none";
    const { prefix } = f.head;
    const from = f.head.restore.target.trail!.members.at(-1)!.from;
    let points = headDragPoints(prefix, from, at, env);
    if (samePoints(points, prefix)) return "finish";
    // A point added (not a cut or a slide): the kind the click places
    if (points.length === prefix.length + 1 && smooth)
        points = [
            ...points.slice(0, -1),
            { ...points.at(-1)!, tension: SMOOTH },
        ];
    usePathPenStore.setState({
        session: {
            ...session,
            follow: {
                ...f,
                head: {
                    ...f.head,
                    prefix: points,
                    history: [...(f.head.history ?? []), prefix],
                },
            },
            points,
            pointer: points.at(-1)!.at,
        },
    });
    return "placed";
}

/**
 * While the head is drawn on with clicks, a press-and-drag on from the point it just added: that
 * point turns smooth, its roundness how far the drag went (the pen's `dragNewPoint`). Nothing
 * when the press didn't add a point (a cut, or the head slid on).
 */
export function shapeHeadPoint(to: XY, env: ToolEnv): void {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    const head = f?.head;
    const before = head?.history?.at(-1);
    if (!session || !f || !head?.clicks || !before) return;
    if (head.prefix.length !== before.length + 1) return;
    const from = head.restore.target.trail!.members.at(-1)!.from;
    const points = dragNewPoint(shapeOfPrefix(from, head.prefix), to, env);
    if (samePoints(points, head.prefix)) return;
    usePathPenStore.setState({
        session: {
            ...session,
            follow: { ...f, head: { ...head, prefix: points } },
            points,
            pointer: points.at(-1)!.at,
            dragging: points.length - 1,
        },
    });
}

/** The press-and-drag that shaped the head's new point let go */
export function endHeadPoint(): void {
    const { session } = usePathPenStore.getState();
    if (session && isHeadClicks(session) && session.dragging !== null)
        usePathPenStore.setState({ session: { ...session, dragging: null } });
}

/** The pointer left the field while drawing on with clicks: only what's placed is shown */
export function showHeadPlaced(): void {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!session || !f?.head?.clicks || session.points === f.head.prefix)
        return;
    usePathPenStore.setState({
        session: {
            ...session,
            points: f.head.prefix,
            pointer: f.head.prefix.at(-1)!.at,
        },
    });
}

/** Escape, or a lost press: the trail as it was, nothing written. False when no head is dragged. */
export function cancelHeadDrag(): boolean {
    const { session } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!f?.head) return false;
    usePathPenStore.setState({ session: f.head.restore });
    return true;
}

/**
 * The head let go (AP-T16): unchanged, the trail as it was; else the new trail and everyone's end
 * spot planned again (`dragTrailHead`), one undo step. The trail is then shown with its new
 * points while it's read again.
 */
export async function finishHeadDrag(): Promise<void> {
    const { session, saving } = usePathPenStore.getState();
    const f = headDragOf(session);
    if (!session || !f?.head || saving) return;
    const { restore } = f.head;
    // Drawn on with clicks, Enter writes what's placed, not the leg to the pointer (the pen's rule)
    const points = f.head.clicks ? f.head.prefix : session.points;
    // A form's tail slid changes only the spacing (owner, 2026-11-17, `trailForm.ts`)
    const respaced = !!f.head.form && f.spacing !== f.head.form.spacing;
    if (samePoints(points, restore.points) && !respaced) {
        usePathPenStore.setState({ session: restore });
        return;
    }
    usePathPenStore.setState({ saving: true });
    try {
        await dragTrailHead({
            db,
            routeId: restore.target.routeId!,
            points: storedPoints(points),
            spacing: followSpacingOf(session),
            step: f.step,
        });
        invalidatePlacedBoxes();
        usePathPenStore.setState((state) => ({
            session: { ...restore, points },
            saved: state.saved + 1,
        }));
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.headDrag", "Couldn't change the trail"),
        );
        usePathPenStore.setState({ session: restore });
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}
