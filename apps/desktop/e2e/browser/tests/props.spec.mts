import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    dragFrom,
    expectCanvasMatchesShow,
    readField,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type { FieldTestItem } from "../../../src/field/fieldTestApi";

// Props on the field (C2.1): a prop is a marchers row the timeline moves like
// any marcher, drawn as its Outline instead of a dot. A click anywhere inside
// the Outline selects it, a performer standing on it is still clicked, and a
// drag moves it through the timeline.

/** Field units per meter, as `PIXELS_PER_METER` (`src/items/itemOutlines.ts`). */
const PIXELS_PER_METER = 0.5 / 0.0254;

const PAGE_0: SeedPosition[] = [
    [1, 503, 304],
    [2, 803, 404],
];

/** A 4 x 2 m riser (marcher 10) centered on (700, 300), on field from beat 0. */
const RISER = [
    "INSERT INTO marchers (id, section, drill_prefix, drill_order, home_x, home_y, type) VALUES (10, 'Prop', 'PROP', 1, 700, 300, 'item')",
    "INSERT INTO items (id, marcher_id, kind, surface_type) VALUES (1, 10, 'prop', 'floor')",
    "INSERT INTO item_geometry (item_id, beat_id, outline_type, width, depth) VALUES (1, 0, 'rectangle', 4, 2)",
];

test.use({
    // The time-stretch worklet (#216) can't load here: Playwright's route,
    // which serves the renderer from disk, doesn't see AudioWorklet module
    // requests. Every browser scenario on main logs this; nothing here plays.
    allowedPageErrors: [/Audio worklet error/],
    seedSql: [
        ...seedShowSql({
            beats: 16,
            pageStarts: [],
            measureStarts: [1, 5, 9, 13],
            marchers: PAGE_0.map(([id]) => ({
                id,
                section: "Trumpet",
                prefix: "T",
                order: id,
            })),
            positions: [PAGE_0],
        }),
        ...RISER,
    ],
});

const drawnItems = (page: Page): Promise<FieldTestItem[]> =>
    page.evaluate(() => window.fieldTest!.items?.() ?? []);

/** A point inside the riser, `meters` right of its center, in the viewport. */
async function insideRiser(page: Page, meters: number) {
    const [riser] = await drawnItems(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: riser.screen.x + meters * PIXELS_PER_METER * zoom,
        y: riser.screen.y,
    };
}

test("draws a prop as its Outline, at its size, where the timeline has it", async ({
    show,
}) => {
    await expect
        .poll(() => drawnItems(show.page))
        .toEqual([
            expect.objectContaining({
                id: 10,
                outlineType: "rectangle",
                width: 4,
                depth: 2,
                rotation: 0,
                x: 700,
                y: 300,
            }),
        ]);
    await expectCanvasMatchesShow(show);
});

test("selects a prop clicked inside its Outline, away from its center", async ({
    show,
}) => {
    await expect.poll(() => drawnItems(show.page)).toHaveLength(1);
    const at = await insideRiser(show.page, 1.8);
    await show.page.mouse.click(at.x, at.y);
    await expect
        .poll(() => show.page.evaluate(() => window.fieldTest!.selection()))
        .toEqual([10]);
});

test("moves a prop dragged from inside its Outline, and saves where it lands", async ({
    show,
}) => {
    await expect.poll(() => drawnItems(show.page)).toHaveLength(1);
    const { zoom } = (await readField(show.page)).viewport;
    const from = await insideRiser(show.page, 1.5);
    await dragFrom(show.page, from, { x: 0, y: 40 * zoom });
    await waitForIdle(show.page);
    await expectCanvasMatchesShow(show);
    const [riser] = await drawnItems(show.page);
    expect(riser.y).toBeGreaterThan(300);
    expect(riser.width).toBe(4);
});
