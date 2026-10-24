import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import { drawnMarchers, waitForField } from "../app.mjs";
import { goToPage, pageBox } from "../timeline.mjs";

// Splitting a move and merging it back (docs/timeline/ui.md UI-25), end to
// end: split from the page box menu, drag the new move's clip onto the page
// box to merge it, then undo the merge. The drag-out gesture's distances
// (V-330, V-331) are feel defaults still to be tried by hand, so they're not
// pinned here.

const desktop = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

// A converted demo show: every page is a move. The move over the page box
// that starts at beat 53 has 4 of the 95 marchers.
test.use({
    showFile: path.join(desktop, "view3d-web/public/demos/part1-demo.dots"),
    appSettings: { optOutAnalytics: true, editorMode: "expert" },
    // The time-stretch worklet (#216) can't load in the harness (see props.spec.mts)
    allowedPageErrors: [/Audio worklet error/],
});

const PAGE_START = 53;

/** Every stored timeline with the marchers in it, by id. */
const moves = async (query: Show["query"]) => {
    const rows = await query<{ timeline: number; marcher: number | null }>(
        `SELECT l.id AS timeline, a.marcher_id AS marcher
           FROM timelines l
           LEFT JOIN timeline_transitions t ON t.timeline_id = l.id
           LEFT JOIN timeline_assignments a ON a.transition_id = t.id
          ORDER BY l.id, a.marcher_id`,
    );
    const out = new Map<number, number[]>();
    for (const r of rows) {
        const list = out.get(r.timeline) ?? [];
        if (r.marcher !== null) list.push(r.marcher);
        out.set(r.timeline, list);
    }
    return out;
};

/** The center of an element's box on screen. */
const centerOf = async (page: Page, locator: ReturnType<Page["locator"]>) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("split a marcher off a page's move, drag its clip onto the page box to merge it back, and undo the merge", async ({
    show,
}) => {
    const { page, query } = show;
    await waitForField(page);
    await goToPage(page, PAGE_START);

    const before = await moves(query);
    const pageMoveId = (
        await query<{ id: number }>(
            `SELECT id FROM timelines WHERE start_beat = ? ORDER BY id LIMIT 1`,
            // Stored by beat id, one more than the view beat the box starts at
            PAGE_START + 1,
        )
    )[0]!.id;
    const members = before.get(pageMoveId)!;
    expect(members).toHaveLength(4);
    // Select one of the move's marchers on the field
    const drawn = await drawnMarchers(page);
    const marcher = drawn.find((m) => m.id === members[0] && m.onScreen)!;
    expect(marcher, "a member of the move is on screen").toBeTruthy();
    await page.mouse.click(marcher.screen.x, marcher.screen.y);
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.selection()))
        .toEqual([marcher.id]);

    // Split from the page box's menu: a new move with that marcher, isolated
    await expect(async () => {
        await pageBox(page, PAGE_START).click({ button: "right" });
        await page
            .getByRole("menuitem", { name: "Split 1 selected into new move" })
            .click({ timeout: 1000 });
    }).toPass();
    await expect
        .poll(async () => (await moves(query)).size)
        .toBe(before.size + 1);
    const afterSplit = await moves(query);
    const splitId = Math.max(...afterSplit.keys());
    expect(afterSplit.get(splitId)).toEqual([marcher.id]);
    expect(afterSplit.get(pageMoveId)).toEqual(
        members.filter((id) => id !== marcher.id),
    );
    await expect(page.getByTestId("timeline-isolation-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-isolation-bar")).toBeHidden();

    // Drag the split move's clip up onto the page box: it merges back
    const clip = page.locator(
        `[data-testid="timeline-clip"][data-move-id="${splitId}"]`,
    );
    await expect(clip).toBeVisible();
    const from = await centerOf(page, clip);
    const to = await centerOf(page, pageBox(page, PAGE_START));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 14, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(page.getByText(/^Merge into Page /).first()).toBeVisible();
    await page.mouse.up();
    await expect.poll(async () => await moves(query)).toEqual(before);

    // Undo brings the split move back as it was
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => await moves(query)).toEqual(afterSplit);
});
