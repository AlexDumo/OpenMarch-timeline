import { describe, expect, it } from "vitest";
import { hold, type HoldState } from "../holds";
import { bounds, PART_METAL, type Vec3 } from "../mesh";
import { woodwindModel } from "../woodwinds";

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
    return { point, z };
}

/** The bell rim's center in the instrument frame: the widest piece's top ring. */
function bellRim(id: SaxId): Vec3 {
    const pieces = woodwindModel(id, "high").pieces;
    const width = (p: (typeof pieces)[number]) => {
        const b = bounds([p]);
        return b.max[0] - b.min[0];
    };
    const bell = pieces.reduce((a, b) => (width(b) > width(a) ? b : a));
    const top = bounds([bell]).min[2];
    const sum: Vec3 = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < bell.positions.length; i += 3)
        if (bell.positions[i + 2] < top + 0.002) {
            for (let k = 0; k < 3; k++) sum[k] += bell.positions[i + k];
            n++;
        }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
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

                it("puts the bell at the performer's right, opening forward or out", () => {
                    expect(point(bellRim(id))[0]).toBeLessThan(-0.02);
                    // the bell opens along the instrument's −Z
                    expect(-z[2]).toBeGreaterThanOrEqual(0);
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
