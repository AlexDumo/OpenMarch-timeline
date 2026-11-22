/**
 * Go round in the Follow tool, pathways step 10 (spec Appendix L.11, DO-1 to DO-8): when the
 * selected marchers stand on a closed outline (a circle or a box outline) at the start flag, the
 * Follow tool offers Go round beside dragging a trail out. Each follows the one ahead round the
 * outline the same distance, N of its spots (or steps), either way round; the drawing shows the
 * outline, its way round and where everyone stops, and Finish writes it (`goRound`, AP-T13).
 *
 * Going round is a move you make, not one made for you (owner, 2026-11-22: "I should be forced to
 * drag or do something so I can tangibly feel the change"). The tool opens with nobody moved
 * (N = 0). Dragging the leader, or any marcher of the line, or the outline itself, slides the
 * whole line round it, snapped to whole spots (or steps), with the count by the pointer; the
 * release writes it in one undo step, and Escape puts it back. Digits typed while the tool is
 * open set N exactly, and Enter writes it. With N still 0 nothing is written.
 */
import {
    goRoundPreview,
    planGoRound,
    type GoRoundPlan,
    type Outline,
    type RoundUnit,
} from "@/db-functions/timelineTrailAround";
import {
    loopPoint,
    nearestOnLoop,
    routePolyline,
    type XY as CoreXY,
} from "@openmarch/core";
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
    /**
     * Again only: how far and which way the stored move went, so Finish with nothing changed
     * writes nothing (owner, 2026-11-22)
     */
    readonly stored?: {
        readonly amount: number;
        readonly unit: RoundUnit;
        readonly reversed: boolean;
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
 * Go round's choices when the Follow tool opens on `outline` (DO-3, DO-4): N is 0, nobody moved
 * until the line is dragged round or a count typed (owner, 2026-11-22); the way round and the
 * leader are the line's remembered order's (step 4f) when it runs round the outline, else
 * clockwise on the field with the member who has most room ahead leading.
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
        amount: 0,
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
    // A remembered order (tail first) that runs round the outline sets the way round and the leader
    if (remembered && remembered.length === f.ids.length) {
        for (const reversed of [false, true]) {
            const leader = remembered.at(-1)!;
            const tried: FollowAround = { ...base, reversed, leader };
            const plan = aroundPlanOf({
                ...probe,
                around: tried,
            } as FollowDrag)!;
            const line = aroundLine(probe, plan);
            if (line.every((id, q) => id === remembered[q])) return tried;
        }
    }
    return base;
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

/** How far (DO-4): a whole number from 0 (nobody moved) to as far as Finish allows ({@link roundMaxOf}) */
export function setRoundAmount(amount: number): void {
    updateAround((a, f) => {
        const n = Math.max(0, Math.min(roundMaxOf(f), Math.round(amount)));
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
            // nobody moved stays nobody moved
            amount: a.amount === 0 ? 0 : Math.max(1, Math.round(gone / per)),
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
 * The choices `n` places (or steps) on from `base`, signed: back past where the line started goes
 * the other way round, the one at the back leading (as Reverse leader turns it), that far
 */
export function aroundSlidTo(
    base: FollowAround,
    plan: Pick<GoRoundPlan, "line">,
    ids: readonly number[],
    n: number,
): FollowAround {
    if (n >= 0) return { ...base, amount: n };
    return {
        ...base,
        reversed: !base.reversed,
        leader: ids[plan.line[0]!]!,
        amount: -n,
    };
}

/**
 * The member of the line or the outline under `at` while going round, as an index into the
 * line as the plan has it (the leader for the outline), or null for neither. A member counts where
 * it's drawn: at its stop.
 */
export function roundHit(f: FollowDrag, at: XY, radius: number): number | null {
    if (!goingRound(f)) return null;
    const plan = aroundPlanOf(f);
    if (!plan) return null;
    let best: { q: number; d: number } | null = null;
    plan.spots.forEach(([x, y], q) => {
        const d = Math.hypot(x - at.x, y - at.y);
        if (d <= radius && (!best || d < best.d)) best = { q, d };
    });
    if (best) return (best as { q: number }).q;
    const p: CoreXY = [at.x, at.y];
    const on = loopPoint(plan.loop, nearestOnLoop(plan.loop, p));
    return Math.hypot(on[0] - at.x, on[1] - at.y) <= radius
        ? plan.line.length - 1
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
        follow.around && follow.around !== f.around
            ? aroundTarget(s.target, follow, drillsOf(s))
            : s.target;
    usePathPenStore.setState({ session: { ...s, follow, target } });
}

/**
 * A press at `at` while going round: on a member or the outline, the line is grabbed and slides
 * round with the pointer from here. False when the press is on neither.
 */
export function startRoundSlide(at: XY, radius: number): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    if (!s || !f?.around || !goingRound(f)) return false;
    const q = roundHit(f, at, radius);
    if (q === null) return false;
    const plan = aroundPlanOf(f)!;
    setRound(s, f, {
        roundSlide: {
            base: f.around,
            q,
            last: nearestOnLoop(plan.loop, [at.x, at.y]),
            moved: 0,
            pointer: at,
        },
        // a drag takes over from digits typed
        roundTyped: null,
    });
    return true;
}

/** The pointer at `at` while the line slides: how far round, snapped, live */
export function slideRound(at: XY): void {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return;
    const base = slide.base;
    const plan = aroundPlanOf({ ...f, around: base })!;
    const L = plan.loop.L;
    // round the outline from where it was last seen, the short way: a lap is many small moves
    const now = nearestOnLoop(plan.loop, [at.x, at.y]);
    let delta = now - slide.last;
    delta -= Math.round(delta / L) * L;
    const moved = slide.moved + delta;
    const q = slide.q;
    // from where member q stood when pressed (its stop then), round from where it starts
    const offset = plan.ends[q]! - plan.startDist[q]! + moved;
    const n = snapRound(plan, base.unit, f.step, q, offset, plan.maxAmount);
    const around = aroundSlidTo(base, plan, f.ids, n);
    const same =
        f.around &&
        around.amount === f.around.amount &&
        around.reversed === f.around.reversed;
    setRound(s, f, {
        around: same ? f.around : around,
        roundSlide: { ...slide, last: now, moved, pointer: at },
    });
}

/**
 * The line let go: true when it now goes round differently from when it was pressed, so the
 * caller writes it (one undo step); otherwise it's put back as it was, and nothing is written
 */
export function endRoundSlide(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return false;
    // digits typed while held wait for Enter
    if (f.roundTyped) {
        setRound(s, f, { roundSlide: null });
        return false;
    }
    const a = f.around!;
    const changed =
        a.amount !== slide.base.amount || a.reversed !== slide.base.reversed;
    setRound(s, f, {
        roundSlide: null,
        ...(changed ? {} : { around: slide.base }),
    });
    return changed && a.amount > 0;
}

/** Escape (or a lost press) while the line slides: back as it was when pressed; false with no slide */
export function cancelRoundSlide(): boolean {
    const s = usePathPenStore.getState().session;
    const f = s?.follow;
    const slide = f?.roundSlide;
    if (!s || !f || !slide) return false;
    setRound(s, f, { roundSlide: null, around: slide.base, roundTyped: null });
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
    if (!s || !f?.around || !typed) return false;
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
    if (!s || !f?.around || !typed) return false;
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
        was.reversed === a.reversed
    );
}
