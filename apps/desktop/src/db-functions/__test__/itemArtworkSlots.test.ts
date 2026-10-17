import { describe, expect } from "vitest";
import { count, eq } from "drizzle-orm";
import {
    dormantAssignments,
    slotAssignmentsAt,
    slotsForItem,
    type ArtworkSlot,
} from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { createItems, type NewItemArgs } from "../items";
import {
    assignItemArtworkSlot,
    deleteItemArtworkSlots,
    getItemArtworkSlots,
    getLibraryReferencesInUse,
    setItemArtworkSlot,
    toArtworkAssignments,
} from "../itemArtworkSlots";
import { deleteBeatsCarryingCues } from "../beat";

const BANNER = {
    itemId: "11111111-1111-4111-8111-111111111111",
    versionHash: "a".repeat(64),
};
const SUNSET = {
    itemId: "22222222-2222-4222-8222-222222222222",
    versionHash: "b".repeat(64),
};
// A panel model, its first Version and an update that renames "front" to "face"
const PANEL = "33333333-3333-4333-8333-333333333333";
const PANEL_V1 = "c".repeat(64);
const PANEL_V2 = "d".repeat(64);
const PANEL_SLOTS: Record<string, ArtworkSlot[]> = {
    [PANEL_V1]: [
        { id: "front", widthM: 1.2, heightM: 2.4 },
        { id: "back", widthM: 1.2, heightM: 2.4 },
    ],
    [PANEL_V2]: [
        { id: "face", widthM: 1.2, heightM: 2.4 },
        { id: "back", widthM: 1.2, heightM: 2.4 },
    ],
};

const beatsInOrder = async (db: DbConnection) =>
    db
        .select({ id: schema.beats.id, position: schema.beats.position })
        .from(schema.beats)
        .orderBy(schema.beats.position)
        .all();

const item = (
    name: string,
    beatId: number,
    library?: NewItemArgs["library"],
): NewItemArgs => ({
    kind: "prop",
    name,
    surfaceType: "platform",
    home: [0, 0],
    beatId,
    geometry: { outlineType: "rectangle", width: 2.4, depth: 1.2, height: 0.6 },
    library,
});

const rows = async (db: DbConnection) =>
    (await db.select({ c: count() }).from(schema.item_artwork_slots).get())?.c;

/** Timeline mode, a no-model riser and a panel model prop created on beat 2. */
const setUp = async (db: DbConnection) => {
    const beats = await beatsInOrder(db);
    const beat = (n: number) => beats[n]!.id;
    const [riser, panel] = await createItems({
        db,
        newItems: [
            item("Riser", beat(2)),
            item("Panel", beat(2), { itemId: PANEL, versionHash: PANEL_V1 }),
        ],
    });
    return {
        beat,
        positions: new Map(beats.map((b) => [b.id, b.position])),
        riser: riser!,
        panel: panel!,
    };
};

const slotRows = async (db: DbConnection) =>
    (await getItemArtworkSlots({ db })).map((a) => [
        a.itemId,
        a.slot,
        a.beatId,
        a.artwork?.itemId ?? null,
    ]);

describeDbTests("itemArtworkSlots", (it) => {
    const testWithHistory = getTestWithHistory(it, [
        schema.items,
        schema.item_artwork_slots,
    ]);

    describe("setItemArtworkSlot", () => {
        testWithHistory(
            "writes a change on its slot and beat, and replaces it in place",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, riser } = await setUp(db);

                const first = await setItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(4),
                    assignment: { artwork: BANNER },
                });
                expect(first).toMatchObject({
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(4),
                    artwork: BANNER,
                    fit: "fill",
                    pan: { x: 0, y: 0 },
                    padColor: null,
                });

                const second = await setItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(4),
                    assignment: {
                        artwork: SUNSET,
                        fit: "fit",
                        padColor: "#1A2B3C",
                    },
                });
                expect(second).toMatchObject({
                    id: first.id,
                    artwork: SUNSET,
                    fit: "fit",
                    padColor: "#1a2b3c",
                });

                // A bare slot from a later count
                const bare = await setItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(9),
                    assignment: { artwork: null },
                });
                expect(bare.artwork).toBeNull();
                expect(await rows(db)).toBe(2);
            },
        );

        it("refuses a pan past the edge, a bad pad color or a bad slot id, and writes nothing", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, riser } = await setUp(db);
            const at = (
                slot: string,
                assignment: Parameters<
                    typeof setItemArtworkSlot
                >[0]["assignment"],
            ) =>
                setItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot,
                    beatId: beat(4),
                    assignment,
                });

            await expect(
                at("top", { artwork: BANNER, pan: { x: 1.5, y: 0 } }),
            ).rejects.toThrow(/pan/i);
            await expect(
                at("top", { artwork: BANNER, padColor: "red" }),
            ).rejects.toThrow(/pad color/i);
            await expect(
                at("front panel", { artwork: BANNER }),
            ).rejects.toThrow(/slot/i);
            await expect(
                at("top", {
                    artwork: { itemId: "short", versionHash: "x" },
                }),
            ).rejects.toThrow();
            expect(await rows(db)).toBe(0);
        });

        it("undoes and redoes a change in one step", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, riser } = await setUp(db);
            await setItemArtworkSlot({
                db,
                itemId: riser.id,
                slot: "front",
                beatId: beat(4),
                assignment: { artwork: BANNER, pan: { x: -0.5, y: 0.25 } },
            });
            await performUndo(db);
            expect(await rows(db)).toBe(0);
            await performRedo(db);
            expect(await getItemArtworkSlots({ db })).toMatchObject([
                { slot: "front", pan: { x: -0.5, y: 0.25 } },
            ]);
        });
    });

    describe("assignItemArtworkSlot (the slot picker)", () => {
        testWithHistory(
            "covers the whole show while the slot has no changes, then writes from the current count",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, riser } = await setUp(db);

                const whole = await assignItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(6),
                    assignment: { artwork: BANNER },
                });
                expect(whole.scope).toBe("show");
                expect(whole.assignment.beatId).toBe(beat(0));

                const later = await assignItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(6),
                    assignment: { artwork: SUNSET },
                });
                expect(later.scope).toBe("from_count");
                expect(await slotRows(db)).toEqual([
                    [riser.id, "top", beat(0), BANNER.itemId],
                    [riser.id, "top", beat(6), SUNSET.itemId],
                ]);
            },
        );

        testWithHistory(
            "switched to the whole show, replaces every change on the slot with one",
            async ({ db, marchersAndPages }) => {
                expect(marchersAndPages).toBeDefined();
                const { beat, riser } = await setUp(db);
                for (const [n, artwork] of [
                    [3, BANNER],
                    [8, SUNSET],
                ] as const)
                    await setItemArtworkSlot({
                        db,
                        itemId: riser.id,
                        slot: "top",
                        beatId: beat(n),
                        assignment: { artwork },
                    });
                await setItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "front",
                    beatId: beat(3),
                    assignment: { artwork: BANNER },
                });

                await assignItemArtworkSlot({
                    db,
                    itemId: riser.id,
                    slot: "top",
                    beatId: beat(8),
                    assignment: { artwork: SUNSET },
                    scope: "show",
                });
                expect(await slotRows(db)).toEqual([
                    [riser.id, "front", beat(3), BANNER.itemId],
                    [riser.id, "top", beat(0), SUNSET.itemId],
                ]);

                // One undo step brings back both changes
                await performUndo(db);
                expect(await slotRows(db)).toEqual([
                    [riser.id, "front", beat(3), BANNER.itemId],
                    [riser.id, "top", beat(3), BANNER.itemId],
                    [riser.id, "top", beat(8), SUNSET.itemId],
                ]);
            },
        );

        it("switched to the current count, writes there even with no changes", async ({
            db,
            marchersAndPages,
        }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, riser } = await setUp(db);
            const { scope, assignment } = await assignItemArtworkSlot({
                db,
                itemId: riser.id,
                slot: "top",
                beatId: beat(5),
                assignment: { artwork: BANNER },
                scope: "from_count",
            });
            expect(scope).toBe("from_count");
            expect(assignment.beatId).toBe(beat(5));
        });
    });

    it("deletes changes by id, and with their item or beat", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, riser, panel } = await setUp(db);
        const top = await setItemArtworkSlot({
            db,
            itemId: riser.id,
            slot: "top",
            beatId: beat(3),
            assignment: { artwork: BANNER },
        });
        await setItemArtworkSlot({
            db,
            itemId: panel.id,
            slot: "front",
            beatId: beat(3),
            assignment: { artwork: BANNER },
        });
        expect(
            await deleteItemArtworkSlots({
                db,
                assignmentIds: new Set([top.id]),
            }),
        ).toEqual([top.id]);
        expect(await rows(db)).toBe(1);
        await db
            .delete(schema.marchers)
            .where(eq(schema.marchers.id, panel.marcher_id))
            .run();
        expect(await rows(db)).toBe(0);
    });

    it("reads every Library Version the Item tables keep, dormant assignments and bare slots included", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const { beat, riser, panel } = await setUp(db);
        expect(await getLibraryReferencesInUse({ db })).toEqual([
            { itemId: PANEL, versionHash: PANEL_V1 },
        ]);

        for (const [itemId, slot, n, artwork] of [
            [riser.id, "top", 3, BANNER],
            [riser.id, "front", 3, BANNER],
            [riser.id, "top", 8, null],
            // A slot no Version of the panel declares: dormant, still kept
            [panel.id, "gone", 3, SUNSET],
        ] as const)
            await setItemArtworkSlot({
                db,
                itemId,
                slot,
                beatId: beat(n),
                assignment: { artwork },
            });

        expect(await getLibraryReferencesInUse({ db })).toEqual([
            { itemId: BANNER.itemId, versionHash: BANNER.versionHash },
            { itemId: SUNSET.itemId, versionHash: SUNSET.versionHash },
            { itemId: PANEL, versionHash: PANEL_V1 },
        ]);
    });

    testWithHistory(
        "keeps an assignment dormant when an update renames its slot, and restores it on revert",
        async ({ db, marchersAndPages }) => {
            expect(marchersAndPages).toBeDefined();
            const { beat, positions, panel } = await setUp(db);
            await setItemArtworkSlot({
                db,
                itemId: panel.id,
                slot: "front",
                beatId: beat(2),
                assignment: { artwork: BANNER, fit: "fit" },
            });
            await setItemArtworkSlot({
                db,
                itemId: panel.id,
                slot: "back",
                beatId: beat(2),
                assignment: { artwork: SUNSET },
            });

            /** The panel's slots from its pinned Version, and what is on them at count 10 */
            const read = async () => {
                const model = await db
                    .select({ hash: schema.items.library_version_hash })
                    .from(schema.items)
                    .where(eq(schema.items.id, panel.id))
                    .get();
                const slots = slotsForItem({
                    kind: "prop",
                    model: { slots: PANEL_SLOTS[model!.hash!]! },
                    geometry: null,
                });
                const assignments =
                    toArtworkAssignments(
                        await getItemArtworkSlots({ db }),
                        positions,
                    ).get(panel.id) ?? [];
                const at = slotAssignmentsAt(
                    assignments,
                    slots,
                    positions.get(beat(10))!,
                );
                return {
                    live: Object.fromEntries(
                        [...at].map(([slot, a]) => [
                            slot,
                            a?.artwork?.itemId ?? null,
                        ]),
                    ),
                    dormant: dormantAssignments(assignments, slots).map(
                        (a) => a.slot,
                    ),
                };
            };

            const before = await read();
            expect(before).toEqual({
                live: { front: BANNER.itemId, back: SUNSET.itemId },
                dormant: [],
            });

            const pinVersion = (versionHash: string) =>
                transactionWithHistory(db, "acceptLibraryUpdate", (tx) =>
                    tx
                        .update(schema.items)
                        .set({ library_version_hash: versionHash })
                        .where(eq(schema.items.id, panel.id))
                        .run(),
                );

            // Accept the update: "front" is now "face"
            await pinVersion(PANEL_V2);
            expect(await read()).toEqual({
                live: { face: null, back: SUNSET.itemId },
                dormant: ["front"],
            });
            expect(await rows(db)).toBe(2);

            // Revert by undo, and again by pinning the old Version
            await performUndo(db);
            expect(await read()).toEqual(before);
            await performRedo(db);
            expect((await read()).dormant).toEqual(["front"]);
            await pinVersion(PANEL_V1);
            expect(await read()).toEqual(before);
        },
    );

    it("carries slot assignments on a deleted beat to the next beat, each slot apart", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { beat, riser } = await setUp(db);
        for (const slot of ["top", "front"])
            await setItemArtworkSlot({
                db,
                itemId: riser.id,
                slot,
                beatId: beat(4),
                assignment: { artwork: BANNER },
            });
        await deleteBeatsCarryingCues({ db, beatIds: new Set([beat(4)]) });
        expect(await slotRows(db)).toEqual([
            [riser.id, "front", beat(5), BANNER.itemId],
            [riser.id, "top", beat(5), BANNER.itemId],
        ]);
    });
});
