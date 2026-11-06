import { beforeAll, describe, expect, it } from "vitest";
import {
    BoxGeometry,
    InstancedMesh,
    LineSegments,
    Matrix4,
    Mesh,
    SpotLight,
    Vector3,
    type BufferGeometry,
    type Material,
    type Object3D,
} from "three";
import { buildCrowd, setTexturePainting } from "../../environment";
import type { FieldFootprint, VenueParams } from "../../types";
import { buildCollege } from "../college";
import {
    bowlPlanFor,
    profileAt,
    sampleBowlPath,
    LOWER,
    UPPER,
} from "../college/bowl";

beforeAll(() => setTexturePainting(false));

const FOOTBALL: FieldFootprint = {
    minX: -54.86,
    maxX: 54.86,
    minZ: -48.77,
    maxZ: 0,
};
const SMALL: FieldFootprint = { minX: -20, maxX: 28, minZ: -30, maxZ: 0 };
const PARAMS: VenueParams = {
    homeColor: "#6442ff",
    awayColor: "#c23b3b",
    endZoneText: "",
    endZoneColor: "#1f2a5c",
};

const build = (
    footprint = FOOTBALL,
    quality: "low" | "high" = "high",
    params = PARAMS,
) => buildCollege({ footprint, params, quality });

function solids(root: Object3D): Matrix4[] {
    root.updateMatrixWorld(true);
    const out: Matrix4[] = [];
    root.traverse((o) => {
        if (o.userData.crowd || o.userData.ground) return;
        if (!(o instanceof Mesh) || !(o.geometry instanceof BoxGeometry))
            return;
        if (o instanceof InstancedMesh) {
            const m = new Matrix4();
            for (let i = 0; i < o.count; i++) {
                o.getMatrixAt(i, m);
                out.push(new Matrix4().multiplyMatrices(o.matrixWorld, m));
            }
        } else {
            out.push(o.matrixWorld.clone());
        }
    });
    return out;
}

function insideAny(point: [number, number, number], boxes: Matrix4[]) {
    const p = new Vector3();
    return boxes.some((box) => {
        p.set(...point).applyMatrix4(box.clone().invert());
        return (
            Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.5 && Math.abs(p.z) < 0.5
        );
    });
}

function drawCalls(root: Object3D): number {
    let n = 0;
    root.traverse((o) => {
        if (o instanceof Mesh || o instanceof LineSegments) n++;
    });
    return n;
}

describe("college profile", () => {
    it("is a staircase of axis-aligned steps with the same nodes everywhere", () => {
        const plain = profileAt(0);
        const home = profileAt(1);
        expect(home.nodes.length).toBe(plain.nodes.length);
        for (const p of [plain, home]) {
            for (let k = 0; k + 1 < p.nodes.length; k++) {
                const a = p.nodes[k];
                const b = p.nodes[k + 1];
                const flat = Math.abs(a.h - b.h) < 1e-9;
                const sheer = Math.abs(a.off - b.off) < 1e-9;
                expect(flat || sheer, `segment ${k}`).toBe(true);
            }
            // ends on the ground, starting at the wall
            expect(p.nodes[0]).toMatchObject({ off: 0, h: 0 });
            expect(p.nodes[p.nodes.length - 1].h).toBe(0);
        }
    });

    it("gives the home side a suite level and a wider rim", () => {
        const plain = profileAt(0);
        const home = profileAt(1);
        expect(home.rimH - plain.rimH).toBeCloseTo(8, 5);
        expect(home.rimOff).toBeGreaterThan(plain.rimOff + 5);
        expect(plain.seats.length).toBe(LOWER.rows + UPPER.rows);
    });
});

describe("college plan", () => {
    const plan = bowlPlanFor(FOOTBALL);
    const stations = sampleBowlPath(plan, 4, 16);

    it("wraps three sides and leaves the -x end open", () => {
        const first = stations[0];
        const last = stations[stations.length - 1];
        expect(first.x).toBeCloseTo(plan.cx - plan.openX);
        expect(last.x).toBeCloseTo(plan.cx - plan.openX);
        expect(first.nz).toBe(1);
        expect(last.nz).toBe(-1);
        expect(Math.min(...stations.map((s) => s.x))).toBeGreaterThanOrEqual(
            plan.cx - plan.openX - 1e-6,
        );
        expect(stations.some((s) => s.side === "end" && s.nx > 0.99)).toBe(
            true,
        );
    });

    it("has no gaps: stations are at most one step apart on the wall curve", () => {
        for (let i = 1; i < stations.length; i++) {
            const d = Math.hypot(
                stations[i].x - stations[i - 1].x,
                stations[i].z - stations[i - 1].z,
            );
            expect(d).toBeGreaterThan(0);
            expect(d).toBeLessThanOrEqual(4.01);
        }
        for (const s of stations) {
            expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 6);
        }
    });

    it("keeps the wall clear of the footprint", () => {
        for (const s of stations) {
            const inside =
                s.x > FOOTBALL.minX &&
                s.x < FOOTBALL.maxX &&
                s.z > FOOTBALL.minZ &&
                s.z < FOOTBALL.maxZ;
            expect(inside).toBe(false);
        }
    });

    it("grows the suite weight only on the home side", () => {
        for (const s of stations) {
            if (s.side === "home") expect(s.w).toBeGreaterThan(0);
            if (s.side === "away") expect(s.w).toBe(0);
        }
        expect(Math.max(...stations.map((s) => s.w))).toBe(1);
    });
});

describe("college kit", () => {
    it("returns the contract with finite geometry, default night", () => {
        const kit = build();
        expect(kit.focus[0]).toBeCloseTo(0);
        expect(kit.focus[2]).toBeCloseTo(-24.385);
        expect(kit.defaultLighting).toBe("night");
        expect(kit.lightingPresets).toEqual(["day", "dusk", "night"]);
        kit.root.updateMatrixWorld(true);
        kit.root.traverse((o) => {
            if (o instanceof Mesh || o instanceof LineSegments) {
                const pos = (o.geometry as BufferGeometry).getAttribute(
                    "position",
                );
                for (const v of pos.array)
                    expect(Number.isFinite(v)).toBe(true);
            }
            for (const e of o.matrixWorld.elements) {
                expect(Number.isFinite(e)).toBe(true);
            }
        });
        kit.dispose();
    });

    it("keeps the camera ids shows saved", () => {
        const kit = build();
        expect(kit.cameras.map((c) => c.id)).toEqual([
            "pressBox",
            "frontRow",
            "endZone",
            "blimp",
            "topDown",
        ]);
        for (const c of kit.cameras) {
            expect(c.labelKey).toBe(`view3d.camera.${c.id}`);
            for (const v of [...c.position, ...c.target]) {
                expect(Number.isFinite(v)).toBe(true);
            }
        }
        const topDown = kit.cameras.find((c) => c.id === "topDown")!;
        expect(topDown.kind).toBe("topDown");
        expect(topDown.position[1]).toBeGreaterThan(100);
        expect(topDown.position[2]).toBeGreaterThan(topDown.target[2]);
        kit.dispose();
    });

    it("keeps cameras out of solid boxes and in the venue", () => {
        const kit = build();
        const boxes = solids(kit.root);
        for (const c of kit.cameras) {
            expect(insideAny(c.position, boxes), c.id).toBe(false);
            expect(c.position[1], c.id).toBeGreaterThan(0.5);
            if (c.kind === "seat") {
                expect(Math.abs(c.position[0]), c.id).toBeLessThan(140);
                expect(Math.abs(c.position[2] + 24.4), c.id).toBeLessThan(140);
            }
        }
        // the press box camera is above the rim, the front row camera low
        const pb = kit.cameras.find((c) => c.id === "pressBox")!;
        const fr = kit.cameras.find((c) => c.id === "frontRow")!;
        expect(pb.position[1]).toBeGreaterThan(25);
        expect(fr.position[1]).toBeLessThan(6);
        kit.dispose();
    });

    it("keeps the footprint free for the field surface", () => {
        const kit = build();
        for (const m of solids(kit.root)) {
            const c = new Vector3().setFromMatrixPosition(m);
            const inside =
                c.x > FOOTBALL.minX &&
                c.x < FOOTBALL.maxX &&
                c.z > FOOTBALL.minZ &&
                c.z < FOOTBALL.maxZ;
            expect(inside).toBe(false);
        }
        // the goal posts stand behind the end lines
        const posts = kit.root.getObjectByName("goalPosts") as InstancedMesh;
        const m = new Matrix4();
        for (let i = 0; i < posts.count; i++) {
            posts.getMatrixAt(i, m);
            const x = new Vector3().setFromMatrixPosition(m).x;
            expect(Math.abs(x)).toBeGreaterThan(54.86);
        }
        kit.dispose();
    });

    it("returns continuous seat rows in the three crowd sides", () => {
        const kit = build();
        const sides = new Set(kit.seatRows.map((r) => r.side));
        expect(sides).toEqual(new Set(["home", "away", "neutral"]));
        // every tread of both tiers is a row on the home side
        expect(kit.seatRows.filter((r) => r.side === "home").length).toBe(
            LOWER.rows + UPPER.rows,
        );
        for (const row of kit.seatRows) {
            expect(row.points.length).toBeGreaterThanOrEqual(2);
            expect(row.closed).toBe(false);
            for (const p of row.points) {
                expect(p.every(Number.isFinite)).toBe(true);
                expect(p[1]).toBeGreaterThan(0);
            }
        }
        // seating wraps the +x end: some row reaches past the end line
        expect(
            Math.max(...kit.seatRows.flatMap((r) => r.points.map((p) => p[0]))),
        ).toBeGreaterThan(70);
        expect(kit.pickTargets.length).toBeGreaterThanOrEqual(3);
        const crowd = buildCrowd(kit.seatRows, { density: kit.crowdDensity });
        expect(crowd.count).toBeGreaterThan(5000);
        expect(crowd.clearAround(kit.cameras[1].position, 5)).toBeGreaterThan(
            0,
        );
        crowd.dispose();
        kit.dispose();
    });

    it("stays under the draw call budget", () => {
        const kit = build();
        expect(drawCalls(kit.root)).toBeLessThan(60);
        kit.dispose();
    });

    it("applies lighting presets: banks, spots and window glow", () => {
        const kit = build();
        const spots: SpotLight[] = [];
        kit.root.traverse((o) => {
            if (o instanceof SpotLight) spots.push(o);
        });
        expect(spots.length).toBe(4);
        const glass = (kit.root.getObjectByName("bowl:glass") as Mesh)
            .material as { emissiveIntensity: number };
        kit.setLighting("night");
        for (const s of spots) expect(s.intensity).toBeGreaterThan(0);
        expect(glass.emissiveIntensity).toBeGreaterThan(1);
        kit.setLighting("dusk");
        for (const s of spots) expect(s.intensity).toBeCloseTo(1.6 * 0.6);
        kit.setLighting("day");
        for (const s of spots) {
            expect(s.intensity).toBe(0);
            expect(s.visible).toBe(false);
        }
        expect(glass.emissiveIntensity).toBe(0);
        kit.setLighting("house");
        expect(glass.emissiveIntensity).toBe(0);
        kit.dispose();
    });

    it("scrolls the ribbon board", () => {
        const kit = build();
        const ribbon = (kit.root.getObjectByName("bowl:fascia") as Mesh)
            .material as { emissiveMap: { offset: { x: number } } };
        const before = ribbon.emissiveMap.offset.x;
        kit.onFrame?.({ cameraPosition: [0, 0, 0], dt: 1 });
        expect(ribbon.emissiveMap.offset.x).not.toBe(before);
        kit.dispose();
    });

    it("builds for an off-center footprint, placed relative to it", () => {
        const kit = build(SMALL);
        expect(kit.focus).toEqual([4, 0, -15]);
        const boxes = solids(kit.root);
        for (const c of kit.cameras) {
            expect(insideAny(c.position, boxes), c.id).toBe(false);
        }
        const home = kit.seatRows.filter((r) => r.side === "home");
        expect(
            Math.min(...home.flatMap((r) => r.points.map((p) => p[2]))),
        ).toBeGreaterThan(0);
        const away = kit.seatRows.filter((r) => r.side === "away");
        expect(
            Math.max(...away.flatMap((r) => r.points.map((p) => p[2]))),
        ).toBeLessThan(-30);
        kit.dispose();
    });

    it("drops shadows and half the stations at low quality", () => {
        const high = build();
        const low = build(FOOTBALL, "low");
        low.root.traverse((o) => expect(o.castShadow).toBe(false));
        const tris = (k: typeof high) => {
            let n = 0;
            k.root.traverse((o) => {
                if (o instanceof Mesh) {
                    const g = o.geometry as BufferGeometry;
                    n +=
                        (g.index?.count ?? g.getAttribute("position").count) /
                        3;
                }
            });
            return n;
        };
        expect(tris(low)).toBeLessThan(tris(high) * 0.6);
        high.dispose();
        low.dispose();
    });

    it("disposes everything it created", () => {
        const kit = build();
        const disposed = new Set<unknown>();
        const watched: (BufferGeometry | Material)[] = [];
        kit.root.traverse((o) => {
            if (!(o instanceof Mesh || o instanceof LineSegments)) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const item of [o.geometry as BufferGeometry, ...mats]) {
                if (!watched.includes(item)) {
                    watched.push(item);
                    item.addEventListener("dispose", () => disposed.add(item));
                }
            }
        });
        kit.dispose();
        for (const item of watched) expect(disposed.has(item)).toBe(true);
    });
});
