/**
 * The order line's drawing rules (pathways step 4g, DL-30), pure and in screen pixels: how wide it
 * is at a zoom, the gap it leaves round each marcher so dots and selection rings show through, the
 * gentle arc a leg that runs back over the line takes, and the side each position number sits on.
 */
import type { XY } from "./orderSweep";

/** At least this wide at the leader and at the tail on screen, however far out the field is zoomed */
export const ORDER_MIN_WIDTH = { leader: 3, tail: 1 } as const;
/** How far past a dot's selection ring the line stops, in screen pixels */
export const ORDER_GAP_PX = 1.5;

/** The line's sizes at a zoom, in screen pixels */
export interface OrderLineSizes {
    /** The line's width at the leader: the dot's diameter, its halo included */
    readonly leader: number;
    /** The line's width at the tail: a third of the leader's */
    readonly tail: number;
    /** How far from a marcher's center the line stops: the dot and its ring, and a pixel or two */
    readonly gap: number;
    /** How far a marcher's dot and its selection ring reach from its center */
    readonly reach: number;
}

/**
 * The line's sizes, from the dot as drawn
 *
 * @param dotRadius the dot's radius on screen
 * @param ringReach how far the dot's selection ring reaches from its center, on screen
 * @param halo how far the line's halo reaches past it each side, on screen
 */
export function orderLineSizes(
    dotRadius: number,
    ringReach: number,
    halo = 0,
): OrderLineSizes {
    const leader = Math.max(2 * dotRadius - 2 * halo, ORDER_MIN_WIDTH.leader);
    return {
        leader,
        tail: Math.max(leader / 3, ORDER_MIN_WIDTH.tail),
        gap: ringReach + ORDER_GAP_PX,
        reach: ringReach,
    };
}

/** The line's width `t` of the way from the leader (0) to the tail (1) */
export const orderWidthBetween = (t: number, sizes: OrderLineSizes): number =>
    sizes.leader + (sizes.tail - sizes.leader) * Math.min(1, Math.max(0, t));

/** One leg of the line: straight from `from` to `to`, or a quadratic arc through `control` */
export interface OrderLeg {
    readonly from: XY;
    readonly to: XY;
    /** The arc's control point; null for a straight leg */
    readonly control: XY | null;
}

/** The point `t` (0 to 1) along a leg */
export function legPoint(leg: OrderLeg, t: number): XY {
    const { from, to, control } = leg;
    if (!control)
        return {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
        };
    const u = 1 - t;
    return {
        x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
}

/** The leg's direction (unit) `t` along it; null for a leg of no length */
export function legTangent(leg: OrderLeg, t: number): XY | null {
    const { from, to, control } = leg;
    const dx = control
        ? 2 * (1 - t) * (control.x - from.x) + 2 * t * (to.x - control.x)
        : to.x - from.x;
    const dy = control
        ? 2 * (1 - t) * (control.y - from.y) + 2 * t * (to.y - control.y)
        : to.y - from.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? null : { x: dx / length, y: dy / length };
}

/** Points along a leg, `steps` + 1 of them, from `t0` to `t1` (a straight leg needs only its ends) */
export function legSamples(
    leg: OrderLeg,
    t0 = 0,
    t1 = 1,
    steps = leg.control ? 16 : 1,
): XY[] {
    return Array.from({ length: steps + 1 }, (_, i) =>
        legPoint(leg, t0 + ((t1 - t0) * i) / steps),
    );
}

function nearestOnSegment(p: XY, a: XY, b: XY): { t: number; d: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
        length2 === 0
            ? 0
            : Math.min(
                  1,
                  Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
              );
    return { t, d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) };
}

/**
 * How far `p` is from a leg's inside, or Infinity when its nearest point is one of the leg's ends:
 * a point just past the end of a leg in line with it isn't on it
 */
function distanceToLegInside(p: XY, leg: OrderLeg): number {
    const samples = legSamples(leg);
    const last = samples.length - 2;
    let best = Infinity;
    for (let i = 0; i <= last; i++) {
        const { t, d } = nearestOnSegment(p, samples[i]!, samples[i + 1]!);
        const atEnd = (i === 0 && t <= 0) || (i === last && t >= 1);
        if (!atEnd) best = Math.min(best, d);
    }
    return best;
}

/** Where along a leg its overlap with earlier legs is checked: away from its ends, which it shares */
const OVERLAP_SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9];
/** How many of those must lie on earlier legs for the leg to run back over them */
const OVERLAP_HITS = 2;

/** Whether `leg` runs back over any of `earlier`, within `tolerance` */
export function overlapsEarlier(
    leg: OrderLeg,
    earlier: readonly OrderLeg[],
    tolerance: number,
): boolean {
    if (earlier.length === 0) return false;
    let hits = 0;
    for (const t of OVERLAP_SAMPLES) {
        const p = legPoint(leg, t);
        if (earlier.some((e) => distanceToLegInside(p, e) <= tolerance)) hits++;
        if (hits >= OVERLAP_HITS) return true;
    }
    return false;
}

/** How far a leg that runs back bows out at its middle, as a share of its length */
const BOW = 0.2;
/** The most a first bow takes, and the most any takes, as shares of the leg's length */
const BOW_FIRST_MAX = 0.3;
const BOW_MAX = 0.45;

/** A leg from `from` to `to` bowed `sagitta` px to its left (negative: to its right) at its middle */
export function bowedLeg(from: XY, to: XY, sagitta: number): OrderLeg {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    // A quadratic's middle sits half way to its control point
    return {
        from,
        to,
        control: {
            x: (from.x + to.x) / 2 + (dy / length) * 2 * sagitta,
            y: (from.y + to.y) / 2 - (dx / length) * 2 * sagitta,
        },
    };
}

/**
 * The legs through `points` in order: straight, except a leg that runs back over earlier ones
 * (within `tolerance`), which bows into a gentle arc. Bowed legs take sides in turn; a side whose
 * arc would still run over the line is swapped for the other, then for a deeper bow.
 */
export function orderLegs(
    points: readonly XY[],
    tolerance: number,
): OrderLeg[] {
    const legs: OrderLeg[] = [];
    let bowed = 0;
    for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!;
        const to = points[i]!;
        const straight: OrderLeg = { from, to, control: null };
        if (!overlapsEarlier(straight, legs, tolerance)) {
            legs.push(straight);
            continue;
        }
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const depth = Math.min(
            Math.max(BOW * length, 3 * tolerance),
            BOW_FIRST_MAX * length,
        );
        const side = bowed % 2 === 0 ? 1 : -1;
        bowed++;
        const tries = [side, -side, 2 * side, -2 * side].map((k) =>
            bowedLeg(
                from,
                to,
                Math.sign(k) * Math.min(Math.abs(k) * depth, BOW_MAX * length),
            ),
        );
        legs.push(
            tries.find((leg) => !overlapsEarlier(leg, legs, tolerance)) ??
                tries[0]!,
        );
    }
    return legs;
}

/** How finely an arc is measured when it's trimmed */
const ARC_STEPS = 32;

/** Where along a leg (0 to 1) it is `distance` from its start, near enough for a gentle arc */
function tAtDistance(
    leg: OrderLeg,
    distance: number,
    fromEnd: boolean,
): number {
    if (distance <= 0) return fromEnd ? 1 : 0;
    if (!leg.control) {
        const length = Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y);
        const t = length === 0 ? 1 : Math.min(1, distance / length);
        return fromEnd ? 1 - t : t;
    }
    // Along the arc from the chosen end, by the samples' running length
    const samples = legSamples(leg, 0, 1, ARC_STEPS);
    const ordered = fromEnd ? [...samples].reverse() : samples;
    let run = 0;
    for (let i = 1; i < ordered.length; i++) {
        const step = Math.hypot(
            ordered[i]!.x - ordered[i - 1]!.x,
            ordered[i]!.y - ordered[i - 1]!.y,
        );
        if (run + step >= distance) {
            const t = (i - 1 + (distance - run) / (step || 1)) / ARC_STEPS;
            return fromEnd ? 1 - t : t;
        }
        run += step;
    }
    return fromEnd ? 0 : 1;
}

/** A leg trimmed clear of the marchers at its ends: `t0` to `t1` along it, or null if nothing's left */
export function trimLeg(
    leg: OrderLeg,
    gapFrom: number,
    gapTo: number,
): { t0: number; t1: number } | null {
    const t0 = tAtDistance(leg, gapFrom, false);
    const t1 = tAtDistance(leg, gapTo, true);
    return t1 - t0 > 1e-6 ? { t0, t1 } : null;
}

/** A band along `samples`, `a` half-wide at the first and `b` at the last, as SVG polygon points */
export function taperAlong(
    samples: readonly XY[],
    a: number,
    b: number,
): string {
    const n = samples.length;
    if (n < 2) return "";
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < n; i++) {
        const prev = samples[Math.max(0, i - 1)]!;
        const next = samples[Math.min(n - 1, i + 1)]!;
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const length = Math.hypot(dx, dy) || 1;
        const half = a + ((b - a) * i) / (n - 1);
        const nx = (-dy / length) * half;
        const ny = (dx / length) * half;
        const p = samples[i]!;
        left.push(`${p.x + nx},${p.y + ny}`);
        right.push(`${p.x - nx},${p.y - ny}`);
    }
    return [...left, ...right.reverse()].join(" ");
}

/** Which side of its dot a marcher's name label sits on the field */
export type LabelSide = "above" | "beside";

/**
 * The directions a position number may sit in, best first: away from the label (below it when
 * labels sit above, to the left when they sit beside, on the right)
 */
const NUMBER_SIDES: Record<LabelSide, readonly XY[]> = {
    above: [
        { x: 0, y: 1 },
        { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
        { x: Math.SQRT1_2, y: Math.SQRT1_2 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
    ],
    beside: [
        { x: -1, y: 0 },
        { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
        { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
    ],
};
/** How far off every leg a number's direction must point, at least (cosine of 50°) */
const NUMBER_CLEAR_COS = Math.cos((50 * Math.PI) / 180);

/**
 * The direction from a marcher its position number sits in: the first side away from the label
 * that's clear of the line's legs there (`legs`: the directions the line leaves the marcher in,
 * the arrow's among them), else the side furthest from them
 */
export function numberSide(labelSide: LabelSide, legs: readonly XY[]): XY {
    const sides = NUMBER_SIDES[labelSide];
    const nearest = (d: XY) =>
        Math.max(-1, ...legs.map((l) => d.x * l.x + d.y * l.y));
    const clear = sides.find((d) => nearest(d) <= NUMBER_CLEAR_COS);
    if (clear) return clear;
    return sides.reduce((best, d) => (nearest(d) < nearest(best) ? d : best));
}
