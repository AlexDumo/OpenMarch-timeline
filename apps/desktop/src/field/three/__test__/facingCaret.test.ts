// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anchorsClearOfCarets, caretSizes } from "../facingCaret";

describe("facing caret sizes (#1316)", () => {
    it("is a small caret just outside the dot, at the field's size when zoomed in", () => {
        const at1 = caretSizes(1);
        const at3 = caretSizes(3);
        expect(at1.depth).toBe(3);
        expect(at3.depth).toBe(3);
        expect(at1.halfWidth).toBe(3.75);
        expect(at1.start).toBeGreaterThan(5);
        expect(at1.start).toBeLessThan(7);
    });

    it("keeps a readable size on screen when zoomed out to the whole field", () => {
        for (const zoom of [0.5, 0.3, 0.15]) {
            const sizes = caretSizes(zoom);
            // CSS px on screen
            expect(2 * sizes.halfWidth * zoom).toBeGreaterThanOrEqual(7 - 1e-9);
            expect(2 * sizes.strokeHalfWidth * zoom).toBeGreaterThanOrEqual(
                1.5 - 1e-9,
            );
            expect(sizes.halo * zoom).toBeCloseTo(1);
        }
    });
});

describe("labels clear of facing carets (#1316)", () => {
    const caret = caretSizes(1);
    // Three marchers: facing back (up the screen), side 2 (right) and front (down)
    const positions = new Float64Array([10, 20, 100, 40, 200, 60]);
    const directions = new Float32Array([0, -1, 1, 0, 0, 1]);
    const widths = [20, 20, 20];
    const anchors = (beside: boolean, sizes = caret) =>
        anchorsClearOfCarets({
            positions,
            directions,
            widths,
            label: { beside, offset: beside ? 8 : 11, height: 14 },
            caret: sizes,
            out: new Float64Array(6),
        });

    it("moves a label above the dot below it when the caret points up through it", () => {
        expect([...anchors(false)]).toEqual([10, 42, 100, 40, 200, 60]);
    });

    it("moves a label beside the dot to its left when the caret points right through it", () => {
        // Its left end goes as far left of the dot as it was right: 8 + 20 + 8
        expect([...anchors(true)]).toEqual([10, 20, 64, 40, 200, 60]);
    });

    it("moves labels off the bigger caret drawn when zoomed out", () => {
        const zoomedOut = caretSizes(0.15);
        expect([...anchors(false, zoomedOut)]).toEqual([
            10, 42, 100, 40, 200, 60,
        ]);
        expect([...anchors(true, zoomedOut)]).toEqual([
            10, 20, 64, 40, 200, 60,
        ]);
    });

    it("moves a label off a caret that only one arm reaches", () => {
        // Facing a little left of the back: the point and the right arm stay under the label
        const a = (20 * Math.PI) / 180;
        const out = anchorsClearOfCarets({
            positions: new Float64Array([0, 0]),
            directions: new Float32Array([-Math.sin(a), -Math.cos(a)]),
            widths: [20],
            label: { beside: false, offset: 11, height: 14 },
            caret,
            out: new Float64Array(2),
        });
        expect([...out]).toEqual([0, 22]);
    });

    it("leaves a label where it is when the caret points away from it", () => {
        // Facing side 1 (left), the label beside the dot on its right
        const out = anchorsClearOfCarets({
            positions: new Float64Array([0, 0]),
            directions: new Float32Array([-1, 0]),
            widths: [20],
            label: { beside: true, offset: 8, height: 14 },
            caret,
            out: new Float64Array(2),
        });
        expect([...out]).toEqual([0, 0]);
    });

    it("leaves a label where it is when nothing has a caret", () => {
        const out = anchorsClearOfCarets({
            positions,
            directions: new Float32Array(6),
            widths,
            label: { beside: false, offset: 11, height: 14 },
            caret,
            out: new Float64Array(6),
        });
        expect([...out]).toEqual([...positions]);
    });
});
