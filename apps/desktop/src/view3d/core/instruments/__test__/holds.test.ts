import { describe, expect, it } from "vitest";
import { HOLD_STATES, hold, holdId, type HoldFamily } from "../holds";

const SHOULDER_R = [-0.185, 1.397, -0.005] as const;
const UPPER = 0.205;
const FOREARM = 0.264;
const dist = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const FAMILIES: HoldFamily[] = ["brass", "trombone", "contra"];

describe("holds", () => {
    it("lists the four states with up first", () => {
        expect(HOLD_STATES).toEqual(["up", "carry", "trail"]);
        expect(holdId("brass", "up")).toBe("brass:up");
    });

    it.each(FAMILIES)(
        "%s: every state's targets are reachable by the arm",
        (family) => {
            for (const state of HOLD_STATES) {
                const h = hold(family, state);
                for (const [side, arm] of [
                    ["right", h.right],
                    ["left", h.left],
                ] as const) {
                    const shoulder =
                        side === "right"
                            ? SHOULDER_R
                            : [-SHOULDER_R[0], SHOULDER_R[1], SHOULDER_R[2]];
                    expect(dist(shoulder, arm.elbow)).toBeLessThanOrEqual(
                        UPPER + 0.02,
                    );
                    expect(dist(arm.elbow, arm.wrist)).toBeLessThanOrEqual(
                        FOREARM + 0.02,
                    );
                    expect(dist(shoulder, arm.wrist)).toBeGreaterThan(0.12);
                    expect(Math.hypot(...arm.fingers)).toBeCloseTo(1, 6);
                }
            }
        },
    );

    it("brass up: bell forward at face height, mouthpiece at the mouth", () => {
        const h = hold("brass", "up");
        expect(h.instrument.bellAxis).toEqual([0, 0, 1]);
        expect(h.instrument.origin[1]).toBeGreaterThan(1.35);
        expect(h.instrument.origin[1]).toBeLessThan(1.55);
        // elbows out: wider than the shoulders
        expect(h.right.elbow[0]).toBeLessThan(SHOULDER_R[0] - 0.08);
    });

    it("brass carry: mouthpiece at eye level, bell to the ground", () => {
        const h = hold("brass", "carry");
        expect(h.instrument.bellAxis).toEqual([0, -1, 0]);
        expect(h.instrument.origin[1]).toBeGreaterThan(1.2);
    });

    it("brass trail: right arm down the side, bell backward, left arm straight", () => {
        const h = hold("brass", "trail");
        expect(h.instrument.bellAxis).toEqual([0, 0, -1]);
        expect(h.right.wrist[1]).toBeLessThan(1.0);
        expect(h.left.wrist[1]).toBeLessThan(1.0);
        expect(Math.abs(h.left.wrist[0] - 0.2)).toBeLessThan(0.08);
    });

    it("contra up: bell forward, valves high in front of the face", () => {
        const h = hold("contra", "up");
        expect(h.instrument.bellAxis).toEqual([0, 0, 1]);
        expect(h.instrument.origin[1]).toBeGreaterThan(1.5);
        expect(h.instrument.origin[1]).toBeLessThan(1.7);
        expect(h.instrument.origin[2]).toBeGreaterThan(0.1);
        expect(h.instrument.origin[2]).toBeLessThan(0.3);
        // the loop plane lies over the left shoulder, clear of the head (half-width 0.1 plus the tube)
        expect(h.instrument.origin[0]).toBeGreaterThan(0.15);
    });

    it("keeps the wrists in front of the chest in every hold", () => {
        for (const family of FAMILIES)
            for (const state of HOLD_STATES) {
                const h = hold(family, state);
                if (state === "trail") continue;
                expect(h.right.wrist[2]).toBeGreaterThan(0.12);
                expect(h.left.wrist[2]).toBeGreaterThan(0.12);
            }
    });
});
