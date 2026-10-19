import { describe, expect } from "vitest";
import { count } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
    handConflicts,
    handsAt,
    placementAt,
    shortHandedHolds,
} from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { performUndo } from "../history";
import { createItems, type NewItemArgs } from "../items";
import { deleteMarchers } from "../marcher";
import { deleteBeatsCarryingCues } from "../beat";
import { readShowTiming } from "@/timeline/showTiming";
import { _replaceAllBeatObjects } from "@/components/timeline/audio/EditableAudioPlayerUtils";
import Measure from "@/global/classes/Measure";
import {
    createItemPlacementRipple,
    deleteItemPlacementGroup,
    deleteItemPlacements,
    getItemPlacements,
    moveItemPlacementGroup,
    rippleBeatIds,
    setItemPlacement,
    setItemPlacementGroup,
    toPlacementChanges,
} from "../itemPlacements";

// Performers in the marchersAndPages fixture
const ALICE = 1;
const BOB = 2;
const CREW_A = 3;
const CREW_B = 4;

const beatsInOrder = async (db: DbConnection) =>
    db
        .select({ id: schema.beats.id, position: schema.beats.position })
        .from(schema.beats)
        .orderBy(schema.beats.position)
        .all();

const item = (
    kind: "prop" | "equipment",
    name: string,
    beatId: number,
): NewItemArgs => ({
    kind,
    name,
    surfaceType: kind === "prop" ? "platform" : undefined,
    home: [0, 0],
    beatId,
    geometry: { outlineType: "rectangle", width: 1, depth: 1 },
});

/** Each Placement change's item and beat time, in seconds. */
const placementTimes = async (db: DbConnection) => {
    const { beats } = await readShowTiming(db);
    const at = new Map(beats.map((b) => [b.id, b.timestamp]));
    return (await getItemPlacements({ db })).map((p) => [
        p.itemId,
        at.get(p.beatId),
    ]);
};

const rows = async (db: DbConnection, table: SQLiteTable) =>
    (await db.select({ c: count() }).from(table).get())?.c;

/** Timeline mode, a flag and a riser created on the first beat, and the beat ids by count. */
const setUp = async (db: DbConnection) => {
    const beats = await beatsInOrder(db);
    const beat = (n: number) => beats[n]!.id;
    const [flag, riser, rifle] = await createItems({
        db,
        newItems: [
            item("equipment", "Flag", beat(0)),
            item("prop", "Riser", beat(0)),
            item("equipment", "Rifle", beat(0)),
        ],
    });
    return {
        beat,
        positions: new Map(beats.map((b) => [b.id, b.position])),
        flag: flag!,
        riser: riser!,
        rifle: rifle!,
    };
};

describeDbTests("itemPlacements", (it) => {
    const testWithHistory = getTestWithHistory(it, [
        schema.items,
        schema.item_placements,
        schema.item_placement_marchers,
    ]);

    describe("setItemPlacement", () => {
        testWithHistory(
            "holds, puts down and trades an item, each a change on its beat",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, flag } = await setUp(db);

                await setItemPlacement({
                    db,
                    itemId: flag.id,
                    beatId: beat(2),
                    placement: {
                        state: "held",
                        holders: [{ marcherId: ALICE, hand: "both" }],
                    },
                });
                await setItemPlacement({
                    db,
                    itemId: flag.id,
                    beatId: beat(8),
                    placement: { state: "placed" },
                });
                // A visible trade: Bob takes it on 16
                await setItemPlacement({
                    db,
                    itemId: flag.id,
                    beatId: beat(16),
                    placement: {
                        state: "held",
                        holders: [{ marcherId: BOB, hand: "right" }],
                    },
                });

                expect(
                    (await getItemPlacements({ db })).map((p) => [
                        p.beatId,
                        p.state,
                        p.holders,
                        p.crew,
                        p.groupId,
                    ]),
                ).toEqual([
                    [
                        beat(2),
                        "held",
                        [{ marcherId: ALICE, hand: "both" }],
                        [],
                        null,
                    ],
                    [beat(8), "placed", [], [], null],
                    [
                        beat(16),
                        "held",
                        [{ marcherId: BOB, hand: "right" }],
                        [],
                        null,
                    ],
                ]);
            },
        );

        testWithHistory(
            "replaces the change on its beat in place, crew and all",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, riser } = await setUp(db);

                const first = await setItemPlacement({
                    db,
                    itemId: riser.id,
                    beatId: beat(4),
                    placement: { state: "placed", crew: [CREW_A, CREW_B] },
                });
                const second = await setItemPlacement({
                    db,
                    itemId: riser.id,
                    beatId: beat(4),
                    placement: { state: "placed", crew: [CREW_B] },
                });
                expect(second).toMatchObject({
                    id: first.id,
                    crew: [CREW_B],
                    holders: [],
                });

                const off = await setItemPlacement({
                    db,
                    itemId: riser.id,
                    beatId: beat(4),
                    placement: { state: "off_field" },
                });
                expect(off).toMatchObject({
                    id: first.id,
                    state: "off_field",
                    crew: [],
                });
                expect(await rows(db, schema.item_placement_marchers)).toBe(0);
            },
        );

        it("refuses a held change with no holder, a holder twice, or an item as holder or crew", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag, riser } = await setUp(db);
            const at = (placement: Parameters<typeof setItemPlacement>[0]) =>
                setItemPlacement(placement);

            await expect(
                at({
                    db,
                    itemId: flag.id,
                    beatId: beat(1),
                    placement: { state: "held", holders: [] },
                }),
            ).rejects.toThrow(/holder/);
            await expect(
                at({
                    db,
                    itemId: flag.id,
                    beatId: beat(1),
                    placement: {
                        state: "held",
                        holders: [
                            { marcherId: ALICE, hand: "left" },
                            { marcherId: ALICE, hand: "right" },
                        ],
                    },
                }),
            ).rejects.toThrow(/twice/);
            await expect(
                at({
                    db,
                    itemId: flag.id,
                    beatId: beat(1),
                    placement: {
                        state: "held",
                        holders: [
                            { marcherId: riser.marcher_id, hand: "both" },
                        ],
                    },
                }),
            ).rejects.toThrow(/performers/);
            await expect(
                at({
                    db,
                    itemId: riser.id,
                    beatId: beat(1),
                    placement: { state: "placed", crew: [flag.marcher_id] },
                }),
            ).rejects.toThrow(/performers/);
            expect(await rows(db, schema.item_placements)).toBe(0);
        });

        it("undoes a Placement change in one step", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, riser } = await setUp(db);
            await setItemPlacement({
                db,
                itemId: riser.id,
                beatId: beat(4),
                placement: { state: "placed", crew: [CREW_A, CREW_B] },
            });
            await performUndo(db);
            expect(await rows(db, schema.item_placements)).toBe(0);
            expect(await rows(db, schema.item_placement_marchers)).toBe(0);
        });
    });

    describe("item ripples", () => {
        const holder = (marcherId: number) =>
            ({
                state: "held",
                holders: [{ marcherId, hand: "both" }],
            }) as const;

        it("spreads its starts evenly in time over the span, the first on the start count", () => {
            const beats = Array.from({ length: 10 }, (_, id) => ({
                id,
                duration: 0.5,
            }));
            expect(rippleBeatIds(beats, 2, 5, 3)).toEqual([2, 4, 6]);
            expect(rippleBeatIds(beats, 2, 1, 3)).toEqual([2, 2, 2]);
            // Clamped to the show's last count
            expect(rippleBeatIds(beats, 8, 5, 2)).toEqual([8, 9]);
            expect(rippleBeatIds(beats, 2, 5, 1)).toEqual([2]);
            // In time, not counts: a long count takes up more of the span
            const slow = beats.map((b) =>
                b.id === 2 ? { ...b, duration: 2 } : b,
            );
            expect(rippleBeatIds(slow, 2, 5, 3)).toEqual([2, 3, 6]);
        });

        testWithHistory(
            "gives each item its own value: each flag to its own performer, with no conflict",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, positions, flag, riser, rifle } = await setUp(db);
                // An earlier ripple, so the new one gets the next group id
                await createItemPlacementRipple({
                    db,
                    startBeatId: beat(1),
                    ripple: { span: 1, order: "drill" },
                    rows: [
                        { itemId: riser.id, placement: { state: "placed" } },
                    ],
                });

                const ripple = await createItemPlacementRipple({
                    db,
                    startBeatId: beat(12),
                    ripple: { span: 3, order: "left_right" },
                    rows: [
                        { itemId: flag.id, placement: holder(ALICE) },
                        { itemId: rifle.id, placement: holder(BOB) },
                        { itemId: riser.id, placement: holder(CREW_A) },
                    ],
                });
                expect(
                    ripple.map((p) => [
                        p.itemId,
                        p.beatId,
                        p.groupId,
                        p.ripple,
                        p.holders,
                    ]),
                ).toEqual([
                    [
                        flag.id,
                        beat(12),
                        2,
                        { span: 3, order: "left_right" },
                        [{ marcherId: ALICE, hand: "both" }],
                    ],
                    [
                        rifle.id,
                        beat(13),
                        2,
                        { span: 3, order: "left_right" },
                        [{ marcherId: BOB, hand: "both" }],
                    ],
                    [
                        riser.id,
                        beat(14),
                        2,
                        { span: 3, order: "left_right" },
                        [{ marcherId: CREW_A, hand: "both" }],
                    ],
                ]);
                const changes = toPlacementChanges(
                    await getItemPlacements({ db }),
                    positions,
                );
                const items = [flag, rifle, riser].map((i) => ({
                    itemId: i.id,
                    changes: changes.get(i.id) ?? [],
                }));
                expect(handsAt(items, positions.get(beat(14))!)).toEqual({
                    drawn: new Set([flag.id, rifle.id, riser.id]),
                    conflicts: [],
                });
            },
        );

        testWithHistory(
            "edits the group's state and keeps who holds what, then deletes it together",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, flag, rifle } = await setUp(db);
                const [first] = await createItemPlacementRipple({
                    db,
                    startBeatId: beat(12),
                    ripple: { span: 2, order: "drill" },
                    rows: [
                        { itemId: flag.id, placement: holder(ALICE) },
                        { itemId: rifle.id, placement: holder(BOB) },
                    ],
                });
                const groupId = first!.groupId!;
                const read = async () =>
                    (await getItemPlacements({ db }))
                        .filter((p) => p.groupId === groupId)
                        .map((p) => [p.itemId, p.state, p.holders, p.crew]);

                // Down: placed, no crew
                await setItemPlacementGroup({ db, groupId, state: "placed" });
                expect(await read()).toEqual([
                    [flag.id, "placed", [], []],
                    [rifle.id, "placed", [], []],
                ]);
                // Back up needs each item's holder
                await expect(
                    setItemPlacementGroup({ db, groupId, state: "held" }),
                ).rejects.toThrow(/needs its holders/);
                await setItemPlacementGroup({
                    db,
                    groupId,
                    state: "held",
                    values: new Map([
                        [flag.id, holder(BOB)],
                        [rifle.id, holder(ALICE)],
                    ]),
                });
                // Held again (a no-op on who holds what)
                await setItemPlacementGroup({ db, groupId, state: "held" });
                expect(await read()).toEqual([
                    [flag.id, "held", [{ marcherId: BOB, hand: "both" }], []],
                    [
                        rifle.id,
                        "held",
                        [{ marcherId: ALICE, hand: "both" }],
                        [],
                    ],
                ]);

                expect(
                    await deleteItemPlacementGroup({ db, groupId }),
                ).toHaveLength(2);
                expect(await rows(db, schema.item_placements)).toBe(0);
            },
        );

        testWithHistory(
            "moves and re-times the group, each change keeping its value",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, flag, rifle, riser } = await setUp(db);
                const [first] = await createItemPlacementRipple({
                    db,
                    startBeatId: beat(4),
                    ripple: { span: 3, order: "drill" },
                    rows: [
                        { itemId: flag.id, placement: holder(ALICE) },
                        { itemId: rifle.id, placement: holder(BOB) },
                        { itemId: riser.id, placement: { state: "off_field" } },
                    ],
                });
                const groupId = first!.groupId!;
                const read = async () =>
                    (await getItemPlacements({ db }))
                        .filter((p) => p.groupId === groupId)
                        // By item: flag, riser, rifle
                        .sort((a, b) => a.itemId - b.itemId)
                        .map((p) => [p.itemId, p.beatId, p.state, p.ripple]);

                // Later and slower
                await moveItemPlacementGroup({
                    db,
                    groupId,
                    startBeatId: beat(8),
                    ripple: { span: 5, order: "right_left" },
                });
                expect(await read()).toEqual(
                    [
                        [flag.id, beat(8), "held"],
                        [riser.id, beat(12), "off_field"],
                        [rifle.id, beat(10), "held"],
                    ].map((r) => [...r, { span: 5, order: "right_left" }]),
                );
                // A new order from the same start
                await moveItemPlacementGroup({
                    db,
                    groupId,
                    itemOrder: [riser.id, flag.id, rifle.id],
                });
                expect(
                    (await read()).map(([itemId, beatId]) => [itemId, beatId]),
                ).toEqual([
                    [flag.id, beat(10)],
                    [riser.id, beat(8)],
                    [rifle.id, beat(12)],
                ]);
                // Refused onto a count where an item has another change
                await setItemPlacement({
                    db,
                    itemId: flag.id,
                    beatId: beat(3),
                    placement: { state: "placed" },
                });
                await expect(
                    moveItemPlacementGroup({
                        db,
                        groupId,
                        startBeatId: beat(1),
                        itemOrder: [rifle.id, flag.id, riser.id],
                        ripple: { span: 5, order: "drill" },
                    }),
                ).rejects.toThrow(/already has a Placement change/);
                await expect(
                    moveItemPlacementGroup({
                        db,
                        groupId,
                        itemOrder: [flag.id, rifle.id],
                    }),
                ).rejects.toThrow(/each of its items once/);
            },
        );

        it("refuses two rows for one item, and a span under one count", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag, rifle } = await setUp(db);
            await expect(
                createItemPlacementRipple({
                    db,
                    startBeatId: beat(1),
                    ripple: { span: 2, order: "drill" },
                    rows: [
                        { itemId: flag.id, placement: { state: "off_field" } },
                        { itemId: flag.id, placement: { state: "off_field" } },
                    ],
                }),
            ).rejects.toThrow(/one change per item/);
            await expect(
                createItemPlacementRipple({
                    db,
                    startBeatId: beat(1),
                    ripple: { span: 0, order: "drill" },
                    rows: [
                        { itemId: flag.id, placement: { state: "off_field" } },
                        { itemId: rifle.id, placement: { state: "off_field" } },
                    ],
                }),
            ).rejects.toThrow(/at least one count/);
            expect(await rows(db, schema.item_placements)).toBe(0);
        });
    });

    describe("performer deletion", () => {
        it("deletes a held change left with no holder, and keeps a placed change without its crew", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, positions, flag, riser } = await setUp(db);
            await setItemPlacement({
                db,
                itemId: flag.id,
                beatId: beat(2),
                placement: {
                    state: "held",
                    holders: [{ marcherId: ALICE, hand: "both" }],
                },
            });
            const shared = await setItemPlacement({
                db,
                itemId: flag.id,
                beatId: beat(6),
                placement: {
                    state: "held",
                    holders: [
                        { marcherId: ALICE, hand: "left" },
                        { marcherId: BOB, hand: "right" },
                    ],
                },
            });
            await setItemPlacement({
                db,
                itemId: riser.id,
                beatId: beat(2),
                placement: { state: "placed", crew: [ALICE] },
            });

            await deleteMarchers({ db, marcherIds: new Set([ALICE]) });

            expect(
                (await getItemPlacements({ db })).map((p) => [
                    p.itemId,
                    p.beatId,
                    p.state,
                    p.holders,
                    p.crew,
                ]),
            ).toEqual([
                [
                    flag.id,
                    beat(6),
                    "held",
                    [{ marcherId: BOB, hand: "right" }],
                    [],
                ],
                [riser.id, beat(2), "placed", [], []],
            ]);
            expect(shared.id).toBeDefined();
            // Still held by Bob, and the notes list can say a hand is missing
            const changes = toPlacementChanges(
                await getItemPlacements({ db }),
                positions,
            );
            expect(
                shortHandedHolds([
                    { itemId: flag.id, changes: changes.get(flag.id) ?? [] },
                ]),
            ).toEqual([
                {
                    itemId: flag.id,
                    changeId: shared.id,
                    from: positions.get(beat(6)),
                    until: null,
                    needed: 2,
                    held: 1,
                },
            ]);

            await performUndo(db);
            expect(await rows(db, schema.item_placements)).toBe(3);
            expect(await rows(db, schema.item_placement_marchers)).toBe(4);
        });
    });

    it("deletes changes by id", async ({ db, marchersAndPages }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, riser } = await setUp(db);
        const change = await setItemPlacement({
            db,
            itemId: riser.id,
            beatId: beat(3),
            placement: { state: "off_field" },
        });
        expect(
            await deleteItemPlacements({
                db,
                placementIds: new Set([change.id]),
            }),
        ).toEqual([change.id]);
        expect(await rows(db, schema.item_placements)).toBe(0);
    });

    it("feeds the core lookups: the fixture reads back as written", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, positions, flag, riser, rifle } = await setUp(db);
        // The flag came from Alice's flag: held by her from its first beat (an explicit change)
        // until it is put down on 8
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(0),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(8),
            placement: { state: "placed" },
        });
        await setItemPlacement({
            db,
            itemId: rifle.id,
            beatId: beat(4),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: riser.id,
            beatId: beat(0),
            placement: { state: "placed", crew: [CREW_A, CREW_B] },
        });
        await setItemPlacement({
            db,
            itemId: riser.id,
            beatId: beat(24),
            placement: { state: "off_field" },
        });

        const changes = toPlacementChanges(
            await getItemPlacements({ db }),
            positions,
        );
        const at = (n: number) => positions.get(beat(n))!;
        expect(placementAt(changes.get(flag.id) ?? [], at(3))).toMatchObject({
            state: "held",
            holders: [{ marcherId: ALICE, hand: "both" }],
        });
        expect(placementAt(changes.get(riser.id) ?? [], at(10))).toMatchObject({
            state: "placed",
            crew: [CREW_A, CREW_B],
        });
        expect(placementAt(changes.get(riser.id) ?? [], at(24)).state).toBe(
            "off_field",
        );

        expect(
            handConflicts([
                { itemId: flag.id, changes: changes.get(flag.id) ?? [] },
                { itemId: rifle.id, changes: changes.get(rifle.id) ?? [] },
                { itemId: riser.id, changes: changes.get(riser.id) ?? [] },
            ]),
        ).toEqual([
            {
                itemId: flag.id,
                byItemId: rifle.id,
                marcherId: ALICE,
                side: "right",
                from: at(4),
                until: at(8),
            },
        ]);
    });

    it("carries a Placement change on a deleted beat to the next beat, holders and all", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { beat, flag } = await setUp(db);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(2),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        await deleteBeatsCarryingCues({ db, beatIds: new Set([beat(2)]) });
        const [carried] = await getItemPlacements({ db });
        expect(carried).toMatchObject({
            beatId: beat(3),
            state: "held",
            holders: [{ marcherId: ALICE, hand: "both" }],
        });
    });

    it("keeps who holds what when a deleted count carries a change onto another item's (P3)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { beat, positions, flag, rifle } = await setUp(db);
        // Alice takes the rifle on 3 (written first), and holds the flag from 2
        await setItemPlacement({
            db,
            itemId: rifle.id,
            beatId: beat(3),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(2),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            },
        });
        const drawnAt3 = async () => {
            const changes = toPlacementChanges(
                await getItemPlacements({ db }),
                positions,
            );
            return handsAt(
                [flag, rifle].map((i) => ({
                    itemId: i.id,
                    changes: changes.get(i.id) ?? [],
                })),
                positions.get(beat(3))!,
            ).drawn;
        };
        expect(await drawnAt3()).toEqual(new Set([rifle.id]));

        await deleteBeatsCarryingCues({ db, beatIds: new Set([beat(2)]) });

        const carried = (await getItemPlacements({ db })).find(
            (p) => p.itemId === flag.id,
        );
        expect(carried).toMatchObject({ beatId: beat(3) });
        expect(await drawnAt3()).toEqual(new Set([rifle.id]));
    });

    it("makes a replaced change the newest on its beat", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { beat, positions, flag, rifle } = await setUp(db);
        const right = {
            state: "held",
            holders: [{ marcherId: BOB, hand: "right" }],
        } as const;
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(5),
            placement: right,
        });
        await setItemPlacement({
            db,
            itemId: rifle.id,
            beatId: beat(5),
            placement: right,
        });
        const drawn = async () => {
            const changes = toPlacementChanges(
                await getItemPlacements({ db }),
                positions,
            );
            return handsAt(
                [flag, rifle].map((i) => ({
                    itemId: i.id,
                    changes: changes.get(i.id) ?? [],
                })),
                positions.get(beat(5))!,
            ).drawn;
        };
        expect(await drawn()).toEqual(new Set([rifle.id]));
        // Re-giving Bob the flag on the same count, in place, makes it the one he holds
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(5),
            placement: right,
        });
        expect(await drawn()).toEqual(new Set([flag.id]));
    });

    it("keeps Placement changes, holders and ripples when every beat is replaced", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { beat, flag, rifle } = await setUp(db);
        await createItemPlacementRipple({
            db,
            startBeatId: beat(4),
            ripple: { span: 2, order: "drill" },
            rows: [
                {
                    itemId: flag.id,
                    placement: {
                        state: "held",
                        holders: [{ marcherId: ALICE, hand: "both" }],
                    },
                },
                {
                    itemId: rifle.id,
                    placement: { state: "placed", crew: [CREW_A] },
                },
            ],
        });
        // A tempo edit in the audio editor: twice the tempo over the same time
        const before = await placementTimes(db);
        const { beats: oldBeats, pages } = await readShowTiming(db);
        const total = oldBeats.reduce((t, b) => t + b.duration, 0);
        const newBeats = Array.from(
            { length: Math.round(total / 0.25) },
            (_, i) => ({
                id: -1 - i,
                position: 0,
                index: 0,
                duration: 0.25,
                timestamp: 0.25 * i,
                includeInMeasure: true,
                notes: null,
            }),
        );
        const oldMeasures = (await db.select().from(schema.measures).all()).map(
            (m) => ({ id: m.id }) as unknown as Measure,
        );
        await _replaceAllBeatObjects({
            newBeats,
            oldBeats: [...oldBeats],
            newMeasures: [],
            oldMeasures,
            pages: [...pages],
        });
        const replaced = new Set(
            oldBeats.map((b) => b.id).filter((id) => id !== 0),
        );
        expect(await placementTimes(db)).toEqual(before);
        const after = await getItemPlacements({ db });
        expect(
            after.map((p) => [p.itemId, p.state, p.holders, p.crew, p.ripple]),
        ).toEqual([
            [
                flag.id,
                "held",
                [{ marcherId: ALICE, hand: "both" }],
                [],
                { span: 2, order: "drill" },
            ],
            [rifle.id, "placed", [], [CREW_A], { span: 2, order: "drill" }],
        ]);
        expect(after.every((p) => !replaced.has(p.beatId))).toBe(true);
    });

    it("writes an item's first Placement with it: a flag item held by its performer", async ({
        db,
        marchersAndPages: _,
    }) => {
        const beats = await beatsInOrder(db);
        const [flag] = await createItems({
            db,
            newItems: [
                {
                    ...item("equipment", "Flag", beats[3]!.id),
                    placement: {
                        state: "held",
                        holders: [{ marcherId: ALICE, hand: "both" }],
                    },
                },
            ],
        });
        expect(await getItemPlacements({ db })).toMatchObject([
            {
                itemId: flag!.id,
                beatId: beats[3]!.id,
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        ]);
        await performUndo(db);
        expect(await rows(db, schema.item_placements)).toBe(0);
        expect(await rows(db, schema.items)).toBe(0);
    });
});
