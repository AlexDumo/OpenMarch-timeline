// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anchorsClearOfArrows, arrowSizes } from "../facingArrow";

describe("facing arrow sizes (#1316)", () => {
    it("is about 1.5 dot diameters from just outside the dot, at the field's size when zoomed in", () => {
        const at1 = arrowSizes(1);
        const at3 = arrowSizes(3);
        expect(at1.length).toBe(16);
        expect(at3.length).toBe(16);
        expect(at1.start).toBeGreaterThan(5);
        expect(at1.start).toBeLessThan(7);
        expect(at1.headHalfWidth).toBeGreaterThan(at1.shaftHalfWidth * 3);
    });

    it("keeps a readable size on screen when zoomed out to the whole field", () => {
        for (const zoom of [0.5, 0.3, 0.15]) {
            const sizes = arrowSizes(zoom);
            // CSS px on screen
            expect(sizes.length * zoom).toBeGreaterThanOrEqual(13 - 1e-9);
            expect(2 * sizes.shaftHalfWidth * zoom).toBeGreaterThanOrEqual(
                1.75 - 1e-9,
            );
            expect(2 * sizes.headHalfWidth * zoom).toBeGreaterThan(6);
            expect(sizes.halo * zoom).toBeCloseTo(1.25);
        }
    });
});

describe("labels clear of facing arrows (#1316)", () => {
    const arrow = arrowSizes(1);
    // Three marchers: facing back (up the screen), side 2 (right) and front (down)
    const positions = new Float64Array([10, 20, 100, 40, 200, 60]);
    const directions = new Float32Array([0, -1, 1, 0, 0, 1]);
    const widths = [20, 20, 20];
    const anchors = (beside: boolean) =>
        anchorsClearOfArrows({
            positions,
            directions,
            widths,
            label: { beside, offset: beside ? 8 : 11, height: 14 },
            arrow,
            out: new Float64Array(6),
        });

    it("moves a label above the dot below it when the arrow points up through it", () => {
        expect([...anchors(false)]).toEqual([10, 42, 100, 40, 200, 60]);
    });

    it("moves a label beside the dot to its left when the arrow points right through it", () => {
        // Its left end goes as far left of the dot as it was right: 8 + 20 + 8
        expect([...anchors(true)]).toEqual([10, 20, 64, 40, 200, 60]);
    });

    it("leaves a label where it is when nothing has an arrow", () => {
        const out = anchorsClearOfArrows({
            positions,
            directions: new Float32Array(6),
            widths,
            label: { beside: false, offset: 11, height: 14 },
            arrow,
            out: new Float64Array(6),
        });
        expect([...out]).toEqual([...positions]);
    });
});
