/**
 * The order line's drawing rules (pathways step 4g, DL-30), pure and in screen pixels (any origin:
 * the overlay works them out with the field's pan left out, and moves them by it): how wide it
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
    const samples = samplesOf(leg);
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

/** A leg's samples (`legSamples`), worked out once per leg: legs are never changed */
const legSampleCache = new WeakMap<OrderLeg, XY[]>();
const samplesOf = (leg: OrderLeg): XY[] => {
    let samples = legSampleCache.get(leg);
    if (!samples) {
        samples = legSamples(leg);
        legSampleCache.set(leg, samples);
    }
    return samples;
};

/** A box round a leg: its ends and its control point, which a quadratic arc stays inside */
interface Bounds {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}
const boundsCache = new WeakMap<OrderLeg, Bounds>();
function boundsOf(leg: OrderLeg): Bounds {
    let bounds = boundsCache.get(leg);
    if (!bounds) {
        const xs = [leg.from.x, leg.to.x];
        const ys = [leg.from.y, leg.to.y];
        if (leg.control) {
            xs.push(leg.control.x);
            ys.push(leg.control.y);
        }
        bounds = {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
        };
        boundsCache.set(leg, bounds);
    }
    return bounds;
}

/** An arc's coarse outline: 4 chords, and how far at most the arc strays from them */
const COARSE_STEPS = 4;
const coarseCache = new WeakMap<OrderLeg, { samples: XY[]; slack: number }>();

/**
 * Whether `p` is surely further than `limit` from an arc, by its coarse outline: a quick answer
 * before its finer samples are measured (a straight leg has nothing coarser)
 */
function surelyFar(p: XY, leg: OrderLeg, limit: number): boolean {
    if (!leg.control) return false;
    let coarse = coarseCache.get(leg);
    if (!coarse) {
        // A quadratic strays from a chord a share 1/n of it long by |P''| / (8 n²), P'' = 2 (from - 2 control + to)
        const bend = Math.hypot(
            leg.from.x - 2 * leg.control.x + leg.to.x,
            leg.from.y - 2 * leg.control.y + leg.to.y,
        );
        coarse = {
            samples: legSamples(leg, 0, 1, COARSE_STEPS),
            slack: bend / (4 * COARSE_STEPS * COARSE_STEPS),
        };
        coarseCache.set(leg, coarse);
    }
    const { samples, slack } = coarse;
    for (let i = 0; i < samples.length - 1; i++)
        if (
            nearestOnSegment(p, samples[i]!, samples[i + 1]!).d - slack <=
            limit
        )
            return false;
    return true;
}

/** Whether `p` is further than `tolerance` outside the box round `leg`, so it can't be on it */
const outside = (p: XY, leg: OrderLeg, tolerance: number) => {
    const b = boundsOf(leg);
    return (
        p.x < b.minX - tolerance ||
        p.x > b.maxX + tolerance ||
        p.y < b.minY - tolerance ||
        p.y > b.maxY + tolerance
    );
};

/** Whether `leg` runs back over any of `earlier`, within `tolerance` */
export function overlapsEarlier(
    leg: OrderLeg,
    earlier: readonly OrderLeg[],
    tolerance: number,
): boolean {
    if (earlier.length === 0) return false;
    let hits = 0;
    for (const [i, t] of OVERLAP_SAMPLES.entries()) {
        // Too few samples left to find enough on the line
        if (hits + OVERLAP_SAMPLES.length - i < OVERLAP_HITS) return false;
        const p = legPoint(leg, t);
        if (
            earlier.some(
                (e) =>
                    !outside(p, e, tolerance) &&
                    !surelyFar(p, e, tolerance) &&
                    distanceToLegInside(p, e) <= tolerance,
            )
        )
            hits++;
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
 * The marchers a leg mustn't cover: every marcher drawn near the line, its own among them (a leg
 * skips its own two ends), and how far clear of them it stays
 */
export interface OrderObstacles {
    /** Where each marcher is drawn */
    readonly at: readonly XY[];
    /**
     * How far the line's middle stays from a marcher it passes: the dot and its selection ring,
     * the gap past them, and half the line's width with its halo
     */
    readonly clearance: number;
    /** How far from its ends a leg is trimmed: a marcher nearest a leg within this of an end isn't crossed */
    readonly endGap: number;
}

/** The point `p` on a leg (its samples) nearest `q`, and how far it is */
function nearestOnLeg(q: XY, leg: OrderLeg): { p: XY; d: number } {
    const samples = samplesOf(leg);
    let best = { p: samples[0]!, d: Infinity };
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i]!;
        const b = samples[i + 1]!;
        const { t, d } = nearestOnSegment(q, a, b);
        if (d < best.d)
            best = {
                p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
                d,
            };
    }
    return best;
}

const samePoint = (a: XY, b: XY) =>
    Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * The marchers (`obstacles`) a leg passes over: within its clearance of the part of it that's
 * drawn, so its dot and selection ring would be covered. Its own ends never count, nor a marcher
 * the leg is nearest at a trimmed end (a neighbor beside its end, or one in line past it).
 */
export function crossedMarchers(
    leg: OrderLeg,
    obstacles: OrderObstacles | undefined,
    most = Infinity,
    near?: readonly XY[],
): XY[] {
    if (!obstacles) return [];
    const { clearance, endGap } = obstacles;
    const crossed: XY[] = [];
    for (const q of near ?? nearBox(boundsOf(leg), obstacles)) {
        if (outside(q, leg, clearance) || surelyFar(q, leg, clearance))
            continue;
        if (samePoint(q, leg.from) || samePoint(q, leg.to)) continue;
        const { p, d } = nearestOnLeg(q, leg);
        if (d >= clearance) continue;
        const fromEnd = Math.min(
            Math.hypot(p.x - leg.from.x, p.y - leg.from.y),
            Math.hypot(p.x - leg.to.x, p.y - leg.to.y),
        );
        if (fromEnd > endGap) crossed.push(q);
        if (crossed.length >= most) break;
    }
    return crossed;
}

/** The marchers in `obstacles` by square cells a clearance across, so a leg looks only near itself */
interface ObstacleGrid {
    readonly clearance: number;
    readonly cell: number;
    readonly cells: Map<number, XY[]>;
}
const gridCache = new WeakMap<readonly XY[], ObstacleGrid>();
const cellKey = (ix: number, iy: number) => ix * 0x100000 + iy;
function gridOf({ at, clearance }: OrderObstacles): ObstacleGrid {
    const cached = gridCache.get(at);
    if (cached && cached.clearance === clearance) return cached;
    const cell = Math.max(clearance, 1);
    const cells = new Map<number, XY[]>();
    for (const q of at) {
        const key = cellKey(Math.floor(q.x / cell), Math.floor(q.y / cell));
        const list = cells.get(key);
        if (list) list.push(q);
        else cells.set(key, [q]);
    }
    const grid = { clearance, cell, cells };
    gridCache.set(at, grid);
    return grid;
}

/** The marchers in `obstacles` within a clearance of the box `b` (and some a little further) */
function nearBox(b: Bounds, obstacles: OrderObstacles): XY[] {
    const { cell, cells } = gridOf(obstacles);
    const pad = obstacles.clearance;
    const x0 = Math.floor((b.minX - pad) / cell);
    const x1 = Math.floor((b.maxX + pad) / cell);
    const y0 = Math.floor((b.minY - pad) / cell);
    const y1 = Math.floor((b.maxY + pad) / cell);
    // A box bigger than the marchers drawn: every marcher, without looking at empty cells
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size) return [...obstacles.at];
    const near: XY[] = [];
    for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
            const list = cells.get(cellKey(x, y));
            if (list) for (const q of list) near.push(q);
        }
    return near;
}

/**
 * How far a leg must bow to `side` (1: its left, -1: its right) at its middle for its arc to pass
 * clear of `crossed`: a quadratic's offset `u` along its chord is 4 u (1 - u) of its middle's
 */
function bowToClear(
    from: XY,
    to: XY,
    side: number,
    crossed: readonly XY[],
    clearance: number,
): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length2 = dx * dx + dy * dy;
    const length = Math.sqrt(length2) || 1;
    let need = 0;
    for (const q of crossed) {
        const u = Math.min(
            0.95,
            Math.max(
                0.05,
                ((q.x - from.x) * dx + (q.y - from.y) * dy) / (length2 || 1),
            ),
        );
        // Positive: to the leg's left, the way a positive sagitta bows
        const left = ((q.x - from.x) * dy - (q.y - from.y) * dx) / length;
        need = Math.max(need, (side * left + clearance) / (4 * u * (1 - u)));
    }
    return need;
}

/**
 * The legs through `points` in order: straight, except a leg that runs back over earlier ones
 * (within `tolerance`) or over a marcher it doesn't end at (`obstacles`), which bows into a
 * gentle arc, deep enough to pass clear of the marchers it would cover. Bowed legs take sides in
 * turn; a side whose arc would still run over the line or a marcher is swapped for the other,
 * then for a deeper bow.
 */
export function orderLegs(
    points: readonly XY[],
    tolerance: number,
    obstacles?: OrderObstacles,
): OrderLeg[] {
    const legs: OrderLeg[] = [];
    let bowed = 0;
    for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!;
        const to = points[i]!;
        const straight: OrderLeg = { from, to, control: null };
        const crossed = crossedMarchers(straight, obstacles);
        if (
            crossed.length === 0 &&
            !overlapsEarlier(straight, legs, tolerance)
        ) {
            legs.push(straight);
            continue;
        }
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const gentle = Math.min(
            Math.max(BOW * length, 3 * tolerance),
            BOW_FIRST_MAX * length,
        );
        const depthTo = (side: number) =>
            Math.max(
                gentle,
                obstacles
                    ? bowToClear(from, to, side, crossed, obstacles.clearance)
                    : 0,
            );
        const side = bowed % 2 === 0 ? 1 : -1;
        bowed++;
        const tries = [
            [side, 1],
            [-side, 1],
            [side, 2],
            [-side, 2],
        ].map(([k, deeper]) =>
            bowedLeg(
                from,
                to,
                k! * Math.min(deeper! * depthTo(k!), BOW_MAX * length),
            ),
        );
        // The marchers near any of them, looked up once
        const near = obstacles
            ? nearBox(
                  tries.map(boundsOf).reduce((u, b) => ({
                      minX: Math.min(u.minX, b.minX),
                      minY: Math.min(u.minY, b.minY),
                      maxX: Math.max(u.maxX, b.maxX),
                      maxY: Math.max(u.maxY, b.maxY),
                  })),
                  obstacles,
              )
            : [];
        // The first clear of the line and the marchers; else the one covering least
        let best = tries[0]!;
        let bestCost = Infinity;
        for (const leg of tries) {
            let cost = overlapsEarlier(leg, legs, tolerance) ? 1 : 0;
            // Counted only as far as it could still beat the best so far
            if (cost < bestCost)
                cost += crossedMarchers(
                    leg,
                    obstacles,
                    bestCost - cost,
                    near,
                ).length;
            if (cost < bestCost) {
                best = leg;
                bestCost = cost;
            }
            if (cost === 0) break;
        }
        legs.push(best);
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

/** A box on screen, such as a marcher's name label */
export interface Box {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

const inBox = (p: XY, box: Box, pad: number) =>
    p.x >= box.minX - pad &&
    p.x <= box.maxX + pad &&
    p.y >= box.minY - pad &&
    p.y <= box.maxY + pad;

/** How finely a leg's end is walked to find where it leaves a label */
const LABEL_STEPS = 64;

/**
 * Where a leg trimmed to `t` at one end (its start, or its end when `fromEnd`) should stop
 * instead so it doesn't run into `box` (a name label) in its last `most` px: just clear of the
 * box, or `t` as it was when it doesn't reach the box there or still runs through it after
 */
export function trimClearOf(
    leg: OrderLeg,
    t: number,
    fromEnd: boolean,
    box: Box,
    most: number,
): number {
    const step = (fromEnd ? -1 : 1) / LABEL_STEPS;
    let prev = legPoint(leg, t);
    let walked = 0;
    let clearAt: number | null = inBox(prev, box, 0) ? null : t;
    let sawBox = clearAt === null;
    for (let u = t + step; fromEnd ? u > 0 : u < 1; u += step) {
        const p = legPoint(leg, u);
        walked += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
        if (walked > most) break;
        if (inBox(p, box, 0)) {
            sawBox = true;
            clearAt = null;
        } else if (clearAt === null) clearAt = u;
    }
    // Still in the box this far along: it runs through the label, it doesn't just end in it
    if (!sawBox || clearAt === null || inBox(prev, box, 0)) return t;
    return clearAt;
}

/** How many points round the leader's ring are checked against the labels */
const RING_STEPS = 96;

/**
 * The leader's ring round `at`, `r` across, as SVG arcs that leave out where it (its stroke
 * reaching `reach` each side) would cover a box in `boxes` (a name label): null when nothing's
 * left out, "" when nothing's left
 */
export function ringArcs(
    at: XY,
    r: number,
    reach: number,
    boxes: readonly Box[],
): string | null {
    const near = boxes.filter(
        (b) =>
            at.x + r + reach >= b.minX &&
            at.x - r - reach <= b.maxX &&
            at.y + r + reach >= b.minY &&
            at.y - r - reach <= b.maxY,
    );
    if (near.length === 0) return null;
    const angle = (i: number) => (2 * Math.PI * i) / RING_STEPS;
    const pointAt = (i: number): XY => ({
        x: at.x + r * Math.cos(angle(i)),
        y: at.y + r * Math.sin(angle(i)),
    });
    const covers = Array.from({ length: RING_STEPS }, (_, i) =>
        near.some((b) => inBox(pointAt(i), b, reach)),
    );
    if (!covers.some(Boolean)) return null;
    // A point next to one that covers a label is left out too: the box's edge lies between them
    const hidden = covers.map(
        (c, i) =>
            c ||
            covers[(i + 1) % RING_STEPS]! ||
            covers[(i + RING_STEPS - 1) % RING_STEPS]!,
    );
    const first = hidden.indexOf(true);
    const arcs: string[] = [];
    let start: number | null = null;
    for (let k = 1; k <= RING_STEPS; k++) {
        const i = first + k;
        const shown = !hidden[i % RING_STEPS];
        if (shown && start === null) start = i;
        if (!shown && start !== null) {
            const end = i - 1;
            if (end > start) {
                const a = pointAt(start);
                const b = pointAt(end);
                const large = angle(end - start) > Math.PI ? 1 : 0;
                arcs.push(
                    `M${a.x},${a.y} A${r},${r} 0 ${large} 1 ${b.x},${b.y}`,
                );
            }
            start = null;
        }
    }
    return arcs.join(" ");
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
