/**
 * Go round in the Follow tool, pathways step 10 (spec Appendix L.11, DO-1 to DO-8): when the
 * selected marchers stand on a closed outline (a circle or a box outline) at the start flag, the
 * Follow tool offers Go round beside dragging a trail out. Each follows the one ahead round the
 * outline the same distance, N of its spots (or steps), either way round; the drawing shows the
 * outline, its way round and where everyone stops, and Finish writes it (`goRound`, AP-T13).
 */
import {
    defaultSpots,
    goRoundPreview,
    planGoRound,
    type GoRoundPlan,
    type Outline,
    type RoundUnit,
} from "@/db-functions/timelineTrailAround";
import { loopPoint, routePolyline } from "@openmarch/core";
import type { XY } from "@/shapes/types";
import type { FollowDrag, FollowMarchers } from "./followDrag";
import { usePathPenStore, type PathSession } from "./pathPenStore";
import type { PathTarget } from "./pathTarget";

/** Go round's choices in the Follow tool (a session's `follow.around`) */
export interface FollowAround {
    /** The outline the line stands on at the start flag */
    readonly outline: Outline;
    /** Go round chosen (DO-1): on when the tool opens on an outline */
    readonly on: boolean;
    /** How far (DO-4): this many of the outline's spots, or steps */
    readonly amount: number;
    readonly unit: RoundUnit;
    /** The other way round from the outline's own (clockwise on the field) */
    readonly reversed: boolean;
    /** Who leads (a marcher id), or null for the member with most room ahead */
    readonly leader: number | null;
    /** Whether a trail can be dragged out of the line instead (it has two ends to pull) */
    readonly canDrag: boolean;
    /** The line's own move round this outline over the window, which Finish replaces ("again") */
    readonly again: boolean;
}

/** The most spots or steps the bar goes to: as far as Finish allows (100 times round) */
export const roundMaxOf = (f: FollowDrag | null | undefined): number =>
    aroundPlanOf(f)?.maxAmount ?? 1;

/** Whether the Follow tool is going round (DO-1): chosen, and no trail being dragged out */
export const goingRound = (f: FollowDrag | null | undefined): boolean =>
    !!f?.around?.on && f.grabbed === null;

/** The starts in `follow.ids` order, as the plan reads them */
const startsOf = (f: FollowDrag): [number, number][] =>
    f.ids.map((id) => {
        const p = f.starts.get(id)!;
        return [p.x, p.y];
    });

const plans = new WeakMap<FollowAround, GoRoundPlan>();

/** AP-T13's plan for the Follow tool's choices: what's drawn is what's written. Null off an outline. */
export function aroundPlanOf(
    f: FollowDrag | null | undefined,
): GoRoundPlan | null {
    const a = f?.around;
    if (!f || !a) return null;
    const hit = plans.get(a);
    if (hit) return hit;
    const leader = a.leader === null ? -1 : f.ids.indexOf(a.leader);
    const plan = planGoRound(startsOf(f), a.outline, {
        reversed: a.reversed,
        leader: leader >= 0 ? leader : null,
        amount: a.amount,
        unit: a.unit,
        step: f.step,
    });
    plans.set(a, plan);
    return plan;
}

/** The line round the outline, by id: the tail first, the leader last */
export const aroundLine = (f: FollowDrag, plan: GoRoundPlan): number[] =>
    plan.line.map((i) => f.ids[i]!);

/**
 * Go round's choices when the Follow tool opens on `outline` (DO-3, DO-4): N is the spots a
 * normal step a count covers over the window; the way round and the leader are the line's
 * remembered order's (step 4f) when it runs round the outline, else clockwise on the field with
 * the member who has most room ahead leading.
 */
export function initialAround(
    f: Pick<FollowDrag, "ids" | "starts" | "step" | "window">,
    outline: Outline,
    remembered: readonly number[] | null,
    canDrag: boolean,
): FollowAround {
    const base: FollowAround = {
        outline,
        on: true,
        amount: 1,
        unit: "spots",
        reversed: false,
        leader: null,
        canDrag,
        again: false,
    };
    const probe = {
        ...f,
        grabbed: null,
        around: base,
    } as unknown as FollowDrag;
    const spacing = aroundPlanOf(probe)!.spacing;
    const amount = defaultSpots(spacing, f.window.end - f.window.start, f.step);
    // A remembered order (tail first) that runs round the outline sets the way round and the leader
    if (remembered && remembered.length === f.ids.length) {
        for (const reversed of [false, true]) {
            const leader = remembered.at(-1)!;
            const tried: FollowAround = { ...base, amount, reversed, leader };
            const plan = aroundPlanOf({
                ...probe,
                around: tried,
            } as FollowDrag)!;
            const line = aroundLine(probe, plan);
            if (line.every((id, q) => id === remembered[q])) return tried;
        }
    }
    return { ...base, amount };
}

/** The target the drawing shows while going round: the line in walking order, each to its spot */
export function aroundTarget(
    target: PathTarget,
    f: FollowDrag,
    drills: ReadonlyMap<number, string>,
): PathTarget {
    const plan = aroundPlanOf(f);
    if (!plan) return target;
    const line = aroundLine(f, plan);
    const members = line.map((id, q) => ({
        marcherId: id,
        drill: drills.get(id) ?? `${id}`,
        from: f.starts.get(id)!,
        to: { x: plan.spots[q]![0], y: plan.spots[q]![1] },
    }));
    const leader = members.at(-1)!;
    const g = plan.geometry;
    return {
        ...target,
        marcherId: leader.marcherId,
        start: f.window.start,
        end: f.window.end,
        from: { x: g.from[0], y: g.from[1] },
        to: { x: g.to[0], y: g.to[1] },
        points: g.points,
        ...(g.toBulge === undefined ? {} : { toBulge: g.toBulge }),
        ends: {
            from: { x: g.from[0], y: g.from[1] },
            to: { x: g.to[0], y: g.to[1] },
        },
        trail: {
            members,
            leaderId: leader.marcherId,
            reverse: false,
            around: true,
        },
    };
}

/** The target before an end is grabbed (the Follow tool as it opens): the line, each where it stands */
export function dragTarget(
    target: PathTarget,
    f: FollowDrag,
    drills: ReadonlyMap<number, string>,
): PathTarget {
    const members = f.order.map((id) => ({
        marcherId: id,
        drill: drills.get(id) ?? `${id}`,
        from: f.starts.get(id)!,
        to: f.starts.get(id)!,
    }));
    const leader = members.at(-1)!;
    const { toBulge: _toBulge, ...rest } = target;
    return {
        ...rest,
        marcherId: leader.marcherId,
        start: f.window.start,
        end: f.window.end,
        from: leader.from,
        to: leader.from,
        points: [],
        ends: null,
        trail: { members, leaderId: leader.marcherId, reverse: false },
    };
}

const drillsOf = (s: PathSession): Map<number, string> =>
    new Map((s.target.trail?.members ?? []).map((m) => [m.marcherId, m.drill]));

/** A change to Go round's choices, the drawing's target kept with them */
function updateAround(
    fn: (a: FollowAround, f: FollowDrag) => FollowAround | null,
): void {
    const { session } = usePathPenStore.getState();
    const f = session?.follow;
    if (!session || !f?.around || f.grabbed !== null) return;
    const around = fn(f.around, f);
    if (!around || around === f.around) return;
    const follow = { ...f, around };
    const drills = drillsOf(session);
    usePathPenStore.setState({
        session: {
            ...session,
            follow,
            target: around.on
                ? aroundTarget(session.target, follow, drills)
                : dragTarget(session.target, follow, drills),
        },
    });
}

/** Go round or Drag out (DO-1): only when both are offered */
export function setGoRound(on: boolean): void {
    updateAround((a) =>
        a.on === on || (!on && !a.canDrag) ? null : { ...a, on },
    );
}

/** How far (DO-4): a whole number from 1 to as far as Finish allows ({@link roundMaxOf}) */
export function setRoundAmount(amount: number): void {
    updateAround((a, f) => {
        const n = Math.max(1, Math.min(roundMaxOf(f), Math.round(amount)));
        return a.on && a.amount !== n ? { ...a, amount: n } : null;
    });
}

/** One more or one less spot (or step) round */
export function stepRoundAmount(delta: number): void {
    const a = usePathPenStore.getState().session?.follow?.around;
    if (a) setRoundAmount(a.amount + delta);
}

/** Spots or steps (DO-4), keeping about the same distance */
export function setRoundUnit(unit: RoundUnit): void {
    updateAround((a, f) => {
        if (!a.on || a.unit === unit) return null;
        const plan = aroundPlanOf(f)!;
        const gone =
            plan.distances.reduce((x, d) => x + d, 0) /
            Math.max(1, plan.distances.length);
        const per = unit === "spots" ? plan.spacing : f.step;
        const next = {
            ...a,
            unit,
            amount: Math.max(1, Math.round(gone / per)),
        };
        const max = roundMaxOf({ ...f, around: next });
        return { ...next, amount: Math.min(next.amount, max) };
    });
}

/**
 * The other way round (DO-3, Reverse leader while going round): the line turns round, so the one
 * at its back leads
 */
export function flipRoundWay(): void {
    updateAround((a, f) => {
        if (!a.on) return null;
        const plan = aroundPlanOf(f)!;
        return { ...a, reversed: !a.reversed, leader: f.ids[plan.line[0]!]! };
    });
}

/** The real marchers going round (DL-16's rule): at their end spots, or walking with ▶ Preview */
export function aroundMarchersOf(f: FollowDrag): FollowMarchers | null {
    const plan = aroundPlanOf(f);
    if (!plan) return null;
    const ids = aroundLine(f, plan);
    const spots = plan.spots.map(([x, y]) => ({ x, y }));
    if (!f.preview) return { ids, spots };
    return {
        ids,
        spots,
        walk: (p) => goRoundPreview(plan, p).map(([x, y]) => ({ x, y })),
    };
}

/** The outline as drawn (closed), clockwise or turned round as chosen */
export function aroundOutline(f: FollowDrag): XY[] {
    const plan = aroundPlanOf(f);
    if (!plan) return [];
    return routePolyline(plan.loop).map(([x, y]) => ({ x, y }));
}

/**
 * Which way round, drawn at the leader's start and at the outline's quarters from it: the way the
 * outline runs there (step 4d's pull arrows, pointing round it)
 */
export function aroundArrows(f: FollowDrag): { at: XY; dir: XY }[] {
    const plan = aroundPlanOf(f);
    if (!plan) return [];
    const { loop } = plan;
    const leader = plan.startDist.at(-1)!;
    // the tangent from a short chord about the point, along the walk
    const e = Math.min(loop.L / 200, 0.5);
    return [0, 0.25, 0.5, 0.75].map((k) => {
        const d = leader + k * loop.L;
        const a = loopPoint(loop, d - e);
        const b = loopPoint(loop, d + e);
        const p = loopPoint(loop, d);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return {
            at: { x: p[0], y: p[1] },
            dir: { x: (b[0] - a[0]) / len, y: (b[1] - a[1]) / len },
        };
    });
}
