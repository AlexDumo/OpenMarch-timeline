import { describe, expect } from "vitest";
import { describeDbTests } from "@/test/base";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";
import { performRedo, performUndo } from "../history";
import { getStoredVenueSettings, updateVenueSettings } from "../view3dVenue";
import {
    getShowAsset,
    getShowAssetReferences,
    getShowAssets,
    historyEncoding,
    readShowAssetBlob,
    valuesNamedInHistory,
} from "../showAssets";
import { sql } from "drizzle-orm";
import { setUniformPack } from "../view3dUniformPack";
import { parseShowAssetRef } from "@/showAssets/ref";
import { REMOVABLE_ASSET_KINDS, showAssetUse } from "@/showAssets/assetUse";
import {
    readUniformPack,
    writeUniformPack,
} from "@/view3d/core/uniformPack/format";
import {
    fakePng,
    sampleManifest,
} from "@/view3d/core/uniformPack/__test__/fixtures";
import { defaultVenueForField } from "@/view3d/core/venueSettings";

const field = FootballTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/** The tag-1 "Home uniform" with a crest on the chest: format version 2 */
const packWithItemsFixture = () =>
    writeUniformPack(
        {
            ...sampleManifest("Home uniform"),
            items: [
                {
                    id: "crest",
                    file: "items/crest.png",
                    panel: "front",
                    at: [17, 25.32],
                    width: 6,
                },
            ],
        },
        {
            "layers/base.png": fakePng(3360, 2816, 1),
            "items/crest.png": fakePng(512, 512, 9),
        },
    );

const packFile = (name = "Home uniform", tag = 0) =>
    writeUniformPack(sampleManifest(name), {
        "layers/base.png": fakePng(3360, 2816, tag),
    });

/** What the editor passes: the file, and its manifest as the worker read it */
const store = (
    db: Parameters<typeof setUniformPack>[0]["db"],
    pack: Uint8Array,
) =>
    setUniformPack({
        db,
        pack,
        manifest: readUniformPack(pack).manifest,
        field,
    });

describeDbTests("view3dUniformPack", (it) => {
    describe("setUniformPack", () => {
        it("stores the pack file unchanged as a uniform asset and dresses the band in it", async ({
            db,
        }) => {
            const bytes = packFile();
            const value = await store(db, bytes);
            const venue = await getStoredVenueSettings({ db });
            expect(venue?.uniformArtwork).toBe(value);

            const ref = parseShowAssetRef(value)!;
            const asset = await getShowAsset({ db, ref });
            expect(asset).toMatchObject({
                kind: "uniform",
                name: "Home uniform",
                credits: { author: "A. Designer", license: "CC-BY-4.0" },
            });
            expect(Object.keys(asset!.parts)).toEqual(["pack"]);
            // the show holds the very bytes of the portable file
            const stored = await readShowAssetBlob({
                db,
                hash: asset!.parts.pack,
            });
            expect(Array.from(stored!)).toEqual(Array.from(bytes));
            expect(readUniformPack(stored!).manifest).toEqual(sampleManifest());
        });

        it("keeps the rest of the venue and the band's preset", async ({
            db,
        }) => {
            await updateVenueSettings({
                db,
                settings: {
                    ...defaultVenueForField(field),
                    uniforms: "prism",
                    crowd: false,
                },
            });
            await store(db, packFile());
            const venue = await getStoredVenueSettings({ db });
            expect(venue?.uniforms).toBe("prism");
            expect(venue?.crowd).toBe(false);
        });

        it("reuses the asset when the same file comes back", async ({ db }) => {
            const first = await store(db, packFile());
            const again = await store(db, packFile());
            expect(again).toBe(first);
            expect(
                (await getShowAssets({ db })).filter(
                    (a) => a.kind === "uniform",
                ),
            ).toHaveLength(1);
        });

        it("undoes and redoes like other venue changes, keeping the asset", async ({
            db,
        }) => {
            const first = await store(db, packFile("One", 1));
            const second = await store(db, packFile("Two", 2));
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                first,
            );
            await performRedo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                second,
            );
            // assets are outside history: both are still in the show
            expect(
                (await getShowAssets({ db })).filter(
                    (a) => a.kind === "uniform",
                ),
            ).toHaveLength(2);
        });

        it("saves an item edit as a new version of the same uniform, undone like a venue change (#1258)", async ({
            db,
        }) => {
            const plain = await store(db, packFile("Home uniform", 1));
            const read = readUniformPack(packWithItemsFixture());
            const withCrest = await setUniformPack({
                db,
                pack: packWithItemsFixture(),
                manifest: read.manifest,
                field,
                versionOf: parseShowAssetRef(plain)!.id,
            });
            const a = parseShowAssetRef(plain)!;
            const b = parseShowAssetRef(withCrest)!;
            // the same uniform, a new version
            expect(b.id).toBe(a.id);
            expect(b.versionHash).not.toBe(a.versionHash);
            expect((await getShowAsset({ db, ref: b }))?.sidecar).toEqual({
                formatVersion: 2,
            });
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                withCrest,
            );
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                plain,
            );
            await performRedo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                withCrest,
            );
            // a versionOf the show doesn't have is a uniform of its own
            const other = await setUniformPack({
                db,
                pack: packFile("Away", 3),
                manifest: readUniformPack(packFile("Away", 3)).manifest,
                field,
                versionOf: "00000000-0000-4000-8000-000000000000",
            });
            expect(parseShowAssetRef(other)!.id).not.toBe(a.id);
        });

        it("refuses a manifest that doesn't parse, changing nothing", async ({
            db,
        }) => {
            const manifest = {
                ...sampleManifest(),
                items: [{ file: "crest.svg" }],
            };
            await expect(
                setUniformPack({ db, pack: packFile(), manifest, field }),
            ).rejects.toThrow();
            expect(await getStoredVenueSettings({ db })).toBeUndefined();
            expect(await getShowAssets({ db })).toEqual([]);
        });

        it("counts as a use of the asset", async ({ db }) => {
            const value = await store(db, packFile());
            expect(await getShowAssetReferences({ db })).toContain(value);
        });

        it("keeps a uniform an undo would dress the band in again", async ({
            db,
        }) => {
            // wear A, then B: undo would put A back, so A isn't offered for removal
            const a = await store(db, packFile("A", 1));
            const b = await store(db, packFile("B", 2));
            const inHistory = await valuesNamedInHistory({
                db,
                values: [a, b],
            });
            expect(inHistory.has(a)).toBe(true);
            const use = showAssetUse(
                await getShowAssets({ db }),
                new Map(),
                await getShowAssetReferences({ db }),
                inHistory,
            );
            expect(use.unused).toEqual([]);
            // undo: the band wears A again, which is still in the show
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                a,
            );
            expect(
                await getShowAsset({ db, ref: parseShowAssetRef(a)! }),
            ).toBeDefined();
        });

        it("is never removed while the band wears it, and can be once it doesn't", async ({
            db,
        }) => {
            const value = await store(db, packFile());
            const named = new Set(await getShowAssetReferences({ db }));
            const use = showAssetUse(await getShowAssets({ db }), new Map(), [
                ...named,
            ]);
            expect(REMOVABLE_ASSET_KINDS.has("uniform")).toBe(true);
            expect(use.unused).toEqual([]);
            // back to a preset: the uniform is unused, so Remove unused… may take it
            const venue = (await getStoredVenueSettings({ db }))!;
            const { uniformArtwork: _worn, ...preset } = venue;
            await updateVenueSettings({ db, settings: preset });
            // history still names it (the undo step that set it): kept until that's gone
            const inHistory = await valuesNamedInHistory({
                db,
                values: [value],
            });
            expect(inHistory.has(value)).toBe(true);
            await db.run(sql`DELETE FROM history_undo`);
            await db.run(sql`DELETE FROM history_redo`);
            const after = showAssetUse(
                await getShowAssets({ db }),
                new Map(),
                await getShowAssetReferences({ db }),
                await valuesNamedInHistory({ db, values: [value] }),
            );
            expect(after.unused.map((row) => row.value)).toEqual([value]);
        });
    });

    describe("valuesNamedInHistory", () => {
        const HASH = "b".repeat(64);
        /** Names `value` as the band's uniform, then wears a preset, so only history names it. */
        const wearThenDrop = async (
            db: Parameters<typeof updateVenueSettings>[0]["db"],
            value: string,
        ) => {
            const venue = defaultVenueForField(field);
            await updateVenueSettings({
                db,
                settings: { ...venue, uniformArtwork: value },
            });
            await updateVenueSettings({ db, settings: venue });
        };

        it("finds ids with quotes and backslashes, as the venue's JSON and SQL quoting store them", async ({
            db,
        }) => {
            const values = [
                `library:it's@${HASH}`,
                `library:say"hi"@${HASH}`,
                `library:back\\slash@${HASH}`,
                `library:o''clock"\\x@${HASH}`,
            ];
            for (const value of values) await wearThenDrop(db, value);
            const other = `library:never-worn@${HASH}`;
            const named = await valuesNamedInHistory({
                db,
                values: [...values, other],
            });
            expect([...named].sort()).toEqual([...values].sort());
        });

        it("finds them on the redo side too", async ({ db }) => {
            const value = `library:it's "quoted"@${HASH}`;
            const venue = defaultVenueForField(field);
            await updateVenueSettings({ db, settings: venue });
            await updateVenueSettings({
                db,
                settings: { ...venue, uniformArtwork: value },
            });
            await performUndo(db);
            await db.run(sql`DELETE FROM history_undo`);
            expect(await valuesNamedInHistory({ db, values: [value] })).toEqual(
                new Set([value]),
            );
        });

        it("reads only steps that write the venue row", async ({ db }) => {
            const value = `library:chair@${HASH}`;
            // a step that names the value in another table's row doesn't count
            await db.run(sql`
                INSERT INTO history_undo ("sequence", "history_group", "sql")
                VALUES (NULL, 1, ${`UPDATE "items" SET "model"='${value}' WHERE rowid=1`})`);
            expect(await valuesNamedInHistory({ db, values: [value] })).toEqual(
                new Set(),
            );
            await db.run(sql`
                INSERT INTO history_undo ("sequence", "history_group", "sql")
                VALUES (NULL, 1, ${`UPDATE "view3d_venue" SET "json_data"='{"uniformArtwork":"${value}"}' WHERE rowid=1`})`);
            expect(await valuesNamedInHistory({ db, values: [value] })).toEqual(
                new Set([value]),
            );
        });

        it("encodes a value as the history's stored SQL holds it", () => {
            expect(historyEncoding(`library:a'b@x`)).toBe(`library:a''b@x`);
            expect(historyEncoding(`library:a"b@x`)).toBe(`library:a\\"b@x`);
            expect(historyEncoding(`library:a\\b@x`)).toBe(`library:a\\\\b@x`);
        });
    });
});
