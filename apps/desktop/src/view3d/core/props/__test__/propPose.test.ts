import { describe, expect, it } from "vitest";
import { isLevel, writePosedMatrix, type PropTurn } from "../propPose";

/** Where a point in the prop's own unit frame lands, by the matrix at index 0 */
function place(m: Float32Array, p: [number, number, number]) {
    return [0, 1, 2].map(
        (r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r],
    );
}

const pose = (turn: Partial<PropTurn>) => {
    const m = new Float32Array(16);
    writePosedMatrix(
        m,
        0,
        { rotation: 0, pitch: 0, roll: 0, ...turn },
        { x: 2, y: 1, z: 1 },
        { x: 10, y: 0, z: 20 },
        0.5,
    );
    return m;
};

const close = (a: number[], b: number[]) =>
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe("writePosedMatrix", () => {
    it("places an level prop's underside at its spot, scaled", () => {
        close(place(pose({}), [0, 0, 0]), [10, 0, 20]);
        close(place(pose({}), [0.5, 1, 0]), [11, 1, 20]);
    });

    it("tips the top toward the front with pitch, about the middle of its height", () => {
        const m = pose({ pitch: 90 });
        // The middle stays put
        close(place(m, [0, 0.5, 0]), [10, 0.5, 20]);
        // The top goes toward +z
        close(place(m, [0, 1, 0]), [10, 0.5, 20.5]);
    });

    it("lays the top toward the right with roll", () => {
        close(place(pose({ roll: 90 }), [0, 1, 0]), [10.5, 0.5, 20]);
    });

    it("tilts in the prop's own frame, after its turn on the ground", () => {
        // Turned a quarter, the prop's front (+z) faces -x, so pitch tips the top that way
        const m = pose({ rotation: 90, pitch: 90 });
        close(place(m, [0, 1, 0]), [9.5, 0.5, 20]);
    });
});

describe("isLevel", () => {
    it("is level with no tilt or whole turns of it", () => {
        expect(isLevel({ pitch: 0, roll: 0 })).toBe(true);
        expect(isLevel({ pitch: 360, roll: -720 })).toBe(true);
        expect(isLevel({})).toBe(true);
        expect(isLevel({ pitch: 15, roll: 0 })).toBe(false);
        expect(isLevel({ pitch: 0, roll: 180 })).toBe(false);
    });
});
