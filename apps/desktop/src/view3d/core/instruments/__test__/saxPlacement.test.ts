import { describe, expect, it } from "vitest";
import { hold, type HoldState } from "../holds";
import { bounds, PART_METAL, type Vec3 } from "../mesh";
import {
    SAX_BELL_TILT,
    SAX_SHAPES,
    WOODWIND_DIMENSIONS,
    woodwindModel,
} from "../woodwinds";

type SaxId = "altoSax" | "tenorSax" | "bariSax";
const SAXES: SaxId[] = ["altoSax", "tenorSax", "bariSax"];
const STATES: HoldState[] = ["up", "carry"];

const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];

/** The instrument frame placed in the body frame, as `instrumentGeometry.ts` builds it. */
function placement(state: HoldState) {
    const { origin, bellAxis, capsAxis } = hold("sax", state).instrument;
    const z = unit(bellAxis);
    const d = dot(capsAxis, z);
    const y = unit([
        capsAxis[0] - z[0] * d,
        capsAxis[1] - z[1] * d,
        capsAxis[2] - z[2] * d,
    ]);
    const x = unit(cross(y, z));
    const point = (p: Vec3): Vec3 =>
        [0, 1, 2].map(
            (k) => origin[k] + x[k] * p[0] + y[k] * p[1] + z[k] * p[2],
        ) as Vec3;
    return { point, z, y, x };
}

/**
 * The bell rim's center in the instrument frame: the widest piece's ring
 * furthest along the flare's axis (−Z leaning toward +Y).
 */
function bellRim(id: SaxId): Vec3 {
    const pieces = woodwindModel(id, "high").pieces;
    const width = (p: (typeof pieces)[number]) => {
        const b = bounds([p]);
        return b.max[0] - b.min[0];
    };
    const bell = pieces.reduce((a, b) => (width(b) > width(a) ? b : a));
    const n: Vec3 = [0, Math.sin(SAX_BELL_TILT), -Math.cos(SAX_BELL_TILT)];
    let far = -Infinity;
    for (let i = 0; i < bell.positions.length; i += 3)
        far = Math.max(
            far,
            dot(n, [
                bell.positions[i],
                bell.positions[i + 1],
                bell.positions[i + 2],
            ]),
        );
    const sum: Vec3 = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < bell.positions.length; i += 3) {
        const v: Vec3 = [
            bell.positions[i],
            bell.positions[i + 1],
            bell.positions[i + 2],
        ];
        if (dot(n, v) > far - 0.003) {
            for (let k = 0; k < 3; k++) sum[k] += v[k];
            count++;
        }
    }
    return [sum[0] / count, sum[1] / count, sum[2] / count];
}

// the torso, front at z 0.12 (holds.ts landmarks), between hips and shoulders
const inTorso = (w: Vec3) =>
    Math.abs(w[0]) < 0.17 && w[1] > 0.85 && w[1] < 1.35 && w[2] < 0.12;
const LIPS: Record<HoldState, Vec3> = {
    up: [0, 1.52, 0.13],
    carry: [0, 1.62, 0.14],
    trail: [0, 1.62, 0.14],
};

describe("sax placement under the sax hold", () => {
    for (const id of SAXES)
        for (const state of STATES)
            describe(`${id} ${state}`, () => {
                const { point, z } = placement(state);

                it("keeps every lacquered vertex in front of the chest", () => {
                    const inside: Vec3[] = [];
                    for (const p of woodwindModel(id, "high").pieces) {
                        if (p.part !== PART_METAL) continue;
                        for (let i = 0; i < p.positions.length; i += 3) {
                            const w = point([
                                p.positions[i],
                                p.positions[i + 1],
                                p.positions[i + 2],
                            ]);
                            if (inTorso(w)) inside.push(w);
                        }
                    }
                    expect(inside.length).toBe(0);
                });

                it("puts the bell on the performer's left of the body, opening forward and up", () => {
                    const [, yb] = woodwindModel(id).leftGrip;
                    const rimLocal = bellRim(id);
                    const rim = point(rimLocal);
                    const body = point([0, yb, rimLocal[2]]);
                    expect(rim[0]).toBeGreaterThan(body[0] + 0.05);
                    // the opening's normal: the flare's axis, leaning toward the keys
                    const open = point([
                        0,
                        Math.sin(SAX_BELL_TILT),
                        -Math.cos(SAX_BELL_TILT),
                    ]);
                    const o = point([0, 0, 0]);
                    const n = [0, 1, 2].map((k) => open[k] - o[k]);
                    expect(n[1]).toBeGreaterThan(0.6); // up
                    expect(n[2]).toBeGreaterThan(0.2); // forward
                });

                it("keeps the mouthpiece at the lips", () => {
                    const o = point([0, 0, 0]);
                    const lips = LIPS[state];
                    expect(
                        Math.hypot(
                            o[0] - lips[0],
                            o[1] - lips[1],
                            o[2] - lips[2],
                        ),
                    ).toBeLessThan(0.04);
                });
            });
});

/**
 * A pearl touch at fraction `k` from the body's top to the bow, in the
 * instrument frame: on the keys' side (+Y) of the body, just off center.
 */
function pearl(id: SaxId, k: number): Vec3 {
    const sh = SAX_SHAPES[id];
    const [, yb, grip] = woodwindModel(id).leftGrip;
    const top = grip - 0.12;
    const bowZ = WOODWIND_DIMENSIONS[id].length - sh.bowWidth / 2 - sh.rBow;
    const z = top + (bowZ - top) * k;
    const r = sh.rTop + ((sh.rBow - sh.rTop) * (z - top)) / (bowZ - top);
    return [0, yb + r, z];
}

describe("the sax held in front", () => {
    for (const id of SAXES) {
        it(`${id}: the bell turns up on the instrument's +X, its flare leaning toward the keys`, () => {
            const rim = bellRim(id);
            expect(rim[0]).toBeGreaterThan(0.05);
            const [, yb] = woodwindModel(id).leftGrip;
            expect(rim[1]).toBeGreaterThan(yb + 0.01);
        });

        it(`${id}: hangs centered in front of the body with the keys facing forward`, () => {
            const { point, y } = placement("up");
            expect(y[2]).toBeGreaterThan(0.95);
            const sh = SAX_SHAPES[id];
            const [, yb] = woodwindModel(id).leftGrip;
            const bowZ =
                WOODWIND_DIMENSIONS[id].length - sh.bowWidth / 2 - sh.rBow;
            const bow = point([0, yb, bowZ]);
            expect(Math.abs(bow[0])).toBeLessThan(0.05);
            // in front of the stomach, not out at arm's length
            expect(bow[2]).toBeLessThan(0.35);
        });

        it(`${id}: the hands wrap the stacks from the sides, left hand upper, right hand lower`, () => {
            const { point } = placement("up");
            const h = hold("sax", "up");
            const dist = (a: Vec3, b: Vec3) =>
                Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            const upper = point(pearl(id, 0.28));
            const lower = point(pearl(id, 0.63));
            // the hold suits the alto; the longer tenor and bari reach further
            const reach = { altoSax: 0.12, tenorSax: 0.17, bariSax: 0.2 }[id];
            expect(dist(h.left.wrist, upper)).toBeLessThan(reach);
            expect(dist(h.right.wrist, lower)).toBeLessThan(reach);
            expect(h.left.wrist[0]).toBeGreaterThan(upper[0]);
            expect(h.right.wrist[0]).toBeLessThan(lower[0]);
            // fingers across the front, toward the other side
            expect(h.left.fingers[0]).toBeLessThan(-0.5);
            expect(h.right.fingers[0]).toBeGreaterThan(0.5);
        });
    }
});
