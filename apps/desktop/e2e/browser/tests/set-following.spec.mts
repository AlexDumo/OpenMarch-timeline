import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    addPageAt,
    clickMarcher,
    dragMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    goTo,
    readField,
    waitForField,
} from "../app.mjs";
import { seedShowSql } from "../seed.mjs";
import { isolate } from "../timeline.mjs";

// Set vs Following (#300, #301): on the playhead's exact count, a marcher with
// a coordinate of its own (a move of its own ends there, with motion) is Set
// and drawn solid; every other marcher is Following and drawn with a dashed edge.
//
// Pages flag at beats 9, 17 and 25, four beats a measure. Over page 1 (1–9)
// everyone moves. Over page 2 (9–17) T1 moves, T2 has a stay move (it ends
// where it began) and T3 has no move: it holds. Over page 3 (17–25) everyone
// moves.
test.use({
    seedSql: [
        ...seedShowSql({
            beats: 32,
            measureStarts: [1, 5, 9, 13, 17, 21, 25, 29],
            pageStarts: [1, 9, 17],
            marchers: [1, 2, 3].map((id) => ({
                id,
                section: "Trumpet",
                prefix: "T",
                order: id,
            })),
            positions: [
                [
                    [1, 400, 300],
                    [2, 500, 300],
                    [3, 600, 300],
                ],
                [
                    [1, 400, 340],
                    [2, 500, 340],
                    [3, 600, 340],
                ],
                [
                    [1, 400, 380],
                    [2, 500, 340],
                    [3, 600, 380],
                ],
                [
                    [1, 400, 420],
                    [2, 500, 420],
                    [3, 600, 420],
                ],
            ],
        }),
        // T3 (slot 2) has no move over page 2: it holds there
        "DELETE FROM timeline_assignments WHERE transition_id = 2 AND marcher_id = 3",
        "DELETE FROM timeline_slot_destinations WHERE transition_id = 2 AND slot_index = 2",
        "UPDATE timeline_transitions SET slot_count = 2 WHERE id = 2",
        "DELETE FROM timeline_change_log",
    ],
});

/** Who's drawn as Following, by drill number. */
const following = async (page: Page) =>
    (await drawnMarchers(page))
        .filter((m) => m.following)
        .map((m) => m.drillNumber)
        .sort();

/** Moves the playhead one beat later (Shift+E) or earlier (Shift+Q). */
const step = (page: Page, key: "Shift+E" | "Shift+Q") =>
    page.keyboard.press(key);

async function open(page: Page) {
    await waitForField(page);
    // The resolver is ready once the field draws the show
    await expect.poll(async () => (await drawnMarchers(page)).length).toBe(3);
}

test("Following marchers are the ones with no coordinate on the count", async ({
    show,
}) => {
    const { page } = show;
    await open(page);

    // The first page is always Set
    await expect.poll(() => following(page)).toEqual([]);

    // Page 1's flag: everyone's move ends here
    await goTo(page, "m3");
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual([]);

    // One beat before, everyone is partway through their move
    await step(page, "Shift+Q");
    await expect.poll(() => following(page)).toEqual(["T1", "T2", "T3"]);
    // And one beat after, everyone holds
    await step(page, "Shift+E");
    await step(page, "Shift+E");
    await expect.poll(() => following(page)).toEqual(["T1", "T2", "T3"]);

    // Page 2's flag: T1 moved here; T2 stayed where it was and T3 holds
    await goTo(page, "m5");
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual(["T2", "T3"]);
});

test("a page added mid-move shows everyone Following", async ({ show }) => {
    const { page } = show;
    await open(page);
    // Halfway through page 3's moves
    await addPageAt(page, 6);
    await expect
        .poll(async () => (await show.query("SELECT id FROM pages")).length)
        .toBe(5);
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual(["T1", "T2", "T3"]);
});

test("a Following marcher can be dragged, and becomes Set on that count", async ({
    show,
}) => {
    const { page } = show;
    await open(page);
    await goTo(page, "m5");
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual(["T2", "T3"]);

    await dragMarcher(page, "T3", { x: 0, y: 40 });
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual(["T2"]);
});

test("selecting a Following marcher keeps its look", async ({ show }) => {
    const { page } = show;
    await open(page);
    await goTo(page, "m5");
    await expectCanvasMatchesShow(show);

    await clickMarcher(page, "T2");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([2]);
    await expect.poll(() => following(page)).toEqual(["T2", "T3"]);
});

test("isolation's dim takes over from the Following look", async ({ show }) => {
    const { page } = show;
    await open(page);
    // Page 2's move (its box starts at beat index 8) has T1 and T2; T3,
    // which holds there, is dimmed
    await isolate(page, 8);
    await expect
        .poll(async () =>
            (await drawnMarchers(page))
                .filter((m) => m.dimmed)
                .map((m) => m.drillNumber),
        )
        .toEqual(["T3"]);
    const t3 = (await drawnMarchers(page)).find((m) => m.drillNumber === "T3")!;
    expect(t3.following).toBe(false);
});

test("everyone is solid while playing, and Following again after Stop", async ({
    show,
}) => {
    const { page } = show;
    await open(page);
    // Partway through page 2: everyone follows
    await goTo(page, "m4");
    await expect.poll(() => following(page)).toEqual(["T1", "T2", "T3"]);
    const paused = (await drawnMarchers(page)).find(
        (m) => m.drillNumber === "T1",
    )!;

    await page.keyboard.press("Space");
    // Read once playback is running: T1 has moved on from where it was paused
    await expect
        .poll(
            async () =>
                (await drawnMarchers(page)).find((m) => m.drillNumber === "T1")!
                    .y,
        )
        .not.toBe(paused.y);
    expect(await following(page)).toEqual([]);

    // Stop goes back to where Play was pressed, where everyone follows
    await page.keyboard.press("Space");
    await expect.poll(() => following(page)).toEqual(["T1", "T2", "T3"]);
});

test("selecting and dragging right after Stop don't wait for the dashed look", async ({
    show,
}) => {
    const { page } = show;
    await open(page);
    // Page 2's flag: T2 and T3 follow
    await goTo(page, "m5");
    await expect.poll(() => following(page)).toEqual(["T2", "T3"]);
    const flag = (await drawnMarchers(page)).find(
        (m) => m.drillNumber === "T1",
    )!;

    await page.keyboard.press("Space");
    await expect
        .poll(
            async () =>
                (await drawnMarchers(page)).find((m) => m.drillNumber === "T1")!
                    .y,
        )
        .not.toBe(flag.y);
    // Stop goes back to page 2's flag; the dashes ease in (#302) while the
    // designer is already dragging T3 there
    await page.keyboard.press("Space");
    await dragMarcher(page, "T3", { x: 0, y: 40 });
    await expectCanvasMatchesShow(show);
    await expect.poll(() => following(page)).toEqual(["T2"]);
    await clickMarcher(page, "T2");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([2]);
});
