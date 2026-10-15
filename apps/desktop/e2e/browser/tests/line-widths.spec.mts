import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { waitForField } from "../app.mjs";

/**
 * Lines of the same width are drawn the same width at every zoom (#249). The
 * new field first drew its lines without antialiasing, so at a zoom of 1.6
 * some yard lines were 1 px wide and others 2 px, and zooming changed which.
 *
 * Read on screen pixels: with the grid and half lines off, the middle row of
 * the field crosses only yard lines. Each line's width is its ink, the sum of
 * how dark its pixels are, so an antialiased edge counts for the part of the
 * pixel it covers.
 */

test.use({ uiSettings: { gridLines: false, halfLines: false } });

/** The ink of each line across the field's middle row, in device pixels. */
async function lineInks(page: Page) {
    const png = await page.getByTestId("fieldCanvas").first().screenshot();
    return page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
            new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const y = Math.floor(bitmap.height / 2);
        const data = context.getImageData(0, y, bitmap.width, 1).data;
        const light: number[] = [];
        for (let x = 0; x < bitmap.width; x++)
            light.push((data[x * 4]! + data[x * 4 + 1]! + data[x * 4 + 2]!) / 3);
        // The field's background is the row's most common shade
        const counts = new Map<number, number>();
        for (const value of light)
            counts.set(Math.round(value), (counts.get(Math.round(value)) ?? 0) + 1);
        const background = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
        // Yard lines are the theme's primary stroke, black on the light field
        const inks: number[] = [];
        let ink = 0;
        for (const value of [...light, background]) {
            const dark = (background - value) / background;
            if (dark > 0.04) ink += dark;
            else if (ink > 0) {
                inks.push(ink);
                ink = 0;
            }
        }
        // The field's edges and anything outside it aren't yard lines
        return inks.slice(1, -1);
    }, png.toString("base64"));
}

test("yard lines are drawn at one width across a zoom sweep", async ({
    show,
}) => {
    test.setTimeout(90_000);
    const { page } = show;
    await waitForField(page);
    const box = (await page.getByTestId("fieldCanvas").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const dpr = await page.evaluate(() => window.devicePixelRatio);

    const seen: string[] = [];
    let zoom = 0;
    for (let step = 0; zoom < 6 && step < 30; step++) {
        if (step > 0) {
            await page.keyboard.down("Control");
            await page.mouse.wheel(0, -30);
            await page.keyboard.up("Control");
        }
        // Each zoom drawn and settled before it's read
        const before = zoom;
        await expect
            .poll(() => page.evaluate(() => window.fieldTest!.viewport().zoom))
            .not.toBe(before);
        await page.waitForTimeout(300);
        zoom = await page.evaluate(() => window.fieldTest!.viewport().zoom);
        const inks = await lineInks(page);
        if (inks.length < 2) continue;
        const width = Math.max(1, zoom * dpr);
        seen.push(
            `zoom ${zoom.toFixed(2)}: ${inks.map((ink) => ink.toFixed(2)).join(", ")}`,
        );
        // Every yard line is 1 field unit wide: zoom × DPR device pixels, at
        // least one. Antialiasing leaves each a fraction of a pixel off.
        expect(
            Math.max(...inks) - Math.min(...inks),
            `yard line widths at zoom ${zoom.toFixed(2)}: ${inks.join(", ")}`,
        ).toBeLessThanOrEqual(0.5);
        for (const ink of inks)
            expect(
                Math.abs(ink - width),
                `a yard line's width at zoom ${zoom.toFixed(2)}`,
            ).toBeLessThanOrEqual(Math.max(0.5, width * 0.15));
    }
    // The sweep went through the zooms the bug showed at
    expect(seen.length, seen.join("\n")).toBeGreaterThanOrEqual(8);
});
