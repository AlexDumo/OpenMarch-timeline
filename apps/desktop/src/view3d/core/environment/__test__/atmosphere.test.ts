import { beforeAll, describe, expect, it, vi } from "vitest";
import { InstancedBufferAttribute, Matrix4, Vector3 } from "three";
import type { SeatRow } from "../../types";
import {
    autoDetail,
    buildCrowd,
    buildFigureGeometry,
    createEnvironment,
    createHorizon,
    createSkyDome,
    HORIZON_RADIUS,
    horizonHeight,
    LIGHTING_PRESET_IDS,
    lightingValues,
    setTexturePainting,
    SKY_RADIUS,
} from "..";

beforeAll(() => setTexturePainting(false));

describe("atmosphere values", () => {
    it("has unit sun and moon directions and matching fog for every preset", () => {
        for (const id of LIGHTING_PRESET_IDS) {
            const a = lightingValues(id).atmosphere;
            for (const d of [a.sunDir, a.moonDir])
                expect(Math.hypot(...d)).toBeCloseTo(1);
            expect(a.cloudCover).toBeGreaterThanOrEqual(0);
            expect(a.cloudCover).toBeLessThanOrEqual(1);
        }
        for (const id of ["day", "dusk", "night"] as const)
            expect(lightingValues(id).atmosphere.horizon).toBe(
                lightingValues(id).fog,
            );
    });

    it("shows stars and a moon only at night, windows from dusk", () => {
        expect(lightingValues("day").atmosphere.stars).toBe(0);
        expect(lightingValues("night").atmosphere.stars).toBe(1);
        expect(lightingValues("night").atmosphere.moon).toBe(1);
        expect(lightingValues("day").atmosphere.windows).toBe(0);
        expect(lightingValues("dusk").atmosphere.windows).toBeGreaterThan(0);
    });
});

describe("createSkyDome", () => {
    it("sets sun, clouds and stars from the preset and hides indoors", () => {
        const sky = createSkyDome();
        const u = (
            sky.mesh.material as unknown as {
                uniforms: Record<string, { value: unknown }>;
            }
        ).uniforms;
        sky.setPreset("night");
        expect(u.uStars.value).toBe(1);
        expect(u.uMoon.value).toBe(1);
        sky.setPreset("day");
        expect(u.uStars.value).toBe(0);
        expect((u.uSunDir.value as Vector3).y).toBeGreaterThan(0.5);
        expect(sky.mesh.visible).toBe(true);
        sky.setPreset("house");
        expect(sky.mesh.visible).toBe(false);
        sky.dispose();
    });

    it("fits inside the camera far plane", () => {
        expect(SKY_RADIUS).toBeLessThan(3000);
        expect(HORIZON_RADIUS).toBeLessThan(SKY_RADIUS);
    });
});

describe("createHorizon", () => {
    it("is hills, trees, town and lights, and dresses by preset", () => {
        const h = createHorizon();
        expect(h.root.children).toHaveLength(4);
        const lights = h.root.getObjectByName("horizon.lights")!;
        h.setPreset("day");
        expect(h.root.visible).toBe(true);
        expect(lights.visible).toBe(false);
        h.setPreset("night");
        expect(lights.visible).toBe(true);
        h.setPreset("house");
        expect(h.root.visible).toBe(false);
        h.setCenter([5, 0, -7]);
        expect(h.root.position.x).toBe(5);
        expect(h.root.position.z).toBe(-7);
        h.dispose();
    });

    it("keeps the hills flat near the field and finite everywhere", () => {
        expect(horizonHeight(330, 1)).toBeCloseTo(0.25, 0);
        for (let r = 300; r <= HORIZON_RADIUS + 40; r += 37)
            for (let a = 0; a < 6.3; a += 0.31)
                expect(Number.isFinite(horizonHeight(r, a))).toBe(true);
        expect(horizonHeight(HORIZON_RADIUS + 40, 0)).toBeLessThan(0);
    });

    it("is periodic around the circle", () => {
        expect(horizonHeight(1200, 0)).toBeCloseTo(
            horizonHeight(1200, Math.PI * 2),
            4,
        );
    });

    it("moves with the rig's focus and is freed with it", () => {
        const env = createEnvironment();
        env.setLighting("dusk", [10, 0, 20]);
        expect(env.horizon.root.position.x).toBe(10);
        expect(env.root.children).toContain(env.horizon.root);
        const spy = vi.spyOn(env.horizon, "dispose");
        env.dispose();
        expect(spy).toHaveBeenCalled();
    });
});

/** A closed ring of rows around the origin. */
function ring(r: number): SeatRow {
    const points: [number, number, number][] = Array.from(
        { length: 48 },
        (_, i) => [
            Math.cos((i / 48) * Math.PI * 2) * r,
            1,
            Math.sin((i / 48) * Math.PI * 2) * r,
        ],
    );
    return { points, closed: true, depth: 0.8, side: "neutral" };
}

describe("crowd figures", () => {
    it("has a head, torso and legs, about 0.9 m tall, at every detail", () => {
        const tris = [0, 1, 2].map((d) => {
            const g = buildFigureGeometry(d as 0 | 1 | 2);
            g.computeBoundingBox();
            const box = g.boundingBox!;
            expect(box.max.y).toBeGreaterThan(0.8);
            expect(box.max.y).toBeLessThan(1);
            expect(box.min.y).toBeLessThan(-0.1);
            const parts = new Set(
                Array.from(g.getAttribute("aPart").array as Float32Array),
            );
            expect([...parts].sort()).toEqual([0, 1, 2, 3]);
            const n = g.getAttribute("position").count / 3;
            g.dispose();
            return n;
        });
        expect(tris[0]).toBeLessThan(tris[1]);
        expect(tris[1]).toBeLessThan(tris[2]);
        expect(tris[2]).toBeLessThan(250);
    });

    it("picks lighter figures for bigger crowds and at low quality", () => {
        expect(autoDetail(1000, "high")).toBe(2);
        expect(autoDetail(12000, "high")).toBe(1);
        expect(autoDetail(40000, "high")).toBe(0);
        expect(autoDetail(1000, "low")).toBe(1);
    });

    it("gives each person skin, hair and trouser values", () => {
        const crowd = buildCrowd([ring(30)], { density: 1 });
        const vary = crowd.mesh.geometry.getAttribute("aVar");
        expect(vary).toBeInstanceOf(InstancedBufferAttribute);
        expect(vary.count).toBeGreaterThanOrEqual(crowd.count);
        const values = new Set(
            Array.from(vary.array as Float32Array).map((x) => x.toFixed(2)),
        );
        expect(values.size).toBeGreaterThan(20);
        crowd.dispose();
    });

    it("faces the middle of the venue on a ring and on two straight stands", () => {
        const crowd = buildCrowd([ring(30)], { density: 1, seed: 3 });
        const m = new Matrix4();
        let facing = 0;
        for (let i = 0; i < crowd.count; i++) {
            crowd.mesh.getMatrixAt(i, m);
            const p = new Vector3().setFromMatrixPosition(m);
            const f = new Vector3(0, 0, 1).transformDirection(m);
            const toMid = new Vector3(-p.x, 0, -p.z).normalize();
            if (f.dot(toMid) > 0.7) facing++;
        }
        expect(facing / crowd.count).toBeGreaterThan(0.95);
        crowd.dispose();

        // Home stand at z = +20 and away stand at z = -20, rows along X.
        const stand = (z: number): SeatRow => ({
            points: [
                [-20, 1, z],
                [20, 1, z],
            ],
            closed: false,
            depth: 0.8,
            side: "home",
        });
        const two = buildCrowd([stand(20), stand(-20)], { density: 1 });
        let ok = 0;
        for (let i = 0; i < two.count; i++) {
            two.mesh.getMatrixAt(i, m);
            const p = new Vector3().setFromMatrixPosition(m);
            const f = new Vector3(0, 0, 1).transformDirection(m);
            if (f.z * p.z < 0) ok++;
        }
        expect(ok / two.count).toBeGreaterThan(0.99);
        two.dispose();
    });

    it("builds without people", () => {
        const crowd = buildCrowd([]);
        expect(crowd.mesh.instanceColor).not.toBeNull();
        crowd.dispose();
    });
});
