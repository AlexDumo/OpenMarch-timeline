import { beforeAll, describe, expect, it } from "vitest";
import {
    Box3,
    CubeTexture,
    DirectionalLight,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    SpotLight,
    Texture,
    Vector3,
    type Material,
    type Object3D,
} from "three";
import { buildCrowd, setTexturePainting } from "../../environment";
import type { FieldFootprint, KitBuildInput, KitResult } from "../../types";
import {
    buildGym,
    gymAisles,
    GYM_BLEACHER_ROWS,
    GYM_BLEACHER_TREAD,
    GYM_ROOM_HEIGHT,
} from "../gym";

beforeAll(() => setTexturePainting(false));

const footprints: Record<string, FieldFootprint> = {
    indoor40x60: { minX: -17.1, maxX: 17.1, minZ: -22.9, maxZ: 0 },
    indoor50x80: { minX: -22.9, maxX: 22.9, minZ: -28.6, maxZ: 0 },
    football: { minX: -54.86, maxX: 54.86, minZ: -48.77, maxZ: 0 },
};

const params = {
    homeColor: "#6442ff",
    awayColor: "#c23b3b",
    endZoneText: "",
    endZoneColor: "#1f2a5c",
};

const build = (
    footprint: FieldFootprint,
    quality: KitBuildInput["quality"] = "high",
): KitResult => buildGym({ footprint, params, quality });

function drawCalls(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return;
        n += Array.isArray(o.material) ? o.material.length : 1;
    });
    return n;
}

describe.each(Object.entries(footprints))("gym kit, %s", (_name, fp) => {
    it("sizes the room from the footprint", () => {
        const kit = build(fp);
        kit.root.updateMatrixWorld(true);
        const room = kit.root.getObjectByName("gym-room")!;
        const box = new Box3().setFromObject(room);
        expect(box.min.x).toBeCloseTo(fp.minX - 9);
        expect(box.max.x).toBeCloseTo(fp.maxX + 9);
        expect(box.min.z).toBeCloseTo(fp.minZ - 9);
        // The front extends past the bleachers.
        expect(box.max.z).toBeGreaterThan(fp.maxZ + 3 + 12 * 0.73);
        expect(box.max.y - box.min.y).toBeCloseTo(GYM_ROOM_HEIGHT);
        expect(kit.focus).toEqual([
            (fp.minX + fp.maxX) / 2,
            0,
            (fp.minZ + fp.maxZ) / 2,
        ]);
        kit.dispose();
    });

    it("has the five named cameras inside the room, clear of the bleachers", () => {
        const kit = build(fp);
        expect(kit.cameras.map((c) => c.id)).toEqual([
            "geJudge",
            "frontRow",
            "corner",
            "floor",
            "topDown",
        ]);
        const box = new Box3().setFromObject(
            kit.root.getObjectByName("gym-room")!,
        );
        for (const c of kit.cameras) {
            expect(c.labelKey).toBe(`view3d.camera.${c.id}`);
            if (c.id === "topDown") continue;
            const p = new Vector3(...c.position);
            expect(box.containsPoint(p)).toBe(true);
            expect(p.y).toBeLessThan(GYM_ROOM_HEIGHT);
            // Not inside a tread block.
            const [first] = kit.seatRows;
            const rowIndex = kit.seatRows.findIndex(
                (r) => Math.abs(r.points[0][2] - p.z) < GYM_BLEACHER_TREAD / 2,
            );
            if (rowIndex >= 0) {
                expect(p.y).toBeGreaterThan(
                    kit.seatRows[rowIndex].points[0][1] + 1,
                );
                expect(first.points[0][2]).toBeGreaterThan(fp.maxZ);
            }
        }
        const top = kit.cameras.find((c) => c.id === "topDown")!;
        expect(top.position[1]).toBeGreaterThan(GYM_ROOM_HEIGHT);
        expect(top.position[2]).toBeGreaterThan(top.target[2]);
        kit.dispose();
    });

    it("returns 12 bleacher rows, front side only", () => {
        const kit = build(fp);
        expect(kit.seatRows).toHaveLength(GYM_BLEACHER_ROWS);
        let prev = -Infinity;
        for (const row of kit.seatRows) {
            expect(row.depth).toBeCloseTo(GYM_BLEACHER_TREAD);
            const [a, b] = row.points;
            expect(b[0]).toBeGreaterThan(a[0]);
            expect(a[2]).toBeGreaterThan(fp.maxZ + 3 - 1e-6);
            expect(a[1]).toBeGreaterThan(prev);
            prev = a[1];
        }
        expect(kit.pickTargets).toHaveLength(1);
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
        expect(spots.every((s) => s.intensity === 0)).toBe(true);
        expect(spots.some((s) => s.visible)).toBe(false);
        expect(overhead!.intensity).toBeCloseTo(1.1);
        const panels = kit.root.getObjectByName("gym-panels") as InstancedMesh;
        const mat = panels.material as { emissiveIntensity: number };
        expect(mat.emissiveIntensity).toBeCloseTo(1.4);

        kit.setLighting("show");
        expect(spots.every((s) => s.intensity > 2)).toBe(true);
        expect(spots.every((s) => s.visible)).toBe(true);
        expect(overhead!.intensity).toBeCloseTo(0.1);
        expect(mat.emissiveIntensity).toBeCloseTo(0.08);

        kit.setLighting("night"); // not supported: ignored
        expect(overhead!.intensity).toBeCloseTo(0.1);
        kit.setLighting("house");
        expect(spots.every((s) => s.intensity === 0)).toBe(true);
        expect(spots.some((s) => s.visible)).toBe(false);
        kit.dispose();
    });

    it("hides the ceiling lights and roof steel when the camera is above the ceiling", () => {
        const kit = build(fp);
        const parts = ["gym-panels", "gym-roof-steel", "gym-roof-pipes"].map(
            (n) => kit.root.getObjectByName(n)!,
        );
        kit.onFrame!({ cameraPosition: [0, 70, 0], dt: 0.016 });
        expect(parts.every((p) => !p.visible)).toBe(true);
        kit.onFrame!({ cameraPosition: [0, 5, 0], dt: 0.016 });
        expect(parts.every((p) => p.visible)).toBe(true);
        kit.dispose();
    });

    it("shows the spot beams and lit spot lenses only in show lighting", () => {
        const kit = build(fp);
        const beams = kit.root.getObjectByName("gym-spot-beams")!;
        const lenses = kit.root.getObjectByName("gym-spot-lenses") as Mesh;
        const lensMat = lenses.material as { emissiveIntensity: number };
        expect(beams.visible).toBe(false);
        expect(lensMat.emissiveIntensity).toBe(0);
        kit.setLighting("show");
        expect(beams.visible).toBe(true);
        expect(lensMat.emissiveIntensity).toBeGreaterThan(1);
        kit.setLighting("house");
        expect(beams.visible).toBe(false);
        kit.dispose();
    });

    it("puts aisle steps where the crowd leaves its aisles", () => {
        const kit = build(fp);
        const [row] = kit.seatRows;
        const aisles = gymAisles(row.points[0][0], row.points[1][0]);
        expect(aisles.length).toBeGreaterThan(0);
        const crowd = buildCrowd([row], { density: 1 });
        const m = new Matrix4();
        const p = new Vector3();
        for (let i = 0; i < crowd.mesh.count; i++) {
            crowd.mesh.getMatrixAt(i, m);
            p.setFromMatrixPosition(m);
            for (const x of aisles) {
                expect(Math.abs(p.x - x)).toBeGreaterThan(0.5);
            }
        }
        crowd.dispose();
        kit.dispose();
    });

    it("keeps matte surfaces out of the scene environment map", () => {
        const kit = build(fp);
        const room = kit.root.getObjectByName("gym-room") as Mesh;
        const mats = room.material as Material[];
        for (const i of [0, 2, 4]) {
            const mat = mats[i] as MeshLambertMaterial;
            expect(mat).toBeInstanceOf(MeshLambertMaterial);
            expect(mat.envMap).toBeInstanceOf(CubeTexture);
            expect(mat.reflectivity).toBe(0);
        }
        kit.dispose();
    });

    it("stays under 40 draw calls and disposes everything", () => {
        const kit = build(fp, "low");
        expect(drawCalls(kit.root)).toBeLessThan(40);
        const geo = (kit.root.getObjectByName("gym-room") as Mesh).geometry;
        let disposed = 0;
        geo.addEventListener("dispose", () => disposed++);
        const textures = new Set<Texture>();
        kit.root.traverse((o) => {
            if (!(o instanceof Mesh)) return;
            const mats: Material[] = Array.isArray(o.material)
                ? o.material
                : [o.material];
            for (const mat of mats) {
                for (const v of Object.values(mat)) {
                    if (v instanceof Texture) textures.add(v);
                }
            }
        });
        expect(textures.size).toBeGreaterThan(8);
        const undisposed = new Set(textures);
        textures.forEach((t) =>
            t.addEventListener("dispose", () => undisposed.delete(t)),
        );
        kit.dispose();
        expect(disposed).toBe(1);
        expect(undisposed.size).toBe(0);
        expect(kit.root.children).toHaveLength(0);
    });
});
