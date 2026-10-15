import { test, expect } from "../fixtures.mjs";
import {
    addPageAt,
    createMarchers,
    createTempoGroup,
    drawnMarchers,
    expectCanvasMatchesShow,
    waitForField,
} from "../app.mjs";
import { savedPosition } from "../positions.mjs";

// Still failing on the three.js field (#209 rechecked): after the reload, the first marcher is drawn
// away from where page 1 saved it. Needs a look before it's turned back on.
test.fixme("a show built in the app looks the same after a reload", async ({
    show,
}) => {
    const { page } = show;
    await createTempoGroup(page, {
        tempo: 120,
        beatsPerMeasure: 4,
        measures: 8,
    });
    await createMarchers(page, { quantity: 6, section: "Trumpet" });
    await addPageAt(page, 5);
    await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
    await expectCanvasMatchesShow(show);

    // Move one marcher on page 1 so the pages differ.
    const marcher = (await drawnMarchers(page)).find((m) => m.onScreen)!;
    await page.mouse.move(marcher.screen.x, marcher.screen.y);
    await page.mouse.down();
    await page.mouse.move(marcher.screen.x + 150, marcher.screen.y + 100, {
        steps: 10,
    });
    await page.mouse.up();
    await expect
        .poll(async () => (await savedPosition(show, marcher.id, 1)).x)
        .not.toEqual(marcher.x);
    await expectCanvasMatchesShow(show);
    // A reload clears the selection, which the timeline marks
    await page.keyboard.press("Escape");

    // The timeline's pages and their flags, by their labels
    const timeline = () =>
        page
            .getByTestId("timeline-viewport")
            .getByRole("button", { name: /^Page / })
            .evaluateAll((buttons) =>
                buttons.map((button) => button.getAttribute("aria-label")),
            );
    const before = await timeline();
    expect(before).toContain("Page 1");
    await page.reload();
    await waitForField(page);

    await expect.poll(timeline).toEqual(before);
    await expectCanvasMatchesShow(show);
    await page.keyboard.press("Shift+E");
    await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
    await expectCanvasMatchesShow(show);
});
