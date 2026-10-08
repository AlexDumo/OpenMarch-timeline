import { describe, expect, it } from "vitest";
import { bounds, triangleCount } from "../mesh";
import { BRASS_DIMENSIONS, brassModel, type BrassModelId } from "../brass";

const IDS: BrassModelId[] = [
    "trumpet",
    "mellophone",
    "baritone",
    "euphonium",
    "trombone",
    "bassTrombone",
    "contra",
];

describe("brass models", () => {
    it.each(IDS)("%s stays within the triangle budget", (id) => {
        const n = triangleCount(brassModel(id).pieces);
        expect(n).toBeGreaterThanOrEqual(300);
        expect(n).toBeLessThanOrEqual(600);
    });

    it.each(IDS)(
        "%s has the spec's length along +Z and bell diameter",
        (id) => {
            const { min, max } = bounds(brassModel(id).pieces);
            const d = BRASS_DIMENSIONS[id];
            expect(max[2] - min[2]).toBeCloseTo(d.length, 1);
            // the bell is the widest part: its diameter sets the x extent
            expect(max[0] - min[0]).toBeCloseTo(d.bell, 1);
        },
    );

    it("puts the trumpet's right-hand grip at the origin and the mouthpiece behind it", () => {
        const m = brassModel("trumpet");
        expect(m.mouthpiece[2]).toBeLessThan(0);
        expect(Math.abs(m.leftGrip[2])).toBeLessThan(0.12);
        // the valve caps rise above the grip
        const { max } = bounds(m.pieces.filter((p) => p.part === 18));
        expect(max[1]).toBeGreaterThan(0.03);
    });

    it("builds the contra with its bell above the grip", () => {
        const { max } = bounds(brassModel("contra").pieces);
        expect(max[1]).toBeGreaterThan(0.5);
    });

    it("uses only instrument part ids", () => {
        for (const id of IDS)
            for (const p of brassModel(id).pieces)
                expect([16, 18, 22]).toContain(p.part);
    });
});
