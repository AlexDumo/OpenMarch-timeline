import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    selectPage,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Pathways step 1 (fork #643, spec v0.9 Appendix I): the Path pen draws a cornered
// path for one marcher. With T1 selected on Page 2, P starts the pen (a banner
// says who it draws for and how), clicks place corners, Enter saves the route as
// one undo step (the resolver tests check the marcher walks it). Undo takes the path away and redo brings
// the same route back. With two marchers selected P refuses ("one marcher for
// now"). Remove path in the floating editor makes the move straight again.

const HOME: SeedPosition[] = [
    [1, 500, 300],
    [2, 600, 300],
];
// Page 2 sends T1 forty field units to the right
const PAGE2: SeedPosition[] = [
    [1, 900, 300],
    [2, 600, 300],
];

test.use({
    seedSql: seedShowSql({
        beats: 48,
        pageStarts: [16, 32],
        measureStarts: Array.from({ length: 12 }, (_, i) => 1 + i * 4),
        marchers: HOME.map(([id]) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [HOME, HOME, PAGE2],
    }),
    // The time-stretch worklet (#216) can't load in the harness (see props.spec.mts)
    allowedPageErrors: [/Audio worklet error/],
});

type Point = { x: number; y: number };

/** Where field point `p` is drawn in the viewport, from where the marchers are drawn. */
async function toScreen(page: Page, p: Point): Promise<Point> {
    const [marcher] = await drawnMarchers(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: marcher.screen.x + (p.x - marcher.x) * zoom,
        y: marcher.screen.y + (p.y - marcher.y) * zoom,
    };
}

const routes = (show: Show) =>
    show.query<{ id: number; geometry: string }>(
        "SELECT id, geometry FROM timeline_routes ORDER BY id",
    );

const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

test("change: P draws a cornered path for one marcher, Enter saves it as one undo step, undo and redo keep its id, Remove path takes it away", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;

    await selectPage(show, "Page 2");
    // Several marchers: the pen refuses
    await clickMarcher(page, "T1");
    await clickMarcher(page, "T2", { add: true });
    await page.keyboard.press("p");
    await expect(page.getByText("One marcher for now")).toBeVisible();
    await expect(page.getByTestId("path-pen-banner")).toBeHidden();

    // One marcher: the banner says who it's for
    await clickMarcher(page, "T1");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([1]);
    const steps = await undoSteps(show);
    await page.getByRole("tab", { name: "Shapes" }).click();
    await page.getByTestId("toolbar-path-pen").click();
    await expect(page.getByTestId("path-pen-banner")).toContainText("T1");
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "drawing",
    );

    // Two corners: up and over, then down to the end spot
    const c1 = { x: 500, y: 300 - 8 * S };
    const c2 = { x: 900, y: 300 - 8 * S };
    for (const c of [c1, c2]) {
        const at = await toScreen(page, c);
        await page.mouse.click(at.x, at.y);
    }
    // Backspace takes the last back, and it's placed again
    await page.keyboard.press("Backspace");
    const again = await toScreen(page, c2);
    await page.mouse.click(again.x, again.y);
    await page.keyboard.press("Enter");
    await waitForIdle(page);

    const [route] = await routes(show);
    const geometry = JSON.parse(route!.geometry) as {
        points: { id: string; at: [number, number] }[];
    };
    expect(geometry.points).toHaveLength(2);
    expect(geometry.points[0]!.at[0]).toBeCloseTo(c1.x, 0);
    expect(geometry.points[0]!.at[1]).toBeCloseTo(c1.y, 0);
    expect(await undoSteps(show)).toBe(steps + 1);
    const [t] = await show.query<{ path_style: string; route_id: number }>(
        "SELECT path_style, route_id FROM timeline_transitions WHERE route_id IS NOT NULL",
    );
    expect(t).toMatchObject({ path_style: "route", route_id: route!.id });
    // The path is open with its editor: who it's for, and Remove path
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "open",
    );
    await expect(page.getByTestId("path-editor-who")).toHaveText("Path · T1");
    await expect(page.getByTestId("path-remove")).toBeVisible();

    // Undo takes it away; redo brings the same route back
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    expect(await routes(show)).toEqual([]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForIdle(page);
    expect(await routes(show)).toEqual([route]);

    // Remove path, from the floating editor once it's open again
    // Empty field clears the selection; selecting T1 again opens its path
    const empty = await toScreen(page, { x: 300, y: 300 + 20 * S });
    await page.mouse.click(empty.x, empty.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    await clickMarcher(page, "T1");
    await expect(page.getByTestId("path-remove")).toBeVisible();
    await page.getByTestId("path-remove").click();
    await waitForIdle(page);
    expect(await routes(show)).toEqual([]);
    await expect(page.getByTestId("path-editor")).toBeHidden();
    await expectCanvasMatchesShow(show);
});
