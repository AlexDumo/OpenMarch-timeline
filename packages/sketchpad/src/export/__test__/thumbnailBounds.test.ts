import { describe, expect, it } from "vitest";
import {
    THUMBNAIL_ASPECT,
    THUMBNAIL_MIN_SHARE,
    thumbnailBounds,
} from "../thumbnailBounds";

/** A whole-field thumbnail's bounds, roughly a football field in scene units */
const FULL = { x: -1000, y: -600, width: 2000, height: 640 };

const contains = (
    outer: { x: number; y: number; width: number; height: number },
    inner: typeof outer,
) =>
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height;

describe("thumbnailBounds", () => {
    it("shows the whole field for an empty page", () => {
        expect(thumbnailBounds(null, FULL)).toEqual(FULL);
    });

    it("wraps a drawing with a margin, at the card's aspect ratio, centred on it", () => {
        const drawing = { x: -200, y: -300, width: 600, height: 200 };
        const b = thumbnailBounds(drawing, FULL);
        expect(contains(b, drawing)).toBe(true);
        expect(b.x).toBeLessThan(drawing.x);
        expect(b.y).toBeLessThan(drawing.y);
        expect(b.width / b.height).toBeCloseTo(THUMBNAIL_ASPECT, 1);
        expect(b.x + b.width / 2).toBeCloseTo(100, 0);
        expect(b.y + b.height / 2).toBeCloseTo(-200, 0);
        expect(b.width).toBeLessThan(FULL.width);
    });

    it("keeps a minimum size, so one tiny stroke isn't blown up", () => {
        const dot = { x: 10, y: -100, width: 4, height: 2 };
        const b = thumbnailBounds(dot, FULL);
        expect(contains(b, dot)).toBe(true);
        expect(b.width).toBeGreaterThanOrEqual(
            FULL.width * THUMBNAIL_MIN_SHARE,
        );
        expect(b.width / b.height).toBeCloseTo(THUMBNAIL_ASPECT, 1);
    });

    it("grows a tall drawing's width to the aspect ratio", () => {
        const tall = { x: 0, y: -500, width: 50, height: 450 };
        const b = thumbnailBounds(tall, FULL);
        expect(contains(b, tall)).toBe(true);
        expect(b.width / b.height).toBeCloseTo(THUMBNAIL_ASPECT, 1);
    });

    it("falls back to the whole field when the crop would be as large", () => {
        const big = { x: -1000, y: -600, width: 2000, height: 640 };
        expect(thumbnailBounds(big, FULL)).toEqual(FULL);
    });

    it("lands on whole units", () => {
        const b = thumbnailBounds(
            { x: 0.3, y: 0.7, width: 101.1, height: 33.3 },
            FULL,
        );
        for (const v of Object.values(b))
            expect(Number.isInteger(v)).toBe(true);
    });
});
