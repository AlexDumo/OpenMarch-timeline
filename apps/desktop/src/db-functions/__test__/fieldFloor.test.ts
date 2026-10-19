import { describe, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
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
    getFieldFloorPart,
    getFieldImage,
    libraryKeepsFromFloor,
    writeFieldJsonKeepingFloorInTransaction,
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

        it("reads the floor's original as imported, for a new show to copy", async ({
            db,
        }) => {
            const tarp = await artwork(FLOOR, "tarp display");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            expect(
                await imageText(getFieldFloorPart({ db, role: "original" })),
            ).toBe("tarp display.original");
        });

        it("draws a legacy image that hasn't become a floor, rather than nothing", async ({
            db,
        }) => {
            await db
                .update(schema.field_properties)
                .set({ image: bytes("legacy image") })
                .where(eq(schema.field_properties.id, 1))
                .run();
            expect(await imageText(getFieldFloorImage({ db }))).toBe(
                "legacy image",
            );
            const image = await getFieldImage({ db, use: "print" });
            expect(image).toMatchObject({ source: "legacy", size: null });
        });

        it("prefers the floor to a legacy image beside it", async ({ db }) => {
            await db
                .update(schema.field_properties)
                .set({ image: bytes("legacy image") })
                .where(eq(schema.field_properties.id, 1))
                .run();
            const tarp = await artwork(FLOOR, "tarp display");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            expect(await imageText(getFieldFloorImage({ db }))).toBe(
                "tarp display",
            );
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

    describe("getFieldImage", () => {
        const png = (text: string) =>
            new Uint8Array([
                0x89,
                0x50,
                0x4e,
                0x47,
                0x0d,
                0x0a,
                0x1a,
                0x0a,
                ...bytes(text),
            ]);
        async function floorWith(original: Uint8Array, sizeM: number[]) {
            const sidecar = bytes(
                JSON.stringify({
                    schemaVersion: 1,
                    type: "openmarch-artwork",
                    surface: "baseFloor",
                    original: {
                        format: "png",
                        page: null,
                        pixels: { width: 4800, height: 2560 },
                        colorSpace: "srgb",
                    },
                    size: {
                        width: { m: sizeM[0] },
                        height: { m: sizeM[1] },
                        source: "slot",
                        templateId: null,
                    },
                    nativeDpi: 300,
                    display: { width: 2048, height: 1092, format: "jpeg" },
                    importNotes: [],
                    badges: [],
                }),
            );
            const parts = { original, display: bytes("display"), sidecar };
            const version: EmbedLibraryVersion = {
                itemId: FLOOR,
                versionHash: await versionHashOf(await hashParts(parts)),
                kind: "artwork",
                name: "Tarp",
                builtIn: false,
                metadata,
                pins: [],
                parts,
            };
            return version;
        }

        it("gives 2D and exports a PNG or JPEG original, and 3D the display texture", async ({
            db,
        }) => {
            const tarp = await floorWith(png("original"), [36.576, 27.432]);
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });

            const print = await getFieldImage({ db, use: "print" });
            expect(Array.from(print!.bytes)).toEqual(
                Array.from(png("original")),
            );
            expect(print).toMatchObject({
                source: "floor",
                size: { widthM: 36.576, heightM: 27.432 },
            });
            const display = await getFieldImage({ db, use: "display" });
            expect(await imageText(Promise.resolve(display!.bytes))).toBe(
                "display",
            );
            expect(display!.size).toEqual(print!.size);
        });

        it("gives 2D a vector original's display texture, which it can draw", async ({
            db,
        }) => {
            const tarp = await floorWith(bytes("<svg></svg>"), [10, 5]);
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });
            const print = await getFieldImage({ db, use: "print" });
            expect(await imageText(Promise.resolve(print!.bytes))).toBe(
                "display",
            );
        });
    });

    describe("file version (D-23)", () => {
        const userVersion = async (db: DbConnection) =>
            (
                await db
                    .select({ v: sql<number>`user_version` })
                    .from(sql`pragma_user_version`)
                    .get()
            )?.v;

        it("writes 9 when a floor is set, so an older build refuses the file", async ({
            db,
        }) => {
            await db.run(sql.raw("PRAGMA user_version = 8"));
            const tarp = await artwork(FLOOR, "tarp display");
            await embedLibraryVersions({ db, versions: [tarp] });
            expect(await userVersion(db)).toBe(8);

            await setFieldFloor({ db, floor: refOf(tarp) });
            expect(await userVersion(db)).toBe(9);
        });

        it("leaves the version alone when a floor is cleared", async ({
            db,
        }) => {
            await db.run(sql.raw("PRAGMA user_version = 8"));
            await setFieldFloor({ db, floor: null });
            expect(await userVersion(db)).toBe(8);
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

        it("applies a patch in the same edit, such as showing the field image", async ({
            db,
        }) => {
            const tarp = await artwork(FLOOR, "tarp");
            await embedLibraryVersions({ db, versions: [tarp] });
            const json = await fieldJson(db);
            await db
                .update(schema.field_properties)
                .set({
                    json_data: JSON.stringify({
                        ...json,
                        showFieldImage: false,
                    }),
                })
                .where(eq(schema.field_properties.id, 1))
                .run();
            const before = await db.select().from(schema.history_undo).all();

            await setFieldFloor({
                db,
                floor: refOf(tarp),
                patch: { showFieldImage: true },
            });

            expect(await fieldJson(db)).toMatchObject({
                showFieldImage: true,
                floor: refOf(tarp),
            });
            const groups = new Set(
                (await db.select().from(schema.history_undo).all())
                    .slice(before.length)
                    .map((row) => row.history_group),
            );
            expect(groups.size).toBe(1);
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

    describe("writeFieldJsonKeepingFloorInTransaction", () => {
        it("keeps the floor when a template replaces the field properties", async ({
            db,
        }) => {
            const tarp = await artwork(FLOOR, "tarp");
            await embedLibraryVersions({ db, versions: [tarp] });
            await setFieldFloor({ db, floor: refOf(tarp) });

            await db.transaction((tx) =>
                writeFieldJsonKeepingFloorInTransaction({
                    tx,
                    json: JSON.stringify({ name: "High School Football" }),
                }),
            );

            expect(await fieldJson(db)).toEqual({
                name: "High School Football",
                floor: refOf(tarp),
            });
        });

        it("ignores a floor in the written JSON: only setFieldFloor sets it", async ({
            db,
        }) => {
            await db.transaction((tx) =>
                writeFieldJsonKeepingFloorInTransaction({
                    tx,
                    json: JSON.stringify({
                        name: "Gym",
                        floor: { itemId: OTHER, versionHash: "9".repeat(64) },
                    }),
                }),
            );
            expect(await fieldJson(db)).toEqual({ name: "Gym" });
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
