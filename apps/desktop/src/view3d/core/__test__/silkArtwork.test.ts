// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    isPng,
    silkArtworkImportSchema,
    silkArtworkTrimRect,
} from "../silkArtwork";
import { silkShapeSurface } from "../artworkTemplates/surfaces";
import { silkShape } from "../sizes/silkShapes";
import { toMeters } from "../sizes/units";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("silk Artwork imports", () => {
    it("takes a PNG and refuses anything else", () => {
        expect(isPng(new Uint8Array([...SIG, 1]))).toBe(true);
        expect(isPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
        const ok = {
            name: "a.png",
            data: new Uint8Array([...SIG, 0]),
            width: 10,
            height: 5,
        };
        expect(silkArtworkImportSchema.safeParse(ok).success).toBe(true);
        expect(
            silkArtworkImportSchema.safeParse({
                ...ok,
                data: new Uint8Array([1, 2, 3]),
            }).success,
        ).toBe(false);
        expect(
            silkArtworkImportSchema.safeParse({ ...ok, width: 0 }).success,
        ).toBe(false);
        expect(
            silkArtworkImportSchema.safeParse({ ...ok, data: [1, 2] }).success,
        ).toBe(false);
    });
});

describe("silkArtworkTrimRect", () => {
    // the 36 x 54 in rectangle: a 54.25 x 36.25 in page with its ⅛ in bleed
    const surface = silkShapeSurface(silkShape("rectangle"));
    const bleed = toMeters(0.125, "in");

    it("finds the trim inside a whole template page", () => {
        // the template PNG at 150 DPI
        const r = silkArtworkTrimRect(8138, 5438, surface);
        const pageW = surface.width.m + 2 * bleed;
        const pageH = surface.height.m + 2 * bleed;
        expect(r.x).toBeCloseTo(bleed / pageW, 9);
        expect(r.y).toBeCloseTo(bleed / pageH, 9);
        expect(r.width).toBeCloseTo(surface.width.m / pageW, 9);
        expect(r.height).toBeCloseTo(surface.height.m / pageH, 9);
    });

    it("uses the whole image when it was painted to the trim, or any other size", () => {
        const whole = { x: 0, y: 0, width: 1, height: 1 };
        expect(silkArtworkTrimRect(5400, 3600, surface)).toEqual(whole);
        expect(silkArtworkTrimRect(1000, 1000, surface)).toEqual(whole);
    });
});
