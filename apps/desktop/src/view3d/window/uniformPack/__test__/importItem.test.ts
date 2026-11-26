// cspell:words artboard
/**
 * SVG items drawn sharp (fork #1258): a logo on a big artboard is drawn a second time with only
 * the art at the stored size, not left at the size it had on the whole artboard.
 */
import { describe, expect, it } from "vitest";
import {
    drawSvgItemSharp,
    paintedBox,
    svgAspect,
    withViewBox,
} from "../importItem";
import { svgViewBox } from "../importUniform";

/**
 * Stands in for the browser: "draws" the SVG by painting the part of `art` (a box in viewBox
 * units) that falls inside the SVG's viewBox, and records each call
 */
function fakeDraw(
    art: { x: number; y: number; w: number; h: number },
    /** The SVG's own units when it has no viewBox */
    page: number[] = [0, 0, 612, 792],
) {
    const calls: { width: number; height: number; viewBox: number[] | null }[] =
        [];
    const draw = (
        text: string,
        width: number,
        height: number,
        crop = { x: 0, y: 0, w: width, h: height },
    ) => {
        const vb = svgViewBox(text) ?? page;
        calls.push({ width, height, viewBox: svgViewBox(text) });
        const px = new Uint8ClampedArray(crop.w * crop.h * 4);
        for (let y = 0; y < crop.h; y++)
            for (let x = 0; x < crop.w; x++) {
                const ux = vb[0] + ((x + crop.x + 0.5) / width) * vb[2];
                const uy = vb[1] + ((y + crop.y + 0.5) / height) * vb[3];
                if (
                    ux >= art.x &&
                    ux < art.x + art.w &&
                    uy >= art.y &&
                    uy < art.y + art.h
                )
                    px[(y * crop.w + x) * 4 + 3] = 255;
            }
        return Promise.resolve(px);
    };
    return { draw, calls };
}

describe("SVG items", () => {
    it("draws a logo on a letter-size artboard again with just the logo at 1024 px", async () => {
        // a 2 × 1 in logo (144 × 72 pt) on an 8.5 × 11 in page
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792"><rect/></svg>`;
        const { draw, calls } = fakeDraw({ x: 234, y: 360, w: 144, h: 72 });
        const out = await drawSvgItemSharp(svg, draw);
        // the first, whole pass would have left the logo about 186 px wide
        expect(calls[0]).toMatchObject({ width: 791, height: 1024 });
        const first = paintedBox(
            (await draw(svg, 791, 1024)).slice(),
            791,
            1024,
        )!;
        expect(first.w).toBeLessThan(200);
        // the second pass: a viewBox cut to the logo, drawn 1024 px across
        expect(calls[1].viewBox![2]).toBeLessThan(160);
        expect(out.width).toBe(1024);
        const box = paintedBox(out.pixels, out.width, out.height)!;
        expect(box.w).toBeGreaterThan(1000);
    });

    it("keeps one pass when the art fills the artboard", async () => {
        const svg = `<svg viewBox="0 0 100 50"></svg>`;
        const { draw, calls } = fakeDraw({ x: 0, y: 0, w: 100, h: 50 });
        const out = await drawSvgItemSharp(svg, draw);
        expect(calls).toHaveLength(1);
        expect(out).toMatchObject({ width: 1024, height: 512 });
    });

    it("crops a bigger whole drawing when the SVG has no viewBox", async () => {
        const svg = `<svg width="1000" height="1000"></svg>`;
        expect(svgAspect(svg)).toBe(1);
        const { draw, calls } = fakeDraw(
            { x: 400, y: 400, w: 100, h: 100 },
            [0, 0, 1000, 1000],
        );
        const out = await drawSvgItemSharp(svg, draw);
        // drawn whole at up to 4096 px, then cropped to the art
        expect(calls[1]).toMatchObject({ width: 4096, height: 4096 });
        expect(out.width).toBeGreaterThan(400);
        expect(out.width).toBeLessThan(420);
    });

    it("rewrites only the root viewBox", () => {
        const svg = `<svg viewBox="0 0 10 10"><svg viewBox="1 1 2 2"/></svg>`;
        expect(withViewBox(svg, [2, 3, 4, 5])).toBe(
            `<svg viewBox="2 3 4 5"><svg viewBox="1 1 2 2"/></svg>`,
        );
    });
});
