import { describe, expect } from "vitest";
import { count } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { handConflicts, placementAt } from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { performUndo } from "../history";
import { createItems, type NewItemArgs } from "../items";
import { deleteMarchers } from "../marcher";
import { deleteBeatsCarryingCues } from "../beat";
import {
    createItemPlacementRipple,
    deleteItemPlacementGroup,
    deleteItemPlacements,
    getItemPlacements,
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
        testWithHistory(
            "writes one row per item at staggered counts with a shared group id, edited and deleted together",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, flag, riser, rifle } = await setUp(db);
                // An earlier ripple, so the new one gets the next group id
                await createItemPlacementRipple({
                    db,
                    rows: [{ itemId: riser.id, beatId: beat(1) }],
                    placement: { state: "placed" },
                });

                const ripple = await createItemPlacementRipple({
                    db,
                    rows: [
                        { itemId: flag.id, beatId: beat(12) },
                        { itemId: riser.id, beatId: beat(13) },
                        { itemId: rifle.id, beatId: beat(14) },
                    ],
                    placement: { state: "off_field" },
                });
                expect(ripple.map((p) => [p.beatId, p.groupId])).toEqual([
                    [beat(12), 2],
                    [beat(13), 2],
                    [beat(14), 2],
                ]);

                await setItemPlacementGroup({
                    db,
                    groupId: 2,
                    placement: { state: "placed", crew: [CREW_A] },
                });
                expect(
                    (await getItemPlacements({ db }))
                        .filter((p) => p.groupId === 2)
                        .map((p) => [p.beatId, p.state, p.crew]),
                ).toEqual([
                    [beat(12), "placed", [CREW_A]],
                    [beat(13), "placed", [CREW_A]],
                    [beat(14), "placed", [CREW_A]],
                ]);

                expect(
                    await deleteItemPlacementGroup({ db, groupId: 2 }),
                ).toHaveLength(3);
                expect(
                    (await getItemPlacements({ db })).map((p) => p.groupId),
                ).toEqual([1]);
            },
        );

        it("refuses two rows for one item", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag } = await setUp(db);
            await expect(
                createItemPlacementRipple({
                    db,
                    rows: [
                        { itemId: flag.id, beatId: beat(1) },
                        { itemId: flag.id, beatId: beat(2) },
                    ],
                    placement: { state: "off_field" },
                }),
            ).rejects.toThrow(/one change per item/);
        });
    });

    describe("performer deletion", () => {
        it("deletes a held change left with no holder, and keeps a placed change without its crew", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag, riser } = await setUp(db);
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
        // The flag came from Alice's implicit flag: held by her until it is put down on 8
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
        const flagOrigin = {
            kind: "flag",
            marcherId: ALICE,
            hand: "both",
        } as const;
        expect(
            placementAt(changes.get(flag.id) ?? [], at(3), flagOrigin),
        ).toMatchObject({
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
                {
                    itemId: flag.id,
                    origin: flagOrigin,
                    changes: changes.get(flag.id) ?? [],
                },
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
});
