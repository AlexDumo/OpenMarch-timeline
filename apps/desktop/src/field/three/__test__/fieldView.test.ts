import { describe, expect, it } from "vitest";
import { cameraBounds, fieldToElement, fitView } from "../fieldView";

const field = { width: 1600, height: 850 };

describe("fitView", () => {
    it("shows the whole field and its margin, centered", () => {
        const view = fitView(1200, 700, field, 60);
        expect(view.zoom).toBeCloseTo(Math.min(1200 / 1720, 700 / 970));
        const topLeft = fieldToElement(view, -60, -60);
        const bottomRight = fieldToElement(
            view,
            field.width + 60,
            field.height + 60,
        );
        expect(topLeft.x).toBeGreaterThanOrEqual(-1e-9);
        expect(topLeft.y).toBeGreaterThanOrEqual(-1e-9);
        expect(bottomRight.x).toBeLessThanOrEqual(1200 + 1e-9);
        expect(bottomRight.y).toBeLessThanOrEqual(700 + 1e-9);
        const center = fieldToElement(view, field.width / 2, field.height / 2);
        expect(center.x).toBeCloseTo(600);
        expect(center.y).toBeCloseTo(350);
    });

    it("keeps a usable zoom before the element has a size", () => {
        expect(fitView(0, 0, field).zoom).toBe(1);
    });
});

describe("cameraBounds", () => {
    it("puts the element's corners where fieldToElement puts field points", () => {
        const view = fitView(1000, 600, field);
        const { left, right, top, bottom } = cameraBounds(view);
        expect(fieldToElement(view, left, top)).toEqual({ x: 0, y: 0 });
        const corner = fieldToElement(view, right, bottom);
        expect(corner.x).toBeCloseTo(1000);
        expect(corner.y).toBeCloseTo(600);
        // Field y grows down the screen
        expect(top).toBeLessThan(bottom);
    });
});
