import { describe, expect } from "vitest";
import { describeDbTests } from "@/test/base";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";
import { performRedo, performUndo } from "../history";
import { getStoredVenueSettings, updateVenueSettings } from "../view3dVenue";
import {
    getShowAsset,
    getShowAssetReferences,
    getShowAssets,
    readShowAssetBlob,
} from "../showAssets";
import { setUniformPack } from "../view3dUniformPack";
import { parseShowAssetRef } from "@/showAssets/ref";
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

const packFile = (name = "Home uniform", tag = 0) =>
    writeUniformPack(sampleManifest(name), {
        "layers/base.png": fakePng(3360, 2816, tag),
    });

describeDbTests("view3dUniformPack", (it) => {
    describe("setUniformPack", () => {
        it("stores the pack file unchanged as a uniform asset and dresses the band in it", async ({
            db,
        }) => {
            const bytes = packFile();
            const value = await setUniformPack({ db, pack: bytes, field });
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
            await setUniformPack({ db, pack: packFile(), field });
            const venue = await getStoredVenueSettings({ db });
            expect(venue?.uniforms).toBe("prism");
            expect(venue?.crowd).toBe(false);
        });

        it("reuses the asset when the same file comes back", async ({ db }) => {
            const first = await setUniformPack({ db, pack: packFile(), field });
            const again = await setUniformPack({ db, pack: packFile(), field });
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
            const first = await setUniformPack({
                db,
                pack: packFile("One", 1),
                field,
            });
            const second = await setUniformPack({
                db,
                pack: packFile("Two", 2),
                field,
            });
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

        it("refuses bytes that aren't a uniform pack, changing nothing", async ({
            db,
        }) => {
            await expect(
                setUniformPack({ db, pack: fakePng(), field }),
            ).rejects.toThrow();
            expect(await getStoredVenueSettings({ db })).toBeUndefined();
            expect(await getShowAssets({ db })).toEqual([]);
        });

        it("counts as a use of the asset", async ({ db }) => {
            const value = await setUniformPack({
                db,
                pack: packFile(),
                field,
            });
            expect(await getShowAssetReferences({ db })).toContain(value);
        });
    });
});
