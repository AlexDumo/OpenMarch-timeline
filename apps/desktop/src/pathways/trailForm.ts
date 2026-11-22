/**
 * Dragging a trail's marcher reshapes its form (owner, 2026-11-17; plan step 4a, trails). A
 * trail's end form is the last stretch of the trail its line stands on, one object. Dragging one
 * of its marchers, with Edit path on or off:
 *
 * - **A middle marcher** bends the line there: a corner at that marcher follows the pointer. The
 *   stretch from the corner to the head keeps its length (the head slides along its last leg, or
 *   moves with the corner when the corner's leg is the last), so the spacing holds back from the
 *   head and the grabbed marcher stays under the pointer.
 * - **The leader** moves the trail's head point.
 * - **The tail** slides along the trail: every gap back from the head scales with it, so the form
 *   stands on more or less of the trail (Even N stays even, on half steps).
 * - **Edit path off**: only the stretch the form stands on changes. Where the changed leg reaches
 *   back past the tail, a corner is set on the trail at the tail's spot, so the route in stays; a
 *   move that would back the tail into it is held where it was.
 * - **Alt** takes the one marcher out of the trail instead (`detachTrailSpot`, L.18 TM-3: it
 *   gets a plain move to where it's let go), **Ctrl/⌘** constrains as a
 *   point's drag does, **Shift** is fine (off the grid).
 *
 * The drag is the head drag's (AP-T16, `trailHead.ts`): the session is step 4b's drawing, the end
 * spots and marchers planned as they follow the pointer, and the release writes AP-T16 in one undo
 * step; Escape writes nothing. It's a solve, not storage: the corner is where the grabbed
 * marcher's spot lands.
 */
import {
    detachTrailSpot,
    planTrailDrag,
    type TrailDragPlan,
    type TrailSpacing,
} from "@/db-functions/timelineTrailDrag";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { invalidatePlacedBoxes } from "@/shapes/placed/placedBoxStore";
import { landClicked } from "@/shapes/line/lineGeometry";
import { samePoints, type PathPoint } from "@/shapes/pen/penPath";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import { EVEN_STEP, type TrailFormGrab } from "./followDrag";
import { isFollowTheLeaderOn } from "./followTheLeader";
import {
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";
import {
    beginTrailDrag,
    cutAt,
    headSpacingOf,
    nearestAlong,
    wayOf,
} from "./trailHead";

/** Distances along the trail this close are the same place, in field units */
const SAME = 0.05;

const tuple = (p: XY): [number, number] => [p.x, p.y];

/** The piece of a route path holding distance `d` */
function pieceAt(D: readonly number[], d: number): number {
    let j = 0;
    while (j < D.length - 2 && !(d < D[j + 1]!)) j++;
    return j;
}

/**
 * `prefix` (walked from `from`) with a point at distance `d` along its drawn way, and that
 * point's index: an existing point there, else a corner set on the way exactly (an arc leg split
 * into two arcs of the same circle). Null at the start or the head.
 */
export function splitAt(
    prefix: readonly PathPoint[],
    from: XY,
    d: number,
): { points: PathPoint[]; index: number } | null {
    const drawn = wayOf(from, prefix);
    if (!drawn || d <= SAME || d >= drawn.L - SAME) return null;
    const W = drawn.way.drawn!.path;
    for (let k = 1; k < W.V.length; k++)
        if (W.source[k]! >= 0 && Math.abs(W.D[k]! - d) <= SAME)
            return { points: [...prefix], index: W.source[k]! };
    const before = cutAt(prefix, drawn.way, d);
    const lastKept = before.length > 1 ? prefix.indexOf(before.at(-2)!) : -1;
    const after = prefix.slice(lastKept + 1);
    // The arc split: the leg after the corner is the rest of the same circle
    const j = pieceAt(W.D, d);
    const piece = W.pieces[j]!;
    if (piece.kind === "arc" && after[0]?.bulge) {
        const f = Math.min(
            1,
            Math.max(0, (d - W.D[j]!) / (W.D[j + 1]! - W.D[j]!)),
        );
        const phi = 2 * Math.atan(2 * piece.k);
        const k = Math.tan((phi * (1 - f)) / 2) / 2;
        const { bulge: _was, ...rest } = after[0];
        after[0] = k === 0 ? rest : { ...rest, bulge: k };
    }
    return { points: [...before, ...after], index: before.length - 1 };
}

/** The drawn length of `points` from `from` up to and including point `i` (0 for none) */
const lengthTo = (from: XY, points: readonly PathPoint[], i: number) =>
    i < 0 ? 0 : (wayOf(from, points.slice(0, i + 1))?.L ?? 0);

/**
 * Edit path off: a corner at the tail's spot when the leg that changes (the one into point `i`)
 * reaches back past it, so the route in stays as it is. `dTail`: the tail's drawn distance.
 */
function protectRoute(
    points: PathPoint[],
    from: XY,
    i: number,
    dTail: number,
): { points: PathPoint[]; index: number } {
    if (dTail <= SAME || dTail <= lengthTo(from, points, i - 1) + SAME)
        return { points, index: i };
    // The tail's spot lies before point `i`: a corner set there comes before it
    const split = splitAt(points, from, dTail);
    if (!split || split.points.length === points.length)
        return { points, index: i };
    return { points: split.points, index: i + 1 };
}

/**
 * The head slid along its last leg so the way from point `c` to the head is `length` long again,
 * as near as the leg allows (it never folds back past its start)
 */
function slideHead(
    points: PathPoint[],
    from: XY,
    c: number,
    length: number,
): void {
    const n = points.length;
    const h = points[n - 1]!;
    const p = points[n - 2]!.at;
    const leg = Math.hypot(h.at.x - p.x, h.at.y - p.y);
    if (!(leg > SAME)) return;
    const u = { x: (h.at.x - p.x) / leg, y: (h.at.y - p.y) / leg };
    const upTo = lengthTo(from, points, c);
    const at = (t: number): PathPoint => ({
        ...h,
        at: { x: h.at.x + u.x * t, y: h.at.y + u.y * t },
    });
    const after = (t: number) =>
        (wayOf(from, [...points.slice(0, n - 1), at(t)])?.L ?? 0) - upTo;
    let lo = -(leg - SAME);
    let hi = length + leg;
    if (after(lo) >= length) hi = lo;
    else if (after(hi) <= length) lo = hi;
    else
        for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2;
            if (after(mid) < length) lo = mid;
            else hi = mid;
        }
    points[n - 1] = at((lo + hi) / 2);
}

/** Why a marcher's drag can't reshape the form, or null */
export type FormRefusal = "lineUp";

/**
 * The trail's points with the form bent at the grabbed middle marcher (`form.q`), its corner
 * landed at `to`. Null when the move is held (the tail would back into the route in with Edit
 * path off, or off the start of the way).
 */
export function bendForm(
    prefix: readonly PathPoint[],
    from: XY,
    form: Pick<TrailFormGrab, "q" | "back" | "protect" | "lineLen">,
    to: XY,
    env: ToolEnv,
): PathPoint[] | FormRefusal | null {
    const L = wayOf(from, prefix)?.L;
    if (!L) return null;
    const back = form.back[form.q]!;
    const d = L - back;
    // Still on the line it came from, before the trail: no corner can go there
    if (d <= SAME) return "lineUp";
    const split = splitAt(prefix, from, d);
    if (!split) return null;
    const dTail = L - form.back[0]!;
    const { points, index: c } = form.protect
        ? protectRoute(split.points, from, split.index, dTail)
        : split;
    const n = points.length;
    if (c >= n - 1) return null;
    const was = points[c]!.at;
    const landed = landClicked(
        [from, ...points.slice(0, c).map((p) => p.at)],
        to,
        env,
    );
    // The corner follows the pointer
    const { tension: _smooth, ...corner } = points[c]!;
    points[c] = { ...corner, at: landed };
    if (c === n - 2) {
        // The corner's leg is the last: the head moves with it, that leg as it was
        const h = points[n - 1]!;
        points[n - 1] = {
            ...h,
            at: {
                x: h.at.x + landed.x - was.x,
                y: h.at.y + landed.y - was.y,
            },
        };
    } else slideHead(points, from, c, back);
    return heldBack(points, from, form, dTail) ? null : points;
}

/**
 * The trail's points with its head moved to `to` (the leader dragged). Null when the move is held.
 */
export function leaderForm(
    prefix: readonly PathPoint[],
    from: XY,
    form: Pick<TrailFormGrab, "back" | "protect" | "lineLen">,
    to: XY,
    env: ToolEnv,
): PathPoint[] | null {
    const L = wayOf(from, prefix)?.L;
    if (!L || prefix.length === 0) return null;
    const dTail = L - form.back[0]!;
    const { points } = form.protect
        ? protectRoute([...prefix], from, prefix.length - 1, dTail)
        : { points: [...prefix] };
    const n = points.length;
    const before = [from, ...points.slice(0, n - 1).map((p) => p.at)];
    const landed = landClicked(before, to, env);
    const prev = before.at(-1)!;
    if (Math.hypot(landed.x - prev.x, landed.y - prev.y) <= SAME) return null;
    points[n - 1] = { ...points[n - 1]!, at: landed };
    return heldBack(points, from, form, dTail) ? null : points;
}

/**
 * Whether the tail would stand before where it may: off the start of the way, or with Edit path
 * off, back past where it stood into the route in
 */
function heldBack(
    points: readonly PathPoint[],
    from: XY,
    form: Pick<TrailFormGrab, "back" | "protect" | "lineLen">,
    dTailWas: number,
): boolean {
    const L = wayOf(from, points)?.L;
    if (!L) return true;
    const dTail = L - form.back[0]!;
    if (form.lineLen + dTail < 0) return true;
    return form.protect && dTail < dTailWas - SAME;
}

/**
 * The spacing with the tail slid to where `at` is along the way (`plan`, the trail as stored):
 * Even N stays even, N on half steps (fine: any); any other spacing scales every gap back from the
 * head alike, the tail's distance on half steps. Never so far back that a marcher would walk
 * backward, nor closer than a quarter step between neighbors.
 */
export function tailSpacing(
    plan: TrailDragPlan,
    form: Pick<TrailFormGrab, "back" | "spacing">,
    at: XY,
    env: ToolEnv,
): TrailSpacing {
    const step = env.stepPx;
    const total = plan.way.destOffset;
    const m = form.back.length;
    let reach = total - nearestAlong(plan.way, tuple(at));
    if (form.spacing.kind === "even") {
        let n = reach / ((m - 1) * step);
        if (env.snap) n = Math.round(n / EVEN_STEP) * EVEN_STEP;
        const limit = plan.evenLimit ?? n;
        const most = env.snap
            ? Math.floor(limit / EVEN_STEP) * EVEN_STEP
            : limit;
        return {
            kind: "even",
            steps: Math.max(EVEN_STEP, Math.min(n, most)),
        };
    }
    if (env.snap) reach = Math.round(reach / (step / 2)) * (step / 2);
    const back = form.back;
    let most = Infinity;
    let least = 0;
    for (let q = 0; q < m - 1; q++) {
        most = Math.min(most, (total - plan.startDist[q]!) / back[q]!);
        const gap = back[q]! - back[q + 1]!;
        if (gap > 0) least = Math.max(least, (0.25 * step) / gap);
    }
    const k = Math.max(least, Math.min(reach / back[0]!, most));
    return { kind: "gaps", back: back.map((b) => b * k) };
}

// ---------------------------------------------------------------------------
// The drag
// ---------------------------------------------------------------------------

/**
 * Whether the session's trail takes a marcher's drag: a stored trail dragged out of a line (its
 * ends along the way), selected or open, not drawn. Never with Follow-the-leader off (#1095): the
 * trail is shown quiet then, and a press on its marcher is the field's
 */
export function canReshape(s: PathSession | null): s is PathSession {
    const trail = s?.target.trail;
    return (
        !!s &&
        !!trail &&
        isFollowTheLeaderOn() &&
        (s.phase === "closed" || s.phase === "open") &&
        !s.follow &&
        !!trail.along &&
        !trail.around &&
        !trail.unfounded &&
        trail.members.length >= 2 &&
        s.target.routeId !== null &&
        s.points.length > 0
    );
}

/** What a drag of `marcherId` would do now: its grab, or why not; null for none of the form's */
export function formGrabFor(
    s: PathSession | null,
    marcherId: number,
    step: number,
): TrailFormGrab | FormRefusal | null {
    if (!canReshape(s)) return null;
    const members = s.target.trail!.members;
    const q = members.findIndex((m) => m.marcherId === marcherId);
    if (q < 0) return null;
    const spacing = headSpacingOf(s, step);
    const plan = planTrailDrag(
        members.map((m) => tuple(m.from)),
        storedPoints(s.points),
        spacing,
        step,
    );
    const total = plan.way.destOffset;
    const lineLen = plan.startDist.at(-1) ?? 0;
    const m = members.length;
    const kind = q === m - 1 ? "leader" : q === 0 ? "tail" : "middle";
    if (kind === "middle" && plan.ends[q]! - lineLen <= SAME) return "lineUp";
    return {
        marcherId,
        q,
        kind,
        // Edit path off: the route in, before the form, stays
        protect: s.phase === "closed",
        back: plan.ends.map((e) => total - e),
        lineLen,
        spacing,
    };
}

/** Starts a marcher's drag (`formGrabFor`'s grab): the session becomes the head drag's drawing */
export function startFormDrag(step: number, grab: TrailFormGrab): boolean {
    const { session, saving } = usePathPenStore.getState();
    if (saving || !canReshape(session)) return false;
    beginTrailDrag(session, step, grab.spacing, grab);
    return true;
}

/** The marcher's drag under way, or null */
export const formDragOf = (s: PathSession | null): TrailFormGrab | null =>
    s?.phase === "drawing" ? (s.follow?.head?.form ?? null) : null;

/** The pointer moved to `at` while a marcher is dragged: the form reshaped to it */
export function moveFormDrag(at: XY, env: ToolEnv): void {
    const { session } = usePathPenStore.getState();
    const f = session?.follow;
    const form = formDragOf(session ?? null);
    if (!session || !f?.head || !form) return;
    const { prefix, restore } = f.head;
    const members = restore.target.trail!.members;
    const from = members.at(-1)!.from;
    const starts = members.map((m) => tuple(m.from));
    if (form.kind === "tail") {
        const plan = planTrailDrag(
            starts,
            storedPoints(prefix),
            form.spacing,
            f.step,
        );
        const spacing = tailSpacing(plan, form, at, env);
        if (JSON.stringify(spacing) === JSON.stringify(f.spacing)) return;
        usePathPenStore.setState({
            session: { ...session, follow: { ...f, spacing } },
        });
        return;
    }
    const points =
        form.kind === "leader"
            ? leaderForm(prefix, from, form, at, env)
            : bendForm(prefix, from, form, at, env);
    if (!Array.isArray(points) || samePoints(points, session.points)) return;
    // Even N past its limit would walk someone backward: held where it was
    if (!planTrailDrag(starts, storedPoints(points), f.spacing, f.step).forward)
        return;
    usePathPenStore.setState({
        session: {
            ...session,
            points,
            pointer: points.at(-1)!.at,
        },
    });
}

/** Why a marcher still in the line-up can't bend the trail (owner, 2026-11-17) */
export const formLineUpReason = () =>
    tolgee.t(
        "pathways.refusals.formLineUp",
        "This marcher is still in the line-up. Lengthen the trail to bend here.",
    );

/**
 * One marcher of the form moved off it (Alt + drag): it leaves the trail for a plain move to `at`
 * (L.18, TM-3), one undo step; the trail goes on with the others
 */
export async function detachFormMarcher(
    marcherId: number,
    at: XY,
): Promise<void> {
    const { session, saving } = usePathPenStore.getState();
    const routeId = session?.target.routeId ?? null;
    if (saving || routeId === null) return;
    usePathPenStore.setState({ saving: true });
    try {
        await detachTrailSpot({
            db,
            routeId,
            marcherId,
            point: [at.x, at.y],
        });
        invalidatePlacedBoxes();
        usePathPenStore.setState((state) => ({ saved: state.saved + 1 }));
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t(
                "pathways.errors.detachFormMarcher",
                "Couldn't move the marcher off the trail",
            ),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}
