// cspell:ignore keyshortcuts
import { expect, type Locator, type Page } from "@playwright/test";
import { drawnMarchers } from "./app.mjs";
import type { Show } from "./fixtures.mjs";

/** Timeline steps on a show whose pages are moves, shared between specs. */

/** The timeline's page box that starts at `startBeat`. */
export const pageBox = (page: Page, startBeat: number) =>
    page
        .locator(
            `[data-timeline-range-page][data-timeline-range-start="${startBeat}"]`,
        )
        .first();

/** Selects the page whose box starts at `startBeat`, and waits for the field to show it. */
export async function goToPage(page: Page, startBeat: number) {
    const box = pageBox(page, startBeat);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await settled(page);
}

/** Waits until the field shows the same page and positions twice in a row. */
export async function settled(page: Page) {
    let last = "";
    await expect
        .poll(async () => {
            const now = await page.evaluate(() =>
                JSON.stringify([
                    window.fieldTest!.pageId(),
                    window.fieldTest!.marchers().map((m) => [m.x, m.y]),
                ]),
            );
            const same = now === last && now.length > 20;
            last = now;
            return same;
        })
        .toBe(true);
}

/** Isolates the move over the page box at `startBeat`, as double-clicking it does. */
export async function isolate(page: Page, startBeat: number) {
    const box = pageBox(page, startBeat);
    // The stored moves load after the field: until then a double-click finds none
    await expect(async () => {
        await box.scrollIntoViewIfNeeded();
        await box.dblclick();
        await expect(page.getByTestId("timeline-isolation-bar")).toBeVisible({
            timeout: 1000,
        });
    }).toPass();
}

/** The field's top-left corner area, where no marcher stands in the converted demo shows. */
export async function emptyField(page: Page) {
    const box = (await page.getByTestId("fieldCanvas").first().boundingBox())!;
    return { x: box.x + 12, y: box.y + 12 };
}

/** Every stored move's start beat, by id */
export const storedMoveStarts = async (query: Show["query"]) =>
    Object.fromEntries(
        (
            await query<{ id: number; start: number }>(
                "SELECT id, start_beat AS start FROM timelines ORDER BY id",
            )
        ).map((r) => [r.id, r.start]),
    );

/**
 * Clicks one marcher of the move at `startBeat` on the field (a mouse, as the field is not under
 * test); returns its id.
 */
export async function selectMoveMember(
    show: Show,
    startBeat: number,
): Promise<number> {
    const { page, query } = show;
    // Stored by beat id, one more than the view beat
    const members = (
        await query<{ marcher: number }>(
            `SELECT a.marcher_id AS marcher
               FROM timelines l
               JOIN timeline_transitions t ON t.timeline_id = l.id
               JOIN timeline_assignments a ON a.transition_id = t.id
              WHERE l.id = (SELECT id FROM timelines WHERE start_beat = ? ORDER BY id LIMIT 1)`,
            startBeat + 1,
        )
    ).map((r) => r.marcher);
    const marcher = (await drawnMarchers(page)).find(
        (m) => members.includes(m.id) && m.onScreen,
    );
    expect(marcher, "a member of the move is on screen").toBeTruthy();
    await page.mouse.click(marcher!.screen.x, marcher!.screen.y);
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.selection()))
        .toEqual([marcher!.id]);
    return marcher!.id;
}

/**
 * Splits one marcher of the move at `startBeat` into a new move, which has a clip, and leaves the
 * isolation the split enters; returns the clip, settled where it dropped.
 */
export async function splitMoveIntoClip(
    show: Show,
    startBeat: number,
): Promise<Locator> {
    const { page, query } = show;
    const before = await storedMoveStarts(query);
    await selectMoveMember(show, startBeat);
    await expect(async () => {
        await pageBox(page, startBeat).click({ button: "right" });
        await page
            .getByRole("menuitem", { name: "Split 1 selected into new move" })
            .click({ timeout: 1000 });
    }).toPass();
    await expect
        .poll(async () => Object.keys(await storedMoveStarts(query)).length)
        .toBe(Object.keys(before).length + 1);
    const splitId = Math.max(
        ...Object.keys(await storedMoveStarts(query)).map(Number),
    );
    await expect(page.getByTestId("timeline-isolation-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-isolation-bar")).toBeHidden();
    const clip = page.locator(
        `[data-testid="timeline-clip"][data-move-id="${splitId}"]`,
    );
    await expect(clip).toBeVisible();
    // Settled where it drops
    let last = Number.NaN;
    await expect
        .poll(async () => {
            const y = (await clip.boundingBox())!.y;
            const still = Math.abs(y - last) < 0.5;
            last = y;
            return still;
        })
        .toBe(true);
    return clip;
}
