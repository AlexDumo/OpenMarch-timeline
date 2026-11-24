import { describe, expect } from "vitest";
import { describeDbTests } from "@/test/base";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";
import {
    amendLatestUndoEntry,
    getLatestUndoEntryToken,
    performRedo,
    performUndo,
} from "../history";
import { updateVenueSettingsInTransaction } from "../view3dVenue";
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
import {
    UniformPackSupersededError,
    resolveStoredUniformPack,
    saveUniformItemsPack,
    setUniformPack,
} from "../view3dUniformPack";
import { parseShowAssetRef, showAssetRefValue } from "@/showAssets/ref";
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

const showAssetValue = showAssetRefValue;

const field = FootballTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/** The tag-1 "Home uniform" with a crest `width` inches wide on the chest: format version 2 */
const crestPack = (width: number) =>
    writeUniformPack(
        {
            ...sampleManifest("Home uniform"),
            items: [
                {
                    id: "crest",
                    file: "items/crest.png",
                    panel: "front",
                    at: [17, 25.32],
                    width,
                },
            ],
        },
        {
            "layers/base.png": fakePng(3360, 2816, 1),
            "items/crest.png": fakePng(512, 512, 9),
        },
    );

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

        it("stores nothing when the venue moved on before an item edit arrived (#1258)", async ({
            db,
        }) => {
            const plain = await store(db, packFile("Home uniform", 1));
            const first = await saveUniformItemsPack({
                db,
                pack: crestPack(6),
                manifest: readUniformPack(crestPack(6)).manifest,
                field,
                versionOf: parseShowAssetRef(plain)!.id,
                expect: plain,
            });
            const before = (await getShowAssets({ db })).length;
            // Undo while the next edit is saving
            await performUndo(db);
            await expect(
                saveUniformItemsPack({
                    db,
                    pack: crestPack(7),
                    manifest: readUniformPack(crestPack(7)).manifest,
                    field,
                    versionOf: parseShowAssetRef(plain)!.id,
                    expect: first.value,
                    amend: first.token ?? undefined,
                }),
            ).rejects.toBeInstanceOf(UniformPackSupersededError);
            // nothing stored, the Undo stands, and Redo still brings the edit back
            expect((await getShowAssets({ db })).length).toBe(before);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                plain,
            );
            await performRedo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                first.value,
            );
        });

        it("keeps a burst of 10 item edits to one undo step and two versions (#1258)", async ({
            db,
        }) => {
            const origin = await store(db, packFile("Home uniform", 1));
            const id = parseShowAssetRef(origin)!.id;
            let latest = origin;
            let token: string | null | undefined;
            for (let n = 1; n <= 10; n++) {
                const pack = crestPack(n);
                const saved = await saveUniformItemsPack({
                    db,
                    pack,
                    manifest: readUniformPack(pack).manifest,
                    field,
                    versionOf: id,
                    expect: latest,
                    amend: token ?? undefined,
                });
                // the burst keeps its first save's token
                if (n > 1) expect(saved.token).toBe(token);
                token = saved.token;
                latest = saved.value;
            }
            // two versions of the uniform: where the burst started and where it ended
            const versions = (await getShowAssets({ db })).filter(
                (a) => a.id === id,
            );
            expect(versions.map((v) => showAssetValue(v))).toEqual([
                origin,
                latest,
            ]);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                latest,
            );
            // one undo step goes back to where it started, and redo to where it ended
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                origin,
            );
            await performRedo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                latest,
            );
            // the step before the burst is still the import's
            await performUndo(db);
            await performUndo(db);
            expect(
                (await getStoredVenueSettings({ db }))?.uniformArtwork,
            ).not.toBe(origin);
        });

        it("starts a new undo step when something else was edited in the burst (#1258)", async ({
            db,
        }) => {
            const origin = await store(db, packFile("Home uniform", 1));
            const id = parseShowAssetRef(origin)!.id;
            const first = await saveUniformItemsPack({
                db,
                pack: crestPack(4),
                manifest: readUniformPack(crestPack(4)).manifest,
                field,
                versionOf: id,
                expect: origin,
            });
            // another edit becomes the latest undo step
            const venue = (await getStoredVenueSettings({ db }))!;
            await updateVenueSettings({
                db,
                settings: { ...venue, crowd: !venue.crowd },
            });
            const second = await saveUniformItemsPack({
                db,
                pack: crestPack(5),
                manifest: readUniformPack(crestPack(5)).manifest,
                field,
                versionOf: id,
                expect: first.value,
                amend: first.token ?? undefined,
            });
            expect(second.token).not.toBe(first.token);
            // the first save's version stays: an undo step names it
            expect(
                (await getShowAssets({ db })).filter((a) => a.id === id),
            ).toHaveLength(3);
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                first.value,
            );
        });

        it("makes an undo pressed during an amend wait, then undo the whole burst (#1258)", async ({
            db,
        }) => {
            const origin = await store(db, packFile("Home uniform", 1));
            const first = await saveUniformItemsPack({
                db,
                pack: crestPack(4),
                manifest: readUniformPack(crestPack(4)).manifest,
                field,
                versionOf: parseShowAssetRef(origin)!.id,
                expect: origin,
            });
            let release: () => void = () => undefined;
            const gate = new Promise<void>((r) => (release = r));
            const venue = (await getStoredVenueSettings({ db }))!;
            const amending = amendLatestUndoEntry(
                db,
                first.token!,
                ["view3d_venue"],
                async (tx) => {
                    await updateVenueSettingsInTransaction({
                        tx,
                        settings: { ...venue, crowd: !venue.crowd },
                    });
                    await gate;
                    return "done";
                },
            );
            let undone = false;
            const undo = performUndo(db).then((r) => {
                undone = true;
                return r;
            });
            await new Promise((r) => setTimeout(r, 30));
            // the undo waits for the amend instead of failing inside its transaction
            expect(undone).toBe(false);
            release();
            expect(await amending).toEqual({ amended: true, result: "done" });
            expect((await undo).success).toBe(true);
            // one step back: before the burst, the amend's change included
            const back = (await getStoredVenueSettings({ db }))!;
            expect(back.uniformArtwork).toBe(origin);
            expect(back.crowd).toBe(venue.crowd);
        });

        it("never deletes the history of an edit made while an amend runs (#1258)", async ({
            db,
        }) => {
            const origin = await store(db, packFile("Home uniform", 1));
            await saveUniformItemsPack({
                db,
                pack: crestPack(4),
                manifest: readUniformPack(crestPack(4)).manifest,
                field,
                versionOf: parseShowAssetRef(origin)!.id,
                expect: origin,
            });
            const token = (await getLatestUndoEntryToken(db))!;
            let release: () => void = () => undefined;
            const gate = new Promise<void>((r) => (release = r));
            const amending = amendLatestUndoEntry(
                db,
                token,
                ["view3d_venue"],
                async () => {
                    await gate;
                    return null;
                },
            );
            // an edit asked for during the amend
            const before = (await getStoredVenueSettings({ db }))!;
            const edit = updateVenueSettings({
                db,
                settings: { ...before, crowd: !before.crowd },
            });
            await new Promise((r) => setTimeout(r, 30));
            release();
            await amending;
            await edit;
            expect((await getStoredVenueSettings({ db }))?.crowd).toBe(
                !before.crowd,
            );
            // the edit is its own undo step, and still undoes
            await performUndo(db);
            expect((await getStoredVenueSettings({ db }))?.crowd).toBe(
                before.crowd,
            );
            expect((await getStoredVenueSettings({ db }))?.uniformArtwork).toBe(
                before.uniformArtwork,
            );
            // and the token it left is no longer the burst's: a late amend starts a new step
            expect(
                await amendLatestUndoEntry(db, token, ["view3d_venue"], () =>
                    Promise.resolve(1),
                ),
            ).toEqual({ amended: false });
        });

        it("never leaves a value the 3D View can still name unresolvable during a burst (#1258)", async ({
            db,
        }) => {
            // The window hears of each save's asset change and venue change separately, so for a
            // moment it can name any value the venue named since the burst began. Each must still
            // resolve to a stored pack: the version itself, or its uniform's newest.
            const origin = await store(db, packFile("Home uniform", 1));
            const id = parseShowAssetRef(origin)!.id;
            const seen = [origin];
            let latest = origin;
            let token: string | null | undefined;
            for (let n = 1; n <= 12; n++) {
                const pack = crestPack(n);
                const saved = await saveUniformItemsPack({
                    db,
                    pack,
                    manifest: readUniformPack(pack).manifest,
                    field,
                    versionOf: id,
                    expect: latest,
                    amend: token ?? undefined,
                });
                token = saved.token;
                latest = saved.value;
                seen.push(latest);
                for (const value of seen) {
                    const resolved = await resolveStoredUniformPack({
                        db,
                        value,
                    });
                    expect(resolved, `${value} after save ${n}`).not.toBeNull();
                    // a removed version reads as the newest: never an older look
                    if (value !== origin) expect(resolved!.value).toBe(latest);
                    const bytes = await readShowAssetBlob({
                        db,
                        hash: resolved!.hash,
                    });
                    expect(bytes).toBeDefined();
                }
            }
            // the burst removed its intermediate versions; they still resolve
            expect(
                (await getShowAssets({ db })).filter((a) => a.id === id),
            ).toHaveLength(2);
            // a uniform the show doesn't have at all still reads as missing
            expect(
                await resolveStoredUniformPack({
                    db,
                    value: `library:00000000-0000-4000-8000-000000000000@${"0".repeat(64)}`,
                }),
            ).toBeNull();
        });

        it("resolves a removed version to what the venue names, even when a save reused an older row (#1287)", async ({
            db,
        }) => {
            // O, then A (one burst), then a burst B whose content goes back to O's bytes
            const originPack = packFile("Home uniform", 1);
            const origin = await store(db, originPack);
            const id = parseShowAssetRef(origin)!.id;
            const a = await saveUniformItemsPack({
                db,
                pack: crestPack(4),
                manifest: readUniformPack(crestPack(4)).manifest,
                field,
                versionOf: id,
                expect: origin,
            });
            const b = await saveUniformItemsPack({
                db,
                pack: crestPack(5),
                manifest: readUniformPack(crestPack(5)).manifest,
                field,
                versionOf: id,
                expect: a.value,
            });
            const back = await saveUniformItemsPack({
                db,
                pack: originPack,
                manifest: readUniformPack(originPack).manifest,
                field,
                versionOf: id,
                expect: b.value,
                amend: b.token ?? undefined,
            });
            // the save reused O's row, and removed B
            expect(back.value).toBe(origin);
            expect(
                (await getShowAssets({ db }))
                    .filter((x) => x.id === id)
                    .map((x) => showAssetValue(x)),
            ).toEqual([origin, a.value]);
            // a window still naming B sees O, the look the venue has, not A
            expect(
                (await resolveStoredUniformPack({ db, value: b.value }))?.value,
            ).toBe(origin);
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
