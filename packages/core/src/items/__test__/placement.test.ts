import { describe, expect, it } from "vitest";
import type { XY } from "../../timeline/types";
import {
    CREATED,
    crewDistances,
    crewOutOfReach,
    handConflicts,
    handsAt,
    handsNeeded,
    placementAt,
    putDowns,
    putDownDrifts,
    putDownSpot,
    type Holder,
    type ItemPlacements,
    type PlacementChange,
} from "../placement";

let nextId = 1;
const held = (
    beat: number,
    holders: Holder[],
    groupId: number | null = null,
): PlacementChange => ({
    id: nextId++,
    beat,
    state: "held",
    holders,
    crew: [],
    groupId,
});
const placed = (
    beat: number,
    crew: number[] = [],
    groupId: number | null = null,
): PlacementChange => ({
    id: nextId++,
    beat,
    state: "placed",
    holders: [],
    crew,
    groupId,
});
const offField = (
    beat: number,
    groupId: number | null = null,
): PlacementChange => ({
    id: nextId++,
    beat,
    state: "off_field",
    holders: [],
    crew: [],
    groupId,
});

// Performers
const ALICE = 1;
const BOB = 2;
const CREW_A = 3;
const CREW_B = 4;

/**
 * The fixture: a flag Alice starts the show with, put down on 8 and picked up by Bob on 16 (a
 * visible trade); a rifle Alice takes in her right hand on 4 while still holding the flag; a
 * crewed riser taken off field on 24 and back on 32; a ripple of three cones off field on 12, 13
 * and 14.
 */
const FLAG: ItemPlacements = {
    itemId: 10,
    origin: { kind: "flag", marcherId: ALICE, hand: "both" },
    changes: [placed(8), held(16, [{ marcherId: BOB, hand: "both" }])],
};
const RIFLE: ItemPlacements = {
    itemId: 11,
    changes: [held(4, [{ marcherId: ALICE, hand: "right" }])],
};
const RISER: ItemPlacements = {
    itemId: 20,
    changes: [placed(0, [CREW_A, CREW_B]), offField(24), placed(32, [CREW_A])],
};
const CONES: ItemPlacements[] = [30, 31, 32].map((itemId, i) => ({
    itemId,
    origin: { kind: "created" },
    changes: [offField(12 + i, 7)],
}));
const SHOW = [FLAG, RIFLE, RISER, ...CONES];

describe("placementAt", () => {
    it("reads a flag item as held by its original performer before its first row", () => {
        expect(placementAt(FLAG.changes, 0, FLAG.origin)).toEqual({
            state: "held",
            holders: [{ marcherId: ALICE, hand: "both" }],
            changeId: null,
            since: null,
            groupId: null,
        });
        expect(placementAt(FLAG.changes, 7.99, FLAG.origin).state).toBe("held");
    });

    it("reads a created item as placed, with no crew, before its first row", () => {
        expect(placementAt(RIFLE.changes, 3)).toMatchObject({
            state: "placed",
            crew: [],
            since: null,
        });
    });

    it("changes instantly on the click of its beat", () => {
        expect(placementAt(FLAG.changes, 8, FLAG.origin)).toMatchObject({
            state: "placed",
            crew: [],
            since: 8,
        });
        expect(placementAt(FLAG.changes, 15.5, FLAG.origin).state).toBe(
            "placed",
        );
    });

    it("hands equipment from one performer to another with a Placement change", () => {
        expect(placementAt(FLAG.changes, 16, FLAG.origin)).toMatchObject({
            state: "held",
            holders: [{ marcherId: BOB, hand: "both" }],
            since: 16,
        });
    });

    it("carries the crew of a placed change, and goes off field and back", () => {
        expect(placementAt(RISER.changes, 0)).toMatchObject({
            state: "placed",
            crew: [CREW_A, CREW_B],
        });
        expect(placementAt(RISER.changes, 23.9).state).toBe("placed");
        expect(placementAt(RISER.changes, 24)).toMatchObject({
            state: "off_field",
            since: 24,
        });
        expect(placementAt(RISER.changes, 32)).toMatchObject({
            state: "placed",
            crew: [CREW_A],
        });
    });

    it("staggers an item ripple, one row per item sharing a group id", () => {
        const at13 = CONES.map((c) => placementAt(c.changes, 13, c.origin));
        expect(at13.map((p) => p.state)).toEqual([
            "off_field",
            "off_field",
            "placed",
        ]);
        expect(at13[0]).toMatchObject({ groupId: 7, since: 12 });
        expect(at13[1]).toMatchObject({ groupId: 7, since: 13 });
    });

    it("takes the higher id of two changes on one beat", () => {
        const changes = [
            { ...placed(4), id: 101 },
            { ...offField(4), id: 100 },
        ];
        expect(placementAt(changes, 4).state).toBe("placed");
    });
});

describe("handsAt", () => {
    it("draws the newest holder of a hand and not the displaced item", () => {
        const { drawn, conflicts } = handsAt(SHOW, 6);
        expect([...drawn]).toEqual([RIFLE.itemId]);
        expect(conflicts).toEqual([
            {
                itemId: FLAG.itemId,
                byItemId: RIFLE.itemId,
                marcherId: ALICE,
                side: "right",
            },
        ]);
    });

    it("has no conflict before the newer item is taken or once the older is put down", () => {
        expect(handsAt(SHOW, 3)).toEqual({
            drawn: new Set([FLAG.itemId]),
            conflicts: [],
        });
        expect(handsAt(SHOW, 8)).toEqual({
            drawn: new Set([RIFLE.itemId]),
            conflicts: [],
        });
    });

    it("lets one performer hold an item in each hand", () => {
        const left: ItemPlacements = {
            itemId: 40,
            changes: [held(0, [{ marcherId: BOB, hand: "left" }])],
        };
        const right: ItemPlacements = {
            itemId: 41,
            changes: [held(2, [{ marcherId: BOB, hand: "right" }])],
        };
        expect(handsAt([left, right], 2)).toEqual({
            drawn: new Set([40, 41]),
            conflicts: [],
        });
    });

    it("displaces a two-holder item when either holder's hand is taken", () => {
        const banner: ItemPlacements = {
            itemId: 50,
            changes: [
                held(0, [
                    { marcherId: ALICE, hand: "left" },
                    { marcherId: BOB, hand: "right" },
                ]),
            ],
        };
        const baton: ItemPlacements = {
            itemId: 51,
            changes: [held(4, [{ marcherId: BOB, hand: "right" }])],
        };
        const { drawn, conflicts } = handsAt([banner, baton], 4);
        expect([...drawn]).toEqual([51]);
        expect(conflicts).toEqual([
            { itemId: 50, byItemId: 51, marcherId: BOB, side: "right" },
        ]);
    });

    it("lets a displaced item hold nothing, so an older item keeps its other hand", () => {
        const oldLeft: ItemPlacements = {
            itemId: 60,
            changes: [held(0, [{ marcherId: ALICE, hand: "left" }])],
        };
        const both: ItemPlacements = {
            itemId: 61,
            changes: [held(2, [{ marcherId: ALICE, hand: "both" }])],
        };
        const newRight: ItemPlacements = {
            itemId: 62,
            changes: [held(4, [{ marcherId: ALICE, hand: "right" }])],
        };
        // The both-hands item loses its right hand to the newest, and leaves the left to the oldest
        const { drawn, conflicts } = handsAt([oldLeft, both, newRight], 4);
        expect([...drawn].sort()).toEqual([60, 62]);
        expect(conflicts).toEqual([
            { itemId: 61, byItemId: 62, marcherId: ALICE, side: "right" },
        ]);
    });
});

describe("handConflicts", () => {
    it("lists each conflict with the span it lasts", () => {
        expect(handConflicts(SHOW)).toEqual([
            {
                itemId: FLAG.itemId,
                byItemId: RIFLE.itemId,
                marcherId: ALICE,
                side: "right",
                from: 4,
                until: 8,
            },
        ]);
    });

    it("leaves a conflict open to the end of the show, and starts one from the show's start", () => {
        const flags: ItemPlacements[] = [
            {
                itemId: 70,
                origin: { kind: "flag", marcherId: BOB, hand: "both" },
                changes: [],
            },
            {
                itemId: 71,
                origin: { kind: "flag", marcherId: BOB, hand: "left" },
                changes: [],
            },
        ];
        expect(handConflicts(flags)).toEqual([
            {
                itemId: 70,
                byItemId: 71,
                marcherId: BOB,
                side: "left",
                from: null,
                until: null,
            },
        ]);
    });
});

describe("crew distance", () => {
    const positions = new Map<number, XY>([
        [CREW_A, [3, 4]],
        [CREW_B, [0, 1]],
    ]);

    it("measures each crew member from the item, farthest first", () => {
        expect(crewDistances([0, 0], [CREW_B, CREW_A, 99], positions)).toEqual([
            { marcherId: CREW_A, distance: 5 },
            { marcherId: CREW_B, distance: 1 },
        ]);
    });

    it("names the crew out of reach", () => {
        expect(crewOutOfReach([0, 0], [CREW_A, CREW_B], positions, 2)).toEqual([
            { marcherId: CREW_A, distance: 5 },
        ]);
        expect(crewOutOfReach([0, 0], [], positions, 2)).toEqual([]);
    });
});

describe("handsNeeded", () => {
    it("takes the hands from the model's grips, else both", () => {
        expect(handsNeeded(null)).toBe("both");
        expect(handsNeeded({ left: false, right: false })).toBe("both");
        expect(handsNeeded({ left: true, right: true })).toBe("both");
        expect(handsNeeded({ left: false, right: true })).toBe("right");
        expect(handsNeeded({ left: true, right: false })).toBe("left");
    });
});

describe("put-down", () => {
    it("finds each held → placed change with the holders just before it", () => {
        const changes = [
            held(2, [{ marcherId: ALICE, hand: "both" }]),
            placed(6),
            offField(8),
            held(10, [
                { marcherId: ALICE, hand: "left" },
                { marcherId: BOB, hand: "right" },
            ]),
            placed(12, [CREW_A]),
            placed(14),
        ];
        expect(
            putDowns(changes).map((p) => [p.beat, p.holders.length]),
        ).toEqual([
            [6, 1],
            [12, 2],
        ]);
    });

    it("puts down a flag item's first placed change, from its original performer", () => {
        expect(putDowns(FLAG.changes, FLAG.origin)).toEqual([
            {
                changeId: FLAG.changes[0]!.id,
                beat: 8,
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        ]);
        expect(putDowns(FLAG.changes)).toEqual([]);
    });

    it("lands at the holder, or the midpoint of several", () => {
        const positions = new Map<number, XY>([
            [ALICE, [0, 0]],
            [BOB, [4, 2]],
        ]);
        expect(
            putDownSpot([{ marcherId: ALICE, hand: "both" }], positions),
        ).toEqual([0, 0]);
        expect(
            putDownSpot(
                [
                    { marcherId: ALICE, hand: "left" },
                    { marcherId: BOB, hand: "right" },
                ],
                positions,
            ),
        ).toEqual([2, 1]);
        expect(
            putDownSpot([{ marcherId: 99, hand: "both" }], positions),
        ).toBeNull();
    });
});

describe("putDownDrifts", () => {
    const ITEM_MARCHER = 100;
    const changes = [held(2, [{ marcherId: ALICE, hand: "both" }]), placed(6)];

    it("is quiet while the item is where its holder was", () => {
        const at = () => [3, 4] as XY;
        expect(putDownDrifts(changes, CREATED, ITEM_MARCHER, at)).toEqual([]);
    });

    it("names a put-down once the holder's drill moved", () => {
        const at = (id: number): XY => (id === ALICE ? [6, 8] : [3, 4]);
        expect(putDownDrifts(changes, CREATED, ITEM_MARCHER, at)).toEqual([
            {
                changeId: changes[1]!.id,
                beat: 6,
                holders: [{ marcherId: ALICE, hand: "both" }],
                spot: [6, 8],
                at: [3, 4],
                distance: 5,
            },
        ]);
    });
});
