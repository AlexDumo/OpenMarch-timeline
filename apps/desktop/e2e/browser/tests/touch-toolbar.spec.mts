import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    expectCanvasMatchesShow,
    selectedDrillNumbers,
    tap,
    waitForSettledField,
} from "../app.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// The touch toolbar (tablet 2.1, ported from upstream #1060): on a touch
// screen the toolbar's tabs sit in the title bar, and the selected tab's
// controls are a panel over the top of the field. The panel starts closed;
// tapping a tab opens it on that tab, tapping the open tab or the chevron
// closes it, and the tab and whether it's open are remembered on reload. The
// controls in it are the toolbar's own and run the same actions.

// Four trumpets on the home page, all in view.
const PAGE_0: SeedPosition[] = [
    [1, 503, 304],
    [2, 603, 354],
    [3, 703, 284],
    [4, 803, 404],
];

test.use({
    seedSql: seedShowSql({
        beats: 16,
        pageStarts: [],
        measureStarts: [1, 5, 9, 13],
        marchers: PAGE_0.map(([id]) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [PAGE_0],
    }),
    // A touch screen, with the interface on Automatic: it lays out for touch
    touchScreen: true,
});

/** Taps the middle of `locator` with one finger. */
async function tapOn(page: Page, locator: Locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Nothing to tap: it isn't on screen");
    await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

const titleBarTabs = (page: Page) => page.getByTestId("titlebar-toolbar-tabs");
const tab = (page: Page, name: string) =>
    titleBarTabs(page).getByRole("tab", { name });
const panel = (page: Page) => page.getByTestId("toolbar-panel");

const fieldBox = (page: Page) =>
    page.getByTestId("fieldCanvas").boundingBox();

test.beforeEach(async ({ show }) => {
    await expectCanvasMatchesShow(show);
});

test("the tabs sit in the title bar, and the panel starts closed", async ({
    show,
}) => {
    const { page } = show;
    for (const name of ["File", "Alignment", "Shapes", "Select"])
        await expect(tab(page, name)).toBeVisible();
    // The tabs take the middle of the bar, where the show's name was
    await expect(page.getByTestId("titlebar-file-path")).toHaveCount(0);
    await expect(panel(page)).toBeHidden();
    // The 3D View button and the workspace switch stay on screen
    await expect(page.getByTestId("workspace-view-switch")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("closed.png") });
});

test("tapping a tab opens its controls over the field without moving the field", async ({
    show,
}) => {
    const { page } = show;
    await waitForSettledField(page);
    const before = await fieldBox(page);

    await tapOn(page, tab(page, "Select"));
    await expect(panel(page)).toBeVisible();
    await expect(tab(page, "Select")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Select")).toHaveAttribute("aria-expanded", "true");
    const selectAll = panel(page).getByRole("button", { name: "Select all" });
    await expect(selectAll).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("select-open.png") });

    // Over the field, not above it: the field keeps its place and size
    expect(await fieldBox(page)).toEqual(before);
    const panelBox = await panel(page).boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(before!.y - 16);

    // The control runs the toolbar's own action
    await tapOn(page, selectAll);
    await expect
        .poll(() => selectedDrillNumbers(page))
        .toEqual(["T1", "T2", "T3", "T4"]);

    // Another tab switches the panel to it, still open
    await tapOn(page, tab(page, "Alignment"));
    await expect(panel(page)).toBeVisible();
    await expect(tab(page, "Alignment")).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(selectAll).toBeHidden();

    // The open tab again closes it
    await tapOn(page, tab(page, "Alignment"));
    await expect(panel(page)).toBeHidden();
    await expect(tab(page, "Alignment")).toHaveAttribute(
        "aria-expanded",
        "false",
    );
});

test("the chevron opens and closes the panel, and a reload remembers it", async ({
    show,
}) => {
    const { page } = show;
    const toggle = page.getByTestId("toolbar-panel-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await tapOn(page, toggle);
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await tapOn(page, toggle);
    await expect(panel(page)).toBeHidden();

    // Open on Shapes, then reload
    await tapOn(page, tab(page, "Shapes"));
    await expect(panel(page)).toBeVisible();
    await page.reload();
    await expectCanvasMatchesShow(show);
    await expect(panel(page)).toBeVisible();
    await expect(tab(page, "Shapes")).toHaveAttribute("aria-selected", "true");

    // Closed is remembered too
    await tapOn(page, tab(page, "Shapes"));
    await expect(panel(page)).toBeHidden();
    await page.reload();
    await expectCanvasMatchesShow(show);
    await expect(tab(page, "Shapes")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page)).toBeHidden();
});

test("with the interface set to Mouse, the toolbar is the desktop one", async ({
    show,
}) => {
    const { page } = show;
    await page.evaluate(() =>
        localStorage.setItem("openmarch:inputMode", "mouse"),
    );
    await page.reload();
    await expectCanvasMatchesShow(show);
    await expect(page.getByTestId("touch-toolbar")).toHaveCount(0);
    await expect(titleBarTabs(page)).toHaveCount(0);
    // The tabs and their controls are back above the field, Alignment first
    await expect(page.getByRole("tab", { name: "Alignment" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(page.getByTestId("toolbar-panel")).toHaveCount(0);
});
