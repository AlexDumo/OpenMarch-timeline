import { beforeAll, describe, expect, it, vi } from "vitest";
import {
    InstancedMesh,
    Matrix4,
    Mesh,
    Quaternion,
    ShaderMaterial,
    SpotLight,
    Vector3,
} from "three";
import type { LightingPreset, SeatRow } from "../../types";
import {
    buildCrowd,
    createEnvironment,
    createSharedMaterials,
    defaultCrowdPalette,
    FT,
    HORIZON_FAR_RADIUS,
    horizonGeometry,
    LIGHTING_PRESET_IDS,
    lightingValues,
    personGeometry,
    lightPole,
    PERSON_HEIGHT,
    PERSON_SPACING,
    setTexturePainting,
    videoBoard,
} from "..";

beforeAll(() => setTexturePainting(false));

/** A straight stand: `rows` rows of `length` meters along X, rising in Y and Z. */
function straightRows(
    rows: number,
    length: number,
    side: SeatRow["side"] = "home",
): SeatRow[] {
    return Array.from({ length: rows }, (_, i) => ({
        points: [
            [-length / 2, 1 + i * 0.3, 10 + i * 0.8],
            [length / 2, 1 + i * 0.3, 10 + i * 0.8],
        ],
        closed: false,
        depth: 0.8,
        side,
    }));
}

describe("lighting presets", () => {
    it("ports the demo's SKY table in meters", () => {
        const day = lightingValues("day");
        expect(day.skyBottom).toBe(day.fog);
        expect(day.hemisphere).toEqual({
            sky: 0xcfe3ff,
            ground: 0x4a5d33,
            intensity: 1.1,
        });
        expect(day.sun.intensity).toBe(2.3);
        expect(day.sun.offset[0]).toBeCloseTo(300 * FT);
        expect(day.sun.offset[1]).toBeCloseTo(520 * FT);
        expect(day.sun.offset[2]).toBeCloseTo(260 * FT);
        expect(day.kit.lampsOn).toBe(false);

        const dusk = lightingValues("dusk");
        expect(dusk.exposure).toBe(1.05);
        expect(dusk.kit.lampScale).toBe(0.6);
        const night = lightingValues("night");
        expect(night.exposure).toBe(1.15);
        expect(night.sun.intensity).toBe(0);
        expect(night.kit.lampsOn).toBe(true);
    });

    it("ports the roof closed and gym presets", () => {
        const closed = lightingValues("roofClosed");
        expect(closed.sun.intensity).toBe(0);
        expect(closed.hemisphere.sky).toBe(0xfff1e0);
        expect(closed.kit.roofOpen).toBe(false);
        expect(closed.kit.barEmissive).toBe(2);
        const house = lightingValues("house");
        const show = lightingValues("show");
        expect(house.skyVisible).toBe(false);
        expect(house.kit.panelEmissive).toBe(1.4);
        expect(house.kit.showSpotIntensity).toBe(0);
        expect(show.hemisphere.intensity).toBe(0.12);
        expect(show.exposure).toBe(1.2);
        expect(show.kit.showSpotIntensity).toBe(2.4);
        expect(show.kit.overheadIntensity).toBe(0.1);
    });

    it("has finite values for every preset", () => {
        for (const id of LIGHTING_PRESET_IDS) {
            const v = lightingValues(id);
            const nums = [
                v.exposure,
                v.hemisphere.intensity,
                v.sun.intensity,
                ...v.sun.offset,
            ];
            nums.push(
                v.fogNear,
                v.fogFar,
                ...Object.values(v.sky).flat().map(Number),
            );
            nums.forEach((n) => expect(Number.isFinite(n)).toBe(true));
            expect(v.fogFar).toBeGreaterThan(v.fogNear);
            expect(v.sky.cloudCover).toBeLessThanOrEqual(1);
        }
        expect(LIGHTING_PRESET_IDS.sort()).toEqual(
            ["day", "dusk", "house", "night", "roofClosed", "show"].sort(),
        );
    });
});

describe("createEnvironment", () => {
    it("applies a preset to the rig", () => {
        const env = createEnvironment({ focus: [0, 0, -24] });
        const v = env.setLighting("dusk");
        expect(env.hemisphere.intensity).toBe(v.hemisphere.intensity);
        expect(env.sun.color.getHex()).toBe(0xffa860);
        expect(env.sun.castShadow).toBe(true);
        expect(env.fog.color.getHex()).toBe(v.fog);
        expect(env.fog.near).toBe(v.fogNear);
        expect(env.fog.far).toBe(v.fogFar);
        expect(env.exposure).toBe(1.05);
        expect(env.sun.position.z).toBeCloseTo(-24 + -60 * FT);
        expect(env.sun.target.position.z).toBe(-24);
        env.dispose();
    });

    it("turns the sun and shadows off at night and indoors", () => {
        const env = createEnvironment();
        env.setLighting("night");
        expect(env.sun.castShadow).toBe(false);
        expect(env.sun.visible).toBe(false);
        env.setLighting("house");
        expect(env.sky.mesh.visible).toBe(false);
        expect(env.horizon.mesh.visible).toBe(false);
        expect(env.sun.visible).toBe(false);
        env.setLighting("day");
        expect(env.sky.mesh.visible).toBe(true);
        expect(env.horizon.mesh.visible).toBe(true);
        expect(env.sun.castShadow).toBe(true);
        expect(env.sun.visible).toBe(true);
        env.dispose();
    });

    it("never casts shadows at low quality", () => {
        const env = createEnvironment({ quality: "low" });
        env.setLighting("day");
        expect(env.sun.castShadow).toBe(false);
        env.dispose();
    });

    it("disposes the sky and horizon", () => {
        const env = createEnvironment();
        const geo = vi.spyOn(env.sky.mesh.geometry, "dispose");
        const horizon = vi.spyOn(env.horizon.mesh.geometry, "dispose");
        env.dispose();
        expect(geo).toHaveBeenCalled();
        expect(horizon).toHaveBeenCalled();
    });

    it("keeps one sky program across presets and centers the horizon", () => {
        const env = createEnvironment({ focus: [10, 0, -24] });
        const material = env.sky.mesh.material as ShaderMaterial;
        const shader = material.fragmentShader;
        const u = material.uniforms;
        env.setLighting("night");
        expect(material.fragmentShader).toBe(shader);
        expect(u.uStars.value).toBeGreaterThan(0);
        expect(u.uSunDisc.value).toBe(0);
        expect(u.uMoon.value).toBeGreaterThan(0);
        env.setLighting("day");
        expect(u.uStars.value).toBe(0);
        expect(u.uSunDisc.value).toBeGreaterThan(0);
        expect(u.uSunDir.value.length()).toBeCloseTo(1);
        expect(u.bottom.value.getHex()).toBe(lightingValues("day").fog);
        expect(env.horizon.mesh.position.x).toBe(10);
        expect(env.horizon.mesh.position.z).toBe(-24);
        env.dispose();
    });

    it("builds a cheaper sky at low quality", () => {
        const high = createEnvironment();
        const low = createEnvironment({ quality: "low" });
        const frag = (e: typeof high) =>
            (e.sky.mesh.material as ShaderMaterial).fragmentShader;
        expect(frag(low)).not.toBe(frag(high));
        expect(frag(low)).toContain("i < 3");
        high.dispose();
        low.dispose();
    });
});

describe("lightPole", () => {
    it("toggles its spot and lamp", () => {
        const shared = createSharedMaterials();
        const pole = lightPole(27, [0, 0, 30], shared);
        const spot = pole.object.children.find(
            (c): c is SpotLight => c instanceof SpotLight,
        )!;
        expect(spot.intensity).toBe(0);
        expect(spot.visible).toBe(false);
        pole.setOn(true, 0.5);
        expect(spot.intensity).toBeCloseTo(0.8);
        expect(spot.visible).toBe(true);
        expect(spot.position.y).toBeCloseTo(27 + 4 * FT);
        pole.setOn(false);
        expect(spot.intensity).toBe(0);
        expect(spot.visible).toBe(false);
        pole.dispose();
        shared.dispose();
    });
});

describe("videoBoard", () => {
    it("builds frame, screen and legs", () => {
        const shared = createSharedMaterials();
        const withLegs = videoBoard(29, 16, 10, "TITLE", "sub", shared);
        expect(withLegs.object.children).toHaveLength(4);
        const noLegs = videoBoard(33.5, 17.7, 0, "TITLE", "sub", shared);
        expect(noLegs.object.children).toHaveLength(2);
        const meshes: Mesh[] = [];
        withLegs.object.traverse((o) => {
            if (o instanceof Mesh) meshes.push(o);
        });
        expect(meshes).toHaveLength(4);
        withLegs.dispose();
        noLegs.dispose();
        shared.dispose();
    });
});

describe("buildCrowd", () => {
    it("is a single InstancedMesh with a sane count", () => {
        const rows = straightRows(10, 60);
        const crowd = buildCrowd(rows, { density: 1 });
        expect(crowd.mesh).toBeInstanceOf(InstancedMesh);
        expect(crowd.mesh.count).toBe(crowd.count);
        // 60 m / 0.64 m is about 94 slots per row, minus aisles.
        const perRow = Math.floor(60 / PERSON_SPACING) + 1;
        expect(crowd.count).toBeLessThan(10 * perRow);
        expect(crowd.count).toBeGreaterThan(10 * perRow * 0.8);
        crowd.dispose();
    });

    it("leaves aisles", () => {
        const rows = straightRows(1, 40);
        const full = buildCrowd(rows, { density: 1, aisleEvery: 1e9 });
        const aisled = buildCrowd(rows, { density: 1, aisleEvery: 18 });
        expect(aisled.count).toBeLessThan(full.count);
        full.dispose();
        aisled.dispose();
    });

    it("scales with density and halves at low quality", () => {
        const rows = straightRows(20, 80);
        const high = buildCrowd(rows, { density: 0.8 });
        const low = buildCrowd(rows, { density: 0.8, quality: "low" });
        const none = buildCrowd(rows, { density: 0 });
        expect(low.count).toBeLessThan(high.count * 0.65);
        expect(low.count).toBeGreaterThan(high.count * 0.35);
        expect(none.count).toBe(0);
        [high, low, none].forEach((c) => c.dispose());
    });

    it("is deterministic and finite", () => {
        const rows = straightRows(5, 30);
        const a = buildCrowd(rows);
        const b = buildCrowd(rows);
        expect(Array.from(a.mesh.instanceMatrix.array)).toEqual(
            Array.from(b.mesh.instanceMatrix.array),
        );
        for (const n of a.mesh.instanceMatrix.array) {
            expect(Number.isFinite(n)).toBe(true);
        }
        a.dispose();
        b.dispose();
    });

    it("handles closed rows and empty input", () => {
        const ring: SeatRow = {
            points: [
                [-10, 1, -10],
                [10, 1, -10],
                [10, 1, 10],
                [-10, 1, 10],
            ],
            closed: true,
            depth: 0.8,
            side: "neutral",
        };
        const closed = buildCrowd([ring], { density: 1 });
        const open = buildCrowd([{ ...ring, closed: false }], { density: 1 });
        expect(closed.count).toBeGreaterThan(open.count);
        const empty = buildCrowd([]);
        expect(empty.count).toBe(0);
        expect(empty.clearAround([0, 0, 0], 5)).toBe(0);
        [closed, open, empty].forEach((c) => c.dispose());
    });

    it("uses the palette for the row's side", () => {
        const palette = { home: [0xff0000], away: [0x00ff00], neutral: [0] };
        const crowd = buildCrowd(straightRows(2, 10, "away"), {
            density: 1,
            palette,
        });
        const c = crowd.mesh.instanceColor!;
        expect(c.getX(0)).toBeCloseTo(0);
        expect(c.getY(0)).toBeCloseTo(1);
        crowd.dispose();
    });

    it("builds a palette from venue params", () => {
        const p = defaultCrowdPalette({
            homeColor: "#112233",
            awayColor: "bad",
        });
        expect(p.home[0]).toBe(0x112233);
        expect(p.away[0]).toBe(0xc23b3b);
    });

    it("clearAround hides people in range and the latest call wins", () => {
        const crowd = buildCrowd(straightRows(10, 60), { density: 1 });
        const total = crowd.count;
        const center: [number, number, number] = [0, 2, 14];
        const hidden = crowd.clearAround(center, 5);
        expect(hidden).toBeGreaterThan(0);
        expect(crowd.visibleCount()).toBe(total - hidden);

        const arr = crowd.mesh.instanceMatrix.array;
        let zeroed = 0;
        for (let k = 0; k < total; k++) {
            if (arr[k * 16] === 0 && arr[k * 16 + 5] === 0) zeroed++;
        }
        expect(zeroed).toBe(hidden);

        // Moving the point restores the earlier area.
        crowd.clearAround([25, 2, 14], 3);
        const hiddenAgain = total - crowd.visibleCount();
        let zeroedAgain = 0;
        for (let k = 0; k < total; k++) {
            if (arr[k * 16] === 0 && arr[k * 16 + 5] === 0) zeroedAgain++;
        }
        expect(zeroedAgain).toBe(hiddenAgain);

        crowd.reset();
        expect(crowd.visibleCount()).toBe(total);
        expect(crowd.clearAround([1000, 0, 0], 5)).toBe(0);
        crowd.dispose();
    });

    it("clearAround keeps the matrix finite", () => {
        const crowd = buildCrowd(straightRows(4, 20), { density: 1 });
        crowd.clearAround([0, 1, 10], 100);
        expect(crowd.visibleCount()).toBe(0);
        for (const n of crowd.mesh.instanceMatrix.array) {
            expect(Number.isFinite(n)).toBe(true);
        }
        crowd.dispose();
    });

    it("disposes its geometry and material", () => {
        const crowd = buildCrowd(straightRows(2, 10));
        const geo = vi.spyOn(crowd.mesh.geometry, "dispose");
        const mat = vi.spyOn(
            crowd.mesh.material as { dispose(): void },
            "dispose",
        );
        crowd.dispose();
        expect(geo).toHaveBeenCalled();
        expect(mat).toHaveBeenCalled();
    });
});

describe("crowd figures", () => {
    const triangles = (g: ReturnType<typeof personGeometry>) =>
        g.index!.count / 3;

    it("is a person of at most 28 triangles, 20 at low quality", () => {
        const high = personGeometry("high");
        const low = personGeometry("low");
        expect(triangles(high)).toBe(28);
        expect(triangles(low)).toBe(20);
        high.computeBoundingBox();
        const box = high.boundingBox!;
        expect(box.min.y).toBeCloseTo(0);
        expect(box.max.y).toBeCloseTo(PERSON_HEIGHT);
        expect(high.getAttribute("aPart").itemSize).toBe(2);
        high.dispose();
        low.dispose();
    });

    it("faces down the stand, toward the field", () => {
        // Rows rise toward +Z, so the field is toward -Z; and the reverse.
        for (const dir of [1, -1]) {
            const rows: SeatRow[] = Array.from({ length: 4 }, (_, i) => ({
                points: [
                    [-10 * dir, 1 + i * 0.4, dir * (10 + i)],
                    [10 * dir, 1 + i * 0.4, dir * (10 + i)],
                ],
                closed: false,
                depth: 0.8,
                side: "home",
            }));
            const crowd = buildCrowd(rows, { density: 1 });
            const m = new Matrix4();
            const q = new Quaternion();
            const p = new Vector3();
            const sc = new Vector3();
            for (let i = 0; i < crowd.count; i++) {
                crowd.mesh.getMatrixAt(i, m);
                m.decompose(p, q, sc);
                const forward = new Vector3(0, 0, 1).applyQuaternion(q);
                expect(forward.z * dir).toBeLessThan(-0.9);
            }
            crowd.dispose();
        }
    });

    it("faces the middle of a ring", () => {
        const ring: SeatRow = {
            points: [
                [-20, 1, -20],
                [20, 1, -20],
                [20, 1, 20],
                [-20, 1, 20],
            ],
            closed: true,
            depth: 0.8,
            side: "neutral",
        };
        const crowd = buildCrowd([ring], { density: 1 });
        const m = new Matrix4();
        const q = new Quaternion();
        const p = new Vector3();
        const sc = new Vector3();
        for (let i = 0; i < crowd.count; i++) {
            crowd.mesh.getMatrixAt(i, m);
            m.decompose(p, q, sc);
            const forward = new Vector3(0, 0, 1).applyQuaternion(q);
            const inward = new Vector3(-p.x, 0, -p.z).normalize();
            expect(forward.dot(inward)).toBeGreaterThan(0);
        }
        crowd.dispose();
    });
});

describe("horizon", () => {
    it("is two sloped rings in one geometry inside the kits' ground", () => {
        const g = horizonGeometry(64);
        const layers = new Set(Array.from(g.getAttribute("aLayer").array));
        expect([...layers].sort()).toEqual([0, 1]);
        g.computeBoundingBox();
        const box = g.boundingBox!;
        expect(box.max.x).toBeCloseTo(HORIZON_FAR_RADIUS);
        // The kits' ground plane is 9000 ft (2743 m) square.
        expect(HORIZON_FAR_RADIUS).toBeLessThan(2743 / 2);
        expect(box.min.y).toBeLessThan(0);
        g.dispose();
    });
});

describe("createSharedMaterials", () => {
    it("disposes everything it created", () => {
        const shared = createSharedMaterials();
        const extra = shared.std(0x123456);
        const spies = [shared.concrete, shared.glass, extra].map((m) =>
            vi.spyOn(m, "dispose"),
        );
        const geo = vi.spyOn(shared.unitBox, "dispose");
        shared.dispose();
        spies.forEach((s) => expect(s).toHaveBeenCalled());
        expect(geo).toHaveBeenCalled();
    });
});

describe("presets cover the contract", () => {
    it("accepts every LightingPreset", () => {
        const env = createEnvironment();
        for (const id of LIGHTING_PRESET_IDS as LightingPreset[]) {
            expect(() => env.setLighting(id)).not.toThrow();
        }
        env.dispose();
    });
});
