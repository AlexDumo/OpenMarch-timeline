import { describe, expect, it } from "vitest";
import { crowdedLabels } from "../labelForms";

const box = (x: number, y = 0) => ({ x, y, width: 34, height: 14 });

describe("crowded labels", () => {
    it("marks labels that would touch, and leaves spread-out ones", () => {
        // 2 steps (24 units) apart touch; the last one is far away
        expect(crowdedLabels([box(0), box(24), box(200)])).toEqual([
            true,
            true,
            false,
        ]);
    });

    it("lets labels in different rows be", () => {
        expect(crowdedLabels([box(0, 0), box(10, 40)])).toEqual([false, false]);
    });
});
