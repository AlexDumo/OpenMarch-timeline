/**
 * Ripple into the next form, pathways step 9 (spec Appendix L.10, RP-3 to RP-5): the plan, pure.
 * The Follow tool's drawing and the write (`timelineTrailRipple`) both use it, so what is shown is
 * what plays once written.
 */
import { makeTrail, pointsPath, type FtlTrail, type XY } from "@openmarch/core";
import type { RoutePointInput } from "./timelineRoutes";

// ---------------------------------------------------------------------------
// Pure: the deal and the trail
// ---------------------------------------------------------------------------

/** The next form (RP-2): the members' end spots in the form's own order, one end to the other */
export interface RippleForm {
    /** Who stands on each spot now, in the form's order */
    readonly ids: readonly number[];
    /** The spots, in the same order */
    readonly spots: readonly XY[];
}

/** What a ripple does (AP-T12), worked out before anything is written */
export interface RipplePlan {
    /** The trail as the resolver walks it: the line-up, the connector, then the next form */
    trail: FtlTrail;
    /** Each member's start along the trail (`startDist`), tail first */
    startDist: number[];
    /** Each member's end along the trail (`endDist`, R-13′) */
    endDist: number[];
    /** The spot each member of the line takes, tail first: the form from the entrance (RP-3) */
    spots: XY[];
    /** Whose spot each member of the line takes, tail first (who stands there now) */
    takes: number[];
    /** The marcher whose spot is the entrance now (the form's end the line enters, RP-4) */
    entrance: number;
    /** The connector's length: the leader's start, through the drawn points, to the entrance */
    connector: number;
    /**
     * Where the leader reaches the form, as a share of the move (0 to 1, RP-5); null when the
     * leader doesn't move
     */
    arrival: number | null;
}

const dist = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * RP-4: the end of `form` the line enters, as the marcher standing on it now. `enter`, when it is
 * one of the form's two ends, wins (a finish on its spot); else the end nearer `at` (where the
 * drawing arrives), ties to the form's first.
 */
export function rippleEntrance(
    form: RippleForm,
    at: XY,
    enter?: number | null,
): number {
    const first = form.ids[0]!;
    const last = form.ids[form.ids.length - 1]!;
    if (enter === first || enter === last) return enter;
    const toLast = dist(at, form.spots[form.spots.length - 1]!);
    return toLast < dist(at, form.spots[0]!) ? last : first;
}

/**
 * AP-T12's deal and trail for the line `starts` (tail first, the leader last) into `form`, with
 * the drawn `points` (the connector's corners, in walking order from the leader; none for a
 * straight connector). `enter` picks the entrance (RP-4) when it is one of the form's ends.
 *
 * The trail is the resolver's own (`makeTrail`, R-9′): the line-up, `W = walk(leader's start,
 * points, entrance)` with the route's `from` the leader's start and `to` the entrance, then the
 * line through the dealt spots (R-13′, `pointsPath`). So the drawing is what plays once written.
 */
export function planRipple(
    starts: readonly XY[],
    form: RippleForm,
    points: readonly RoutePointInput[],
    enter?: number | null,
): RipplePlan {
    const m = starts.length;
    if (form.ids.length !== m)
        throw new Error("a ripple deals one spot to each member of the line");
    const leader = starts[m - 1]!;
    const arrive = points.at(-1)?.at ?? leader;
    const entrance = rippleEntrance(form, arrive, enter);
    const fromFirst = entrance === form.ids[0];
    const takes = fromFirst ? [...form.ids] : [...form.ids].reverse();
    const spots = (fromFirst ? [...form.spots] : [...form.spots].reverse()).map(
        (p): XY => [p[0], p[1]],
    );
    const path = pointsPath(spots);
    const trail = makeTrail(starts, [], path, {
        from: [leader[0], leader[1]],
        to: spots[0]!,
        points: points.map((p) => ({
            at: [p.at[0], p.at[1]],
            ...(p.tension === undefined ? {} : { tension: p.tension }),
            ...(p.bulge === undefined ? {} : { bulge: p.bulge }),
        })),
    });
    const startDist = starts.map((_, q) => trail.cum[q]!);
    const endDist = spots.map((_, q) => trail.destOffset + path.stops![q]!);
    const lead = endDist[m - 1]! - startDist[m - 1]!;
    return {
        trail,
        startDist,
        endDist,
        spots,
        takes,
        entrance,
        connector: trail.destOffset - startDist[m - 1]!,
        arrival:
            lead > 0
                ? Math.min(1, (trail.destOffset - startDist[m - 1]!) / lead)
                : null,
    };
}

/**
 * Where each member of the line (tail first) is at progress `p` of the move (0 to 1): R-10 on the
 * plan's trail, each at its own constant speed, ends exact. For the drawing's ▶ Preview.
 */
export function ripplePreview(plan: RipplePlan, p: number): XY[] {
    return plan.spots.map((spot, q) => {
        if (p <= 0) return plan.trail.at(plan.startDist[q]!);
        if (p >= 1) return spot;
        const a = plan.startDist[q]!;
        return plan.trail.at(a + (plan.endDist[q]! - a) * p);
    });
}

/**
 * RP-5's readout: the count the leader reaches the form on, from the move's start, to the nearest
 * half count. Null when it doesn't move.
 */
export function rippleArrivalCount(
    plan: RipplePlan,
    counts: number,
): number | null {
    if (plan.arrival === null || !(counts > 0)) return null;
    return Math.round(plan.arrival * counts * 2) / 2;
}
