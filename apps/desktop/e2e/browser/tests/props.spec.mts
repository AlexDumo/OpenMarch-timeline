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

/** Selects the riser with a click inside its Outline, and returns its handles. */
async function selectRiser(page: Page) {
    await expect.poll(() => drawnItems(page)).toHaveLength(1);
    const at = await insideRiser(page, 1);
    await page.mouse.click(at.x, at.y);
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.selection()))
        .toEqual([10]);
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.handles()))
        .not.toBeNull();
    return (await page.evaluate(() => window.fieldTest!.handles()))!;
}

test("resizes a prop from its side handle at the playhead, without moving it", async ({
    show,
}) => {
    const handles = await selectRiser(show.page);
    const { zoom } = (await readField(show.page)).viewport;
    // A meter further out on the east side: a meter more on each side
    await dragFrom(show.page, handles.e, { x: PIXELS_PER_METER * zoom, y: 0 });
    await waitForIdle(show.page);
    await expect
        .poll(async () => {
            const [riser] = await drawnItems(show.page);
            return Math.round(riser.width * 10) / 10;
        })
        .toBe(6);
    const [riser] = await drawnItems(show.page);
    expect([riser.x, riser.y, riser.depth]).toEqual([700, 300, 2]);
    const saved = await show.query(
        "SELECT beat_id, round(width, 1) AS width, depth FROM item_geometry",
    );
    expect(saved).toEqual([{ beat_id: 0, width: 6, depth: 2 }]);
    await expectCanvasMatchesShow(show);
});

test("turns a prop from its rotate handle, snapped to 15°", async ({
    show,
}) => {
    const handles = await selectRiser(show.page);
    const [riser] = await drawnItems(show.page);
    // From above the center round to its right: a quarter turn clockwise
    const reach = handles.rot.y - riser.screen.y;
    await dragFrom(
        show.page,
        handles.rot,
        { x: -reach, y: -reach + 2 },
        { steps: 20 },
    );
    await waitForIdle(show.page);
    await expect
        .poll(async () => (await drawnItems(show.page))[0].rotation)
        .toBe(90);
    expect(await show.query("SELECT rotation FROM item_geometry")).toEqual([
        { rotation: 90 },
    ]);
});

/** Picks an Outline in the Props panel's Draw, which closes the panel for drawing. */
async function pickOutline(page: Page, outline: string) {
    await page.locator("#sidebar-launcher-props").click();
    await page.getByRole("button", { name: outline }).click();
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.activeGesture()))
        .toBe("prop");
}

test("draws a new prop with the Props panel's rectangle, on field from the playhead", async ({
    show,
}) => {
    await expect.poll(() => drawnItems(show.page)).toHaveLength(1);
    await pickOutline(show.page, "Rectangle");
    const box = (await show.page
        .getByTestId("fieldCanvas")
        .first()
        .boundingBox())!;
    const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.6 };
    await dragFrom(show.page, from, { x: 80, y: 50 });
    await waitForIdle(show.page);
    await expect.poll(() => drawnItems(show.page)).toHaveLength(2);
    expect(
        await show.page.evaluate(() => window.fieldTest!.activeGesture()),
    ).toBeNull();
    expect(
        await show.query(
            "SELECT kind, surface_type, outline_type, beat_id FROM items JOIN item_geometry ON item_geometry.item_id = items.id WHERE items.id != 1",
        ),
    ).toEqual([
        {
            kind: "prop",
            surface_type: "floor",
            outline_type: "rectangle",
            beat_id: 0,
        },
    ]);
    await expectCanvasMatchesShow(show);
});

test("Escape turns the prop tool off, and nothing is drawn", async ({
    show,
}) => {
    await expect.poll(() => drawnItems(show.page)).toHaveLength(1);
    await pickOutline(show.page, "Polygon");
    const box = (await show.page
        .getByTestId("fieldCanvas")
        .first()
        .boundingBox())!;
    await show.page.mouse.click(
        box.x + box.width * 0.2,
        box.y + box.height * 0.6,
    );
    await show.page.mouse.move(
        box.x + box.width * 0.3,
        box.y + box.height * 0.6,
    );
    await expect
        .poll(() =>
            show.page.evaluate(() => window.fieldTest!.propTool?.()?.preview),
        )
        .not.toBeNull();
    await show.page.keyboard.press("Escape");
    await expect
        .poll(() => show.page.evaluate(() => window.fieldTest!.propTool?.()))
        .toBeNull();
    expect(await show.query("SELECT id FROM items")).toEqual([{ id: 1 }]);
});
