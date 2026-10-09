import { describe, expect, it } from "vitest";
import { HOLD_STATES, hold, holdId, type HoldFamily } from "../holds";

const SHOULDER_R = [-0.185, 1.397, -0.005] as const;
const UPPER = 0.205;
const FOREARM = 0.264;
const dist = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const FAMILIES: HoldFamily[] = [
    "brass",
    "trombone",
    "contra",
    "flute",
    "piccolo",
    "clarinet",
    "sax",
    "snare",
    "tenors",
    "bass",
    "cymbals",
];
/** The guard carries at the side with an arm down, so only the reach test covers it. */
const GUARD: HoldFamily[] = ["flag", "rifle", "sabre"];

describe("holds", () => {
    it("lists the four states with up first", () => {
        expect(HOLD_STATES).toEqual(["up", "carry", "trail"]);
        expect(holdId("brass", "up")).toBe("brass:up");
    });

    it.each([...FAMILIES, ...GUARD])(
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
        // the mouthpiece (behind the grip, level with it) reaches the lips
        expect(h.instrument.origin[1]).toBeGreaterThan(1.5);
        expect(h.instrument.origin[1]).toBeLessThan(1.62);
        // elbows out: wider than the shoulders
        expect(h.right.elbow[0]).toBeLessThan(SHOULDER_R[0] - 0.08);
    });

    it("brass carry: mouthpiece at eye level, bell to the ground", () => {
        const h = hold("brass", "carry");
        expect(h.instrument.bellAxis).toEqual([0, -1, 0]);
        // the mouthpiece sits about 0.17 above the grip: eye level
        expect(h.instrument.origin[1]).toBeGreaterThan(1.45);
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
        expect(h.instrument.origin[0]).toBeGreaterThanOrEqual(0.14);
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

describe("woodwind and battery holds", () => {
    it("flute: to the player's right at the lips, keys forward", () => {
        const h = hold("flute", "up");
        expect(h.instrument.bellAxis[0]).toBeLessThan(-0.8); // the tube runs to the right
        expect(h.instrument.origin[1]).toBeGreaterThan(1.5);
        expect(h.right.wrist[0]).toBeLessThan(h.left.wrist[0] - 0.15);
    });

    it("piccolo: the flute's hold with the right hand on the short body", () => {
        for (const state of HOLD_STATES) {
            const p = hold("piccolo", state);
            const f = hold("flute", state);
            expect(p.instrument).toEqual(f.instrument);
            expect(p.left).toEqual(f.left);
            // the right wrist sits along the tube no further than the piccolo's 0.29 m reach
            const o = p.instrument.origin;
            const along = p.instrument.bellAxis.reduce(
                (s, v, i) => s + v * (p.right.wrist[i] - o[i]),
                0,
            );
            expect(along).toBeGreaterThan(0.15);
            expect(along).toBeLessThan(0.29);
        }
    });

    it("flute: the lip plate (−Y) faces back at the lips, level", () => {
        const c = hold("flute", "up").instrument.capsAxis;
        expect(c[2]).toBeGreaterThan(0.95);
        expect(Math.abs(c[1])).toBeLessThan(0.1);
    });

    it("clarinet: down the center line, angled out", () => {
        const h = hold("clarinet", "up");
        expect(h.instrument.bellAxis[1]).toBeLessThan(-0.7);
        expect(h.instrument.bellAxis[2]).toBeGreaterThan(0.2);
        expect(h.right.wrist[1]).toBeLessThan(h.left.wrist[1]);
    });

    it("sax: body straight down in front, neck at the lips", () => {
        const h = hold("sax", "up");
        expect(h.instrument.origin[1]).toBeGreaterThan(1.45);
        expect(h.instrument.bellAxis[1]).toBeLessThan(-0.95);
        expect(Math.abs(h.instrument.bellAxis[0])).toBeLessThan(0.1);
    });

    it("drums ride the chest with the hands over the heads", () => {
        for (const family of ["snare", "tenors", "bass"] as const) {
            const h = hold(family, "up");
            expect(h.instrument.origin[1]).toBeLessThan(1.2);
            expect(h.instrument.origin[2]).toBeGreaterThan(0.2);
            expect(h.right.wrist[1]).toBeGreaterThan(h.instrument.origin[1]);
        }
        expect(hold("tenors", "up").right.wrist[0]).toBeLessThan(
            hold("snare", "up").right.wrist[0],
        );
        expect(hold("bass", "up").instrument.bellAxis[0]).not.toBe(0); // the heads face sideways
    });

    it("bass drummers play with bent arms, wrists well inside full reach", () => {
        const h = hold("bass", "up");
        // full reach is the upper arm plus the forearm, 0.469
        expect(dist(SHOULDER_R, h.right.wrist)).toBeLessThan(
            (UPPER + FOREARM) * 0.7,
        );
        // the hands sit outside the heads (±0.178), above and behind the drum's middle
        expect(Math.abs(h.right.wrist[0])).toBeGreaterThan(0.2);
        expect(h.right.wrist[1]).toBeGreaterThan(1.2);
    });

    it("woodwinds carry with the ligature at eye level; drums have one hold", () => {
        for (const family of ["flute", "clarinet", "sax"] as const)
            expect(hold(family, "carry").instrument.origin[1]).toBeGreaterThan(
                1.55,
            );
        for (const family of ["snare", "tenors", "bass", "cymbals"] as const)
            expect(hold(family, "carry")).toEqual({
                ...hold(family, "up"),
                state: "carry",
            });
    });
});
