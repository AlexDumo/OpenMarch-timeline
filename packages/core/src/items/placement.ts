/**
 * Where an item is, count by count: its Placement (ADR 0002 D-10, props-spec section 4).
 *
 * Placement is a sparse list of changes keyed by beat. The value on a count is the latest change
 * at or before it; a change is instant, in place on the click of its beat, with no transition.
 * Before an item's first change it is placed at its own position; before its creation count it is
 * Off field, which comes from its Outline alone (`itemGeometryAt` is null there). Nothing about
 * where an item came from is stored: an item that comes from a flag gets an explicit held change
 * on its first beat, held by its original performer.
 *
 * Equipment a Carry cue gives a performer (ADR 0004) takes their hands too: an item held in a
 * hand their Carry fills is a hand conflict, and Carry keeps the hand.
 *
 * Moments are beat positions, fractional between clicks, as in `itemGeometryAt`. Everything here
 * is pure: performer positions come in from the timeline resolver.
 */
import type { XY } from "../timeline/types";
import type { PerformerCarry } from "../cues/types";

/** The hand a performer holds an item with; `both` takes the two. */
export type Hand = "left" | "right" | "both";
/** One hand, as hand conflicts are counted */
export type Side = "left" | "right";

export type PlacementState = "held" | "placed" | "off_field";

export interface Holder {
    marcherId: number;
    hand: Hand;
}

/** One row of `item_placements` with its performers, its beat as a position. */
export interface PlacementChange {
    /** The row id: of two changes on one beat with the same rank, the higher id is newer */
    id: number;
    /** The position of the beat the change is on */
    beat: number;
    /** Of two changes on one beat, the higher rank is newer (`beat_rank`); 0 when left out */
    rank?: number;
    state: PlacementState;
    /** Held: one or more, each with a hand. Empty otherwise. */
    holders: readonly Holder[];
    /** Placed: the optional Crew, by marcher id. Empty otherwise. */
    crew: readonly number[];
    /** Item ripple: the rows of one ripple share a group id */
    groupId: number | null;
}

interface PlacementBase {
    /** The change in effect, or null before the item's first change */
    changeId: number | null;
    /** The position of the change in effect, or null before the item's first change */
    since: number | null;
    groupId: number | null;
}

export type Placement =
    | (PlacementBase & { state: "held"; holders: readonly Holder[] })
    | (PlacementBase & { state: "placed"; crew: readonly number[] })
    | (PlacementBase & { state: "off_field" });

/**
 * The hand an item needs from its model's grips (`OM_grip_L`, `OM_grip_R`): one grip is that
 * hand, two grips or none (or no model) is both.
 */
export function handsNeeded(
    grips: { left: boolean; right: boolean } | null | undefined,
): Hand {
    if (grips?.left && !grips.right) return "left";
    if (grips?.right && !grips.left) return "right";
    return "both";
}

/** Newest first: the later beat, then the higher rank, then the higher id. */
const compareNewest = (a: PlacementChange, b: PlacementChange) =>
    b.beat - a.beat || (b.rank ?? 0) - (a.rank ?? 0) || b.id - a.id;

const newerThan = (a: PlacementChange, b: PlacementChange) =>
    compareNewest(a, b) < 0;

/** Before its first change an item is placed at its own position. */
const BEFORE_FIRST_CHANGE: Placement = {
    state: "placed",
    crew: [],
    changeId: null,
    since: null,
    groupId: null,
};

const fromChange = (c: PlacementChange): Placement => {
    const base = { changeId: c.id, since: c.beat, groupId: c.groupId };
    switch (c.state) {
        case "held":
            return { ...base, state: "held", holders: c.holders };
        case "placed":
            return { ...base, state: "placed", crew: c.crew };
        default:
            return { ...base, state: "off_field" };
    }
};

/** The change in effect at `position`: the newest at or before it. */
export function placementChangeAt(
    changes: readonly PlacementChange[],
    position: number,
): PlacementChange | null {
    let current: PlacementChange | null = null;
    for (const c of changes) {
        if (c.beat <= position && (!current || newerThan(c, current)))
            current = c;
    }
    return current;
}

/** The item's Placement at `position`. */
export function placementAt(
    changes: readonly PlacementChange[],
    position: number,
): Placement {
    const current = placementChangeAt(changes, position);
    return current ? fromChange(current) : BEFORE_FIRST_CHANGE;
}

/** One item's Placement changes, for the show-wide lookups. */
export interface ItemPlacements {
    itemId: number;
    changes: readonly PlacementChange[];
    /** The hands it takes to hold (`handsNeeded`), for `shortHandedHolds`; both when left out */
    needs?: Hand;
}

/**
 * What a Carry cue gives a performer from a position on (ADR 0004): the hands its equipment
 * takes, or null for nothing. The latest at or before a position applies.
 */
export interface CarryChange {
    marcherId: number;
    /** A position in the same units as `PlacementChange.beat` */
    beat: number;
    hands: Hand | null;
}

/**
 * The hands what a Carry cue gives takes: a sabre one hand (the right), a horn, drum, flag or
 * rifle both, and nothing none.
 */
export function carryHands(holds: PerformerCarry): Hand | null {
    switch (holds) {
        case "none":
            return null;
        case "sabre":
            return "right";
        default:
            return "both";
    }
}

/** Each performer's Carry hands at `position`, for the performers that carry something. */
const carriedAt = (
    carries: readonly CarryChange[],
    position: number,
): Map<number, Hand> => {
    const latest = new Map<number, CarryChange>();
    for (const c of carries) {
        if (c.beat > position) continue;
        const current = latest.get(c.marcherId);
        if (!current || c.beat >= current.beat) latest.set(c.marcherId, c);
    }
    const out = new Map<number, Hand>();
    for (const [marcherId, c] of latest)
        if (c.hands) out.set(marcherId, c.hands);
    return out;
};

/** An item not drawn because a newer Placement, or the performer's Carry, took a holder's hand. */
export interface HandConflict {
    /** The item not drawn */
    itemId: number;
    /** The item drawn in its place, or null when the performer's Carry equipment has the hand */
    byItemId: number | null;
    marcherId: number;
    side: Side;
}

export interface HandsAt {
    /** Held items drawn */
    drawn: ReadonlySet<number>;
    /** Held items not drawn, one entry per hand lost */
    conflicts: HandConflict[];
}

const sidesOf = (hand: Hand): Side[] =>
    hand === "both" ? ["left", "right"] : [hand];

/**
 * Who holds what at `position`. Hand conflicts are allowed. Equipment a Carry cue gives a
 * performer (`carries`) takes its hands first. Then the newest Placement (latest beat, then
 * highest rank, then highest id) takes over its hands and is drawn, and an item that has lost any
 * hand isn't drawn and holds nothing while the conflict lasts. Items that aren't held are not in
 * `drawn`.
 */
export function handsAt(
    items: readonly ItemPlacements[],
    position: number,
    carries: readonly CarryChange[] = [],
): HandsAt {
    const held = items
        .map((item) => ({
            itemId: item.itemId,
            current: placementChangeAt(item.changes, position),
            placement: placementAt(item.changes, position),
        }))
        .filter(
            (
                h,
            ): h is {
                itemId: number;
                current: PlacementChange;
                placement: Extract<Placement, { state: "held" }>;
            } => h.placement.state === "held",
        )
        // Newest first; a held placement always has its change
        .sort(
            (a, b) =>
                compareNewest(a.current, b.current) || b.itemId - a.itemId,
        );

    const owner = new Map<string, number | null>();
    for (const [marcherId, hand] of carriedAt(carries, position))
        for (const side of sidesOf(hand))
            owner.set(`${marcherId}:${side}`, null);
    const drawn = new Set<number>();
    const conflicts: HandConflict[] = [];
    for (const { itemId, placement } of held) {
        const wanted = placement.holders.flatMap((h) =>
            sidesOf(h.hand).map((side) => ({ marcherId: h.marcherId, side })),
        );
        const lost = wanted.filter((w) =>
            owner.has(`${w.marcherId}:${w.side}`),
        );
        if (lost.length > 0) {
            for (const w of lost)
                conflicts.push({
                    itemId,
                    byItemId: owner.get(`${w.marcherId}:${w.side}`) ?? null,
                    marcherId: w.marcherId,
                    side: w.side,
                });
            continue;
        }
        for (const w of wanted) owner.set(`${w.marcherId}:${w.side}`, itemId);
        drawn.add(itemId);
    }
    return { drawn, conflicts };
}

/** A hand conflict over a span of the show, for the notes list. */
export interface HandConflictSpan extends HandConflict {
    /** Where it starts: the position of the change that caused it, or null from the show's start */
    from: number | null;
    /** Where it ends, or null if it lasts to the end of the show */
    until: number | null;
}

const conflictKey = (c: HandConflict) =>
    `${c.itemId}:${c.byItemId}:${c.marcherId}:${c.side}`;

/**
 * Every hand conflict in the show, each with the span it lasts, Carry's equipment included.
 * Placement changes and Carry cues are instant, so conflicts start and end only on their counts.
 */
export function handConflicts(
    items: readonly ItemPlacements[],
    carries: readonly CarryChange[] = [],
): HandConflictSpan[] {
    const positions = [
        ...new Set([
            ...items.flatMap((i) => i.changes.map((c) => c.beat)),
            ...carries.map((c) => c.beat),
        ]),
    ].sort((a, b) => a - b);
    const open = new Map<string, HandConflictSpan>();
    const spans: HandConflictSpan[] = [];
    for (const position of [-Infinity, ...positions]) {
        const now = new Map(
            handsAt(items, position, carries).conflicts.map(
                (c) => [conflictKey(c), c] as const,
            ),
        );
        for (const [key, span] of open) {
            if (!now.has(key)) {
                span.until = position;
                open.delete(key);
            }
        }
        for (const [key, c] of now) {
            if (open.has(key)) continue;
            const span: HandConflictSpan = {
                ...c,
                from: position === -Infinity ? null : position,
                until: null,
            };
            open.set(key, span);
            spans.push(span);
        }
    }
    return spans;
}

/** A held change whose holders don't have the hands the item takes, for the notes list. */
export interface ShortHandedHold {
    itemId: number;
    changeId: number;
    /** The change's position */
    from: number;
    /** The item's next change, or null if the hold lasts to the end of the show */
    until: number | null;
    /** How many hands it takes (`needs`: one, or two for both) */
    needed: number;
    /** How many its holders give */
    held: number;
}

/**
 * Every held change whose holders give fewer hands than the item takes: a two-hand riser held by
 * one performer's one hand, for instance once the other holder is deleted (the change stays
 * held). Hands are counted, not matched to the model's grips.
 */
export function shortHandedHolds(
    items: readonly ItemPlacements[],
): ShortHandedHold[] {
    const out: ShortHandedHold[] = [];
    for (const item of items) {
        const needed = sidesOf(item.needs ?? "both").length;
        const ordered = [...item.changes].sort((a, b) => compareNewest(b, a));
        ordered.forEach((change, i) => {
            if (change.state !== "held") return;
            const held = change.holders.reduce(
                (n, h) => n + sidesOf(h.hand).length,
                0,
            );
            if (held >= needed) return;
            // A newer change on the same beat replaces this one
            if (ordered[i + 1]?.beat === change.beat) return;
            const next = ordered.slice(i + 1).find((c) => c.beat > change.beat);
            out.push({
                itemId: item.itemId,
                changeId: change.id,
                from: change.beat,
                until: next?.beat ?? null,
                needed,
                held,
            });
        });
    }
    return out;
}

/** How far one crew member is from the item. */
export interface CrewDistance {
    marcherId: number;
    distance: number;
}

/**
 * How far each crew member is from the item at a moment, farthest first. Positions are the
 * resolver's, in one unit; crew with no position are left out.
 */
export function crewDistances(
    itemPosition: XY,
    crew: readonly number[],
    positions: ReadonlyMap<number, XY>,
): CrewDistance[] {
    const out: CrewDistance[] = [];
    for (const marcherId of crew) {
        const p = positions.get(marcherId);
        if (!p) continue;
        out.push({
            marcherId,
            distance: Math.hypot(
                p[0] - itemPosition[0],
                p[1] - itemPosition[1],
            ),
        });
    }
    return out.sort((a, b) => b.distance - a.distance);
}

/** The crew farther than `reach` from the item, farthest first: what a crew-distance note names. */
export function crewOutOfReach(
    itemPosition: XY,
    crew: readonly number[],
    positions: ReadonlyMap<number, XY>,
    reach: number,
): CrewDistance[] {
    return crewDistances(itemPosition, crew, positions).filter(
        (d) => d.distance > reach,
    );
}
