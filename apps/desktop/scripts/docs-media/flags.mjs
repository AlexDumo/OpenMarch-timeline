// Shared by the shot files: the show's own flags (Props › Flags), added and handed out the way a
// user does it, for the pictures in the Props, Equipment and 3D View pages.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSelected } from "./select.mjs";

/** The demo flag design: purple with a white star and a gold band (fork #973). */
export const OPENER_FLAG = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "assets",
    "silk-artwork.png",
);

/** A second design, painted in the page: teal and white halves with a coral sun. */
async function paintCloser(page) {
    const base64 = await page.evaluate(async () => {
        const W = 900;
        const H = 600;
        const c = new OffscreenCanvas(W, H);
        const g = c.getContext("2d");
        g.fillStyle = "#0f8b8d";
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#f4f1de";
        g.beginPath();
        g.moveTo(W * 0.55, 0);
        g.lineTo(W, 0);
        g.lineTo(W, H);
        g.lineTo(W * 0.3, H);
        g.closePath();
        g.fill();
        g.fillStyle = "#e07a5f";
        g.beginPath();
        g.arc(W * 0.42, H * 0.5, H * 0.24, 0, Math.PI * 2);
        g.fill();
        const blob = await c.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
    });
    return {
        name: "closer.png",
        mimeType: "image/png",
        buffer: Buffer.from(base64, "base64"),
    };
}

/** Opens the Props panel if it isn't open. */
export async function openPropsPanel(page) {
    if (
        !(await page
            .getByTestId("show-flags")
            .isVisible()
            .catch(() => false))
    ) {
        await page.locator("#sidebar-launcher-props").click();
        await page.getByTestId("show-flags").waitFor();
        await page.waitForTimeout(400);
    }
}

/** Adds a flag through Props › Flags › Add flag…, from a PNG path or a painted file. */
async function addFlag(page, file, name) {
    await openPropsPanel(page);
    await page.getByTestId("show-flags-add").click();
    await page.getByTestId("assets-add-flag").waitFor();
    await page.getByTestId("assets-add-flag-file").setInputFiles(file);
    await page
        .getByTestId("assets-add-flag-picture")
        .waitFor({ timeout: 15_000 });
    await page.getByTestId("assets-add-flag-name").fill(name);
    await page.getByTestId("assets-add-flag-confirm").click();
    await page
        .getByTestId("assets-add-flag")
        .waitFor({ state: "detached", timeout: 15_000 });
    await page
        .getByTestId("show-flag")
        .filter({ hasText: name })
        .waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
}

/** Adds the two demo flags, "Opener silk" and "Closer silk", to the show. */
export async function addDemoFlags(page) {
    await addFlag(page, OPENER_FLAG, "Opener silk");
    await addFlag(page, await paintCloser(page), "Closer silk");
}

/**
 * Selects the named performers and hands them the flag `name` from its tile in Props › Flags,
 * at the playhead. Leaves them selected and the Props panel open.
 */
export async function giveFlag(page, labels, name) {
    // The panel closed first, so it doesn't cover anyone on the field
    if (
        await page
            .getByTestId("show-flags")
            .isVisible()
            .catch(() => false)
    ) {
        await page.locator("#sidebar-launcher-props").click();
        await page.waitForTimeout(400);
    }
    const points = await page.evaluate(
        (want) =>
            window.fieldTest
                .marchers()
                .filter((m) => want.includes(m.label))
                .map((m) => ({ label: m.label, x: m.screen.x, y: m.screen.y })),
        labels,
    );
    if (points.length !== labels.length)
        throw new Error(`not every performer is on the field: ${labels}`);
    await page.mouse.click(points[0].x, points[0].y);
    await page.keyboard.down("Shift");
    for (const p of points.slice(1)) await page.mouse.click(p.x, p.y);
    await page.keyboard.up("Shift");
    await ensureSelected(page, labels);
    await openPropsPanel(page);
    const tile = page.getByTestId("show-flag").filter({ hasText: name });
    if (await tile.isDisabled())
        throw new Error(`the ${name} tile is disabled`);
    await tile.click();
    await page.waitForTimeout(1200);
}
