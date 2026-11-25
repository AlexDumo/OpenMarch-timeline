import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { drawnMarchers, expectCanvasMatchesShow, readField } from "../app.mjs";
import { fieldGrid } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Rows too long for full-size dots (#1190 follow-up): both ends of every row stay in the
// menu, pointing along a row magnifies the same stretch in every row, the readout says which
// spot and how many are each side, a click there leaves it empty, and the keyboard reaches
// the end spots too.

// A hundred trumpets in a 10 × 10 block, all in view
const HOME: SeedPosition[] = Array.from({ length: 100 }, (_, i) => [
    i + 1,
    450 + (i % 10) * 45,
    260 + Math.floor(i / 10) * 25,
]);

test.use({
    seedSql: seedShowSql({
        beats: 32,
        pageStarts: [16],
        measureStarts: Array.from({ length: 8 }, (_, i) => 1 + i * 4),
        marchers: HOME.map(([id]) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [HOME, HOME],
    }),
    allowedPageErrors: [/Audio worklet error/],
});

const SHOTS = process.env.ROWS_LENS_SHOTS;

async function shot(page: Page, name: string) {
    if (!SHOTS) return;
    await page
        .getByTestId("shape-rows-content")
        .screenshot({ path: `${SHOTS}/${name}.png` });
}

async function toScreen(page: Page, p: { x: number; y: number }) {
    const [marcher] = await drawnMarchers(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: marcher.screen.x + (p.x - marcher.x) * zoom,
        y: marcher.screen.y + (p.y - marcher.y) * zoom,
    };
}

/** Points at `px` across `strip` (from its left edge) and leaves the pointer there */
async function pointAt(page: Page, strip: Locator, px: number) {
    const box = (await strip.boundingBox())!;
    await page.mouse.move(box.x + px, box.y + box.height / 2, { steps: 4 });
    return box;
}

test("change: 50 × 2 rows keep both ends in the menu, magnify where pointed, and press any spot by mouse or key", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;

    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection.length)
        .toBe(100);
    await page.keyboard.press("l");
    const from = await toScreen(page, { x: cf.x - 40 * S, y: cf.y - 20 * S });
    const to = await toScreen(page, { x: cf.x + 40 * S, y: cf.y - 20 * S });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();

    await page.getByTestId("shape-rows").click();
    await page.getByTestId("shape-rows-pick-50").click();
    await expect(page.getByTestId("shape-rows-heading")).toHaveText(
        "100 marchers in 2 rows",
    );
    const back = page.getByTestId("shape-rows-spots-0");
    const front = page.getByTestId("shape-rows-spots-1");
    const readout = page.getByTestId("shape-rows-readout");
    await expect(readout).toContainText("Point along a row");
    await page.mouse.move(5, 5);
    await shot(page, "1-rest");

    // The right end is under the pointer at the strip's right edge
    const box = await pointAt(page, back, 0);
    await pointAt(page, back, box.width - 8);
    await expect(readout).toContainText("Behind 1, spot 50 of 50");
    await expect(readout).toContainText("49 to the left, 0 to the right");
    await expect(page.getByTestId("shape-rows-spot-count")).toHaveText(
        "49 left · 0 right",
    );
    await shot(page, "2-right-end");
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId("shape-rows-heading")).toContainText(
        "1 empty spot",
    );

    // In the middle, once the lens is open, each step of 8 px is the next spot
    await page.mouse.move(5, 5);
    await pointAt(page, back, box.width / 2);
    await expect(back).toHaveAttribute("data-row-lens", "open");
    const spotAt = async () =>
        Number(/spot (\d+) of/.exec(await readout.innerText())![1]);
    const middle = await spotAt();
    await pointAt(page, back, box.width / 2 + 8);
    await expect.poll(spotAt).toBe(middle + 1);
    await pointAt(page, back, box.width / 2 + 16);
    await expect.poll(spotAt).toBe(middle + 2);
    await shot(page, "3-middle");
    // The wheel moves the row a spot under the still pointer
    await page.mouse.wheel(0, 100);
    await expect.poll(spotAt).toBe(middle + 3);
    await page.mouse.wheel(0, -100);
    await expect.poll(spotAt).toBe(middle + 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId("shape-rows-heading")).toContainText(
        "2 empty spots",
    );

    // The keyboard: Home on the front row, Space leaves its first spot empty
    await page.mouse.move(5, 5);
    await front.focus();
    await page.keyboard.press("Home");
    await expect(readout).toContainText("Drawn, spot 1 of");
    await shot(page, "4-keyboard-home");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("shape-rows-heading")).toContainText(
        "3 empty spots",
    );
    // Other keys pass by the strip and leave its spot alone
    await page.keyboard.press("Shift");
    await expect(readout).toContainText("Drawn, spot 1 of");
    // Up keeps the column
    await page.keyboard.press("ArrowUp");
    await expect(readout).toContainText("Behind 1, spot 1 of");
});
