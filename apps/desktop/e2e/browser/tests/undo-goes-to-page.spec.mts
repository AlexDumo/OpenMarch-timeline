import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    dragMarcher,
    drawnMarchers,
    waitForField,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql } from "../seed.mjs";
import { goToPage, pageBox } from "../timeline.mjs";

// Undo and redo go to the page they changed, and select it whole, as going
// there with page navigation does. In Expert the start flag stays where it is
// on a seek, so going there by moving only the playhead to the page's flag
// left a one-count window at the start of the page after it (the changed
// page's flag is that page's start flag).
//
// Pages flag at beats 9, 17 and 25. In the timeline's beats (one less than the
// show's), page 2's box is 8–16 and page 3's is 16–24.
const SEED = seedShowSql({
    beats: 32,
    measureStarts: [1, 5, 9, 13, 17, 21, 25, 29],
    pageStarts: [1, 9, 17],
    marchers: [1, 2, 3].map((id) => ({
        id,
        section: "Trumpet",
        prefix: "T",
        order: id,
    })),
    positions: [300, 340, 380, 420].map((y) =>
        [1, 2, 3].map(
            (id) => [id, 300 + id * 100, y] as [number, number, number],
        ),
    ),
});

const playhead = (page: Page) =>
    page.getByTestId("timeline-playhead").getAttribute("aria-label");

/**
 * Page 2 is the window: its box is selected, from its start to its flag. Expert
 * draws the start flag; it's on the box's start.
 */
async function expectPage2Selected(page: Page, mode: "expert" | "basic") {
    await expect.poll(() => playhead(page)).toContain("Page 2, count 8 of 8");
    await expect(pageBox(page, 8)).toHaveAttribute("aria-pressed", "true");
    if (mode === "basic") return;
    const start = (await page
        .getByTestId("timeline-start-pennant")
        .boundingBox())!;
    const box = (await pageBox(page, 8).boundingBox())!;
    expect(Math.abs(start.x - box.x)).toBeLessThan(4);
}

for (const mode of ["expert", "basic"] as const)
    test.describe(`in ${mode === "basic" ? "Basic" : "Expert"} mode`, () => {
        test.use({
            seedSql: SEED,
            appSettings: { optOutAnalytics: true, editorMode: mode },
        });

        test("undo and redo of an edit on another page select that page", async ({
            show,
        }) => {
            const { page } = show;
            await waitForField(page);
            await expect
                .poll(async () => (await drawnMarchers(page)).length)
                .toBe(3);
            await goToPage(page, 8);
            await dragMarcher(page, "T1", { x: 40, y: -30 });
            await waitForIdle(page);

            await goToPage(page, 16);
            await waitForIdle(page);
            await page.keyboard.press("ControlOrMeta+z");
            await expectPage2Selected(page, mode);

            await goToPage(page, 16);
            await waitForIdle(page);
            await page.keyboard.press("ControlOrMeta+Shift+z");
            await expectPage2Selected(page, mode);
        });
    });
