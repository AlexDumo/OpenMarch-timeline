import { describe, expect } from "vitest";
import { eq } from "drizzle-orm";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { performRedo, performUndo } from "../history";
import {
    embedLibraryVersions,
    pruneShowLibraryInTransaction,
    type EmbedLibraryVersion,
} from "../showLibrary";
import {
    getFieldFloor,
    getFieldFloorImage,
    libraryKeepsFromFloor,
} from "../fieldFloor";
import { setFieldFloor } from "../fieldFloorEdits";
import { hashParts, versionHashOf } from "@/view3d/library/showHash";

const bytes = (text: string) => new TextEncoder().encode(text);
/** The image as text, so bytes from another realm compare equal */
const imageText = async (image: Promise<Uint8Array | null>) => {
    const data = await image;
    return data && new TextDecoder().decode(Uint8Array.from(data));
};

const FLOOR = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

const metadata = {
    tags: [],
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
    originalFilename: "tarp.png",
    derivedFrom: null,
    license: null,
    licenseText: null,
    author: null,
    sourceUrl: null,
    attribution: null,
    modified: false,
};

async function artwork(
    itemId: string,
    display: string,
): Promise<EmbedLibraryVersion> {
    const parts = {
        original: bytes(`${display}.original`),
        display: bytes(display),
    };
    return {
        itemId,
        versionHash: await versionHashOf(await hashParts(parts)),
        kind: "artwork",
        name: "Tarp",
        builtIn: false,
        metadata,
        pins: [],
        parts,
    };
}

const refOf = (v: EmbedLibraryVersion) => ({
    itemId: v.itemId,
    versionHash: v.versionHash,
});

const fieldJson = async (db: DbConnection) =>
    JSON.parse(
        (await db
            .select({ json: schema.field_properties.json_data })
            .from(schema.field_properties)
            .where(eq(schema.field_properties.id, 1))
            .get())!.json,
    ) as Record<string, unknown>;

describeDbTests("fieldFloor", (it) => {
    describe("getFieldFloorImage", () => {
        it("is null for a show with no floor", async ({ db }) => {
            expect(await getFieldFloor({ db })).toBeNull();
            expect(await getFieldFloorImage({ db })).toBeNull();
        });

        it("reads the floor's display texture", async ({ db }) => {
            const tarp = await artwork(FLOOR, "tarp display");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });

            expect(await getFieldFloor({ db })).toEqual(refOf(tarp));
            expect(await imageText(getFieldFloorImage({ db }))).toBe(
                "tarp display",
            );
        });

        it("never reads the legacy field_properties.image", async ({ db }) => {
            await db
                .update(schema.field_properties)
                .set({ image: bytes("legacy image") })
                .where(eq(schema.field_properties.id, 1))
                .run();
            expect(await getFieldFloorImage({ db })).toBeNull();
        });

        it("is null when the floor's Version isn't in the show", async ({
            db,
        }) => {
            const json = await fieldJson(db);
            await db
                .update(schema.field_properties)
                .set({
                    json_data: JSON.stringify({
                        ...json,
                        floor: { itemId: FLOOR, versionHash: "c".repeat(64) },
                    }),
                })
                .where(eq(schema.field_properties.id, 1))
                .run();
            expect(await getFieldFloorImage({ db })).toBeNull();
        });
    });

    describe("setFieldFloor", () => {
        it("refuses a floor that isn't embedded in the show", async ({
            db,
        }) => {
            await expect(
                setFieldFloor({
                    db,
                    floor: { itemId: FLOOR, versionHash: "d".repeat(64) },
                }),
            ).rejects.toThrow(/isn't in this show/);
            expect(await getFieldFloor({ db })).toBeNull();
        });

        it("keeps the other field properties", async ({ db }) => {
            const before = await fieldJson(db);
            const tarp = await artwork(FLOOR, "tarp");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            expect(await fieldJson(db)).toEqual({
                ...before,
                floor: refOf(tarp),
            });

            await setFieldFloor({ db, floor: null });
            expect(await fieldJson(db)).toEqual(before);
        });

        it("undoes and redoes setting, replacing and clearing the floor", async ({
            db,
        }) => {
            const first = await artwork(FLOOR, "first");
            const second = await artwork(OTHER, "second");
            await embedLibraryVersions({ db, versions: [first, second] });

            await setFieldFloor({ db, floor: refOf(first) });
            await setFieldFloor({ db, floor: refOf(second) });
            await setFieldFloor({ db, floor: null });
            expect(await getFieldFloorImage({ db })).toBeNull();

            await performUndo(db);
            expect(await imageText(getFieldFloorImage({ db }))).toBe("second");
            await performUndo(db);
            expect(await imageText(getFieldFloorImage({ db }))).toBe("first");
            await performRedo(db);
            expect(await imageText(getFieldFloorImage({ db }))).toBe("second");
        });

        it("records only a field_properties change in history", async ({
            db,
        }) => {
            const tarp = await artwork(FLOOR, "tarp");
            await embedLibraryVersions({ db, versions: [tarp] });
            const before = await db.select().from(schema.history_undo).all();
            await setFieldFloor({ db, floor: refOf(tarp) });
            const added = (
                await db.select().from(schema.history_undo).all()
            ).slice(before.length);
            expect(added.length).toBeGreaterThan(0);
            for (const row of added)
                expect(row.sql).toMatch(/field_properties/);
        });
    });

    describe("prune", () => {
        it("keeps the floor's Version and prunes the rest", async ({ db }) => {
            const tarp = await artwork(FLOOR, "tarp");
            const unused = await artwork(OTHER, "unused");
            await embedLibraryVersions({ db, versions: [tarp, unused] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            // Clear history so only the floor itself keeps an item
            await db.delete(schema.history_undo).run();
            await db.delete(schema.history_redo).run();

            expect(await libraryKeepsFromFloor({ db })).toEqual([refOf(tarp)]);
            const plan = await db.transaction((tx) =>
                pruneShowLibraryInTransaction({ tx, keep: [] }),
            );
            expect(plan.items).toEqual([refOf(unused)]);
            const left = await db
                .select({ id: schema.library_items.item_id })
                .from(schema.library_items)
                .all();
            expect(left).toEqual([{ id: FLOOR }]);
        });

        it("keeps a floor that only undo history names", async ({ db }) => {
            const tarp = await artwork(FLOOR, "tarp");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            await setFieldFloor({ db, floor: null });

            const plan = await db.transaction((tx) =>
                pruneShowLibraryInTransaction({ tx, keep: [] }),
            );
            expect(plan.items).toEqual([]);
        });
    });
});
