import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    goTo,
    setUiSettings,
    waitForField,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql } from "../seed.mjs";

// A placed shape whose member never arrives (ADR 0006 revision of 2026-11-22, §9.1). Four
// marchers walk into a 2 × 2 group over page 2 ([9, 17)), and a group recipe stands at page 2's
// flag (beat 17). A move on a higher layer takes T4 over at beat 11, partway through its walk,
// and holds it elsewhere until beat 21. At the flag the shape is still drawn, with T4's spot an
// open ring labelled "taken over"; Remove from shape on that ring takes T4 and its spot out in
// one undo step.
//
// Pages flag at beats 9, 17 and 25 (measures 3, 5 and 7), four beats a measure.
const SPOTS: [number, number, number][] = [
    [1, 600, 300],
    [2, 640, 300],
    [3, 600, 340],
    [4, 640, 340],
];
const GROUP = {
    center: { x: 620, y: 320 },
    rotation: 0,
    points: [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: -20, y: 20 },
        { x: 20, y: 20 },
    ],
    spots: 4,
};
const START: [number, number, number][] = SPOTS.map(([id], i) => [
    id,
    400 + 40 * i,
    200,
]);

test.use({
    seedSql: [
        ...seedShowSql({
            beats: 32,
            measureStarts: [1, 5, 9, 13, 17, 21, 25, 29],
            pageStarts: [1, 9, 17],
            marchers: SPOTS.map(([id]) => ({
                id,
                section: "Trumpet",
                prefix: "T",
                order: id,
            })),
            positions: [START, START, SPOTS, SPOTS],
        }),
        // T4 taken over by a higher layer from beat 11 to 21, held elsewhere
        "INSERT INTO timelines (id, start_beat, end_beat) VALUES (10, 11, 21)",
        `INSERT INTO timeline_transitions (id, timeline_id, slot_count, start_beat, end_beat)
         VALUES (10, 10, 1, 11, 21)`,
        "INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES (10, 0, 460, 420)",
        `INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat, layer)
         VALUES (4, 10, 0, 11, 21, 1)`,
        // The group placed at page 2's flag
        `INSERT INTO timeline_shape_recipes (id, beat, shape_key, kind, kind_version, params, order_mode, reverse)
         VALUES (1, 17, 1, 'group', 1, '${JSON.stringify(GROUP)}', 'nearest', 0)`,
        `INSERT INTO timeline_shape_recipe_marchers (recipe_id, marcher_id, slot, x, y)
         VALUES ${SPOTS.map(([id, x, y], i) => `(1, ${id}, ${i}, ${x}, ${y})`).join(", ")}`,
        "DELETE FROM timeline_change_log",
    ],
});

/** Where screenshots for review go, when set (`OPEN_SPOT_SHOTS=/mnt/ssd/...`) */
const SHOTS = process.env.OPEN_SPOT_SHOTS;

const members = async (show: Show) =>
    (
        await show.query<{ marcher_id: number }>(
            "SELECT marcher_id FROM timeline_shape_recipe_marchers ORDER BY marcher_id",
        )
    ).map((r) => r.marcher_id);

/** Opens the show at page 2's flag with every placed shape drawn */
async function atFlag(show: Show) {
    const { page } = show;
    await setUiSettings(page, { shapes: "always" });
    await waitForField(page);
    await expect.poll(async () => (await drawnMarchers(page)).length).toBe(4);
    await goTo(page, "m5");
    await waitForIdle(page);
    if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/open-spot-at-flag.png` });
}

const openRing = (page: Page, marcherId: number) =>
    page.locator(
        `[data-testid="placedOpenSpot"][data-marcher-id="${marcherId}"]`,
    );

test("a member taken over before the shape's count is an open ring with its label, and the shape stays drawn", async ({
    show,
}) => {
    const { page } = show;
    await atFlag(show);

    // The shape is still drawn, outline and all
    await expect(
        page.locator('[data-testid="placedBox"][data-outlined="true"]'),
    ).toHaveCount(1);
    // Its other members stand on their spots; T4's is open, and says why
    await expect(page.getByTestId("placedOpenSpot")).toHaveCount(1);
    const ring = openRing(page, 4);
    await expect(ring).toHaveAttribute("data-status", "takenOver");
    await expect(ring).toContainText("T4 · taken over at Page 2 count 2");
    expect(await members(show)).toEqual([1, 2, 3, 4]);
});

test("Remove from shape on the open ring takes the member and its spot out, in one undo step", async ({
    show,
}) => {
    const { page } = show;
    await atFlag(show);
    const ring = openRing(page, 4).locator("circle");
    await expect(ring).toBeVisible();

    await expect(async () => {
        const box = (await ring.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
            button: "right",
        });
        await expect(
            page.getByTestId("field-menu-shapeRemoveFromShape"),
        ).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(
        page.getByTestId("field-menu-shapeRemoveFromShape"),
    ).toHaveText("Remove from shape");
    await page.getByTestId("field-menu-shapeRemoveFromShape").click();

    await expect.poll(() => members(show)).toEqual([1, 2, 3]);
    await expect(page.getByTestId("placedOpenSpot")).toHaveCount(0);
    await expect(
        page.locator('[data-testid="placedBox"][data-outlined="true"]'),
    ).toHaveCount(1);
    if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/open-spot-removed.png` });

    await waitForIdle(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => members(show)).toEqual([1, 2, 3, 4]);
    await expect(openRing(page, 4)).toHaveAttribute("data-status", "takenOver");
});
