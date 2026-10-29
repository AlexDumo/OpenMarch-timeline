import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    drawnMarchers,
    readField,
    waitForField,
    waitForIdle,
} from "../app.mjs";
import { isolate } from "../timeline.mjs";

// The timeline's interactions on the field (#202; #189 user stories 18, 20,
// 59): Escape leaving isolation (and when it doesn't), and dimmed marchers
// while the line tool is on. The first press
// after a paused preview (story 60) is `paused-preview.spec.mts`. What #201
// already pinned (a click on a dimmed marcher selects nothing; Escape with
// nobody selected leaves isolation) is in `timeline-visuals.spec.mts`.
//
// Escape during a clip move or resize belongs to the gesture, not to
// isolation. That rule is the timeline's alone, and the demo's moves are page
// moves, which have no clip: it's pinned by `TimelineClipResize.test.tsx`
// ("while a resize or move runs, Esc belongs to it, not to isolation").
//
// The "change:" scenarios are the rules-table changes decided in #189.

const desktop = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

const isolationBar = (page: Page) => page.getByTestId("timeline-isolation-bar");

/** The marchers drawn now, by id. */
const drawnById = async (page: Page) =>
    new Map((await drawnMarchers(page)).map((m) => [m.id, m]));

/**
 * Selects every marcher that can be selected, and waits for `count` of them
 * on the field and in the inspector: keys like L act on the app's
 * selection, which reaches the app's state a render after the field's.
 */
async function selectAll(page: Page, count: number) {
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection.length)
        .toBe(count);
    await expect(
        page.getByText(new RegExp(`^${count} Marchers$`)).first(),
    ).toBeVisible();
}

// A converted demo show: every page is a move. The move over the page box
// that starts at beat 53 has 4 of the 95 marchers; the others follow there.
test.use({
    showFile: path.join(desktop, "view3d-web/public/demos/part1-demo.dots"),
});

/** Isolates the 4-marcher move at beat 53 and selects its marchers. */
async function isolateAndSelect(page: Page) {
    await waitForField(page);
    await isolate(page, 53);
    await expect
        .poll(
            async () =>
                (await drawnMarchers(page)).filter((m) => !m.dimmed).length,
        )
        .toBe(4);
    await selectAll(page, 4);
}

test("Escape leaves isolation with marchers selected, in one press", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("Escape");
    await expect(isolationBar(page)).toBeHidden();
    await expect
        .poll(async () => (await drawnMarchers(page)).some((m) => m.dimmed))
        .toBe(false);
});

test("Escape in isolation with the line tool on only cancels the tool", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("l");
    // The tool holds the marchers it lines up; the selection is empty meanwhile
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(isolationBar(page)).toBeVisible();
    // The tool gave the marchers back; the next Escape leaves
    await expect
        .poll(async () => (await readField(page)).selection.length)
        .toBe(4);
    await page.keyboard.press("Escape");
    await expect(isolationBar(page)).toBeHidden();
});

test("Escape in isolation with a dialog open only closes the dialog", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    await expect(isolationBar(page)).toBeVisible();
});

test("change: a marcher no longer dimmed while the line tool is on can't be selected until the tool ends (user story 20)", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await isolate(page, 53);
    await expect
        .poll(
            async () =>
                (await drawnMarchers(page)).filter((m) => !m.dimmed).length,
        )
        .toBe(4);
    const outside = (await drawnMarchers(page)).find(
        (m) => m.dimmed && m.onScreen,
    )!;
    await selectAll(page, 4);
    await page.keyboard.press("l");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);

    // Leaving isolation (Done) ends the dimming while the tool is still on
    await page.getByRole("button", { name: /^Done/ }).click();
    await expect(isolationBar(page)).toBeHidden();
    await expect
        .poll(async () => (await drawnById(page)).get(outside.id)!.dimmed)
        .toBe(false);
    // Leaving isolation puts the playhead back, so the marcher may stand elsewhere now
    await waitForIdle(page);
    const now = (await drawnById(page)).get(outside.id)!;
    expect(now.onScreen).toBe(true);
    await page.mouse.click(now.screen.x, now.screen.y);
    await page.waitForTimeout(300);
    expect((await readField(page)).selection).not.toContain(outside.id);
});
