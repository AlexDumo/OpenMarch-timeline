import { expect } from "vitest";
import {
    putDownAnchors,
    putDownDrifts,
    type PutDownResolver,
    type XY,
} from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { acquireExportResolver } from "@/timeline/timelineExport";
import { performRedo, performUndo } from "../history";
import { createItems } from "../items";
import {
    createItemPlacementRipple,
    deleteItemPlacements,
    moveItemPlacementGroup,
    setItemPlacement,
} from "../itemPlacements";
import { readPutDownItems, snapItemToHolder } from "../itemPutDown";
import { deleteMarchers } from "../marcher";
import { deleteBeats } from "../beat";
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
    return (n: number) => beats[n]!.id;
};

/** The resolver as the app reads it: put-downs derived from Placement (`withPutDowns`). */
const resolverOf = (db: DbConnection): Promise<PutDownResolver> =>
    acquireExportResolver(db);

const positionAt = async (db: DbConnection) => {
    const resolver = await resolverOf(db);
    return (marcherId: number, beat: number): XY =>
        resolver.positionAt(marcherId, beat);
};

/** Where the timeline alone puts a marcher, without put-downs. */
const ownAt = async (db: DbConnection) => {
    const resolver = await resolverOf(db);
    return (marcherId: number, beat: number): XY =>
        resolver.base.positionAt(marcherId, beat);
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

const timelineRows = async (db: DbConnection) =>
    (await db.select().from(schema.timeline_transitions).all()).length;

/** Timeline mode, Alice and Bob placed on their marks by count 8, and a flag item. */
const setUp = async (db: DbConnection) => {
    const beat = await ordinals(db);
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
    return { beat, flag: flag! };
};

/** Alice holds the flag from count 10 and puts it down on count 12. */
const holdAndPutDown = async (
    db: DbConnection,
    beat: (n: number) => number,
    itemId: number,
) => {
    const held = await setItemPlacement({
        db,
        itemId,
        beatId: beat(10),
        placement: {
            state: "held",
            holders: [{ marcherId: ALICE, hand: "both" }],
        },
    });
    const putDown = await setItemPlacement({
        db,
        itemId,
        beatId: beat(12),
        placement: { state: "placed" },
    });
    return { held, putDown };
};

const driftsOf = async (db: DbConnection, marcherId: number) => {
    const resolver = await resolverOf(db);
    return putDownDrifts(
        resolver.base,
        marcherId,
        resolver.putDownAnchors(marcherId),
    );
};

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
        "puts a released item down where its holder is, writing no move",
        async ({ db, marchersAndPages }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, flag } = await setUp(db);
            const before = await timelineRows(db);
            await holdAndPutDown(db, beat, flag.id);
            // A hidden mechanism: no clip on the timeline, no step size
            expect(await timelineRows(db)).toBe(before);

            const at = await positionAt(db);
            const alice = at(ALICE, 12);
            expect(at(flag.marcher_id, 12)).toEqual(alice);
            // It stays put after the put-down, wherever Alice goes
            await movePerformer(db, ALICE, { start: 12, end: 16 }, [300, 300]);
            expect((await positionAt(db))(flag.marcher_id, 20)).toEqual(alice);
        },
    );

    it("follows the holder's drill at the release: derived, never stale", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await holdAndPutDown(db, beat, flag.id);
        await movePerformer(db, ALICE, { start: 8, end: 12 }, [160, 100]);
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual([160, 100]);
        expect(await driftsOf(db, flag.marcher_id)).toEqual([]);
    });

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

    it("can't outlive the release: put it Off field, or delete the hold, and it is where its own drill is", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        const { held } = await holdAndPutDown(db, beat, flag.id);
        const alice = (await positionAt(db))(ALICE, 12);
        const own = (await ownAt(db))(flag.marcher_id, 12);
        expect(own).not.toEqual(alice);

        // Replace the held change with Off field: not a put-down
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: { state: "off_field" },
        });
        let at = await positionAt(db);
        expect(at(flag.marcher_id, 12)).toEqual(own);
        expect(at(flag.marcher_id, 20)).toEqual(own);

        await performUndo(db);
        expect((await positionAt(db))(flag.marcher_id, 20)).toEqual(alice);

        // Delete the held change: placed all along, and it doesn't glide anywhere
        await deleteItemPlacements({ db, placementIds: new Set([held.id]) });
        at = await positionAt(db);
        for (const b of [10, 12, 16, 20])
            expect(at(flag.marcher_id, b)).toEqual(own);
    });

    it("puts down at a placed change inserted inside the hold, and nothing walks on after it", async ({
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
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(16),
            placement: { state: "placed" },
        });
        // Alice walks on after count 12
        await movePerformer(db, ALICE, { start: 12, end: 16 }, [300, 300]);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        const at = await positionAt(db);
        const alice = at(ALICE, 12);
        expect(at(ALICE, 16)).not.toEqual(alice);
        for (const b of [12, 14, 16, 20])
            expect(at(flag.marcher_id, b)).toEqual(alice);
    });

    it("drops the put-down with its holder when the holder is deleted", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await holdAndPutDown(db, beat, flag.id);
        const own = (await ownAt(db))(flag.marcher_id, 20);
        await deleteMarchers({ db, marcherIds: new Set([ALICE]) });
        expect(
            (await readPutDownItems(db)).flatMap((i) => i.changes),
        ).toMatchObject([{ state: "placed" }]);
        expect((await positionAt(db))(flag.marcher_id, 20)).toEqual(own);
    });

    it("follows an item ripple when its group is re-timed", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await movePerformer(db, ALICE, { start: 8, end: 20 }, [400, 100]);
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(9),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        const [row] = await createItemPlacementRipple({
            db,
            startBeatId: beat(12),
            ripple: { span: 1, order: "drill" },
            rows: [{ itemId: flag.id, placement: { state: "placed" } }],
        });
        let at = await positionAt(db);
        expect(at(flag.marcher_id, 30)).toEqual(at(ALICE, 12));
        await moveItemPlacementGroup({
            db,
            groupId: row!.groupId!,
            startBeatId: beat(16),
        });
        at = await positionAt(db);
        expect(at(ALICE, 16)).not.toEqual(at(ALICE, 12));
        expect(at(flag.marcher_id, 30)).toEqual(at(ALICE, 16));
    });

    it("stays with its holder when beats are deleted", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        await holdAndPutDown(db, beat, flag.id);
        // Delete the put-down's own count: the change carries to the next count
        await deleteBeats({ db, beatIds: new Set([beat(12)]) });
        const at = await positionAt(db);
        const [change] = (await readPutDownItems(db))[0]!.changes.filter(
            (c) => c.state === "placed",
        );
        expect(at(flag.marcher_id, change!.beat)).toEqual(
            at(ALICE, change!.beat),
        );
        expect(at(flag.marcher_id, 30)).toEqual(at(ALICE, change!.beat));
    });

    it("lets the item's own move win when it ends on the put-down: a drift note, and Snap and Placement edits never throw", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        const { putDown } = await holdAndPutDown(db, beat, flag.id);
        const alice = (await positionAt(db))(ALICE, 12);
        // The designer moves the flag on the page box ending on the put-down (review probe I)
        await movePerformer(
            db,
            flag.marcher_id,
            { start: 8, end: 12 },
            [50, 50],
        );
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual([50, 50]);
        expect(
            (await resolverOf(db)).putDownAnchors(flag.marcher_id),
        ).toMatchObject([{ kind: "own_move", beat: 12 }]);
        expect(await driftsOf(db, flag.marcher_id)).toMatchObject([
            { changeId: putDown.id, spot: alice, at: [50, 50] },
        ]);

        // Unrelated Placement edits still go through
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(10),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(12),
            placement: { state: "placed", crew: [BOB] },
        });

        // Snap rewrites the item's own move's end, as one undo step
        expect(
            await snapItemToHolder({ db, placementId: putDown.id }),
        ).toMatchObject({ spot: alice, range: { end: 12 } });
        expect(await driftsOf(db, flag.marcher_id)).toEqual([]);
        expect((await positionAt(db))(flag.marcher_id, 12)).toEqual(alice);
        await performUndo(db);
        expect(await driftsOf(db, flag.marcher_id)).toHaveLength(1);
        await performRedo(db);
        expect(await driftsOf(db, flag.marcher_id)).toEqual([]);
    });

    it("opens no edit for a change that isn't a put-down, or a derived put-down", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, flag } = await setUp(db);
        const off = await setItemPlacement({
            db,
            itemId: flag.id,
            beatId: beat(9),
            placement: { state: "off_field" },
        });
        expect(await snapItemToHolder({ db, placementId: off.id })).toBeNull();
        const { putDown } = await holdAndPutDown(db, beat, flag.id);
        const undoGroups = async () =>
            (await db.select().from(schema.history_undo).all()).length;
        const before = await undoGroups();
        expect(
            await snapItemToHolder({ db, placementId: putDown.id }),
        ).toBeNull();
        expect(await undoGroups()).toBe(before);
        const resolver = await resolverOf(db);
        expect(
            putDownAnchors(resolver.base, {
                marcherId: flag.marcher_id,
                changes: (await readPutDownItems(db))[0]!.changes,
            }),
        ).toMatchObject([
            { kind: "derived", spot: resolver.positionAt(ALICE, 12) },
        ]);
    });
});
