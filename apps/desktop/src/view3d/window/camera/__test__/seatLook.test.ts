// @vitest-environment node
// cspell:ignore raycaster panini hfov
import { afterEach, describe, expect, it } from "vitest";
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { RigController } from "../rigController";
import {
    clampLook,
    isPersonSeat,
    lookAngles,
    lookDirection,
    LOOK_PITCH_MAX,
    LOOK_PITCH_MIN,
    LOOK_YAW_LIMIT,
    SEAT_ZOOM_MIN_DEG,
} from "../rigMath";
import { projectToScreen, seatLens, setRayFromScreen } from "../seatLens";
import { paniniFrame } from "@/view3d/core/post/panini";
import { SEAT_VIEW_DEFAULTS } from "@/view3d/core/post/seatViewPass";

const DEG = Math.PI / 180;
const EYE: [number, number, number] = [0, 14, 35];
const FIELD: [number, number, number] = [0, 0, -10];

function seatedRig() {
    const camera = new PerspectiveCamera(45, 1.6, 0.1, 3000);
    const rig = new RigController(camera);
    rig.sit(EYE, FIELD);
    rig.update(0);
    return { camera, rig };
}

/** Runs frames until the head settles. */
function settle(rig: RigController, from = 16) {
    for (let t = from; t <= from + 2000; t += 16) rig.update(t);
}

const facing = lookAngles(EYE, FIELD);

describe("look limits", () => {
    it("keeps yaw within 100° either way and pitch within 60° down, 45° up", () => {
        expect(LOOK_YAW_LIMIT).toBeCloseTo(100 * DEG, 12);
        expect(clampLook(3, 0).yaw).toBe(LOOK_YAW_LIMIT);
        expect(clampLook(-3, 0).yaw).toBe(-LOOK_YAW_LIMIT);
        expect(clampLook(0, 2).pitch).toBe(LOOK_PITCH_MAX);
        expect(clampLook(0, -2).pitch).toBe(LOOK_PITCH_MIN);
        expect(clampLook(0.4, -0.2)).toEqual({ yaw: 0.4, pitch: -0.2 });
    });

    it("turns angles into directions and back", () => {
        for (const [az, p] of [
            [0, 0],
            [2.5, -0.4],
            [-1.2, 0.7],
        ]) {
            const d = lookDirection(az, p);
            const back = lookAngles([0, 0, 0], d);
            expect(back.azimuth).toBeCloseTo(az, 9);
            expect(back.pitch).toBeCloseTo(p, 9);
        }
    });

    it("applies to seat and floor cameras only", () => {
        expect(isPersonSeat({ kind: "seat" })).toBe(true);
        expect(isPersonSeat({ kind: "floor" })).toBe(true);
        expect(isPersonSeat({ kind: "topDown" })).toBe(false);
        expect(isPersonSeat({ kind: "aerial" })).toBe(false);
        expect(isPersonSeat({ kind: "saved" })).toBe(false);
    });
});

describe("looking around from a seat", () => {
    it("faces the seat's target at first", () => {
        const { camera, rig } = seatedRig();
        expect(rig.seated).toBe(true);
        const dir = camera.getWorldDirection(new Vector3());
        const want = lookDirection(facing.azimuth, facing.pitch);
        expect(dir.x).toBeCloseTo(want[0], 6);
        expect(dir.y).toBeCloseTo(want[1], 6);
        expect(dir.z).toBeCloseTo(want[2], 6);
    });

    it("turns the head about a fixed eye, easing there", () => {
        const { camera, rig } = seatedRig();
        expect(rig.lookBy(0.5, 0.2)).toBe(true);
        rig.update(16);
        const partway = rig.look!;
        expect(partway.yaw).toBeGreaterThan(0);
        expect(partway.yaw).toBeLessThan(0.5);
        expect(rig.moving).toBe(true);
        settle(rig, 32);
        expect(rig.moving).toBe(false);
        expect(rig.look!.yaw).toBeCloseTo(0.5, 6);
        expect(rig.look!.pitch).toBeCloseTo(facing.pitch + 0.2, 6);
        expect(camera.position.toArray()).toEqual(EYE);
    });

    it("stops at the limits however far the drag goes", () => {
        const { rig } = seatedRig();
        rig.lookBy(10, 10);
        settle(rig);
        expect(rig.look).toEqual({
            yaw: LOOK_YAW_LIMIT,
            pitch: LOOK_PITCH_MAX,
        });
        rig.lookBy(-30, -30);
        settle(rig, 3000);
        expect(rig.look).toEqual({
            yaw: -LOOK_YAW_LIMIT,
            pitch: LOOK_PITCH_MIN,
        });
    });

    it("turns to face a double-clicked point, the shorter way round", () => {
        const { rig } = seatedRig();
        // 40° to the viewer's left of the facing, level.
        const az = facing.azimuth + 40 * DEG;
        const p = lookDirection(az, 0);
        rig.turnHeadTo([EYE[0] + p[0] * 50, EYE[1], EYE[2] + p[2] * 50]);
        settle(rig);
        expect(rig.look!.yaw).toBeCloseTo(40 * DEG, 6);
        expect(rig.look!.pitch).toBeCloseTo(0, 6);
    });

    it("zooms the eye between 30° and seat view's widest", () => {
        const { rig } = seatedRig();
        expect(rig.seatFovDeg).toBe(SEAT_VIEW_DEFAULTS.hfovDeg);
        rig.seatZoom(0.1);
        settle(rig);
        expect(rig.seatFovDeg).toBeCloseTo(SEAT_ZOOM_MIN_DEG, 1);
        rig.seatZoom(100);
        settle(rig, 3000);
        expect(rig.seatFovDeg).toBeCloseTo(SEAT_VIEW_DEFAULTS.hfovDeg, 1);
    });

    it("leaves the seat on an orbit, a fly or a jump, and ignores looks then", () => {
        for (const leave of [
            (r: RigController) => r.orbit(10, 0),
            (r: RigController) => r.flyTo([0, 50, 50], [0, 0, 0], { nowMs: 0 }),
            (r: RigController) => r.jumpTo([0, 50, 50], [0, 0, 0]),
        ]) {
            const { rig } = seatedRig();
            leave(rig);
            expect(rig.seated).toBe(false);
            expect(rig.lookBy(0.1, 0)).toBe(false);
            expect(rig.seatZoom(0.5)).toBe(false);
        }
    });

    it("orbits about what the head faced after leaving the seat", () => {
        const { camera, rig } = seatedRig();
        rig.lookBy(0.3, 0);
        settle(rig);
        const before = camera.getWorldDirection(new Vector3());
        rig.orbit(0, 0);
        rig.update(5000);
        const after = camera.getWorldDirection(new Vector3());
        expect(after.angleTo(before)).toBeLessThan(1e-6);
    });
});

describe("picking through the seat view lens", () => {
    afterEach(() => {
        seatLens.frame = null;
    });

    it("casts the plain camera's ray with no lens", () => {
        const { camera } = seatedRig();
        const a = new Raycaster();
        const b = new Raycaster();
        setRayFromScreen(a, new Vector2(0.4, -0.3), camera);
        b.setFromCamera(new Vector2(0.4, -0.3), camera);
        expect(a.ray.direction.angleTo(b.ray.direction)).toBeLessThan(1e-9);
    });

    it("casts the ray the picture shows at each pixel, and projects back to it", () => {
        const { camera } = seatedRig();
        seatLens.frame = paniniFrame({
            hfovDeg: 105,
            aspect: camera.aspect,
            d: 1,
            s: 0.25,
        });
        const rc = new Raycaster();
        for (const [x, y] of [
            [0, 0],
            [0.95, 0.4],
            [-0.9, -0.9],
        ]) {
            setRayFromScreen(rc, new Vector2(x, y), camera);
            const p = rc.ray.at(40, new Vector3());
            const ndc = projectToScreen([p.x, p.y, p.z], camera)!;
            expect(ndc[0]).toBeCloseTo(x, 9);
            expect(ndc[1]).toBeCloseTo(y, 9);
        }
        // At the edge the picture shows a ray 52.5° off center, where the
        // plain camera's ray would be at its own edge.
        setRayFromScreen(rc, new Vector2(1, 0), camera);
        const local = rc.ray.direction
            .clone()
            .transformDirection(camera.matrixWorldInverse);
        expect(Math.atan2(local.x, -local.z) / DEG).toBeCloseTo(52.5, 6);
    });

    it("finds nothing behind the eye", () => {
        const { camera } = seatedRig();
        const behind = camera.position
            .clone()
            .sub(camera.getWorldDirection(new Vector3()));
        expect(projectToScreen([behind.x, behind.y, behind.z], camera)).toBe(
            null,
        );
    });
});
