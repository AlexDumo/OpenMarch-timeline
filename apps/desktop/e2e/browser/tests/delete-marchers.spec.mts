import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    expectCanvasMatchesShow,
    marcherRowAction,
} from "../app.mjs";
import { savedPositions } from "../positions.mjs";
import { seedShowSql } from "../seed.mjs";

// Three trumpets on two pages.
test.use({
    seedSql: seedShowSql({
        beats: 16,
        pageStarts: [8],
        marchers: [1, 2, 3].map((id) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [
            [
                [1, 500, 300],
                [2, 600, 300],
                [3, 700, 300],
            ],
            [
                [1, 500, 400],
                [2, 600, 400],
                [3, 700, 400],
            ],
        ],
    }),
    // Pre-existing on fork main ef7b6efe, about 2 runs in 3: the undo can restore T2's
    // selection a moment before the canvas redraws T2, so the selection listener logs this
    // and skips it. The selection and drawing end up right; the field is frozen until the
    // new renderer (#189), which replaces this listener.
    allowedPageErrors: [/SelectedMarcher not found on Canvas/],
});

const marchers = (show: Show) =>
    show.query(
        "SELECT id, drill_prefix || drill_order AS drill FROM marchers ORDER BY id",
    );
const allPositions = async (show: Show) => [
    await savedPositions(show, 0),
    await savedPositions(show, 1),
];

test("deleting a marcher removes it from every page, and undo brings it back", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);
    const marchersBefore = await marchers(show);
    const positionsBefore = await allPositions(show);

    await marcherRowAction(page, "T2", "Delete");
    // The list stages the deletion until it's saved.
    await expect(
        page.locator("#marcherListForm").getByText("T2", { exact: true }),
    ).toBeHidden();
    expect(await marchers(show)).toEqual(marchersBefore);
    await page.getByRole("button", { name: "Save Changes" }).click();
    const warning = page.getByRole("alertdialog", { name: "Warning" });
    await expect(warning).toContainText(
        "You are about to delete these marchers: T2.",
    );
    await warning.getByRole("button", { name: "Delete" }).click();

    await expect
        .poll(() => marchers(show))
        .toEqual(marchersBefore.filter((row) => row.drill !== "T2"));
    expect(
        await show.query(
            "SELECT id FROM timeline_assignments WHERE marcher_id = 2",
        ),
    ).toEqual([]);
    expect(await allPositions(show)).toEqual(
        positionsBefore.map((page) => page.filter(({ id }) => id !== 2)),
    );
    await expect
        .poll(async () => (await drawnMarchers(page)).map((m) => m.drillNumber))
        .toEqual(["T1", "T3"]);
    await expectCanvasMatchesShow(show);

    await page.locator("#sidebar-launcher-marchers").click();
    await page.keyboard.press("Control+z");

    await expect.poll(() => marchers(show)).toEqual(marchersBefore);
    expect(await allPositions(show)).toEqual(positionsBefore);
    await expectCanvasMatchesShow(show);
});
