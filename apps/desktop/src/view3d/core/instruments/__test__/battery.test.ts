// apps/desktop/src/view3d/core/instruments/__test__/battery.test.ts
import { describe, expect, it } from "vitest";
import {
    bounds,
    triangleCount,
    PART_HEAD,
    PART_SHELL,
    PART_WOOD,
    PART_METAL,
} from "../mesh";
import { BASS_SIZES_IN, bassSizesFor, batteryModel } from "../battery";
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

    it("puts the tenors in an arc, biggest to the player's left", () => {
        const m = batteryModel("tenors");
        const shells = m.pieces.filter((p) => p.part === PART_SHELL);
        expect(shells.length).toBe(6);
        const centers = shells.map((p) => {
            const b = bounds([p]);
            return { x: (b.max[0] + b.min[0]) / 2, w: b.max[0] - b.min[0] };
        });
        const big = centers.filter((c) => c.w > 0.22).sort((a, b) => a.x - b.x);
        expect(big.length).toBe(4);
        expect(big[0].w).toBeLessThan(big[3].w); // smallest at −X (the performer's right), biggest at +X
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
