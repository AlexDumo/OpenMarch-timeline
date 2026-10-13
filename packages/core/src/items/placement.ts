/**
 * Where an item is, count by count: its Placement (ADR 0002 D-10, props-spec section 4).
 *
 * Placement is a sparse list of changes keyed by beat. The value on a count is the latest change
 * at or before it; a change is instant, in place on the click of its beat, with no transition.
 * Before an item's first change it reads as its origin says: a created item is placed at its own
 * position (Off field before its creation count comes from its Outline, `itemGeometryAt`), and an
 * item that came from a flag is held by its original performer.
 *
 * Moments are beat positions, fractional between clicks, as in `itemGeometryAt`. Everything here
 * is pure: performer positions come in from the timeline resolver.
 */
import type { XY } from "../timeline/types";

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
    /** The row id: of two changes on one beat, the higher id is newer */
    id: number;
    /** The position of the beat the change is on */
    beat: number;
    state: PlacementState;
    /** Held: one or more, each with a hand. Empty otherwise. */
    holders: readonly Holder[];
    /** Placed: the optional Crew, by marcher id. Empty otherwise. */
    crew: readonly number[];
    /** Item ripple: the rows of one ripple share a group id */
    groupId: number | null;
}

/** How an item reads before its first Placement change. */
export type ItemOrigin =
    | { kind: "created" }
    | { kind: "flag"; marcherId: number; hand: Hand };

export const CREATED: ItemOrigin = { kind: "created" };

interface PlacementBase {
    /** The change in effect, or null while the origin applies */
    changeId: number | null;
    /** The position of the change in effect, or null while the origin applies */
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

const newerThan = (a: PlacementChange, b: PlacementChange) =>
    a.beat > b.beat || (a.beat === b.beat && a.id > b.id);

const fromOrigin = (origin: ItemOrigin): Placement =>
    origin.kind === "flag"
        ? {
              state: "held",
              holders: [{ marcherId: origin.marcherId, hand: origin.hand }],
              changeId: null,
              since: null,
              groupId: null,
          }
        : {
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
    origin: ItemOrigin = CREATED,
): Placement {
    const current = placementChangeAt(changes, position);
    return current ? fromChange(current) : fromOrigin(origin);
}

/** One item's Placement changes, for the show-wide lookups. */
export interface ItemPlacements {
    itemId: number;
    changes: readonly PlacementChange[];
    origin?: ItemOrigin;
}

/** An item not drawn because a newer Placement took one of its holder's hands. */
export interface HandConflict {
    /** The item not drawn */
    itemId: number;
    /** The item drawn in its place */
    byItemId: number;
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
 * Who holds what at `position`. Hand conflicts are allowed: the newest Placement (latest beat,
 * then highest id; an origin is older than any change) takes over its hands and is drawn, and an
 * item that has lost any hand isn't drawn and holds nothing while the conflict lasts. Items that
 * aren't held are not in `drawn`.
 */
export function handsAt(
    items: readonly ItemPlacements[],
    position: number,
): HandsAt {
    const held = items
        .map((item) => ({
            itemId: item.itemId,
            placement: placementAt(item.changes, position, item.origin),
        }))
        .filter(
            (
                h,
            ): h is {
                itemId: number;
                placement: Extract<Placement, { state: "held" }>;
            } => h.placement.state === "held",
        )
        // Newest first
        .sort(
            (a, b) =>
                (b.placement.since ?? -Infinity) -
                    (a.placement.since ?? -Infinity) ||
                (b.placement.changeId ?? -Infinity) -
                    (a.placement.changeId ?? -Infinity) ||
                b.itemId - a.itemId,
        );

    const owner = new Map<string, number>();
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
                    byItemId: owner.get(`${w.marcherId}:${w.side}`)!,
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
 * Every hand conflict in the show, each with the span it lasts. Placement changes are instant,
 * so conflicts start and end only on change counts.
 */
export function handConflicts(
    items: readonly ItemPlacements[],
): HandConflictSpan[] {
    const positions = [
        ...new Set(items.flatMap((i) => i.changes.map((c) => c.beat))),
    ].sort((a, b) => a - b);
    const open = new Map<string, HandConflictSpan>();
    const spans: HandConflictSpan[] = [];
    for (const position of [-Infinity, ...positions]) {
        const now = new Map(
            handsAt(items, position).conflicts.map(
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
