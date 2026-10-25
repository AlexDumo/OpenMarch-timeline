import { describe, expect, it } from "vitest";
import { FieldProperties } from "../FieldProperties";
import { FieldPropertiesTemplates } from "../templates";
import { fieldSvg, svgPaint, svgText } from "../fieldSvg";
import type { RgbaColor } from "../FieldTheme";

const base: FieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;

// Show and sketch files are untrusted: a color read from one may not be numbers
const hostile = {
    r: '0)" onload="alert(1)',
    g: 0,
    b: 0,
    a: '1" onclick="x',
} as unknown as RgbaColor;

describe("svgPaint", () => {
    it("writes rgb() and an opacity under 1", () => {
        expect(svgPaint("fill", { r: 10, g: 20.4, b: 300, a: 0.5 })).toBe(
            'fill="rgb(10,20,255)" fill-opacity="0.5"',
        );
        expect(svgPaint("stroke", { r: 1, g: 2, b: 3, a: 1 })).toBe(
            'stroke="rgb(1,2,3)"',
        );
    });

    it("never copies a non-number channel into the markup", () => {
        const out = svgPaint("fill", hostile);
        expect(out).not.toContain("onload");
        expect(out).not.toContain("onclick");
        expect(out).toBe('fill="rgb(0,0,0)" fill-opacity="0"');
    });
});

describe("svgText", () => {
    it("escapes the content and the font family", () => {
        const out = svgText({
            content: "<script>",
            x: 0,
            y: 0,
            fontSize: 10,
            fontFamily: 'a" onload="x',
            color: { r: 0, g: 0, b: 0, a: 1 },
            anchor: "middle",
        });
        expect(out).not.toContain("<script>");
        expect(out).toContain('font-family="a&quot; onload=&quot;x"');
    });
});

describe("fieldSvg", () => {
    it("keeps hostile theme colors and checkpoint names out of the markup", () => {
        const fp = new FieldProperties({
            ...base,
            xCheckpoints: base.xCheckpoints.map((c, i) =>
                i === 0 ? { ...c, name: '<img src=x onerror="alert(1)">' } : c,
            ),
            theme: {
                ...base.theme,
                background: hostile,
                primaryStroke: hostile,
            },
        });
        const out = fieldSvg(fp, { gridLines: true, halfLines: true });
        expect(out).not.toMatch(/onload|onclick|<img/);
    });
});
