import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    goTo,
    longPress,
    readField,
    selectedDrillNumbers,
    tap,
    waitForField,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// The field menu's Select submenu (#1359): Select same section from one performer, the Select
// tab's Section, Family and Tag lists (Shift adds), and Holding, which took over from "Select by
// equipment". The selection is read from the field (`window.fieldTest`).
//
// Two trumpets, a flute and two guard. G1 holds a rifle from the first count on; G2 keeps the
// guard's own flag.
test.use({
    seedSql: [
        ...seedShowSql({
            beats: 32,
            measureStarts: [1, 5, 9, 13, 17, 21, 25, 29],
            pageStarts: [1, 9, 17],
            marchers: [
                { id: 1, section: "Trumpet", prefix: "T", order: 1 },
                { id: 2, section: "Trumpet", prefix: "T", order: 2 },
                { id: 3, section: "Flute", prefix: "F", order: 1 },
                { id: 4, section: "Color Guard", prefix: "G", order: 1 },
                { id: 5, section: "Color Guard", prefix: "G", order: 2 },
            ],
            positions: Array.from({ length: 4 }, (): SeedPosition[] => [
                [1, 400, 300],
                [2, 450, 300],
                [3, 500, 300],
                [4, 550, 300],
                [5, 600, 300],
            ]),
        }),
        `INSERT INTO cues (id, type, beat_id, value, length, label)
         VALUES (1, 'equipment', 1, 'builtin:equipment.rifle', NULL, 'G1')`,
        "INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (1, 4)",
    ],
});

const menu = (page: Page) => page.getByTestId("field-menu");

async function rightClickMarcher(page: Page, drillNumber: string) {
    const marcher = (await drawnMarchers(page)).find(
        (m) => m.drillNumber === drillNumber,
    )!;
    await page.mouse.click(marcher.screen.x, marcher.screen.y, {
        button: "right",
    });
    await expect(menu(page)).toBeVisible();
}

/** Right-clicks empty field, well clear of the performers, from where T1 is drawn */
async function rightClickEmptyField(page: Page) {
    const t1 = (await drawnMarchers(page)).find((m) => m.drillNumber === "T1")!;
    const { zoom } = (await readField(page)).viewport;
    await page.mouse.click(t1.screen.x, t1.screen.y - 100 * zoom, {
        button: "right",
    });
    await expect(menu(page)).toBeVisible();
}

/** Opens Select › and then each submenu in `path`, by test id */
async function openSelect(page: Page, ...path: string[]) {
    for (const testId of ["field-menu-select", ...path]) {
        await page.getByTestId(testId).hover();
        await expect(page.getByTestId(`${testId}-content`)).toBeVisible();
    }
}

test("Select › Select same section from one trumpet selects every trumpet; Section and Family pick by the Select tab's lists, Shift adding", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await waitForIdle(page);

    // Right-clicking T1 selects it; Select same section takes in the other trumpet
    await rightClickMarcher(page, "T1");
    await openSelect(page);
    await page.getByTestId("field-menu-selectSameSection").click();
    await expect(menu(page)).toBeHidden();
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["T1", "T2"]);

    // Shift-click a section adds it to the selection, as Shift does in the Select tab
    await rightClickMarcher(page, "T1");
    await openSelect(page, "field-menu-select-section");
    await page
        .getByTestId("field-menu-select-section-Flute")
        .click({ modifiers: ["Shift"] });
    await expect
        .poll(() => selectedDrillNumbers(page))
        .toEqual(["F1", "T1", "T2"]);

    // A plain click replaces it: the guard family
    await rightClickMarcher(page, "T1");
    await openSelect(page, "field-menu-select-family");
    await page.getByTestId("field-menu-select-family-Guard").click();
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["G1", "G2"]);
});

test("Select › Holding selects who holds a rifle at the playhead; Select same section says why it can't run with nobody selected", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await goTo(page, "m2");
    await waitForIdle(page);

    // Nobody selected: Select same section is there, greyed out, saying why
    await rightClickEmptyField(page);
    await openSelect(page);
    const same = page.getByTestId("field-menu-selectSameSection");
    await expect(same).toHaveAttribute("aria-disabled", "true");
    await same.hover();
    await expect(
        page.getByRole("tooltip", { name: "Select a performer first" }),
    ).toBeVisible();

    // Holding › Guard › Select Rifle: only G1 holds one
    await openSelect(
        page,
        "field-menu-select-holding",
        "field-menu-select-holding-guard",
    );
    await page.getByTestId("field-menu-selectHoldingRifle").click();
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["G1"]);

    // The Equipment submenu is still beside Facing, and no longer offers selecting
    await clickMarcher(page, "T1");
    await rightClickMarcher(page, "T1");
    await expect(page.getByTestId("field-menu-equipment")).toBeVisible();
    await expect(page.getByTestId("field-menu-select-holding")).toBeHidden();
});

test("on a tablet, a long press on a trumpet opens the menu, and tapping Select, then Select same section, selects every trumpet", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await waitForIdle(page);
    const t1 = (await drawnMarchers(page)).find((m) => m.drillNumber === "T1")!;
    await longPress(page, t1.screen);
    await expect(menu(page)).toBeVisible();
    /** A finger's tap on the middle of `testId`: no pointer glides there first */
    const tapTestId = async (testId: string) => {
        const box = (await page.getByTestId(testId).boundingBox())!;
        await tap(page, {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        });
    };
    await tapTestId("field-menu-select");
    await expect(page.getByTestId("field-menu-select-content")).toBeVisible();
    await tapTestId("field-menu-selectSameSection");
    await expect(menu(page)).toBeHidden();
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["T1", "T2"]);
});
