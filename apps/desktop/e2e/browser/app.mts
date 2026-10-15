import { expect, type Page } from "@playwright/test";
import type { Show } from "./fixtures.mjs";
import { savedPositions } from "./positions.mjs";
import type { FieldTestLook } from "../../src/field/fieldTestApi";

/** Steps a user takes in the app, shared between specs. */

export type DrawnMarcher = {
    id: number;
    drillNumber: string;
    /** Where the dot is drawn, in field units (as the timeline stores them). */
    x: number;
    y: number;
    /** The dot's position in the viewport, for mouse actions. */
    screen: { x: number; y: number };
    /** False when the dot is scrolled out of the visible field. */
    onScreen: boolean;
    /** How it's drawn: shape, colors, and whether it and its label show. */
    look: FieldTestLook;
    /** Drawn dimmed, outside the isolated move; it can't be selected. */
    dimmed: boolean;
};

// Helpers read the field only through the field test API
// (`window.fieldTest`, `src/field/fieldTestApi.ts`), so the scenarios run
// against any field renderer.

/** Waits until the field shows a page and its test API is installed. */
export const waitForField = (page: Page) =>
    page.waitForFunction(() => window.fieldTest?.pageId() != null);

/** Reads the marchers drawn on the field. */
export const drawnMarchers = (page: Page): Promise<DrawnMarcher[]> =>
    page.evaluate(() =>
        window.fieldTest!.marchers().map(({ label, ...marcher }) => ({
            ...marcher,
            drillNumber: label,
        })),
    );

/** Screen pixels per field unit at the field's current zoom. */
export const canvasScale = (page: Page): Promise<number> =>
    page.evaluate(() => window.fieldTest!.viewport().zoom);

/** The field's selection, view, handles and gesture in progress, as the field test API reads them. */
export const readField = (page: Page) =>
    page.evaluate(() => {
        const field = window.fieldTest!;
        return {
            selection: field.selection(),
            viewport: field.viewport(),
            handles: field.handles(),
            activeGesture: field.activeGesture(),
        };
    });

/** Adds marchers through the sidebar form, then closes the sidebar. */
export async function createMarchers(
    page: Page,
    { quantity, section }: { quantity: number; section: string },
) {
    const before = (await drawnMarchers(page)).length;

    await page.locator("#sidebar-launcher-marchers").click();
    await page.getByRole("button", { name: "Add" }).click();
    const form = page.locator("#marcherForm");
    await form.getByRole("combobox").click();
    await page.getByRole("option", { name: section, exact: true }).click();
    await form
        .getByRole("spinbutton", { name: "Quantity" })
        .fill(`${quantity}`);
    await page.getByRole("button", { name: "Create Marcher Button" }).click();
    await page.locator("#sidebar-launcher-marchers").click();

    await expect
        .poll(async () => (await drawnMarchers(page)).length)
        .toBe(before + quantity);
}

/** Adds a tempo group through the Music sidebar, then closes the sidebar. */
export async function createTempoGroup(
    page: Page,
    {
        name,
        tempo,
        beatsPerMeasure,
        measures,
    }: {
        name?: string;
        tempo: number;
        beatsPerMeasure: number;
        measures: number;
    },
) {
    await page.locator("#sidebar-launcher-music").click();
    const form = page.locator("form").filter({ hasText: "Start Tempo" });
    // The form is already open in a show with no music; otherwise it's behind a button.
    const addGroup = page.getByRole("button", { name: "Add New Group" });
    await expect(form.or(addGroup)).toBeVisible();
    if (await addGroup.isVisible()) await addGroup.click();
    if (name) await form.locator("#name-input").fill(name);
    await form.locator("#start-tempo-input").fill(`${tempo}`);
    await form.locator("#bpm-input").fill(`${beatsPerMeasure}`);
    await form.locator("#repeats-input").fill(`${measures}`);
    await form.getByRole("button", { name: "Create" }).click();
    await page.locator("#sidebar-launcher-music").click();
}

/**
 * Waits until every marcher is drawn where the show file says it is at the
 * end of the selected page (`savedPositions`). Call it after any step that
 * changes positions or the page.
 */
export async function expectCanvasMatchesShow(show: Show) {
    const round = (value: number) => Math.round(value * 100) / 100;
    await expect
        .poll(async () => {
            const pageId = await show.page.evaluate(() =>
                window.fieldTest!.pageId(),
            );
            const saved = (await savedPositions(show, pageId)).map(
                ({ id, x, y }) => ({ id, x: round(x), y: round(y) }),
            );
            const drawn = (await drawnMarchers(show.page))
                .map(({ id, x, y }) => ({ id, x: round(x), y: round(y) }))
                .sort((a, b) => a.id - b.id);
            // On a mismatch the failure shows both sides.
            return JSON.stringify(drawn) === JSON.stringify(saved)
                ? "canvas matches the show file"
                : { pageId, drawn, saved };
        })
        .toBe("canvas matches the show file");
}

/** Clicks a marcher's dot; with `add`, adds it to the selection (Shift+click). */
export async function clickMarcher(
    page: Page,
    drillNumber: string,
    { add = false }: { add?: boolean } = {},
) {
    const marcher = (await drawnMarchers(page)).find(
        (drawn) => drawn.drillNumber === drillNumber,
    );
    if (!marcher?.onScreen)
        throw new Error(`${drillNumber} is not visible on the field`);
    if (add) await page.keyboard.down("Shift");
    await page.mouse.click(marcher.screen.x, marcher.screen.y);
    if (add) await page.keyboard.up("Shift");
}

/** The drill numbers of the marchers selected on the field. */
export const selectedDrillNumbers = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const field = window.fieldTest!;
        const selected = new Set(field.selection());
        return field
            .marchers()
            .filter((marcher) => selected.has(marcher.id))
            .map((marcher) => marcher.label)
            .sort();
    });

/** Opens a marcher's row menu in the Marchers sidebar and picks an item. */
export async function marcherRowAction(
    page: Page,
    drillNumber: string,
    item: "Edit" | "Delete",
) {
    const sidebar = page.locator("#marcherListForm");
    if (!(await sidebar.isVisible()))
        await page.locator("#sidebar-launcher-marchers").click();
    // The row's menu button has no accessible name; it's the row's only button.
    await sidebar
        .getByText(drillNumber, { exact: true })
        .locator("xpath=../..")
        .getByRole("button")
        .click();
    await page.getByRole("button", { name: item, exact: true }).click();
}

/**
 * Waits until the app has made no database calls for `quietMs`, i.e. every
 * write a step started has finished. Lets a test act at a person's pace
 * instead of pressing the next key mid-write.
 */
export async function waitForIdle(page: Page, quietMs = 250) {
    await page.evaluate(() => {
        const w = window as any;
        if (w.__omIdle) return;
        const state = { inFlight: 0, last: performance.now() };
        w.__omIdle = state;
        for (const name of ["sqlProxy", "unsafeSqlProxy"]) {
            const original = w.electron[name];
            w.electron[name] = async (...args: unknown[]) => {
                state.inFlight++;
                try {
                    return await original(...args);
                } finally {
                    state.inFlight--;
                    state.last = performance.now();
                }
            };
        }
    });
    await page.waitForFunction(
        (quiet) => {
            const state = (window as any).__omIdle;
            return (
                state.inFlight === 0 && performance.now() - state.last > quiet
            );
        },
        quietMs,
        { polling: 50 },
    );
}

/**
 * Adds a page flag at the start of a measure: moves the playhead there with
 * the timeline's Go to field, then presses the timeline's **+**. The new page
 * runs from that beat to the next flag (or the show's last page counts).
 */
export async function addPageAt(page: Page, measure: number) {
    await page.getByTestId("timeline-readout").click();
    const goTo = page.getByRole("textbox", {
        name: "Go to a page, measure or rehearsal mark",
    });
    await goTo.fill(`m${measure}`);
    await goTo.press("Enter");
    await page.getByTestId("timeline-add-page-flag").click();
}

/**
 * The cursor the field shows at a point in the viewport, as the browser reads
 * it. The one field reading outside the field test API: it's what the user
 * sees in the page, the same on any renderer, not a renderer internal.
 */
export const fieldCursorAt = (page: Page, at: { x: number; y: number }) =>
    page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element ? getComputedStyle(element).cursor : null;
    }, at);

/**
 * The drill numbers of the marchers the inspector shows as selected, sorted:
 * "Marcher T2" for one, "2 Marchers" and their list for several.
 */
export async function inspectorMarchers(page: Page): Promise<string[]> {
    const single = page.getByText(/^Marcher \S+$/);
    if (await single.isVisible())
        return [(await single.innerText()).replace(/^Marcher /, "")];
    const several = page.getByText(/^\d+ Marchers$/);
    if (!(await several.isVisible())) return [];
    // The list of drill numbers under the heading
    const list = await page
        .locator("p.font-mono")
        .filter({ hasText: /^[^,]+(, [^,]+)+$/ })
        .first()
        .innerText();
    return list.split(", ").sort();
}
