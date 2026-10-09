import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { RigController } from "../rigController";
import { MAX_PAN, MIN_RADIUS } from "../rigMath";

function rigAt(
    position: [number, number, number],
    target: [number, number, number],
) {
    const camera = new PerspectiveCamera(45, 1.6, 0.1, 5000);
    const rig = new RigController(camera);
    rig.jumpTo(position, target);
    rig.update(0);
    return { camera, rig };
}

describe("smoothed wheel zoom toward a point", () => {
    it("eases into the zoom over a few frames instead of jumping", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        const r0 = rig.spherical.radius;
        expect(rig.zoomWheelAt(-200, null, 0)).toBe(true);
        rig.update(16);
        const r1 = rig.spherical.radius;
        expect(r1).toBeLessThan(r0);
        for (let t = 32; t <= 1000; t += 16) rig.update(t);
        const rEnd = rig.spherical.radius;
        expect(rEnd).toBeLessThan(r1);
        // the whole step lands: the same total as an immediate zoom
        expect(rEnd).toBeCloseTo(r0 * Math.exp(-200 * 0.0012), 3);
    });

    it("keeps the point under the cursor by moving the target toward it", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        rig.zoomWheelAt(-400, [20, 0, -10], 0);
        for (let t = 16; t <= 1000; t += 16) rig.update(t);
        const k = 1 - Math.exp(-400 * 0.0012);
        expect(rig.target[0]).toBeCloseTo(20 * k, 3);
        expect(rig.target[2]).toBeCloseTo(-10 * k, 3);
    });

    it("doesn't zoom past the closest distance", () => {
        const { rig } = rigAt([0, 3, 3], [0, 0, 0]);
        for (let i = 0; i < 20; i++) rig.zoomWheelAt(-500, [0, 0, 0], i);
        for (let t = 16; t <= 2000; t += 16) rig.update(t);
        expect(rig.spherical.radius).toBeGreaterThanOrEqual(MIN_RADIUS - 1e-9);
    });
});

describe("pinch zoom toward a point", () => {
    it("zooms at once and moves the target toward the point", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        const r0 = rig.spherical.radius;
        expect(rig.zoomRatioAt(0.5, [10, 0, 0])).toBe(true);
        expect(rig.spherical.radius).toBeCloseTo(r0 * 0.5, 6);
        expect(rig.target[0]).toBeCloseTo(5, 6);
    });
});

describe("flung orbit", () => {
    it("keeps turning after release and coasts to a stop", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        let t = 0;
        for (let i = 0; i < 6; i++) {
            t += 16;
            rig.orbitDrag(12, 0, t);
            rig.update(t);
        }
        const atRelease = rig.spherical.theta;
        rig.release(t);
        t += 16;
        rig.update(t);
        const after = rig.spherical.theta;
        expect(after).not.toBeCloseTo(atRelease, 6); // still moving
        expect(Math.sign(after - atRelease)).toBe(-1); // same direction as the drag (theta -= dx)
        for (let i = 0; i < 200; i++) rig.update((t += 16));
        const settled = rig.spherical.theta;
        rig.update(t + 16);
        expect(rig.spherical.theta).toBeCloseTo(settled, 6); // stopped
        expect(Math.abs(settled - atRelease)).toBeLessThan(1); // a coast, not a spin
    });

    it("doesn't coast after a drag that paused before release", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        rig.orbitDrag(30, 0, 16);
        rig.update(16);
        const held = rig.spherical.theta;
        rig.release(400); // held still for most of a second
        rig.update(416);
        expect(rig.spherical.theta).toBeCloseTo(held, 9);
    });

    it("stops coasting when the pointer goes down again", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        for (let t = 16; t <= 96; t += 16) {
            rig.orbitDrag(20, 0, t);
            rig.update(t);
        }
        rig.release(96);
        rig.stopMotion();
        const at = rig.spherical.theta;
        rig.update(112);
        expect(rig.spherical.theta).toBeCloseTo(at, 9);
    });
});

describe("grab pan", () => {
    it("moves the target by the ground distance the pointer slid", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        expect(rig.grabPan([10, 0, 5], [4, 0, 2], [0, 0, 0])).toBe(true);
        expect(rig.target).toEqual([6, 0, 3]);
    });

    it("keeps the target within reach of the focus", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        rig.grabPan([MAX_PAN * 3, 0, 0], [0, 0, 0], [0, 0, 0]);
        expect(Math.hypot(rig.target[0], rig.target[2])).toBeCloseTo(
            MAX_PAN,
            6,
        );
    });
});

describe("input while flying", () => {
    it("ignores the new inputs during a fly-to", () => {
        const { rig } = rigAt([0, 60, 80], [0, 0, 0]);
        rig.flyTo([50, 20, 40], [0, 0, 0], { nowMs: 0 });
        expect(rig.zoomWheelAt(-100, null, 0)).toBe(false);
        expect(rig.zoomRatioAt(0.5, null)).toBe(false);
        expect(rig.orbitDrag(10, 0, 0)).toBe(false);
        expect(rig.grabPan([1, 0, 0], [0, 0, 0], [0, 0, 0])).toBe(false);
    });
});
