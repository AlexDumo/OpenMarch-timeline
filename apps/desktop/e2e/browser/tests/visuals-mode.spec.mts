import { test, expect } from "../fixtures.mjs";
import { clickMarcher, drawnMarchers } from "../app.mjs";
import { seedShowSql } from "../seed.mjs";

/**
 * Visuals mode (performer-behavior.md section 7.1): the workspace switch
 * swaps the toolbar and the inspector, and focusing a who in the Who list
 * dims everyone else on the field. Dimmed marchers stay selectable, since
 * the selection is a who too.
 */

test.use({
    seedSql: [
        ...seedShowSql({
            beats: 16,
            measureStarts: [1, 5, 9, 13],
            pageStarts: [1, 9],
            marchers: [
                { id: 1, section: "Trumpet", prefix: "T", order: 1 },
                { id: 2, section: "Trumpet", prefix: "T", order: 2 },
                { id: 3, section: "Flute", prefix: "F", order: 1 },
                { id: 4, section: "Flute", prefix: "F", order: 2 },
                { id: 5, section: "Color Guard", prefix: "G", order: 1 },
            ],
            positions: [0, 1, 2].map((page) =>
                [1, 2, 3, 4, 5].map(
                    (id) => [id, 300 + id * 60, 300 + page * 40] as const,
                ),
            ),
        }),
        `INSERT INTO tags (id, name) VALUES (1, 'Soloists')`,
        `INSERT INTO marcher_tags (marcher_id, tag_id) VALUES (1, 1), (5, 1)`,
    ],
});

const lit = async (page: Parameters<typeof drawnMarchers>[0]) =>
    (await drawnMarchers(page))
        .filter((m) => !m.dimmed)
        .map((m) => m.drillNumber)
        .sort();

test("focusing a who dims everyone else, and the Editor brings them back", async ({
    show,
}) => {
    const { page } = show;
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();

    await page.getByTestId("workspace-view-visuals").click();
    await expect(page.getByTestId("visuals-tabs")).toBeVisible();
    await expect(page.getByTestId("visuals-inspector")).toBeVisible();

    await page.getByTestId("visuals-who-section-Trumpet").click();
    await expect.poll(() => lit(page)).toEqual(["T1", "T2"]);
    // winds only: the Horn/Equipment tab says Horn
    await expect(page.getByTestId("visuals-tab-horn_equipment")).toHaveText(
        /^Horn\d/,
    );

    await page.getByTestId("visuals-who-tag-1").click();
    await expect.poll(() => lit(page)).toEqual(["G1", "T1"]);
    await expect(page.getByTestId("visuals-tab-horn_equipment")).toHaveText(
        /^Horn \/ Equipment\d/,
    );

    // the selection follows clicks on the field, dimmed marchers included
    await page.getByTestId("visuals-who-selection").click();
    await clickMarcher(page, "F2");
    await expect.poll(() => lit(page)).toEqual(["F2"]);

    await page.getByTestId("visuals-clear-focus").click();
    await expect.poll(() => lit(page)).toHaveLength(5);

    await page.getByTestId("visuals-who-section-Flute").click();
    await expect.poll(() => lit(page)).toEqual(["F1", "F2"]);
    await page.getByTestId("workspace-view-editor").click();
    await expect(page.getByTestId("visuals-inspector")).toBeHidden();
    await expect.poll(() => lit(page)).toHaveLength(5);
});
