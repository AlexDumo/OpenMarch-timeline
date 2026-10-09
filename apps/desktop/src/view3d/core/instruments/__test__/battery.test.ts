// apps/desktop/src/view3d/core/instruments/__test__/battery.test.ts
import { describe, expect, it } from "vitest";
import {
    bounds,
    triangleCount,
    PART_HEAD,
    PART_SHELL,
    PART_WOOD,
    PART_METAL,
    PART_BLACK,
    type Piece,
} from "../mesh";
import {
    BASS_SIZES_IN,
    bassForward,
    bassSizesFor,
    batteryModel,
} from "../battery";
import type { BatteryModelId } from "../model";

const IDS: BatteryModelId[] = ["snare", "tenors", "bass", "cymbals"];

describe("battery models", () => {
    it.each(IDS)("%s stays within the triangle budgets", (id) => {
        const high = triangleCount(batteryModel(id, "high").pieces);
        const low = triangleCount(batteryModel(id, "low").pieces);
        expect(high).toBeGreaterThanOrEqual(4000);
        expect(high).toBeLessThanOrEqual(12000);
        expect(low).toBeGreaterThanOrEqual(1000);
        expect(low).toBeLessThanOrEqual(3500);
    });

    it("builds the snare 14 by 12 on the chest with a stick in each hand", () => {
        const m = batteryModel("snare");
        expect(m.bone).toBe("spine002");
        const shell = m.pieces.filter((p) => p.part === PART_SHELL && !p.bone);
        const b = bounds(shell);
        expect(b.max[0] - b.min[0]).toBeCloseTo(0.356, 1);
        expect(b.max[2] - b.min[2]).toBeCloseTo(0.305, 1);
        expect(
            m.pieces.some((p) => p.part === PART_WOOD && p.bone === "handR"),
        ).toBe(true);
        expect(
            m.pieces.some((p) => p.part === PART_WOOD && p.bone === "handL"),
        ).toBe(true);
        expect(m.pieces.some((p) => p.part === PART_HEAD)).toBe(true);
    });

    it("sizes the bass drum from its options", () => {
        for (const inches of [18, 26, 32]) {
            const m = batteryModel("bass", "high", { bassInches: inches });
            const shell = m.pieces.filter((p) => p.part === PART_SHELL);
            const b = bounds(shell);
            // the heads' axis is +Z: the diameter spans x and y
            expect(b.max[0] - b.min[0]).toBeCloseTo(inches * 0.0254, 1);
            expect(b.max[2] - b.min[2]).toBeCloseTo(0.356, 1);
            expect(m.options?.bassInches).toBe(inches);
        }
    });

    it("spreads bass sizes evenly, smallest first", () => {
        expect(BASS_SIZES_IN).toEqual([18, 20, 22, 24, 26, 28, 30, 32]);
        expect(bassSizesFor(1)).toEqual([26]);
        expect(bassSizesFor(2)).toEqual([18, 32]);
        expect(bassSizesFor(5)).toEqual([18, 22, 26, 28, 32]);
        expect(bassSizesFor(8)).toEqual([18, 20, 22, 24, 26, 28, 30, 32]);
        expect(bassSizesFor(0)).toEqual([]);
    });

    it("puts the tenors in an arc, smallest on the player's left and biggest on the right", () => {
        const m = batteryModel("tenors");
        const shells = m.pieces.filter((p) => p.part === PART_SHELL);
        expect(shells.length).toBe(6);
        const centers = shells.map((p) => {
            const b = bounds([p]);
            return { x: (b.max[0] + b.min[0]) / 2, w: b.max[0] - b.min[0] };
        });
        const big = centers.filter((c) => c.w > 0.22).sort((a, b) => a.x - b.x);
        expect(big.length).toBe(4);
        // under the tenor hold instrument +X is the performer's right: the
        // smallest drum sits at −X (the player's left), the biggest at +X
        expect(big[0].w).toBeLessThan(big[3].w);
    });

    it("hangs a cymbal from each hand, facing each other", () => {
        const m = batteryModel("cymbals");
        const left = m.pieces.filter((p) => p.bone === "handL");
        const right = m.pieces.filter((p) => p.bone === "handR");
        expect(left.length).toBeGreaterThan(0);
        expect(right.length).toBeGreaterThan(0);
        for (const p of [...left, ...right]) expect(p.part).toBe(PART_METAL);
        const bl = bounds(left);
        const br = bounds(right);
        expect(bl.max[1] - bl.min[1]).toBeCloseTo(0.457, 1);
        expect(bl.min[0]).toBeGreaterThan(br.max[0] - 0.05);
    });
});

describe("battery placement", () => {
    const center = (pieces: Piece[]) => {
        const b = bounds(pieces);
        return b.min.map((v, i) => (v + b.max[i]) / 2);
    };
    const shellCenter = (inches: number) =>
        center(
            batteryModel("bass", "high", { bassInches: inches }).pieces.filter(
                (p) => p.part === PART_SHELL,
            ),
        );

    it("moves bigger bass drums forward (instrument −X) so every size clears the chest", () => {
        const small = shellCenter(18);
        const big = shellCenter(32);
        // forward is instrument −X: the 32 sits about 0.18 further out
        expect(small[0] - big[0]).toBeCloseTo(0.178, 2);
        expect(bassForward(18)).toBeCloseTo(0.0286, 3);
        // the drum's back (toward the player, +X) stays 0.2 in front of the hold's origin
        for (const inches of [18, 26, 32]) {
            const b = bounds(
                batteryModel("bass", "high", {
                    bassInches: inches,
                }).pieces.filter((p) => p.part === PART_SHELL),
            );
            expect(b.max[0]).toBeCloseTo(0.2, 2);
        }
    });

    it("lands each bass mallet on its head's center for the smallest and biggest drums", () => {
        for (const inches of [18, 32]) {
            const m = batteryModel("bass", "high", { bassInches: inches });
            const axis = shellCenter(inches);
            for (const bone of ["handR", "handL"] as const) {
                const head = m.pieces.filter(
                    (p) => p.part === PART_BLACK && p.bone === bone,
                );
                expect(head.length).toBe(1);
                const c = center(head);
                // the heads are at z ±0.178; the mallet's center just outside its plane
                expect(Math.abs(Math.abs(c[2]) - 0.178)).toBeLessThanOrEqual(
                    0.03,
                );
                expect(Math.sign(c[2])).toBe(bone === "handR" ? -1 : 1);
                expect(
                    Math.hypot(c[0] - axis[0], c[1] - axis[1]),
                ).toBeLessThanOrEqual(0.06);
            }
        }
    });

    it("records the options every battery model was built with", () => {
        for (const id of IDS)
            expect(
                batteryModel(id, "low", { bassInches: 30 }).options?.bassInches,
            ).toBe(30);
    });

    /** Each hand's stick tip: the center of the last wooden piece on that hand. */
    const tips = (id: "snare" | "tenors") => {
        const m = batteryModel(id);
        return (["handR", "handL"] as const).map((bone) => {
            const wood = m.pieces.filter(
                (p) => p.part === PART_WOOD && p.bone === bone,
            );
            return center([wood[wood.length - 1]]);
        });
    };

    it("angles the snare sticks in over the head without crossing or passing the front rim", () => {
        // the head is the disc of radius 0.178 at z 0; +X the performer's right, +Y forward
        const [right, left] = tips("snare");
        for (const t of [right, left]) {
            expect(Math.hypot(t[0], t[1])).toBeLessThan(0.178 - 0.04);
            expect(t[1]).toBeGreaterThan(0); // the front half
            expect(t[2]).toBeGreaterThan(0);
            expect(t[2]).toBeLessThan(0.05);
        }
        expect(right[0]).toBeGreaterThan(0);
        expect(left[0]).toBeLessThan(0);
    });

    it("puts each tenor stick's tip over one of the two front drums", () => {
        const [right, left] = tips("tenors");
        const front = [
            { x: -0.16, y: 0.15, r: (12 * 0.0254) / 2 },
            { x: 0.17, y: 0.15, r: (13 * 0.0254) / 2 },
        ];
        const over = (t: number[], d: (typeof front)[number]) =>
            Math.hypot(t[0] - d.x, t[1] - d.y) < d.r - 0.03 &&
            t[2] > 0 &&
            t[2] < 0.06;
        expect(over(right, front[1])).toBe(true);
        expect(over(left, front[0])).toBe(true);
    });
});
