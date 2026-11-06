import { beforeAll, describe, expect, it } from "vitest";
import { Mesh, MeshStandardMaterial } from "three";
import { setTexturePainting } from "../../environment";
import type { FieldFootprint, VenueParams } from "../../types";
import { buildBighs } from "../bighs";
import { buildCollege } from "../college";
import { buildHs } from "../hs";
import { parseColor, shade } from "../hs/textures";

beforeAll(() => setTexturePainting(false));

const FOOTBALL: FieldFootprint = {
    minX: -54.86,
    maxX: 54.86,
    minZ: -48.77,
    maxZ: 0,
};
const PARAMS: VenueParams = {
    homeColor: "#6442ff",
    awayColor: "#c23b3b",
    endZoneText: "Eagles",
    endZoneColor: "#1f2a5c",
};
const input = { footprint: FOOTBALL, params: PARAMS, quality: "high" as const };

describe("hs and bighs scenery", () => {
    it.each([
        ["hs", buildHs],
        ["bighs", buildBighs],
    ] as const)(
        "%s adds fence, school, lot, goal posts and a tower",
        (_id, b) => {
            const kit = b(input);
            for (const name of [
                "trackFence",
                "school",
                "parkingLot",
                "goalPosts",
                "conductorTower",
                "cars",
                "treeCrowns",
                "pressWindows",
                "frontWall",
            ]) {
                expect(kit.root.getObjectByName(name), name).toBeDefined();
            }
            kit.dispose();
        },
    );

    it("hs has a scoreboard, bighs does not (it has a video board)", () => {
        expect(buildHs(input).root.getObjectByName("scoreboard")).toBeDefined();
        expect(
            buildBighs(input).root.getObjectByName("scoreboard"),
        ).toBeUndefined();
    });

    it("keeps goal posts out of small surfaces", () => {
        const kit = buildHs({
            ...input,
            footprint: { minX: -20, maxX: 28, minZ: -30, maxZ: 0 },
        });
        expect(kit.root.getObjectByName("goalPosts")).toBeUndefined();
        kit.dispose();
    });

    it("lights the press box windows only when the lamps are on", () => {
        const kit = buildHs(input);
        const win = kit.root.getObjectByName("pressWindows") as Mesh;
        const mat = win.material as MeshStandardMaterial;
        kit.setLighting("day");
        expect(mat.emissiveIntensity).toBe(0);
        kit.setLighting("night");
        expect(mat.emissiveIntensity).toBeGreaterThan(0.9);
        kit.dispose();
    });

    it("keeps college on the plain stands", () => {
        const kit = buildCollege(input);
        expect(kit.root.getObjectByName("frontWall")).toBeUndefined();
        expect(kit.root.getObjectByName("school")).toBeUndefined();
        kit.dispose();
    });

    it("keeps draw calls under budget", () => {
        for (const b of [buildHs, buildBighs]) {
            const kit = b(input);
            let n = 0;
            kit.root.traverse((o) => {
                if ((o as Mesh).isMesh || (o as Mesh).isLineSegments) n++;
            });
            expect(n).toBeLessThan(80);
            kit.dispose();
        }
    });
});

describe("color helpers", () => {
    it("parses hex and falls back", () => {
        expect(parseColor("#6442ff", 0)).toBe(0x6442ff);
        expect(parseColor("nope", 7)).toBe(7);
    });
    it("shades and clamps", () => {
        expect(shade(0x808080, 0.5)).toBe(0x404040);
        expect(shade(0xff8000, 2)).toBe(0xffff00);
    });
});
