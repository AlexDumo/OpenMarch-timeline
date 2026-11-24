/**
 * Follow on a closed outline, pathways step 10 (spec Appendix L.11): one Follow tool and one
 * gesture (owner, 2026-11-22: "I wanted the spread-out tool and wrap-around tool to be
 * effectively the same thing. I should be able to drag it around the circle or drag it out of
 * the circle … It should let me pretty much pick any marker I want").
 *
 * When the selected marchers stand all the way round a circle or a box outline, any of them can
 * be grabbed, and the one grabbed leads. Dragged along the outline, the whole line slides round
 * it, either way, snapped to whole spots (or steps), the count by the pointer; let go, it is
 * written in one undo step (`goRound`, AP-T13). Dragged off the outline, the leader is pulled out
 * into a trail (`pullOut`): the line follows it off the outline, first round it as far as it had
 * slid; the release places the trail's first point, and the drawing goes on as any dragged trail
 * does (AP-T8). Back on the outline, it slides again.
 *
 * Who follows whom: the march order set by hand when it runs round the outline (`loopAround`),
 * always over a guess; with none set, their places round the outline (`guessAround`), clockwise
 * with the member who has most room ahead leading until a drag says otherwise. Never a refusal
 * for want of an order.
 *
 * The tool opens with nobody moved (N = 0; owner, 2026-11-22: "I should be forced to drag or do
 * something so I can tangibly feel the change"). Digits typed while it is open set N exactly, and
 * Enter writes it. With N still 0 nothing is written.
 */
import {
    goRoundPreview,
    lineRound,
    planGoRound,
    walkingOutline,
    type GoRoundPlan,
    type Outline,
    type RoundUnit,
} from "@/db-functions/timelineTrailAround";
import {
    loopPoint,
    loopSnap,
    nearestOnLoop,
    routePolyline,
    type RoutePath,
    type XY as CoreXY,
} from "@openmarch/core";
import type { XY } from "@/shapes/types";
import {
    followTarget,
    type FollowDrag,
    type FollowMarchers,
} from "./followDrag";
import type { PathPoint } from "./pathEdit";
import { usePathPenStore, type PathSession } from "./pathPenStore";
import type { PathTarget } from "./pathTarget";

/** The loop's choices in the Follow tool (a session's `follow.around`) */
export interface FollowAround {
    /** The outline the line stands on at the start flag */
    readonly outline: Outline;
    /** How far (DO-4): this many of the outline's spots, or steps */
    readonly amount: number;
    readonly unit: RoundUnit;
    /** The line goes the other way round from the outline's own (clockwise on the field) */
    readonly reversed: boolean;
    /**
     * Who leads (a marcher id): the one grabbed; before that the march order's leader, or with no
     * order set the member with most room ahead
     */
    readonly leader: number;
    /** The line's own move round this outline over the window, which Finish replaces ("again") */
    readonly again: boolean;
    /**
     * Again only: how far and which way the stored move went, so Finish with nothing changed
     * writes nothing (owner, 2026-11-22)
     */
    readonly stored?: {
        readonly amount: number;
        readonly unit: RoundUnit;
        readonly reversed: boolean;
        readonly leader: number;
    };
}

/**
 * The line being slid round the outline (owner, 2026-11-22; a session's `follow.roundSlide`):
 * pressed on a member or on the outline, the pointer's travel round it sets how far
 */
export interface RoundSlide {
    /** The choices when pressed: the slide counts from them, and Escape goes back to them */
    readonly base: FollowAround;
    /** The member the slide snaps by, an index into the base plan's line */
    readonly q: number;
    /** The pointer's distance round the base plan's loop when last seen */
    readonly last: number;
    /** How far the pointer has gone round since the press, signed (the base way positive) */
    readonly moved: number;
    /** Where the pointer is, for the count by it */
    readonly pointer: XY;
    /**
     * The marcher pressed, who leads from here on; null when the outline itself was pressed, which
     * slides the line as it is
     */
    readonly lead: number | null;
    /**
     * How far off the outline the pointer may stray and still slide the line, in field units.
     * Past it the leader is pulled out into a trail; within half of it, it slides again.
     */
    readonly band: number;
    /**
     * Carried by the pointer with no button held (owner, 2026-11-23): the marcher was clicked,
     * not dragged, and the line follows the pointer until the next click, Enter or Escape
     */
    readonly loose?: boolean;
}

/**
 * The leader pulled out of the outline into a trail (a session's `follow.peel`): what letting go
 * of it goes back to, and how the line was turned to follow it
 */
export interface FollowPeel {
    /** The line's order before the leader was pulled out */
    readonly order: readonly number[];
    /** The loop's choices when the line was pressed */
    readonly around: FollowAround;
    /** The way round the line follows its leader off the outline */
    readonly reversed: boolean;
    /** How many of the trail's first points run round the outline, as far as the line had slid */
    readonly carried: number;
}

/**
 * Digits typed for how far (owner, 2026-11-22; a session's `follow.roundTyped`): `text` as typed,
 * and the amount before the first digit, which Escape or erasing every digit goes back to
 */
export interface RoundTyped {
    readonly text: string;
    readonly before: number;
}

/** The most digits a typed count takes: as far as Finish allows is never more than five */
const TYPED_DIGITS = 5;

/** The most spots or steps the bar goes to: as far as Finish allows (100 times round) */
export const roundMaxOf = (f: FollowDrag | null | undefined): number =>
    aroundPlanOf(f)?.maxAmount ?? 1;

/** Whether the Follow tool's trail closes the loop round an outline (the order runs round it) */
export const goingRound = (f: FollowDrag | null | undefined): boolean =>
    !!f?.around && f.grabbed === null;

/** The starts in `follow.ids` order, as the plan reads them */
const startsOf = (f: Pick<FollowDrag, "ids" | "starts">): [number, number][] =>
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
    const leader = f.ids.indexOf(a.leader);
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
 * The loop's choices when the Follow tool opens on `outline` with the march order `order` (tail
 * first, the leader last): nobody moved (N = 0) until the line is dragged round or a count typed
 * (owner, 2026-11-22). The way round is the order's own: the leader walks on towards the tail.
 * Null when the order doesn't run round the outline, each marcher's neighbor on it the next in
 * the order and the last and first neighbors too; the line then follows its order as any trail
 * does. Never a guessed way round or leader in place of a set order's.
 */
export function loopAround(
    f: Pick<FollowDrag, "ids" | "starts" | "step" | "window">,
    outline: Outline,
    order: readonly number[],
): FollowAround | null {
    if (order.length !== f.ids.length || order.length < 2) return null;
    const leader = order.at(-1)!;
    for (const reversed of [false, true]) {
        const tried: FollowAround = {
            outline,
            amount: 0,
            unit: "spots",
            reversed,
            leader,
            again: false,
        };
        const probe = { ...f, grabbed: null, around: tried } as FollowDrag;
        const line = aroundLine(probe, aroundPlanOf(probe)!);
        if (line.every((id, q) => id === order[q])) return tried;
    }
    return null;
}

/**
 * The loop's choices when the Follow tool opens on `outline` with no march order set (owner,
 * 2026-11-22: "it should guess in order first or at least in a circle"): the marchers in their
 * places round the outline, nobody moved, clockwise on the field with the member who has most
 * room ahead leading. A guess the drawing shows, and the first grab replaces: the one grabbed
 * leads, the way it's dragged.
 */
export function guessAround(
    f: Pick<FollowDrag, "ids" | "starts">,
    outline: Outline,
): FollowAround {
    const line = lineRound(outline.loop, startsOf(f));
    return {
        outline,
        amount: 0,
        unit: "spots",
        reversed: false,
        leader: f.ids[line.at(-1)!]!,
        again: false,
    };
}

/**
 * The line round `outline` led by `lead`, walking the way `reversed` says, by id: the tail first
 * (the one the leader walks towards), the leader last
 */
export function ringLine(
    f: Pick<FollowDrag, "ids" | "starts">,
    outline: Outline,
    lead: number,
    reversed: boolean,
): number[] {
    const { loop } = walkingOutline(outline, reversed);
    return lineRound(loop, startsOf(f), f.ids.indexOf(lead)).map(
        (i) => f.ids[i]!,
    );
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

const drillsOf = (s: PathSession): Map<number, string> =>
    new Map((s.target.trail?.members ?? []).map((m) => [m.marcherId, m.drill]));

/** A change to the loop's choices, the drawing's target kept with them */
function updateAround(
    fn: (a: FollowAround, f: FollowDrag) => FollowAround | null,
): void {
    const { session } = usePathPenStore.getState();
    const f = session?.follow;
    if (!session || !f?.around || f.grabbed !== null) return;
    const around = fn(f.around, f);
    if (!around || around === f.around) return;
    // a change from the bar ends any slide, and digits typed: Escape then leaves the tool
    const follow = { ...f, around, roundSlide: null, roundTyped: null };
    usePathPenStore.setState({
        session: {
            ...session,
            follow,
            target: aroundTarget(session.target, follow, drillsOf(session)),
        },
    });
}

/** How far (DO-4): a whole number from 0 (nobody moved) to as far as Finish allows ({@link roundMaxOf}) */
export function setRoundAmount(amount: number): void {
    updateAround((a, f) => {
        const n = Math.max(0, Math.min(roundMaxOf(f), Math.round(amount)));
        return a.amount !== n ? { ...a, amount: n } : null;
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
        if (a.unit === unit) return null;
        const plan = aroundPlanOf(f)!;
        const gone =
            plan.distances.reduce((x, d) => x + d, 0) /
            Math.max(1, plan.distances.length);
        const per = unit === "spots" ? plan.spacing : f.step;
        const next = {
            ...a,
            unit,
            // nobody moved stays nobody moved
            amount: a.amount === 0 ? 0 : Math.max(1, Math.round(gone / per)),
        };
        const max = roundMaxOf({ ...f, around: next });
        return { ...next, amount: Math.min(next.amount, max) };
    });
}

/**
 * The other way round (DO-3, Reverse leader and the bar's Clockwise | Counterclockwise): the line
 * turns round, so the one at its back leads
 */
export function flipRoundWay(): void {
    updateAround((a, f) => {
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

// ---------------------------------------------------------------------------
// Sliding the line round by hand, and typing how far (owner, 2026-11-22)
// ---------------------------------------------------------------------------

/**
 * How far round, signed, puts member `q` of `plan` (its line index) nearest `offset` round the
 * outline from where it starts, the plan's way positive: whole spots (each onto the place that
 * many ahead or behind, as `planGoRound` counts them, so uneven spacing and gaps snap to the
 * places they have) or whole steps. Held to `max` either way.
 */
export function snapRound(
    plan: Pick<GoRoundPlan, "ring" | "memberSpot" | "loop">,
    unit: RoundUnit,
    step: number,
    q: number,
    offset: number,
    max: number,
): number {
    const clamp = (n: number) => Math.max(-max, Math.min(max, n));
    if (unit === "steps") return clamp(Math.round(offset / step));
    const { ring, memberSpot } = plan;
    const S = ring.length;
    const L = plan.loop.L;
    if (S === 0 || !(L > 0)) return 0;
    const i0 = memberSpot[q] ?? 0;
    // where member q stands n places on, counted from its own place (rising with n)
    const rel = (n: number) => {
        const i = i0 + n;
        const k = Math.floor(i / S);
        return ring[i - k * S]! + k * L - ring[i0]!;
    };
    let n = clamp(Math.round((offset / L) * S));
    while (n < max && Math.abs(rel(n + 1) - offset) < Math.abs(rel(n) - offset))
        n++;
    while (
        n > -max &&
        Math.abs(rel(n - 1) - offset) < Math.abs(rel(n) - offset)
    )
        n--;
    return n;
}

/**
 * The choices `n` places (or steps) on from `base`, signed, with `lead` grabbed (null: the outline
 * itself): the one grabbed leads whichever way it's dragged, back past where the line started
 * being the other way round. With the outline grabbed the line keeps its leader going on, and
 * going back the one at its back leads (`back`, as Reverse leader turns it).
 */
export function aroundSlidTo(
    base: FollowAround,
    n: number,
    lead: number | null,
    back: number,
): FollowAround {
    const leader = lead ?? (n < 0 ? back : base.leader);
    return {
        ...base,
        leader,
        reversed: n < 0 ? !base.reversed : base.reversed,
        amount: Math.abs(n),
    };
}

/**
 * The member of the line or the outline under `at` while going round, as an index into the
 * line as the plan has it (the leader for the outline), or null for neither. A member counts where
 * it's drawn: at its stop.
 */
export function roundHit(f: FollowDrag, at: XY, radius: number): number | null {
    return roundPress(f, at, radius)?.q ?? null;
}

/** {@link roundHit}, and whether a member was pressed (`member`) or only the outline */
function roundPress(
    f: FollowDrag,
    at: XY,
    radius: number,
): { q: number; member: boolean } | null {
    if (!goingRound(f)) return null;
    const plan = aroundPlanOf(f);
    if (!plan) return null;
    let best: { q: number; d: number } | null = null;
    plan.spots.forEach(([x, y], q) => {
        const d = Math.hypot(x - at.x, y - at.y);
        if (d <= radius && (!best || d < best.d)) best = { q, d };
    });
    if (best) return { q: (best as { q: number }).q, member: true };
    const p: CoreXY = [at.x, at.y];
    const on = loopPoint(plan.loop, nearestOnLoop(plan.loop, p));
    return Math.hypot(on[0] - at.x, on[1] - at.y) <= radius
        ? { q: plan.line.length - 1, member: false }
        : null;
}

/** A change to the Follow tool's going round, its target kept with it */
function setRound(
    s: PathSession,
    f: FollowDrag,
    patch: Partial<FollowDrag>,
): void {
    const follow: FollowDrag = { ...f, ...patch };
    const target =
        follow.around && follow.around !== f.around && follow.grabbed === null
            ? aroundTarget(s.target, follow, drillsOf(s))
            : s.target;
    usePathPenStore.setState({ session: { ...s, follow, target } });
}

/**
 * A press at `at` while going round: on a member or the outline, the line is grabbed and slides
 * round with the pointer from here; a member pressed leads from here on. False when the press is
 * on neither. `band` is how far off the outline the pointer may stray before the leader is
 * pulled out into a trail (none by default: the line only slides).
 */
export function startRoundSlide(
    at: XY,
    radius: number,
    band: number = Infinity,
): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    if (!s || !f?.around || !goingRound(f)) return false;
    const hit = roundPress(f, at, radius);
    if (hit === null) return false;
    const plan = aroundPlanOf(f)!;
    const lead = hit.member ? aroundLine(f, plan)[hit.q]! : null;
    setRound(s, f, {
        roundSlide: {
            base: f.around,
            q: hit.q,
            last: nearestOnLoop(plan.loop, [at.x, at.y]),
            moved: 0,
            pointer: at,
            lead,
            band,
        },
        // the one pressed leads at once, before it moves (owner, 2026-11-23): the Leader mark
        // jumps to it as the sign that it's held
        ...(lead !== null && lead !== f.around.leader
            ? { around: { ...f.around, leader: lead } }
            : {}),
        // a drag takes over from digits typed
        roundTyped: null,
    });
    return true;
}

const sameAround = (a: FollowAround, b: FollowAround | null | undefined) =>
    !!b &&
    a.amount === b.amount &&
    a.reversed === b.reversed &&
    a.leader === b.leader;

/**
 * The pointer at `at` while the line is held: on the outline it slides round, how far snapped and
 * live (`"round"`); past the slide's band off it, the marcher grabbed is pulled out and leads a
 * trail (`"out"`, the caller draws its leg to the pointer). Null when the line isn't held.
 */
export function slideRound(at: XY): "round" | "out" | null {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return null;
    // digits typed while held set how far: the pointer no longer does
    if (f.roundTyped) {
        setRound(s, f, { roundSlide: { ...slide, pointer: at } });
        return "round";
    }
    const base = slide.base;
    const plan = aroundPlanOf({ ...f, grabbed: null, around: base })!;
    const L = plan.loop.L;
    // round the outline from where it was last seen, the short way: a lap is many small moves
    const now = nearestOnLoop(plan.loop, [at.x, at.y]);
    let delta = now - slide.last;
    delta -= Math.round(delta / L) * L;
    const moved = slide.moved + delta;
    const held: RoundSlide = { ...slide, last: now, moved, pointer: at };
    // Off the outline (owner, 2026-11-22: "drag it around the circle or drag it out of the
    // circle"): the one grabbed is pulled out into a trail; nearer again, the line slides again
    const on = loopPoint(plan.loop, now);
    const off = Math.hypot(on[0] - at.x, on[1] - at.y);
    const out = f.grabbed !== null;
    if (slide.lead !== null && off > (out ? slide.band / 2 : slide.band)) {
        // Pulled out already, the session stays the same one unless the line turns: the trail's
        // leg to the pointer is the caller's, a frame at a time (so where the pointer went round
        // meanwhile isn't counted: back on the outline it's the short way from where it left)
        const session = out
            ? pulledOn(s, f, at)
            : pullOut(s, { ...f, roundSlide: held }, at);
        if (session !== s) usePathPenStore.setState({ session });
        return "out";
    }
    const q = slide.q;
    // from where member q stood when pressed (its stop then), round from where it starts
    const offset = plan.ends[q]! - plan.startDist[q]! + moved;
    const n = snapRound(plan, base.unit, f.step, q, offset, plan.maxAmount);
    const around = aroundSlidTo(base, n, slide.lead, f.ids[plan.line[0]!]!);
    const back = out ? letGo(s) : s;
    const was = back.follow!;
    setRound(back, was, {
        around: sameAround(around, was.around) ? was.around! : around,
        roundSlide: held,
    });
    return "round";
}

// ---------------------------------------------------------------------------
// Pulled out of the outline into a trail (owner, 2026-11-22)
// ---------------------------------------------------------------------------

/**
 * The stretch of `loop` from `from` round it for `len` (less than once round), as a trail's
 * points: each of the outline's corners passed, an arc leg kept an arc (its bulge for the part
 * walked), and where it stops
 */
export function outlineStretch(
    loop: RoutePath,
    from: number,
    len: number,
): PathPoint[] {
    const L = loop.L;
    const eps = loopSnap(L);
    const out: PathPoint[] = [];
    let d = from - Math.floor(from / L) * L;
    let left = Math.min(len, L - eps);
    let j = loop.pieces.findIndex((_, i) => d < loop.D[i + 1]! - eps);
    if (j < 0) {
        j = 0;
        d = 0;
    }
    // each piece of the outline at most twice: the one it starts in, again when it ends there
    for (let guard = 0; left > eps && guard <= loop.pieces.length; guard++) {
        const start = loop.D[j]!;
        const end = loop.D[j + 1]!;
        const take = Math.min(left, end - d);
        if (take > eps) {
            const whole = d + take >= end - eps;
            const [x, y] = whole ? loop.V[j + 1]! : loopPoint(loop, d + take);
            const piece = loop.pieces[j]!;
            // R-8's arc: its half-angle is 2·atan(2k), and the part walked has its share of it
            const bulge =
                piece.kind === "arc"
                    ? Math.tan(
                          (2 * Math.atan(2 * piece.k) * take) /
                              (end - start) /
                              2,
                      ) / 2
                    : 0;
            out.push({ at: { x, y }, ...(bulge ? { bulge } : {}) });
        }
        left -= take;
        j = (j + 1) % loop.pieces.length;
        d = loop.D[j]!;
    }
    return out;
}

/**
 * Which way round the line follows a leader pulled straight out of the outline to `at`: the way
 * the pull leans along the outline at the leader's start (the leader goes that way, the line
 * behind it); `keep` when it's pulled squarely out
 */
function pulledWay(
    f: FollowDrag,
    outline: Outline,
    lead: number,
    at: XY,
    keep: boolean,
): boolean {
    const p = f.starts.get(lead)!;
    const loop = outline.loop;
    const d = nearestOnLoop(loop, [p.x, p.y]);
    const e = Math.min(loop.L / 200, 0.5);
    const a = loopPoint(loop, d - e);
    const b = loopPoint(loop, d + e);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const vx = at.x - p.x;
    const vy = at.y - p.y;
    const along = (vx * (b[0] - a[0]) + vy * (b[1] - a[1])) / len;
    // squarely out (within about 20° of it): the way it was going
    if (Math.abs(along) < 0.35 * Math.hypot(vx, vy)) return keep;
    return along < 0;
}

/** The session with its leader `lead` pulled out, the line turned to follow it `reversed`'s way */
function pulled(
    s: PathSession,
    f: FollowDrag,
    lead: number,
    reversed: boolean,
    points: readonly PathPoint[],
): PathSession {
    const a = f.around!;
    const follow: FollowDrag = {
        ...f,
        grabbed: lead,
        // all the way round, anyone leads: the line is the ring from the one behind them
        order: a.outline.full
            ? ringLine(f, a.outline, lead, reversed)
            : (f.peel?.order ?? f.order),
        hover: null,
        peel: {
            order: f.peel?.order ?? f.order,
            around: f.peel?.around ?? f.roundSlide?.base ?? a,
            reversed,
            carried: points.length,
        },
    };
    // The trail is drawn from the leader's start: nothing of the outline's stays on the target
    const { toBulge: _toBulge, ...rest } = s.target;
    return {
        ...s,
        follow,
        target: followTarget(
            { ...rest, points: [], ends: null },
            follow,
            drillsOf(s),
        ),
        points: [...points],
        pointer: null,
        dragging: null,
    };
}

/**
 * The marcher grabbed pulled out of the outline towards `at`: it leads a trail from where it
 * starts. Slid round first, the trail runs round the outline as far as its leader had gone
 * (`outlineStretch`), so the line goes on from where the slide showed it; pulled straight out,
 * the line follows the way the pull leans.
 */
function pullOut(s: PathSession, f: FollowDrag, at: XY): PathSession {
    const lead = f.roundSlide!.lead!;
    // The line as it stands, led by the one grabbed (grabbed where a typed count or a stored
    // move had put it, without sliding, it leads from there too)
    const a =
        f.around!.leader === lead ? f.around! : { ...f.around!, leader: lead };
    const plan = aroundPlanOf({ ...f, grabbed: null, around: a })!;
    const gone = plan.ends.at(-1)! - plan.startDist.at(-1)!;
    const L = plan.loop.L;
    // whole times round end where they started: only the part past them is walked
    const len = gone - Math.floor(gone / L + 1e-9) * L;
    const carried =
        len > loopSnap(L)
            ? outlineStretch(plan.loop, plan.startDist.at(-1)!, len)
            : [];
    const reversed = carried.length
        ? a.reversed
        : pulledWay(f, a.outline, lead, at, f.roundSlide!.base.reversed);
    return pulled(s, f, lead, reversed, carried);
}

/** Pulled out already, the pointer on at `at`: pulled straight out, the line's way follows the pull's lean */
function pulledOn(s: PathSession, f: FollowDrag, at: XY): PathSession {
    const peel = f.peel;
    const a = f.around;
    const lead = f.roundSlide?.lead;
    if (!peel || !a || lead == null || peel.carried > 0 || !a.outline.full)
        return s;
    const reversed = pulledWay(f, a.outline, lead, at, peel.reversed);
    return reversed === peel.reversed ? s : pulled(s, f, lead, reversed, []);
}

/**
 * The session with a leader pulled out of the outline let go: the line as it was round the
 * outline, nothing drawn (the same session when nobody was pulled out)
 */
export function letGo(s: PathSession): PathSession {
    const f = s.follow;
    const peel = f?.peel;
    if (!f || !peel) return s;
    const follow: FollowDrag = {
        ...f,
        grabbed: null,
        order: peel.order,
        peel: null,
    };
    return {
        ...s,
        follow,
        points: [],
        pointer: null,
        dragging: null,
        target: aroundTarget(s.target, follow, drillsOf(s)),
    };
}

/**
 * A click on the line (pressed and let go where it was): from here the pointer carries it with
 * no button held, as a drag would with one (owner, 2026-11-23: "click, release, then move"). The
 * next click ends it as letting go of a drag does; Enter keeps it and Escape puts it back. False
 * when the line isn't held.
 */
export function carryRoundSlide(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return false;
    setRound(s, f, { roundSlide: { ...slide, loose: true } });
    return true;
}

/**
 * The line let go: true when it now goes round differently from when it was pressed, so the
 * caller writes it (one undo step); otherwise it's put back as it was, and nothing is written.
 * A marcher pressed and let go where the line started leads from here on. Pulled out into a
 * trail, nothing is written either: the caller places the trail's first point where it was let go.
 */
export function endRoundSlide(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return false;
    if (f.grabbed !== null) {
        // the drawing is the trail's from here: the loop's choices wait as they were pressed
        usePathPenStore.setState({
            session: {
                ...s,
                follow: {
                    ...f,
                    roundSlide: null,
                    around: f.peel?.around ?? slide.base,
                },
            },
        });
        return false;
    }
    // digits typed while held wait for Enter
    if (f.roundTyped) {
        setRound(s, f, { roundSlide: null });
        return false;
    }
    const a = f.around!;
    const changed =
        a.amount !== slide.base.amount || a.reversed !== slide.base.reversed;
    const picked =
        slide.lead !== null && slide.lead !== slide.base.leader
            ? { ...slide.base, leader: slide.lead }
            : slide.base;
    setRound(s, f, {
        roundSlide: null,
        ...(changed ? {} : { around: picked }),
    });
    return changed && a.amount > 0;
}

/**
 * Escape (or a lost press) while the line is held: back as it was when pressed, a leader pulled
 * out let go; false with nothing held
 */
export function cancelRoundSlide(): boolean {
    const s = usePathPenStore.getState().session;
    const slide = s?.follow?.roundSlide;
    if (!s || !slide) return false;
    const back = letGo(s);
    setRound(back, back.follow!, {
        roundSlide: null,
        around: slide.base,
        roundTyped: null,
    });
    return true;
}

/** A digit typed while going round: how far, exactly, shown live; Enter writes it */
export function typeRoundDigit(digit: string): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    if (!s || !f?.around || !goingRound(f) || !/^[0-9]$/.test(digit))
        return false;
    const was = f.roundTyped;
    const text = ((was?.text ?? "") + digit).replace(/^0+(?=\d)/, "");
    if (text.length > TYPED_DIGITS) return true;
    const before = was?.before ?? f.around.amount;
    const amount = Math.min(roundMaxOf(f), Number(text));
    setRound(s, f, {
        roundTyped: { text, before },
        around: f.around.amount === amount ? f.around : { ...f.around, amount },
    });
    return true;
}

/** Backspace while digits are typed: the last one goes; false with none typed */
export function eraseRoundDigit(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const typed = f?.roundTyped;
    if (!s || !f?.around || !typed || !goingRound(f)) return false;
    const text = typed.text.slice(0, -1);
    const amount =
        text === "" ? typed.before : Math.min(roundMaxOf(f), Number(text));
    setRound(s, f, {
        roundTyped: text === "" ? null : { ...typed, text },
        around: f.around.amount === amount ? f.around : { ...f.around, amount },
    });
    return true;
}

/** Escape while digits are typed: back to how far it was before them; false with none typed */
export function clearRoundTyped(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const typed = f?.roundTyped;
    if (!s || !f?.around || !typed || !goingRound(f)) return false;
    setRound(s, f, {
        roundTyped: null,
        around:
            f.around.amount === typed.before
                ? f.around
                : { ...f.around, amount: typed.before },
    });
    return true;
}

/**
 * Whether Finish has anything to write while going round (owner, 2026-11-22): somebody moves,
 * and going round again, it isn't just what's stored
 */
export function roundChanged(a: FollowAround | null | undefined): boolean {
    if (!a || a.amount <= 0) return false;
    const was = a.stored;
    return !(
        was &&
        was.amount === a.amount &&
        was.unit === a.unit &&
        was.reversed === a.reversed &&
        was.leader === a.leader
    );
}
