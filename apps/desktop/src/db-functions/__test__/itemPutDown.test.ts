import { expect } from "vitest";
import { createResolver, putDownDrifts, type XY } from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo } from "../history";
import { createItems } from "../items";
import {
    getItemPlacements,
    setItemPlacement,
    toPlacementChanges,
} from "../itemPlacements";
import { snapItemToHolder } from "../itemPutDown";
import { moveMarchersInTarget } from "../timelineMoves";

// Performers in the marchersAndPages fixture
const ALICE = 1;
const BOB = 2;

const ordinals = async (db: DbConnection) => {
    const beats = await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(schema.beats.position, schema.beats.id)
        .all();
    return {
        beat: (n: number) => beats[n]!.id,
        ordinal: new Map(beats.map((b, i) => [b.id, i])),
    };
};

const positionAt = async (db: DbConnection) => {
    const resolver = createResolver((await readTimelineTables(db)).snapshot);
    return (marcherId: number, beat: number): XY =>
        resolver.positionAt(marcherId, beat);
};

const movePerformer = (
    db: DbConnection,
    marcherId: number,
    range: { start: number; end: number },
    at: XY,
) =>
    moveMarchersInTarget({
        db,
        target: { kind: "range", ...range },
        moves: [{ marcherId, x: at[0], y: at[1] }],
    });

/** Timeline mode, Alice and Bob placed on their marks by count 8, and a flag item. */
const setUp = async (db: DbConnection) => {
    const { beat, ordinal } = await ordinals(db);
    await movePerformer(db, ALICE, { start: 0, end: 8 }, [100, 100]);
    await movePerformer(db, BOB, { start: 0, end: 8 }, [140, 120]);
    const [flag] = await createItems({
        db,
        newItems: [
            {
                kind: "equipment",
                name: "Flag",
                home: [0, 0],
                beatId: beat(0),
                geometry: { outlineType: "rectangle", width: 0.1, depth: 1 },
            },
        ],
    });
    return { beat, ordinal, flag: flag! };
};

const driftsOf = async (
    db: DbConnection,
    ordinal: ReadonlyMap<number, number>,
    itemId: number,
    marcherId: number,
) =>
    putDownDrifts(
        toPlacementChanges(await getItemPlacements({ db }), ordinal).get(
            itemId,
        ) ?? [],
        { kind: "created" },
        marcherId,
        await positionAt(db),
    );

describeDbTests("itemPutDown", (it) => {
    const testWithHistory = getTestWithHistory(it, [
        schema.item_placements,
        schema.item_placement_marchers,
        schema.timelines,
        schema.timeline_transitions,
        schema.timeline_assignments,
        schema.timeline_slot_destinations,
    ]);

    testWithHistory(
        "puts a released item down where its holder is",
        async ({ db, marchersAndPages }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag } = await setUp(db);

            await setItemPlacement({
                db,
                itemId: flag.id,
                beatId: beat(10),
                placement: {
                    state: "held",
                    holders: [{ marcherId: ALICE, hand: "both" }],
                },
            });
            await setItemPlacement({
                db,
                itemId: flag.id,
                beatId: beat(12),
                placement: { state: "placed" },
            });

            const at = await positionAt(db);
            const alice = at(ALICE, 12);
            expect(at(flag.marcher_id, 12)).toEqual(alice);
            // It stays put after the put-down, wherever Alice goes
            expect(at(flag.marcher_id, 20)).toEqual(alice);
        },
    );

    it("puts an item held by two performers down at their midpoint", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
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
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        const at = await positionAt(db);
        const [a, b] = [at(ALICE, 12), at(BOB, 12)];
        expect(at(flag.marcher_id, 12)).toEqual([
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
        ]);
    });

    it("puts down a placed change that a new held change comes to precede", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual([0, 0]);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: {
                state: "held",
                holders: [{ marcherId: BOB, hand: "both" }],
            },
        });
        const at = await positionAt(db);
        expect(at(flag.marcher_id, 12)).toEqual(at(BOB, 12));
    });

    it("leaves a placed change with no holder before it where it is", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: { state: "off_field" },
        });
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual([0, 0]);
    });

    it("notes a put-down away from its holder once the holder's drill changes, and Snap to holder clears it in one undo step", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, ordinal, flag } = await setUp(db);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        const putDown = await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        expect(await driftsOf(db, ordinal, flag.id, flag.marcher_id)).toEqual(
            [],
        );
        const putDownAt = (await positionAt(db))(flag.marcher_id, 12);

        // Alice's drill changes: she is somewhere else at the put-down count
        await movePerformer(db, ALICE, { start: 8, end: 12 }, [160, 100]);
        const drifts = await driftsOf(db, ordinal, flag.id, flag.marcher_id);
        expect(drifts).toMatchObject([
            {
                changeId: putDown.id,
                beat: 12,
                spot: [160, 100],
                at: putDownAt,
            },
        ]);

        await snapItemToHolder({ db, placementId: putDown.id });
        expect(await driftsOf(db, ordinal, flag.id, flag.marcher_id)).toEqual(
            [],
        );
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual([160, 100]);

        await performUndo(db);
        expect(
            await driftsOf(db, ordinal, flag.id, flag.marcher_id),
        ).toHaveLength(1);
        await performRedo(db);
        expect(await driftsOf(db, ordinal, flag.id, flag.marcher_id)).toEqual(
            [],
        );
    });

    it("opens no edit for a change that isn't a put-down, or an item already at its holder", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        const off = await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: { state: "off_field" },
        });
        expect(await snapItemToHolder({ db, placementId: off.id })).toBeNull();
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(11),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        const putDown = await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        const undoGroups = async () =>
            (await db.select().from(schema.history_undo).all()).length;
        const before = await undoGroups();
        expect(
            await snapItemToHolder({ db, placementId: putDown.id }),
        ).toMatchObject({ spot: (await positionAt(db))(ALICE, 12) });
        expect(await undoGroups()).toBe(before);
    });
});
