import { describe, expect } from "vitest";
import { count, getTableName, sql } from "drizzle-orm";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { tablesWithHistory } from "../historyTriggers";
import {
    libraryReferences,
    LIBRARY_REFERENCE_SOURCES,
} from "../libraryReferences";
import { getFieldFloorImage, setFieldFloorInTransaction } from "../fieldFloor";
import { setFieldFloor } from "../fieldFloorEdits";
import {
    embedLibraryVersionInTransaction,
    embedLibraryVersions,
    getShowLibraryItems,
    libraryKeepsFromCues,
    libraryKeepsFromHistory,
    pruneShowLibraryInTransaction,
    readLibraryBlob,
    type EmbedLibraryVersion,
} from "../showLibrary";
import { deleteShowLibraryItem, libraryItemUses } from "../showLibraryDelete";
import { hashParts, versionHashOf } from "@/view3d/library/showHash";
import { createCuesInTransaction, getCues, type NewCueArgs } from "../cues";
import {
    createShowBlobCache,
    renderPartHash,
} from "@/view3d/library/showBlobCache";
import type { LibraryKeep } from "@/view3d/library/showLibraryPrune";
import { embedImportedVersions } from "@/view3d/library/showLibraryEmbed";
import { buildAddFromShowRequest } from "@/view3d/library/showLibraryUpdates";
import { AddFromShowRequestSchema } from "@/view3d/library/protocol";
import type { LibraryItem } from "@om-electron/main/library/types";

const bytes = (text: string) => new TextEncoder().encode(text);

/** Each in its own plain transaction, as a caller outside an undoable edit would run them. */
const embedLibraryVersion = ({
    db,
    version,
}: {
    db: DbConnection;
    version: EmbedLibraryVersion;
}) => db.transaction((tx) => embedLibraryVersionInTransaction({ tx, version }));
const pruneShowLibrary = ({
    db,
    keep,
}: {
    db: DbConnection;
    keep: LibraryKeep[];
}) => db.transaction((tx) => pruneShowLibraryInTransaction({ tx, keep }));

const metadata = {
    tags: ["guard"],
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    originalFilename: "rifle.glb",
    derivedFrom: null,
    license: "CC-BY-4.0",
    licenseText: null,
    author: "A. Maker",
    sourceUrl: null,
    attribution: null,
    modified: false,
};

const RIFLE = "11111111-1111-4111-8111-111111111111";
const FLAG = "22222222-2222-4222-8222-222222222222";
const UNIFORM = "33333333-3333-4333-8333-333333333333";

async function version(
    itemId: string,
    parts: Record<string, Uint8Array>,
    extra: Partial<EmbedLibraryVersion> = {},
): Promise<EmbedLibraryVersion> {
    return {
        itemId,
        versionHash: await versionHashOf(await hashParts(parts)),
        kind: "model",
        name: "Rifle",
        builtIn: false,
        metadata,
        pins: [],
        parts,
        ...extra,
    };
}

const rifle = () =>
    version(RIFLE, {
        glb: bytes("glTF rifle"),
        sidecar: bytes('{"kind":"rifle"}'),
    });
const flag = () =>
    version(
        FLAG,
        { original: bytes("flag.png"), display: bytes("flag.ktx2") },
        { kind: "artwork", name: "Flag" },
    );

const rows = async (db: DbConnection) => ({
    items: (await db.select({ c: count() }).from(schema.library_items).get())
        ?.c,
    blobs: (await db.select({ c: count() }).from(schema.library_blobs).get())
        ?.c,
});

describeDbTests("showLibrary", (it) => {
    describe("tables", () => {
        it("keep both tables out of undo history", () => {
            const names = tablesWithHistory.map((t) => getTableName(t));
            expect(names).not.toContain("library_items");
            expect(names).not.toContain("library_blobs");
        });

        it("have no history triggers in the show file", async ({ db }) => {
            const triggers = await db
                .select({ name: sql<string>`name` })
                .from(sql`sqlite_master`)
                .where(
                    sql`type = 'trigger' AND tbl_name IN ('library_items', 'library_blobs')`,
                )
                .all();
            expect(triggers).toEqual([]);
        });

        it("start empty in a new show", async ({ db }) => {
            expect(await rows(db)).toEqual({ items: 0, blobs: 0 });
        });
    });

    describe("embedding", () => {
        it("stores a Version, its blobs and its sidecar", async ({ db }) => {
            const v = await rifle();
            expect(await embedLibraryVersion({ db, version: v })).toEqual({
                embedded: true,
            });

            const [item] = await getShowLibraryItems({ db });
            expect(item).toMatchObject({
                itemId: RIFLE,
                versionHash: v.versionHash,
                kind: "model",
                name: "Rifle",
                builtIn: false,
                metadata,
                pins: [],
                sidecar: { kind: "rifle" },
            });
            expect(Object.keys(item.parts).sort()).toEqual(["glb", "sidecar"]);
            const glb = await readLibraryBlob({ db, hash: item.parts.glb });
            expect(Array.from(glb!)).toEqual(Array.from(v.parts.glb));
        });

        it("is a no-op for a Version the show already has", async ({ db }) => {
            const v = await rifle();
            await embedLibraryVersion({ db, version: v });
            expect(await embedLibraryVersion({ db, version: v })).toEqual({
                embedded: false,
            });
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });

        it("shares a blob between Versions", async ({ db }) => {
            const v1 = await rifle();
            const v2 = await version(RIFLE, {
                glb: bytes("glTF rifle v2"),
                sidecar: v1.parts.sidecar,
            });
            await embedLibraryVersion({ db, version: v1 });
            await embedLibraryVersion({ db, version: v2 });
            expect(await rows(db)).toEqual({ items: 2, blobs: 3 });
        });

        it("refuses parts that don't match the Version hash", async ({
            db,
        }) => {
            const v = await rifle();
            await expect(
                embedLibraryVersion({
                    db,
                    version: { ...v, parts: { ...v.parts, glb: bytes("x") } },
                }),
            ).rejects.toThrow(/Version hash/);
            expect(await rows(db)).toEqual({ items: 0, blobs: 0 });
        });

        it("refuses a sidecar that isn't JSON", async ({ db }) => {
            const v = await version(RIFLE, {
                glb: bytes("g"),
                sidecar: bytes("{"),
            });
            await expect(
                embedLibraryVersion({ db, version: v }),
            ).rejects.toThrow(/sidecar/);
            expect(await rows(db)).toEqual({ items: 0, blobs: 0 });
        });

        it("embeds several Versions all or nothing", async ({ db }) => {
            const r = await rifle();
            const f = await flag();
            await expect(
                embedLibraryVersions({
                    db,
                    versions: [
                        r,
                        { ...f, parts: { ...f.parts, display: bytes("x") } },
                    ],
                }),
            ).rejects.toThrow(/Version hash/);
            expect(await rows(db)).toEqual({ items: 0, blobs: 0 });

            await embedLibraryVersions({ db, versions: [r, f] });
            expect(await rows(db)).toEqual({ items: 2, blobs: 4 });
            expect(await db.select().from(schema.history_undo).all()).toEqual(
                [],
            );
        });

        it("isn't undone with the edit it was embedded in", async ({ db }) => {
            const v = await rifle();
            await transactionWithHistory(db, "placeRifle", async (tx) => {
                await tx.insert(schema.tags).values({ name: "rifles" }).run();
                await embedLibraryVersionInTransaction({ tx, version: v });
            });
            const undoRows = await db.select().from(schema.history_undo).all();
            expect(undoRows.some((r) => r.sql.includes("library_"))).toBe(
                false,
            );

            await performUndo(db);
            expect(await db.select().from(schema.tags).all()).toHaveLength(0);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });

            await performRedo(db);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });
    });

    describe("loading", () => {
        it("skips a row it can't read", async ({ db }) => {
            await embedLibraryVersion({ db, version: await rifle() });
            await db
                .insert(schema.library_items)
                .values({
                    item_id: FLAG,
                    version_hash: "f".repeat(64),
                    kind: "artwork",
                    name: "Broken",
                    parts: "not json",
                    metadata: "{}",
                })
                .run();
            const items = await getShowLibraryItems({ db });
            expect(items.map((i) => i.itemId)).toEqual([RIFLE]);
        });

        it("reads a model and an artwork back from the show alone", async ({
            db,
        }) => {
            const r = await rifle();
            const f = await flag();
            await embedLibraryVersion({ db, version: r });
            await embedLibraryVersion({ db, version: f });

            // No local Library and no IPC: only the show file
            const cache = createShowBlobCache({
                read: (hash) => readLibraryBlob({ db, hash }),
            });
            const items = await getShowLibraryItems({ db });
            const byId = new Map(items.map((i) => [i.itemId, i]));
            const glb = await cache.get(
                renderPartHash(byId.get(RIFLE)!, "glb")!,
            );
            const display = await cache.get(
                renderPartHash(byId.get(FLAG)!, "display")!,
            );
            expect(Array.from(glb!)).toEqual(Array.from(r.parts.glb));
            expect(Array.from(display!)).toEqual(Array.from(f.parts.display));
            expect(() =>
                renderPartHash(byId.get(FLAG)!, "original" as never),
            ).toThrow();
        });

        it("holds an Artwork's original, so another person can add it to their Library", async ({
            db,
        }) => {
            const f = await flag();
            const item: LibraryItem = {
                schemaVersion: 1,
                id: FLAG,
                kind: "artwork",
                name: "Flag",
                tags: metadata.tags,
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt,
                originalFilename: "flag.png",
                derivedFrom: null,
                license: metadata.license,
                licenseText: null,
                author: metadata.author,
                sourceUrl: null,
                attribution: null,
                modified: false,
                builtIn: false,
                versions: [
                    {
                        hash: f.versionHash,
                        createdAt: metadata.createdAt,
                        parts: await hashParts(f.parts),
                        source: null,
                    },
                ],
            };
            // As an import does: copy the saved Version from the local Library
            await embedImportedVersions({
                db,
                saved: [{ item, versionHash: f.versionHash }],
                readParts: async ({ roles }) => ({
                    ok: true,
                    value: Object.fromEntries(
                        roles.map((r) => [r, f.parts[r]]),
                    ),
                }),
            });

            // On the other machine: only the show file
            const [embedded] = await getShowLibraryItems({ db });
            const request = await buildAddFromShowRequest({
                item: embedded,
                readBlob: (hash) => readLibraryBlob({ db, hash }),
            });
            expect(AddFromShowRequestSchema.safeParse(request).success).toBe(
                true,
            );
            expect(Array.from(request.parts.original)).toEqual(
                Array.from(f.parts.original),
            );
            expect(await versionHashOf(await hashParts(request.parts))).toBe(
                f.versionHash,
            );
        });

        it("reads a missing blob as undefined", async ({ db }) => {
            expect(
                await readLibraryBlob({ db, hash: "0".repeat(64) }),
            ).toBeUndefined();
        });
    });

    describe("pruning", () => {
        it("removes Versions nothing keeps and their blobs", async ({ db }) => {
            const r = await rifle();
            await embedLibraryVersion({ db, version: r });
            await embedLibraryVersion({ db, version: await flag() });

            const plan = await pruneShowLibrary({
                db,
                keep: [{ itemId: RIFLE, versionHash: r.versionHash }],
            });
            expect(plan.items.map((i) => i.itemId)).toEqual([FLAG]);
            expect(plan.blobs).toHaveLength(2);
            expect(
                (await getShowLibraryItems({ db })).map((i) => i.itemId),
            ).toEqual([RIFLE]);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });

        it("keeps what a kept Uniform pins", async ({ db }) => {
            const f = await flag();
            await embedLibraryVersion({ db, version: f });
            const u = await version(
                UNIFORM,
                { sidecar: bytes("{}") },
                {
                    kind: "uniform",
                    name: "Home",
                    pins: [{ itemId: FLAG, versionHash: f.versionHash }],
                },
            );
            await embedLibraryVersion({ db, version: u });
            await pruneShowLibrary({ db, keep: [{ itemId: UNIFORM }] });
            expect(await rows(db)).toEqual({ items: 2, blobs: 3 });
        });

        it("leaves no orphan blobs", async ({ db }) => {
            await db
                .insert(schema.library_blobs)
                .values({ hash: "e".repeat(64), data: bytes("stray") })
                .run();
            await pruneShowLibrary({ db, keep: [] });
            expect(await rows(db)).toEqual({ items: 0, blobs: 0 });
        });

        it("keeps an item an undo or redo row names", async ({ db }) => {
            await embedLibraryVersion({ db, version: await rifle() });
            await embedLibraryVersion({ db, version: await flag() });
            // A cue table doesn't exist yet: stand in with a tag naming the item
            await transactionWithHistory(db, "nameRifle", async (tx) => {
                await tx.insert(schema.tags).values({ name: RIFLE }).run();
            });
            await transactionWithHistory(db, "deleteRifleTag", async (tx) => {
                await tx.delete(schema.tags).run();
            });

            expect(await libraryKeepsFromHistory({ db })).toEqual([
                { itemId: RIFLE },
            ]);
            await pruneShowLibrary({ db, keep: [] });
            expect(
                (await getShowLibraryItems({ db })).map((i) => i.itemId),
            ).toEqual([RIFLE]);

            // Undo moves the row to redo; the item is still kept
            await performUndo(db);
            await performUndo(db);
            expect(await libraryKeepsFromHistory({ db })).toEqual([
                { itemId: RIFLE },
            ]);
        });

        it("keeps the Versions cues name", async ({ db }) => {
            const r = await rifle();
            await embedLibraryVersion({ db, version: r });
            await embedLibraryVersion({ db, version: await flag() });
            // Outside history, so only the cue keeps the rifle
            await db.transaction((tx) =>
                createCuesInTransaction({
                    tx,
                    newCues: [
                        {
                            channel: "carry",
                            kind: "state",
                            target: { kind: "band" },
                            beatId: 0,
                            value: `library:${RIFLE}@${r.versionHash}`,
                        },
                    ],
                }),
            );

            expect(await libraryKeepsFromCues({ db })).toEqual([
                { itemId: RIFLE, versionHash: r.versionHash },
            ]);
            const plan = await pruneShowLibrary({ db, keep: [] });
            expect(plan.items.map((i) => i.itemId)).toEqual([FLAG]);
            expect(
                (await getShowLibraryItems({ db })).map((i) => i.itemId),
            ).toEqual([RIFLE]);
        });

        it("removes no blobs while a row can't be read", async ({ db }) => {
            await embedLibraryVersion({ db, version: await rifle() });
            await db
                .insert(schema.library_items)
                .values({
                    item_id: FLAG,
                    version_hash: "f".repeat(64),
                    kind: "artwork",
                    name: "Broken",
                    parts: "not json",
                    metadata: "{}",
                })
                .run();
            const plan = await pruneShowLibrary({ db, keep: [] });
            expect(plan.items.map((i) => i.itemId)).toEqual([RIFLE]);
            expect(plan.blobs).toEqual([]);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });

        it("doesn't write to undo history", async ({ db }) => {
            await embedLibraryVersion({ db, version: await rifle() });
            const before = await db.select().from(schema.history_undo).all();
            await pruneShowLibrary({ db, keep: [] });
            expect(await db.select().from(schema.history_undo).all()).toEqual(
                before,
            );
        });
    });

    describe("deleting", () => {
        /** A beat after the start, for a cue to sit on; a new show has only beat 0. */
        const LATER = 7;
        const silkCue = (
            versionHash: string,
            extra: Partial<NewCueArgs> = {},
        ): NewCueArgs => ({
            channel: "silk",
            kind: "state",
            target: { kind: "section", section: "Flag" },
            beatId: LATER,
            value: `library:${FLAG}@${versionHash}`,
            ...extra,
        });
        const addCues = async (db: DbConnection, newCues: NewCueArgs[]) => {
            await db
                .insert(schema.beats)
                .values({ id: LATER, duration: 0.5, position: 1 })
                .onConflictDoNothing()
                .run();
            return await db.transaction((tx) =>
                createCuesInTransaction({ tx, newCues }),
            );
        };
        const itemIds = async (db: DbConnection) =>
            (await getShowLibraryItems({ db })).map((i) => i.itemId).sort();

        it("removes every Version of an item nothing uses, and its blobs", async ({
            db,
        }) => {
            await embedLibraryVersion({ db, version: await rifle() });
            await embedLibraryVersion({ db, version: await flag() });
            await embedLibraryVersion({
                db,
                version: await version(
                    FLAG,
                    { original: bytes("flag2.png") },
                    { kind: "artwork", name: "Flag" },
                ),
            });

            const result = await deleteShowLibraryItem({ db, itemId: FLAG });
            expect(result).toEqual({ outcome: "deleted" });
            expect(await itemIds(db)).toEqual([RIFLE]);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });

        it("keeps a blob another item still names", async ({ db }) => {
            await embedLibraryVersion({ db, version: await flag() });
            await embedLibraryVersion({
                db,
                version: await version(
                    RIFLE,
                    { glb: bytes("flag.png") },
                    { name: "Same bytes" },
                ),
            });
            await deleteShowLibraryItem({ db, itemId: FLAG });
            expect(await rows(db)).toEqual({ items: 1, blobs: 1 });
        });

        it("is refused while a cue uses it, and lists the cues", async ({
            db,
        }) => {
            const f = await flag();
            await embedLibraryVersion({ db, version: f });
            const [cue] = await addCues(db, [silkCue(f.versionHash)]);
            await addCues(db, [
                {
                    channel: "carry",
                    kind: "state",
                    target: { kind: "band" },
                    beatId: 0,
                    value: "none",
                },
            ]);

            const result = await deleteShowLibraryItem({ db, itemId: FLAG });
            if (result.outcome !== "inUse") throw new Error(result.outcome);
            expect(result.uses.cues.map((u) => u.cue.id)).toEqual([cue!.id]);
            expect(result.uses.pinnedBy).toEqual([]);
            expect(await itemIds(db)).toEqual([FLAG]);
            expect(await rows(db)).toEqual({ items: 1, blobs: 2 });
        });

        it("is refused while another item pins it", async ({ db }) => {
            const f = await flag();
            await embedLibraryVersion({ db, version: f });
            await embedLibraryVersion({
                db,
                version: await version(
                    UNIFORM,
                    { sidecar: bytes("{}") },
                    {
                        kind: "uniform",
                        name: "Home",
                        pins: [{ itemId: FLAG, versionHash: f.versionHash }],
                    },
                ),
            });

            const result = await deleteShowLibraryItem({ db, itemId: FLAG });
            if (result.outcome !== "inUse") throw new Error(result.outcome);
            expect(result.uses.pinnedBy).toEqual([
                { itemId: UNIFORM, name: "Home" },
            ]);
        });

        it("doesn't write to undo history", async ({ db }) => {
            await embedLibraryVersion({ db, version: await flag() });
            const before = await db.select().from(schema.history_undo).all();
            await deleteShowLibraryItem({ db, itemId: FLAG });
            expect(await db.select().from(schema.history_undo).all()).toEqual(
                before,
            );
        });

        describe("uses", () => {
            it("finds cues naming any Version of the item, with each cue's count and tag", async ({
                db,
            }) => {
                const f = await flag();
                await embedLibraryVersion({ db, version: f });
                const tagId = (
                    await db
                        .insert(schema.tags)
                        .values({ name: "Front" })
                        .returning({ id: schema.tags.id })
                        .get()
                ).id;
                await addCues(db, [
                    silkCue(f.versionHash),
                    silkCue("a".repeat(64), {
                        beatId: 0,
                        target: { kind: "tag", tagId },
                    }),
                    silkCue(f.versionHash, {
                        value: `library:${RIFLE}@${f.versionHash}`,
                    }),
                ]);

                const uses = await libraryItemUses({ db, itemId: FLAG });
                expect(
                    uses.cues.map((u) => ({
                        beatId: u.cue.beatId,
                        tag: u.tagName,
                    })),
                ).toEqual([
                    { beatId: 0, tag: "Front" },
                    { beatId: LATER, tag: null },
                ]);
                expect(uses.cues.map((u) => u.beatIndex)).toEqual([0, 1]);
            });

            it("finds nothing in a show without cues", async ({ db }) => {
                await db.run(sql`DROP TABLE cue_marchers`);
                await db.run(sql`DROP TABLE cues`);
                expect(await libraryItemUses({ db, itemId: FLAG })).toEqual({
                    cues: [],
                    floor: false,
                    items: [],
                    pinnedBy: [],
                });
            });
        });

        it("keeps an item an undo row names, until a prune finds nothing naming it", async ({
            db,
        }) => {
            const f = await flag();
            await embedLibraryVersion({ db, version: f });
            await transactionWithHistory(db, "createSilkCue", (tx) =>
                createCuesInTransaction({
                    tx,
                    newCues: [{ ...silkCue(f.versionHash), beatId: 0 }],
                }),
            );
            await performUndo(db);

            // Redo would bring the cue back, so the silk stays
            expect(await deleteShowLibraryItem({ db, itemId: FLAG })).toEqual({
                outcome: "keptForUndo",
            });
            expect(await itemIds(db)).toEqual([FLAG]);
            await performRedo(db);
            expect((await getCues({ db }))[0]!.value).toBe(
                `library:${FLAG}@${f.versionHash}`,
            );
        });

        describe("replacing", () => {
            const other = () =>
                version(
                    "44444444-4444-4444-8444-444444444444",
                    { original: bytes("other.png") },
                    { kind: "artwork", name: "Other" },
                );

            it("points every cue at the replacement as one undoable edit, and keeps the item for undo", async ({
                db,
            }) => {
                const f = await flag();
                const o = await other();
                await embedLibraryVersion({ db, version: f });
                await embedLibraryVersion({ db, version: o });
                await addCues(db, [
                    silkCue(f.versionHash),
                    silkCue(f.versionHash, { beatId: 0 }),
                ]);
                const to = { itemId: o.itemId, versionHash: o.versionHash };
                const values = async () =>
                    (await getCues({ db })).map((c) => c.value);

                expect(
                    await deleteShowLibraryItem({
                        db,
                        itemId: FLAG,
                        replaceWith: to,
                    }),
                ).toEqual({ outcome: "keptForUndo" });
                expect(await values()).toEqual([
                    `library:${to.itemId}@${to.versionHash}`,
                    `library:${to.itemId}@${to.versionHash}`,
                ]);
                expect(await itemIds(db)).toEqual([o.itemId, FLAG].sort());

                // Undo finds the item it used
                await performUndo(db);
                expect(await values()).toEqual([
                    `library:${FLAG}@${f.versionHash}`,
                    `library:${FLAG}@${f.versionHash}`,
                ]);
                expect(await itemIds(db)).toContain(FLAG);
                await performRedo(db);
                expect(await values()).toEqual([
                    `library:${to.itemId}@${to.versionHash}`,
                    `library:${to.itemId}@${to.versionHash}`,
                ]);
            });

            it("refuses a replacement of another role, such as the floor for a Silk", async ({
                db,
            }) => {
                const silk = await version(
                    FLAG,
                    {
                        original: bytes("flag.png"),
                        sidecar: bytes('{"surface":"silk"}'),
                    },
                    { kind: "artwork", name: "Flag" },
                );
                const floor = await version(
                    "44444444-4444-4444-8444-444444444444",
                    {
                        original: bytes("floor.png"),
                        sidecar: bytes('{"surface":"baseFloor"}'),
                    },
                    { kind: "artwork", name: "Field image" },
                );
                await embedLibraryVersion({ db, version: silk });
                await embedLibraryVersion({ db, version: floor });
                await addCues(db, [silkCue(silk.versionHash)]);

                await expect(
                    deleteShowLibraryItem({
                        db,
                        itemId: FLAG,
                        replaceWith: {
                            itemId: floor.itemId,
                            versionHash: floor.versionHash,
                        },
                    }),
                ).rejects.toThrow(/role/);
                expect((await getCues({ db }))[0]!.value).toBe(
                    `library:${FLAG}@${silk.versionHash}`,
                );
            });

            it("refuses a replacement of another kind, or one the show lacks, and changes nothing", async ({
                db,
            }) => {
                const f = await flag();
                const r = await rifle();
                await embedLibraryVersion({ db, version: f });
                await embedLibraryVersion({ db, version: r });
                await addCues(db, [silkCue(f.versionHash)]);

                await expect(
                    deleteShowLibraryItem({
                        db,
                        itemId: FLAG,
                        replaceWith: {
                            itemId: RIFLE,
                            versionHash: r.versionHash,
                        },
                    }),
                ).rejects.toThrow(/kind/);
                await expect(
                    deleteShowLibraryItem({
                        db,
                        itemId: FLAG,
                        replaceWith: {
                            itemId: UNIFORM,
                            versionHash: "b".repeat(64),
                        },
                    }),
                ).rejects.toThrow(/doesn't have/);
                expect((await getCues({ db }))[0]!.value).toBe(
                    `library:${FLAG}@${f.versionHash}`,
                );
                expect(await itemIds(db)).toEqual([RIFLE, FLAG].sort());
            });
        });
    });

    describe("references (libraryReferences)", () => {
        const FLOOR_ID = "55555555-5555-4555-8555-555555555555";
        const floorVersion = () =>
            version(
                FLOOR_ID,
                {
                    original: bytes("tarp.png"),
                    display: bytes("tarp display"),
                    sidecar: bytes('{"surface":"baseFloor"}'),
                },
                { kind: "artwork", name: "Field image" },
            );
        const refOf = (v: EmbedLibraryVersion) => ({
            itemId: v.itemId,
            versionHash: v.versionHash,
        });

        /**
         * The props packages' Item tables (C2.1 `items`, C2.4 `item_artwork_slots`), as far as
         * the references go, for a branch that doesn't have them yet.
         */
        const addItemTables = async (db: DbConnection) => {
            await db.run(
                sql.raw(`CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY,
                    marcher_id INTEGER NOT NULL,
                    library_item_id TEXT,
                    library_version_hash TEXT)`),
            );
            await db.run(
                sql.raw(`CREATE TABLE IF NOT EXISTS item_artwork_slots (
                    id INTEGER PRIMARY KEY,
                    item_id INTEGER NOT NULL,
                    beat_id INTEGER NOT NULL,
                    slot TEXT NOT NULL,
                    library_item_id TEXT,
                    library_version_hash TEXT)`),
            );
        };
        const addProp = async (
            db: DbConnection,
            id: number,
            name: string,
            model: { itemId: string; versionHash: string } | null,
        ) => {
            await db.run(
                sql`INSERT INTO marchers (id, name, section, drill_prefix, drill_order) VALUES (${id}, ${name}, 'Prop', 'P', ${id})`,
            );
            await db.run(
                sql`INSERT INTO items (id, marcher_id, library_item_id, library_version_hash) VALUES (${id}, ${id}, ${model?.itemId ?? null}, ${model?.versionHash ?? null})`,
            );
        };

        /** Tables with a Library column that no registry source reads. */
        const uncoveredTables = async (db: DbConnection) => {
            const covered = new Set(
                Object.values(LIBRARY_REFERENCE_SOURCES).flatMap(
                    (s) => s.tables,
                ),
            );
            const tables = await db
                .select({ name: sql<string>`name` })
                .from(sql`sqlite_schema`)
                .where(
                    sql`type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
                )
                .all();
            const uncovered: string[] = [];
            for (const { name } of tables) {
                // The Library's own tables hold it; they don't reference it
                if (name === "library_items" || name === "library_blobs")
                    continue;
                const columns = await db
                    .select({ name: sql<string>`name` })
                    .from(sql`pragma_table_info(${name})`)
                    .all();
                if (
                    columns.some((c) =>
                        /^library_(item_id|version_hash)$/.test(c.name),
                    ) &&
                    !covered.has(name)
                )
                    uncovered.push(name);
            }
            return uncovered;
        };

        it("reads every table that has a Library column", async ({ db }) => {
            await addItemTables(db);
            expect(await uncoveredTables(db)).toEqual([]);
        });

        it("fails for a table with a Library column no source reads", async ({
            db,
        }) => {
            await db.run(
                sql.raw(
                    "CREATE TABLE widgets (id INTEGER PRIMARY KEY, library_item_id TEXT, library_version_hash TEXT)",
                ),
            );
            expect(await uncoveredTables(db)).toEqual(["widgets"]);
        });

        it("names the floor, a converted one outside history included, and refuses to delete it", async ({
            db,
        }) => {
            const floor = await floorVersion();
            await embedLibraryVersion({ db, version: floor });
            await db.transaction((tx) =>
                setFieldFloorInTransaction({ tx, floor: refOf(floor) }),
            );
            // As convert on open leaves it: no undo row names it
            await db.run(sql`DELETE FROM history_undo`);

            expect(await libraryReferences({ db })).toContainEqual({
                source: "floor",
                ...refOf(floor),
            });
            const result = await deleteShowLibraryItem({
                db,
                itemId: FLOOR_ID,
            });
            expect(result).toMatchObject({
                outcome: "inUse",
                uses: { floor: true, cues: [], items: [], pinnedBy: [] },
            });
            expect(await getFieldFloorImage({ db })).not.toBeNull();
        });

        it("refuses to delete an uploaded floor, whose new id no undo row holds yet", async ({
            db,
        }) => {
            const floor = await floorVersion();
            await embedLibraryVersion({ db, version: floor });
            await setFieldFloor({ db, floor: refOf(floor) });
            expect(
                await deleteShowLibraryItem({ db, itemId: FLOOR_ID }),
            ).toMatchObject({ outcome: "inUse", uses: { floor: true } });
        });

        it("names item models and slot artwork, dormant ones included, and refuses to delete them", async ({
            db,
        }) => {
            await addItemTables(db);
            const r = await rifle();
            const f = await flag();
            await embedLibraryVersion({ db, version: r });
            await embedLibraryVersion({ db, version: f });
            await addProp(db, 41, "Rifle 1", refOf(r));
            await addProp(db, 42, "", null);
            // A slot the model no longer declares stays stored, dormant
            await db.run(
                sql`INSERT INTO item_artwork_slots (item_id, beat_id, slot, library_item_id, library_version_hash) VALUES (42, 0, 'retired', ${FLAG}, ${f.versionHash})`,
            );

            const refs = await libraryReferences({ db });
            expect(refs).toContainEqual({
                source: "itemModels",
                ...refOf(r),
                marcherId: 41,
            });
            expect(refs).toContainEqual({
                source: "itemArtworkSlots",
                ...refOf(f),
                marcherId: 42,
                slot: "retired",
            });

            expect(
                await deleteShowLibraryItem({ db, itemId: RIFLE }),
            ).toMatchObject({
                outcome: "inUse",
                uses: {
                    items: [{ marcherId: 41, label: "Rifle 1", slot: null }],
                },
            });
            expect(
                await deleteShowLibraryItem({ db, itemId: FLAG }),
            ).toMatchObject({
                outcome: "inUse",
                uses: {
                    items: [{ marcherId: 42, label: "P42", slot: "retired" }],
                },
            });
            // Replace with… only moves cues: an item use still refuses
            const other = await version(UNIFORM, {
                glb: bytes("glTF other rifle"),
                sidecar: bytes('{"kind":"rifle"}'),
            });
            await embedLibraryVersion({ db, version: other });
            expect(
                await deleteShowLibraryItem({
                    db,
                    itemId: RIFLE,
                    replaceWith: refOf(other),
                }),
            ).toMatchObject({
                outcome: "inUse",
                uses: { items: [{ marcherId: 41 }] },
            });

            // And the prune keeps both
            await pruneShowLibrary({ db, keep: [] });
            expect(
                (await getShowLibraryItems({ db })).map((i) => i.itemId).sort(),
            ).toEqual([RIFLE, FLAG].sort());
        });
    });
});
