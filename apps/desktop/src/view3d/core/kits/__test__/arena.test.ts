import { beforeAll, describe, expect, it } from "vitest";
import {
    DirectionalLight,
    InstancedMesh,
    Mesh,
    SpotLight,
    Vector3,
    type Object3D,
} from "three";
import { buildCrowd, setTexturePainting } from "../../environment";
import type { FieldFootprint, KitBuildInput, KitResult } from "../../types";
import { defaultVenueForKit } from "../../venueSettings";
import { buildArena, ARENA_LOWER, ARENA_UPPER, ARENA_WALL_TOP } from "../arena";
import { outlineOffset } from "../bowl";

beforeAll(() => setTexturePainting(false));

const footprints: Record<string, FieldFootprint> = {
    indoor40x60: { minX: -17.1, maxX: 17.1, minZ: -22.9, maxZ: 0 },
    indoor50x80: { minX: -22.9, maxX: 22.9, minZ: -28.6, maxZ: 0 },
    football: { minX: -54.86, maxX: 54.86, minZ: -48.77, maxZ: 0 },
};

const params = defaultVenueForKit("arena").params;

const build = (
    footprint: FieldFootprint,
    quality: KitBuildInput["quality"] = "high",
): KitResult => buildArena({ footprint, params, quality });

function drawCalls(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return;
        n += Array.isArray(o.material) ? o.material.length : 1;
    });
    return n;
}

function triangles(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return;
        const g = o.geometry;
        const count = g.index
            ? g.index.count
            : g.getAttribute("position").count;
        n += (count / 3) * (o instanceof InstancedMesh ? o.count : 1);
    });
    return n;
}

describe.each(Object.entries(footprints))("arena kit, %s", (_name, fp) => {
    it("centers the focus on the footprint", () => {
        const kit = build(fp);
        expect(kit.focus).toEqual([
            (fp.minX + fp.maxX) / 2,
            0,
            (fp.minZ + fp.maxZ) / 2,
        ]);
        kit.dispose();
    });

    it("keeps the existing camera ids and adds the arena's own", () => {
        const kit = build(fp);
        expect(kit.cameras.map((c) => c.id)).toEqual([
            "geJudge",
            "judgesTable",
            "frontRow",
            "upperBowl",
            "corner",
            "floor",
            "topDown",
        ]);
        for (const c of kit.cameras) {
            expect(c.labelKey).toBe(`view3d.camera.${c.id}`);
        }
        kit.dispose();
    });

    it("places the seated cameras in the stands, under the roof", () => {
        const kit = build(fp);
        const cx = (fp.minX + fp.maxX) / 2;
        const cz = (fp.minZ + fp.maxZ) / 2;
        const halfX = Math.max(24, (fp.maxX - fp.minX) / 2 + 7.5);
        const halfZ = Math.max(17, (fp.maxZ - fp.minZ) / 2 + 7.5);
        const outline = {
            centerX: cx,
            centerZ: cz,
            halfX,
            halfZ,
            cornerRadius: Math.min(16, halfZ * 0.7),
        };
        for (const id of ["geJudge", "frontRow", "upperBowl", "corner"]) {
            const c = kit.cameras.find((k) => k.id === id)!;
            const off = outlineOffset(outline, c.position[0], c.position[2]);
            expect(off).toBeGreaterThan(0);
            expect(c.position[1]).toBeGreaterThan(ARENA_LOWER.base);
            expect(c.position[1]).toBeLessThan(ARENA_WALL_TOP);
        }
        const upper = kit.cameras.find((k) => k.id === "upperBowl")!;
        const lower = kit.cameras.find((k) => k.id === "geJudge")!;
        expect(upper.position[1]).toBeGreaterThan(lower.position[1] + 5);
        const table = kit.cameras.find((k) => k.id === "judgesTable")!;
        expect(table.position[2]).toBeGreaterThan(fp.maxZ);
        expect(
            outlineOffset(outline, table.position[0], table.position[2]),
        ).toBeLessThan(0);
        const top = kit.cameras.find((k) => k.id === "topDown")!;
        expect(top.position[1]).toBeGreaterThan(ARENA_WALL_TOP);
        kit.dispose();
    });

    it("returns closed seat rows for both bowls, with the tunnel cut out", () => {
        const kit = build(fp);
        expect(kit.seatRows).toHaveLength(ARENA_LOWER.rows + ARENA_UPPER.rows);
        const closed = kit.seatRows.filter((r) => r.closed).length;
        const open = kit.seatRows.filter((r) => !r.closed).length;
        expect(open).toBeGreaterThan(0);
        expect(closed + open).toBe(kit.seatRows.length);
        // Rows rise away from the floor.
        const lowerHeights = kit.seatRows
            .slice(0, ARENA_LOWER.rows)
            .map((r) => r.points[0][1]);
        for (let i = 1; i < lowerHeights.length; i++) {
            expect(lowerHeights[i]).toBeGreaterThan(lowerHeights[i - 1]);
        }
        const cx = (fp.minX + fp.maxX) / 2;
        const cz = (fp.minZ + fp.maxZ) / 2;
        // No seat in the tunnel's gap on the first row.
        for (const p of kit.seatRows[0].points) {
            const inGap = Math.abs(p[0] - cx) < 3.7 && p[2] < cz;
            expect(inGap).toBe(false);
        }
        const crowd = buildCrowd(kit.seatRows, { density: kit.crowdDensity });
        expect(crowd.count).toBeGreaterThan(1000);
        crowd.dispose();
        expect(kit.pickTargets).toHaveLength(2);
        kit.dispose();
    });

    it("supports house and show lighting", () => {
        const kit = build(fp);
        expect(kit.lightingPresets).toEqual(["house", "show"]);
        expect(kit.defaultLighting).toBe("house");
        const spots: SpotLight[] = [];
        let overhead: DirectionalLight | undefined;
        kit.root.traverse((o) => {
            if (o instanceof SpotLight) spots.push(o);
            if (o instanceof DirectionalLight) overhead = o;
        });
        expect(spots).toHaveLength(4);
        expect(spots.some((s) => s.visible)).toBe(false);
        expect(overhead!.intensity).toBeGreaterThan(0.5);
        const beams = kit.root.getObjectByName("arena-beams")!;
        expect(beams.visible).toBe(false);

        kit.setLighting("show");
        expect(spots.every((s) => s.intensity > 2 && s.visible)).toBe(true);
        expect(overhead!.intensity).toBeLessThan(0.2);
        expect(beams.visible).toBe(true);

        kit.setLighting("night"); // not supported: ignored
        expect(spots.every((s) => s.visible)).toBe(true);
        kit.setLighting("house");
        expect(spots.some((s) => s.visible)).toBe(false);
        expect(beams.visible).toBe(false);
        kit.dispose();
    });

    it("hides the ceiling gear when the camera is above the roof", () => {
        const kit = build(fp);
        const ceiling = kit.root.getObjectByName("arena-ceiling")!;
        expect(ceiling.getObjectByName("arena-scoreboard")).toBeDefined();
        kit.onFrame!({ cameraPosition: [0, 80, 0], dt: 0.016 });
        expect(ceiling.visible).toBe(false);
        kit.onFrame!({ cameraPosition: [0, 5, 0], dt: 0.016 });
        expect(ceiling.visible).toBe(true);
        kit.dispose();
    });

    it("keeps the draw calls and triangles modest", () => {
        const kit = build(fp, "low");
        expect(drawCalls(kit.root)).toBeLessThan(80);
        expect(triangles(kit.root)).toBeLessThan(60_000);
        kit.dispose();
    });

    it("disposes its geometry and clears the root", () => {
        const kit = build(fp, "low");
        const floor = kit.root.getObjectByName("arena-floor") as Mesh;
        let disposed = 0;
        floor.geometry.addEventListener("dispose", () => disposed++);
        kit.dispose();
        expect(disposed).toBe(1);
        expect(kit.root.children).toHaveLength(0);
    });
});

describe("arena kit geometry", () => {
    it("puts the scoreboard over the center of the floor", () => {
        const fp = footprints.indoor50x80;
        const kit = build(fp);
        kit.root.updateMatrixWorld(true);
        const board = kit.root.getObjectByName("arena-scoreboard")!;
        const p = board.getWorldPosition(new Vector3());
        expect(p.x).toBeCloseTo((fp.minX + fp.maxX) / 2);
        expect(p.z).toBeCloseTo((fp.minZ + fp.maxZ) / 2);
        expect(p.y).toBeGreaterThan(12);
        kit.dispose();
    });
});
