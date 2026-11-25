import { fitCircle } from "./geometry/fit";
import { leastTravel, type LeastTravelSolver } from "./leastTravel";
import type { AnyShapeKind, ShapeContext, Slot, XY } from "./types";

/**
 * Which marcher goes to which slot. The tool assigns once when it opens (or when the order mode
 * changes) and keeps that assignment while handles are dragged, so marchers don't swap spots
 * under the cursor. Reassigning is explicit.
 */

export type OrderMode =
    /** Least travel (see `leastTravel.ts`), so straight moves don't pass through each other */
    | "nearest"
    /** Marchers keep their order along the shape (their current order projected onto it) */
    | "keep"
    /** Keep order with each half of the marchers' order flipped: the middle goes to the ends */
    | "inside"
    /** Two lines merge, taking turns along the shape: first of one, first of the other, ... */
    | "zipper"
    /** Each section takes a run of spots along the shape together, Least travel inside it */
    | "sections";

/**
 * Who goes where as the floating editor offers it on a kind with an order along it (a Line, #528):
 * Least travel, Keep order, Reverse order (Keep order the other way round), Inside out, Zipper or
 * Within sections (docs/timeline/research/shapes/09-who-goes-where.md). Stored as a recipe's
 * order mode and reverse ({@link orderFields}).
 */
export type OrderChoice =
    | "nearest"
    | "keep"
    | "reverse"
    | "inside"
    | "zipper"
    | "sections";

/** Every choice, in the menu's order */
export const ORDER_CHOICES: readonly OrderChoice[] = [
    "nearest",
    "keep",
    "reverse",
    "inside",
    "zipper",
    "sections",
];

/** Who goes where on a kind: its choice when it has an order along it (a Line), Least travel otherwise */
export const orderOn = (
    kind: { readonly ordered?: boolean },
    choice: OrderChoice,
): OrderChoice => (kind.ordered ? choice : "nearest");

/** A choice as a recipe stores it */
export const orderFields = (
    choice: OrderChoice,
): { orderMode: OrderMode; reverse: boolean } =>
    choice === "keep" || choice === "reverse"
        ? { orderMode: "keep", reverse: choice === "reverse" }
        : { orderMode: choice, reverse: false };

/**
 * A recipe's order mode and reverse as a choice; anything older (drill order) is Least travel.
 * Least travel has no order, so a reverse stored with it is ignored here, and the Line's next save
 * writes it back as false ({@link orderFields}).
 */
export const orderChoiceOf = (
    orderMode: string,
    reverse: boolean,
): OrderChoice =>
    orderMode === "keep"
        ? reverse
            ? "reverse"
            : "keep"
        : orderMode === "inside" ||
            orderMode === "zipper" ||
            orderMode === "sections"
          ? orderMode
          : "nearest";

export interface AssignMarcher {
    readonly id: number;
    /** Where the marcher is drawn now, at the moment being edited: what a shape fits through */
    readonly at: XY;
    /**
     * Where the marcher starts the move being edited (its position at the start flag), when that
     * differs from `at`. Who goes where is decided from here, so the move reads cleanly from where
     * marchers really come from, not from the spots the edit replaces.
     */
    readonly from?: XY;
    /** Sort position by drill number (drill prefix, then number): breaks ties in keep order */
    readonly drillRank: number;
    /**
     * The marcher's place along the placed Line it comes from (its slot there), when every marcher
     * being assigned is a member of that one Line: keep order follows it (#528)
     */
    readonly along?: number;
    /**
     * Which of two lines the marcher comes from (0 or 1), when every marcher being assigned comes
     * from one of exactly two lines with an order: `along` is then its place along that line.
     * Zipper takes them in turn.
     */
    readonly lane?: number;
    /** The marcher's section, which Within sections keeps together */
    readonly section?: string;
}

/** Above this many marchers, nearest falls back to keep order (the solve is cubic). */
export const NEAREST_LIMIT = 500;

const compareKeys = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
};

/**
 * @returns the slot index for each marcher, in `marchers` order
 */
export function assignSlots<P>({
    kind,
    params,
    slots,
    marchers,
    mode,
    reverse = false,
    ctx,
    solve = leastTravel,
}: {
    kind: AnyShapeKind;
    params: P;
    slots: readonly Slot[];
    marchers: readonly AssignMarcher[];
    mode: OrderMode;
    reverse?: boolean;
    ctx: ShapeContext;
    /** Replaces how "nearest" decides who goes where (defaults to `leastTravel`) */
    solve?: LeastTravelSolver;
}): number[] {
    const n = marchers.length;
    if (slots.length !== n)
        throw new Error("Each marcher needs exactly one slot");
    if (n === 0) return [];

    if (mode === "nearest" && n <= NEAREST_LIMIT)
        return solve(
            marchers.map((m) => m.from ?? m.at),
            slots,
        );

    if (mode === "inside") {
        const pairs = orderedPairs(kind, params, slots, marchers, ctx);
        return laidOn(halvesFlipped(pairs.marchers), pairs.slots, n);
    }

    if (mode === "zipper") {
        const lanes = zipperLanes(marchers);
        const pairs = orderedPairs(kind, params, slots, marchers, ctx);
        return laidOn(lanes ?? pairs.marchers, pairs.slots, n);
    }

    if (mode === "sections")
        return bySections(kind, params, slots, marchers, ctx, solve);

    // One line's order kept; marchers from two lines (Zipper's) go by where they stand, as before
    if (
        mode === "keep" &&
        marchers.every((m) => m.along !== undefined && m.lane === undefined)
    )
        return alongOrder(marchers, slots, reverse);

    if (mode === "keep") {
        const around = ringOrder(marchers);
        if (around)
            return openRing(
                around,
                marchers,
                slots,
                kind,
                params,
                ctx,
                reverse,
            );
    }

    const slotOrder = slots
        .map((slot, index) => ({
            index,
            key: kind.orderKey(params, slot, ctx, n),
        }))
        .sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
        .map((entry) => entry.index);
    if (reverse) slotOrder.reverse();

    const marcherOrder = marchers
        .map((m, index) => ({
            index,
            key: kind.orderKey(params, m.from ?? m.at, ctx, n),
            rank: m.drillRank,
        }))
        .sort((a, b) => compareKeys(a.key, b.key) || a.rank - b.rank)
        .map((entry) => entry.index);

    const result = new Array<number>(n);
    marcherOrder.forEach((marcherIndex, i) => {
        result[marcherIndex] = slotOrder[i]!;
    });
    return result;
}

/** `marchers[k]` (by index) goes to `slots[k]`: the slot for each marcher, in marchers order */
function laidOn(
    marcherOrder: readonly number[],
    slotOrder: readonly number[],
    n: number,
): number[] {
    const result = new Array<number>(n);
    marcherOrder.forEach((marcherIndex, k) => {
        result[marcherIndex] = slotOrder[k]!;
    });
    return result;
}

/**
 * The marchers in their order (along the line they come from, or else projected onto the shape)
 * and the spots in the shape's order, both by index: Keep order lays the one on the other
 */
function orderedPairs<P>(
    kind: AnyShapeKind,
    params: P,
    slots: readonly Slot[],
    marchers: readonly AssignMarcher[],
    ctx: ShapeContext,
): { marchers: number[]; slots: number[] } {
    const n = marchers.length;
    if (marchers.every((m) => m.along !== undefined))
        return {
            marchers: marchers
                .map((m, index) => ({
                    index,
                    along: m.along! + (m.lane ?? 0) * n,
                    rank: m.drillRank,
                }))
                .sort((a, b) => a.along - b.along || a.rank - b.rank)
                .map((e) => e.index),
            slots: slots
                .map((slot, index) => ({ index, s: slot.s ?? index }))
                .sort((a, b) => a.s - b.s || a.index - b.index)
                .map((e) => e.index),
        };
    return {
        marchers: marchers
            .map((m, index) => ({
                index,
                key: kind.orderKey(params, m.from ?? m.at, ctx, n),
                rank: m.drillRank,
            }))
            .sort((a, b) => compareKeys(a.key, b.key) || a.rank - b.rank)
            .map((e) => e.index),
        slots: slots
            .map((slot, index) => ({
                index,
                key: kind.orderKey(params, slot, ctx, n),
            }))
            .sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
            .map((e) => e.index),
    };
}

/**
 * An order with each half flipped, its middle (if odd) kept: the middle of a line goes to the ends
 * of the shape it's laid on, and its ends meet in the middle (Inside out)
 */
export function halvesFlipped<T>(order: readonly T[]): T[] {
    const h = Math.floor(order.length / 2);
    return [
        ...order.slice(0, h).reverse(),
        ...order.slice(h, order.length - h),
        ...order.slice(order.length - h).reverse(),
    ];
}

/**
 * Two lines' marchers taking turns (Zipper), by index: the first of lane 0, the first of lane 1,
 * the second of lane 0, ..., the longer line's rest at the end. Null unless every marcher is on one
 * of two lanes with a place along it.
 */
function zipperLanes(marchers: readonly AssignMarcher[]): number[] | null {
    if (!marchers.every((m) => m.lane !== undefined && m.along !== undefined))
        return null;
    const lane = (l: number) =>
        marchers
            .map((m, index) => ({ m, index }))
            .filter((e) => e.m.lane === l)
            .sort(
                (a, b) =>
                    a.m.along! - b.m.along! || a.m.drillRank - b.m.drillRank,
            )
            .map((e) => e.index);
    const a = lane(0);
    const b = lane(1);
    if (a.length === 0 || b.length === 0) return null;
    const out: number[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length) out.push(a[i]!);
        if (i < b.length) out.push(b[i]!);
    }
    return out;
}

/**
 * Within sections: the sections take runs of the shape's spots in its order, in the order they come
 * in along the line (or as they stand, projected onto the shape), and each section's marchers fill
 * its run by least travel
 */
function bySections<P>(
    kind: AnyShapeKind,
    params: P,
    slots: readonly Slot[],
    marchers: readonly AssignMarcher[],
    ctx: ShapeContext,
    solve: LeastTravelSolver,
): number[] {
    const n = marchers.length;
    const pairs = orderedPairs(kind, params, slots, marchers, ctx);
    const place = new Map(pairs.marchers.map((index, k) => [index, k]));
    const sections = new Map<string, number[]>();
    marchers.forEach((m, index) => {
        const key = m.section ?? "";
        sections.set(key, [...(sections.get(key) ?? []), index]);
    });
    const mean = (indexes: readonly number[]) =>
        indexes.reduce((sum, i) => sum + place.get(i)!, 0) / indexes.length;
    const runs = [...sections.values()].sort((a, b) => mean(a) - mean(b));
    const result = new Array<number>(n);
    let k = 0;
    for (const run of runs) {
        const runSlots = pairs.slots.slice(k, k + run.length);
        const picked = solve(
            run.map((i) => marchers[i]!.from ?? marchers[i]!.at),
            runSlots.map((s) => slots[s]!),
        );
        run.forEach((marcherIndex, j) => {
            result[marcherIndex] = runSlots[picked[j]!]!;
        });
        k += run.length;
    }
    return result;
}

/**
 * Hand picks laid over an assignment (who goes where picked by hand, and Swap): each pinned marcher
 * (by index) takes its pinned slot; everyone else keeps their slot unless a pin took it, and those
 * bumped share the slots left by least travel. Later pins win: a pin on a marcher or slot already
 * pinned replaces the earlier one.
 *
 * @returns the slot for each marcher, in marchers order, and which marchers were bumped
 */
export function withPins(
    assignment: readonly number[],
    pins: readonly (readonly [marcherIndex: number, slot: number])[],
    from: readonly XY[],
    slots: readonly XY[],
    solve: LeastTravelSolver = leastTravel,
): { assignment: number[]; bumped: number[] } {
    const pinned = new Map<number, number>();
    const slotOwner = new Map<number, number>();
    for (const [m, s] of pins) {
        if (m >= assignment.length || s >= slots.length) continue;
        const was = slotOwner.get(s);
        if (was !== undefined && was !== m) pinned.delete(was);
        const old = pinned.get(m);
        if (old !== undefined) slotOwner.delete(old);
        pinned.set(m, s);
        slotOwner.set(s, m);
    }
    const result = assignment.slice();
    const taken = new Set(pinned.values());
    const bumped: number[] = [];
    assignment.forEach((slot, m) => {
        const pin = pinned.get(m);
        if (pin !== undefined) result[m] = pin;
        else if (taken.has(slot)) bumped.push(m);
    });
    if (bumped.length > 0) {
        const used = new Set(result.filter((_, m) => !bumped.includes(m)));
        const free = slots.map((_, s) => s).filter((s) => !used.has(s));
        const picked = solve(
            bumped.map((m) => from[m]!),
            free.map((s) => slots[s]!),
        );
        bumped.forEach((m, j) => {
            result[m] = free[picked[j]!]!;
        });
    }
    return { assignment: result, bumped };
}

/** How many pairs of straight walks cross each other (a readout, never a rule) */
export function crossings(
    walks: readonly { readonly from: XY; readonly to: XY }[],
): number {
    const side = (a: XY, b: XY, c: XY) =>
        Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    let count = 0;
    for (let i = 0; i < walks.length; i++)
        for (let j = i + 1; j < walks.length; j++) {
            const p = walks[i]!;
            const q = walks[j]!;
            if (
                side(p.from, p.to, q.from) * side(p.from, p.to, q.to) < 0 &&
                side(q.from, q.to, p.from) * side(q.from, q.to, p.to) < 0
            )
                count++;
        }
    return count;
}

/**
 * Marchers in their order along the Line they come from, laid on the spots in the shape's order:
 * how far along a path each spot is when it says, the kind's order otherwise
 */
function alongOrder(
    marchers: readonly AssignMarcher[],
    slots: readonly Slot[],
    reverse: boolean,
): number[] {
    const slotOrder = slots
        .map((slot, index) => ({ index, s: slot.s ?? index }))
        .sort((a, b) => a.s - b.s || a.index - b.index)
        .map((entry) => entry.index);
    if (reverse) slotOrder.reverse();
    const result = new Array<number>(marchers.length);
    marchers
        .map((m, index) => ({ index, along: m.along!, rank: m.drillRank }))
        .sort((a, b) => a.along - b.along || a.rank - b.rank)
        .forEach((entry, i) => {
            result[entry.index] = slotOrder[i]!;
        });
    return result;
}

/** How round a group must be (largest gap from its circle, over the radius) to count as a ring */
const RING_TOLERANCE = 0.15;

/**
 * The marchers in order around the circle they stand on, when they do (5 or more, all near one
 * circle), by index. Keep order then follows the ring rather than projecting the marchers onto
 * the new shape, which scrambles a circle opened into an arc (sims, round 9: "151 crossings";
 * a drill writer expects the circle to peel open in order).
 */
function ringOrder(marchers: readonly AssignMarcher[]): number[] | null {
    if (marchers.length < 5) return null;
    const points = marchers.map((m) => m.from ?? m.at);
    const circle = fitCircle(points);
    if (!circle || !(circle.r > 0)) return null;
    const off = Math.max(
        ...points.map((p) =>
            Math.abs(
                Math.hypot(p.x - circle.center.x, p.y - circle.center.y) -
                    circle.r,
            ),
        ),
    );
    if (off > RING_TOLERANCE * circle.r) return null;
    return points
        .map((p, index) => ({
            index,
            angle: Math.atan2(p.y - circle.center.y, p.x - circle.center.x),
        }))
        .sort((a, b) => a.angle - b.angle)
        .map((e) => e.index);
}

/**
 * Lays a ring of marchers along the shape's slot order, keeping their order around the ring:
 * the ring is opened where the least travel results, in whichever direction travels less
 * (Reverse takes the other direction).
 */
function openRing<P>(
    around: readonly number[],
    marchers: readonly AssignMarcher[],
    slots: readonly Slot[],
    kind: AnyShapeKind,
    params: P,
    ctx: ShapeContext,
    reverse: boolean,
): number[] {
    const n = marchers.length;
    const slotOrder = slots
        .map((slot, index) => ({
            index,
            key: kind.orderKey(params, slot, ctx, n),
        }))
        .sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
        .map((entry) => entry.index);
    const at = marchers.map((m) => m.from ?? m.at);
    const best = (direction: 1 | -1) => {
        let bestStart = 0;
        let bestCost = Infinity;
        for (let start = 0; start < n; start++) {
            let cost = 0;
            for (let i = 0; i < n && cost < bestCost; i++) {
                const m = at[around[(start + direction * i + n * n) % n]!]!;
                const s = slots[slotOrder[i]!]!;
                cost += (m.x - s.x) ** 2 + (m.y - s.y) ** 2;
            }
            if (cost < bestCost) {
                bestCost = cost;
                bestStart = start;
            }
        }
        return { direction, start: bestStart, cost: bestCost };
    };
    const forward = best(1);
    const backward = best(-1);
    const [first, second] =
        forward.cost <= backward.cost
            ? [forward, backward]
            : [backward, forward];
    const pick = reverse ? second : first;
    const result = new Array<number>(n);
    for (let i = 0; i < n; i++)
        result[around[(pick.start + pick.direction * i + n * n) % n]!] =
            slotOrder[i]!;
    return result;
}
