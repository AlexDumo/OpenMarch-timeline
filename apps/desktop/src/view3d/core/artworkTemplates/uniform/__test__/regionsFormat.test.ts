// @vitest-environment node
/**
 * One `regions.json` format: the renderer's asset (`assets/uniform-flats/regions.json`, written by
 * `scripts/view3d-assets/uniform-flats.mjs`) is the downloadable `uniform-regions.json` plus the
 * grey figure, so agents and the renderer read the same names.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    FLATS_LAYOUT,
    fromFlatsAsset,
    loadOnce,
    regionsJson,
    uniformTemplate,
    uniformTemplateFile,
    type FlatsAsset,
} from "..";

const ASSET_PATH = path.resolve(
    __dirname,
    "../../../../assets/uniform-flats/regions.json",
);
const asset = JSON.parse(fs.readFileSync(ASSET_PATH, "utf8")) as FlatsAsset &
    Record<string, unknown>;
/** The keys only the asset has. */
const ASSET_ONLY = ["generatedBy", "figure"];

interface Region {
    id: string;
    panel: string;
    part: string;
    polygon: [number, number][];
    bbox: { x: number; y: number; w: number; h: number };
    seams: { y: number; left: number; right: number }[];
}
const regionOf = (json: { regions: unknown[] }, id: string) =>
    (json.regions as Region[]).find((r) => r.id === id)!;

describe("the renderer's regions.json", () => {
    it("is the download, plus the figure and where it came from", async () => {
        const file = await uniformTemplateFile("json", () => {
            throw new Error("no canvas for JSON");
        });
        const download = JSON.parse(file.data as string) as Record<
            string,
            unknown
        >;
        const withoutExtras = Object.fromEntries(
            Object.entries(asset).filter(([k]) => !ASSET_ONLY.includes(k)),
        );
        expect(withoutExtras).toEqual(download);
        expect(Object.keys(asset).sort()).toEqual(
            [...Object.keys(download), ...ASSET_ONLY].sort(),
        );
    });

    it("reads back to itself: the template's own regionsJson of the asset is the asset", () => {
        const { model } = uniformTemplate(fromFlatsAsset(asset));
        const again = regionsJson(model) as Record<string, unknown>;
        for (const [k, v] of Object.entries(again)) expect(asset[k]).toEqual(v);
    });

    it("uses the download's names, none of the old ones", () => {
        expect(asset.format).toBe("openmarch-uniform-flats");
        expect(asset.version).toBe(1);
        expect(asset.body).toBe(FLATS_LAYOUT.body);
        for (const old of [
            "sheet",
            "sheetPx",
            "median",
            "views",
            "regionNotes",
        ])
            expect(asset, old).not.toHaveProperty(old);
        expect(asset.guides.map((g) => g.id)).toContain("jacketHem");
        expect(asset.guides.map((g) => g.id)).not.toContain("hem");
        const landmarks = Object.keys(asset.landmarks);
        expect(landmarks).toEqual(
            expect.arrayContaining([
                "chestCentre",
                "backNumberCentre",
                "centreLines",
                "sleeveCuff",
                "legHem",
            ]),
        );
        expect(landmarks.some((k) => k.includes(" "))).toBe(false);
        expect(landmarks).not.toContain("cuff");
        expect(landmarks).not.toContain("hem");
        // seam rows are objects
        const row = regionOf(asset, "front-leg-L").seams[0];
        expect(Object.keys(row).sort()).toEqual(["left", "right", "y"]);
    });

    it("keeps the figure the template draws", () => {
        const source = fromFlatsAsset(asset);
        expect(source.figure?.shapes.length).toBeGreaterThan(100);
        expect(source.figure?.shapes.every((t) => t.length === 3)).toBe(true);
        expect(source.figure?.hands).toHaveLength(2);
    });

    it("starts the torso's seam rows at its top and stops the torso at the jacket hem", () => {
        const hem = asset.guides.find((g) => g.id === "jacketHem")!.y;
        expect(hem).toBe(38.31);
        for (const id of ["front-torso", "back-torso"]) {
            const torso = regionOf(asset, id);
            const top = torso.bbox.y;
            const bottom = Math.max(...torso.polygon.map(([, y]) => y));
            expect(bottom, id).toBeCloseTo(hem, 6);
            // the first 0.25 in step inside the outline
            expect(torso.seams[0].y, id).toBe(Math.floor(top * 4) / 4 + 0.25);
            expect(torso.seams.at(-1)!.y, id).toBeLessThan(hem);
        }
        // the front torso's top is the shoulders, at 14.11 in
        expect(regionOf(asset, "front-torso").bbox.y).toBe(14.11);
        expect(regionOf(asset, "front-torso").seams[0].y).toBe(14.25);
        // the hips start where the torso stops: no overlap
        expect(regionOf(asset, "front-hips").bbox.y).toBe(hem);
    });

    it("has seam rows every 0.25 in, left of right, inside each region", () => {
        for (const r of asset.regions as unknown as Region[]) {
            if (r.panel === "cape") continue;
            for (let i = 1; i < r.seams.length; i++)
                expect(r.seams[i].y - r.seams[i - 1].y).toBeCloseTo(0.25, 6);
            for (const s of r.seams) {
                expect(s.left, r.id).toBeLessThan(s.right);
                expect(s.y).toBeGreaterThan(r.bbox.y);
                expect(s.y).toBeLessThan(r.bbox.y + r.bbox.h);
            }
        }
    });

    it("refuses a file in another format", () => {
        expect(() => fromFlatsAsset({ ...asset, version: 2 })).toThrow(
            /layout/,
        );
        expect(() =>
            fromFlatsAsset({ ...asset, format: "openmarch-uniform-flats@1" }),
        ).toThrow(/layout/);
    });
});

describe("loadOnce", () => {
    it("shares a load that worked", async () => {
        let calls = 0;
        const get = loadOnce(async () => ++calls);
        expect(await get()).toBe(1);
        expect(await get()).toBe(1);
        expect(calls).toBe(1);
    });

    it("tries again after a load that failed", async () => {
        let calls = 0;
        const get = loadOnce(async () => {
            calls++;
            if (calls === 1) throw new Error("offline");
            return "regions";
        });
        await expect(get()).rejects.toThrow("offline");
        await expect(get()).resolves.toBe("regions");
        await expect(get()).resolves.toBe("regions");
        expect(calls).toBe(2);
    });
});
