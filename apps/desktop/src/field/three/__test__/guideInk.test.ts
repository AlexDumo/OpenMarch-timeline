import { describe, expect, it } from "vitest";
import { GUIDE_INKS, guideInkFor, inkProps } from "../guideInk";
import { START_INK } from "@/components/timeline/startFlagInk";

/** The snap guide's colors (#427): each reads on the common field themes */
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const DARK = { r: 30, g: 30, b: 35, a: 1 };
const TURF = { r: 72, g: 112, b: 52, a: 1 };

const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};
const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
};

describe("guide inks", () => {
    it("pink, teal and orange are at least 3:1 on a white field and a dark one", () => {
        for (const id of ["pink", "teal", "orange"] as const) {
            const color = GUIDE_INKS[id].color(WHITE);
            expect(contrast(color, "#ffffff"), id).toBeGreaterThanOrEqual(3);
            expect(contrast(color, "#1e1e23"), id).toBeGreaterThanOrEqual(3);
        }
    });

    it("contrast is black on a light field and white on a dark one or turf", () => {
        const ink = GUIDE_INKS.contrast;
        expect(ink.color(WHITE)).toBe("#111827");
        expect(ink.color(DARK)).toBe("#ffffff");
        expect(ink.color(TURF)).toBe("#ffffff");
    });

    it("yellow is the timeline's start flag token, as classes", () => {
        expect(inkProps(GUIDE_INKS.yellow, WHITE, "stroke")).toEqual({
            className: START_INK.stroke,
        });
        expect(inkProps(GUIDE_INKS.yellow, WHITE, "fill")).toEqual({
            className: START_INK.fill,
        });
    });

    it("is pink without a lab version, or with one this build doesn't know", () => {
        expect(guideInkFor(null)).toBe(GUIDE_INKS.pink);
        expect(guideInkFor("canvas-labels")).toBe(GUIDE_INKS.pink);
        expect(guideInkFor("teal")).toBe(GUIDE_INKS.teal);
    });
});
