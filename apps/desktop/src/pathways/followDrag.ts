/**
 * The Follow tool's drag, pathways step 4b (spec Appendix L, DL-1 to DL-8): handles on the two
 * ends of the selected line pulse until one is pressed; the press-drag draws the first leg of the
 * trail out of it, then clicks add corners as with the Path pen. While drawing, the way, where the
 * line stops (the end spots, `P(e_q)`) and the path bar's Spacing and Ends show. Finishing writes
 * it all in one undo step (`dragTrail`, AP-T8; AP-T1 with Keep end spots, AP-T9).
 */
import {
    planTrailDrag,
    type TrailDragPlan,
    type TrailSpacing,
    type TrailWindow,
} from "@/db-functions/timelineTrailDrag";
import type { XY } from "@/shapes/types";
import type { PathTarget } from "./pathTarget";
import {
    storedPoints,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";

/**
 * Keep end spots (AP-T9): step 4's Follow onto the spots the line has, in the move every member
 * is in at the playhead (step 4's target rule)
 */
export interface FollowKeep {
    readonly timelineId: number;
    /** The move's start and end beats */
    readonly start: number;
    readonly end: number;
    /** Each member's end spot in that move, by id */
    readonly spots: ReadonlyMap<number, XY>;
}

/** The Follow tool's drag in progress (a session's `follow`) */
export interface FollowDrag {
    /** The edit window `[start flag, end flag)` the move fills (DL-2) */
    readonly window: TrailWindow;
    /** The selected marchers, by id */
    readonly ids: readonly number[];
    /** The selection in order along the shape it stands in, one end to the other (DL-6) */
    readonly order: readonly number[];
    /** Where each stands at the start flag */
    readonly starts: ReadonlyMap<number, XY>;
    /** The end pressed, who leads (DL-1); null while the ends pulse */
    readonly grabbed: number | null;
    readonly spacing: TrailSpacing;
    /** From trail (AP-T8) or Keep end spots (AP-T1), AP-T9 */
    readonly ends: "trail" | "keep";
    /** Keep end spots, offered when every member is in one move at the playhead; else null */
    readonly keep: FollowKeep | null;
    /** One step, in field units */
    readonly step: number;
}

/** Even's steps: the finest choice, and the first offered */
export const EVEN_STEP = 0.5;
export const EVEN_FIRST = 2;

/** The line, tail first and the leader last, once an end is grabbed */
export function trailLine(follow: FollowDrag): number[] {
    const { order, grabbed } = follow;
    if (grabbed === null) return [...order];
    return order[0] === grabbed ? [...order].reverse() : [...order];
}

/** The two ends of the selection along its shape (DL-4) */
export const followEnds = (follow: FollowDrag): number[] =>
    follow.order.length > 1
        ? [follow.order[0]!, follow.order[follow.order.length - 1]!]
        : [...follow.order];

const plans = new WeakMap<
    PathSession,
    { plan: TrailDragPlan; spacing: TrailSpacing } | null
>();

/** AP-T8's plan and the spacing it uses, worked out once per session state */
function followPlanned(
    s: PathSession,
): { plan: TrailDragPlan; spacing: TrailSpacing } | null {
    if (plans.has(s)) return plans.get(s)!;
    const f = s.follow;
    let planned: { plan: TrailDragPlan; spacing: TrailSpacing } | null = null;
    if (f && f.grabbed !== null) {
        const starts = trailLine(f).map((id): [number, number] => {
            const p = f.starts.get(id)!;
            return [p.x, p.y];
        });
        // The points as written, smooth ones with their roundness, so the preview is the write
        const points = storedPoints(s.points);
        let plan = planTrailDrag(starts, points, f.spacing, f.step);
        // Even never goes past its limit (it shrinks as points are removed): held at the limit,
        // and Keep spacing while the limit is under Even's finest step
        let spacing = f.spacing;
        const limit = evenLimitOf(plan);
        if (
            spacing.kind === "even" &&
            limit !== null &&
            spacing.steps > limit
        ) {
            spacing =
                limit < EVEN_STEP
                    ? { kind: "keep" }
                    : { kind: "even", steps: limit };
            plan = planTrailDrag(starts, points, spacing, f.step);
        }
        planned = { plan, spacing };
    }
    plans.set(s, planned);
    return planned;
}

/**
 * AP-T8's Ends for the session as drawn so far: the way, each member's end on it and its spot.
 * Null before an end is grabbed. What the preview draws is what the write stores.
 */
export const followPlanOf = (s: PathSession): TrailDragPlan | null =>
    followPlanned(s)?.plan ?? null;

/**
 * The spacing the drawing uses and writes: the chosen one, with Even held to its limit now
 * (`followPlanOf`'s)
 */
export const followSpacingOf = (s: PathSession): TrailSpacing =>
    followPlanned(s)?.spacing ?? s.follow?.spacing ?? { kind: "keep" };

/**
 * The selected marcher whose start is under `at` (within `radius`): an end of the line, or one in
 * the middle, which takes no press (DL-4). Null elsewhere.
 */
export function followHit(
    follow: FollowDrag,
    at: XY,
    radius: number,
): { id: number; end: boolean } | null {
    let best: { id: number; d: number } | null = null;
    for (const id of follow.order) {
        const p = follow.starts.get(id)!;
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= radius && (!best || d < best.d)) best = { id, d };
    }
    if (!best) return null;
    return { id: best.id, end: followEnds(follow).includes(best.id) };
}

/** Whether the session is Follow onto the spots the line has (AP-T9's Keep end spots) */
export const keepsEndSpots = (follow: FollowDrag): boolean =>
    follow.ends === "keep" && follow.keep !== null;

/**
 * The target as drawn once `follow` is grabbed: its line in trail order, the leader last. With
 * Keep end spots it is step 4's trail: over the kept move, each member to its end spot there, the
 * trail running on into the tail's.
 */
export function followTarget(
    target: PathTarget,
    follow: FollowDrag,
    drills: ReadonlyMap<number, string>,
): PathTarget {
    const line = trailLine(follow);
    const keep = keepsEndSpots(follow) ? follow.keep : null;
    const members = line.map((id) => ({
        marcherId: id,
        drill: drills.get(id) ?? `${id}`,
        from: follow.starts.get(id)!,
        to: keep?.spots.get(id) ?? follow.starts.get(id)!,
    }));
    const leader = members.at(-1)!;
    return {
        ...target,
        marcherId: leader.marcherId,
        start: keep?.start ?? follow.window.start,
        end: keep?.end ?? follow.window.end,
        from: leader.from,
        to: keep ? members[0]!.to : leader.from,
        trail: { members, leaderId: leader.marcherId, reverse: false },
    };
}

/** The drill numbers the session's target names, by id */
const drillsOf = (s: PathSession): Map<number, string> =>
    new Map((s.target.trail?.members ?? []).map((m) => [m.marcherId, m.drill]));

const updateFollow = (
    fn: (s: PathSession, f: FollowDrag) => PathSession,
): void => {
    const { session } = usePathPenStore.getState();
    if (session?.follow)
        usePathPenStore.setState({ session: fn(session, session.follow) });
};

/** An end pressed: it leads, and the drawing starts from it (DL-1) */
export function grabEnd(id: number): void {
    updateFollow((s, f) => {
        if (!followEnds(f).includes(id)) return s;
        const follow = { ...f, grabbed: id };
        return {
            ...s,
            follow,
            target: followTarget(s.target, follow, drillsOf(s)),
            points: [],
            pointer: null,
            dragging: null,
        };
    });
}

/**
 * Escape while dragging out a trail: the drawing goes and the ends pulse again; false when there
 * is nothing drawn to cancel, so Escape leaves the tool
 */
export function cancelFollowDrawing(): boolean {
    const { session } = usePathPenStore.getState();
    const f = session?.follow;
    if (!session || !f || f.grabbed === null) return false;
    usePathPenStore.setState({
        session: {
            ...session,
            follow: { ...f, grabbed: null },
            points: [],
            pointer: null,
            dragging: null,
        },
    });
    return true;
}

/** The path bar's Spacing (DL-7): Keep spacing, or Even N steps */
export function setFollowSpacing(spacing: TrailSpacing): void {
    updateFollow((s, f) => ({ ...s, follow: { ...f, spacing } }));
}

/** The path bar's Ends (DL-8, AP-T9): From trail, or Keep end spots */
export function setFollowEnds(ends: "trail" | "keep"): void {
    updateFollow((s, f) => {
        if (ends === "keep" && !f.keep) return s;
        const follow = { ...f, ends };
        return {
            ...s,
            follow,
            target:
                f.grabbed === null
                    ? s.target
                    : followTarget(s.target, follow, drillsOf(s)),
        };
    });
}

/** Even's limit in the finest steps offered: the largest N that keeps everyone walking forward */
export const evenLimitOf = (plan: TrailDragPlan | null): number | null =>
    plan?.evenLimit == null
        ? null
        : Math.floor(plan.evenLimit / EVEN_STEP + 1e-9) * EVEN_STEP;
