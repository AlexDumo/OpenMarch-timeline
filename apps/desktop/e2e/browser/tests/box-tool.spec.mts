import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    setUiSettings,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid, savedPositions, type Position } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type {
    FieldTestPlacedBox,
    FieldTestShapeOverlay,
} from "../../../src/field/fieldTestApi";

// The box shape tool on the three.js field (#204, from box v1 #181): B opens
// it on the selected marchers, a drag draws a box edge to edge on the
// half-step grid, its handles stretch it, ] and [ change the files, a drag
// inside moves it, Enter places it as one undo step and Escape cancels.
// Placed boxes (07-placed-boxes.md): a click on a member selects the whole
// box, a double click goes inside it, and a selected box's handles stretch it
// and save at once. The View tab's label forms come with it.
// Specs: docs/timeline/research/shapes/06-box-v1.md and 07-placed-boxes.md.

// Eight trumpets scattered, all in view, on three pages.
const HOME: SeedPosition[] = [
    [1, 500, 300],
    [2, 600, 350],
    [3, 700, 280],
    [4, 800, 400],
    [5, 520, 450],
    [6, 640, 470],
    [7, 760, 430],
    [8, 880, 500],
];
const ALL = HOME.map(([id]) => id);

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
        positions: [HOME, HOME, HOME],
    }),
});

type Point = { x: number; y: number };

const asPositions = (rows: readonly SeedPosition[]): Position[] =>
    rows.map(([id, x, y]) => ({ id, x, y }));

/** Where field point `p` is drawn in the viewport, from where the marchers are drawn. */
async function toScreen(page: Page, p: Point): Promise<Point> {
    const [marcher] = await drawnMarchers(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: marcher.screen.x + (p.x - marcher.x) * zoom,
        y: marcher.screen.y + (p.y - marcher.y) * zoom,
    };
}

const shapeOverlay = (page: Page): Promise<FieldTestShapeOverlay | null> =>
    page.evaluate(() => window.fieldTest!.shapeOverlay!());

const placedBoxes = (page: Page): Promise<FieldTestPlacedBox[]> =>
    page.evaluate(() => window.fieldTest!.placedBoxes!());

const readout = (page: Page) =>
    page.getByTestId("shape-tool-readout-text").innerText();

/** Presses at `from`, drags to `to` in `steps` moves and releases; `beforeRelease` runs with the button down. */
async function drag(
    page: Page,
    from: Point,
    to: Point,
    {
        steps = 12,
        beforeRelease,
    }: { steps?: number; beforeRelease?: () => Promise<unknown> } = {},
) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await beforeRelease?.();
    await page.mouse.up();
}

/** How many undo steps the show has. */
const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

async function selectAll(page: Page) {
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
}

/** Positions are saved to three decimals. */
const CLOSE = 1e-3;

/** Whether `v` is on the half-step grid from `origin`. */
const onHalfSteps = (v: number, origin: number, step: number) =>
    Math.abs(v - origin - Math.round((v - origin) / (step / 2)) * (step / 2)) <
    CLOSE;

/**
 * Opens the box tool on every marcher and draws a box 10 steps wide and 6
 * deep, its back-left corner 15 steps left of center front and 25 back.
 * Returns the corners pressed and released, in field units.
 */
async function drawBox(show: Show) {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await page.keyboard.press("b");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    const pressed = { x: cf.x - 15 * S, y: cf.y - 25 * S };
    const released = { x: cf.x - 5 * S, y: cf.y - 19 * S };
    await drag(
        page,
        await toScreen(page, pressed),
        await toScreen(page, released),
    );
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    return { grid, pressed, released };
}

test.beforeEach(async ({ show }) => {
    await expectCanvasMatchesShow(show);
});

test("B opens the box tool, and a drag draws a box edge to edge on half steps, moving nobody yet", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await page.keyboard.press("b");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    expect((await readField(page)).activeGesture).toBe("shape");
    // The tool has its own handles: the selection box has none
    expect((await readField(page)).handles).toBeNull();

    const pressed = { x: cf.x - 15 * S, y: cf.y - 25 * S };
    let midDrag: FieldTestShapeOverlay | null = null;
    await drag(
        page,
        await toScreen(page, pressed),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
        {
            beforeRelease: async () => {
                midDrag = await shapeOverlay(page);
            },
        },
    );
    // During the drag: ghost spots only, no walks, nobody moved
    expect(midDrag!.spots).toHaveLength(ALL.length);
    expect(midDrag!.walks).toEqual([]);

    const drawn = (await shapeOverlay(page))!;
    expect(drawn.outline).toHaveLength(4);
    expect(drawn.spots).toHaveLength(ALL.length);
    // Walks show once the drag ends: one per marcher
    expect(drawn.walks).toHaveLength(ALL.length);
    for (const spot of drawn.spots) {
        expect(onHalfSteps(spot.x, cf.x, S)).toBe(true);
        expect(onHalfSteps(spot.y, cf.y, S)).toBe(true);
    }
    // Edge to edge: marchers stand on the edges through the corner pressed
    expect(drawn.spots.some((p) => Math.abs(p.x - pressed.x) < CLOSE)).toBe(
        true,
    );
    expect(drawn.spots.some((p) => Math.abs(p.y - pressed.y) < CLOSE)).toBe(
        true,
    );
    // Eight marchers split evenly: 4 × 2
    expect(await readout(page)).toMatch(/^4 × 2 · /);
    // Nobody has moved yet, and the selection is as it was
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect((await readField(page)).selection).toEqual(ALL);
});

test("handles stretch the intervals with files and ranks fixed, ] adds a file, and a drag inside moves the box", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const before = await readout(page);

    // The far corner's handle: the one farthest down and right on screen
    const handles = (await shapeOverlay(page))!.handles;
    const se = handles.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
    await drag(page, se, { x: se.x + 60, y: se.y + 30 });
    const stretched = await readout(page);
    expect(stretched.split(" · ")[0]).toBe(before.split(" · ")[0]);
    expect(stretched).not.toBe(before);

    await page.keyboard.press("]");
    await expect.poll(() => readout(page)).toMatch(/^5 × 2 · /);
    await page.keyboard.press("[");
    await expect.poll(() => readout(page)).toMatch(/^4 × 2 · /);

    const spotsBefore = (await shapeOverlay(page))!.spots;
    const xs = spotsBefore.map((p) => p.x);
    const ys = spotsBefore.map((p) => p.y);
    const inside = await toScreen(page, {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    });
    await drag(page, inside, { x: inside.x - 80, y: inside.y + 40 });
    const spotsAfter = (await shapeOverlay(page))!.spots;
    const dx = spotsAfter[0].x - spotsBefore[0].x;
    const dy = spotsAfter[0].y - spotsBefore[0].y;
    expect(dx).toBeLessThan(0);
    expect(dy).toBeGreaterThan(0);
    // The whole box moved together
    spotsAfter.forEach((p, i) => {
        expect(p.x - spotsBefore[i].x).toBeCloseTo(dx, 6);
        expect(p.y - spotsBefore[i].y).toBeCloseTo(dy, 6);
    });
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
});

test("Enter places the marchers on the spots as one undo step, and Escape cancels", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    expect(await shapeOverlay(page)).toBeNull();
    expect((await readField(page)).activeGesture).toBeNull();
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));

    const steps = await undoSteps(show);
    await drawBox(show);
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) =>
                spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
            ),
        )
        .toBe(true);
    await waitForIdle(page);
    await expectCanvasMatchesShow(show);
    expect(await undoSteps(show)).toBe(steps + 1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedPositions(show, 0)).toEqual(asPositions(HOME));
});

/** Draws and places a box on every marcher, then clears the selection. */
async function placeBox(show: Show) {
    const { page } = show;
    await drawBox(show);
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) =>
                spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
            ),
        )
        .toBe(true);
    await waitForIdle(page);
    // Escape lets go of the box selected whole
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
}

const marcherScreen = async (page: Page, id: number) =>
    (await drawnMarchers(page)).find((m) => m.id === id)!.screen;

test("change: a click on a placed box's member selects the whole box, and a double click goes inside it", async ({
    show,
}) => {
    const { page } = show;
    await placeBox(show);
    expect(await placedBoxes(page)).toEqual([]);

    const t3 = await marcherScreen(page, 3);
    await page.mouse.click(t3.x, t3.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    // The box draws its own outline and handles; the selection box has none
    await expect
        .poll(async () => (await shapeOverlay(page))?.handles.length)
        .toBeGreaterThan(0);
    expect((await readField(page)).handles).toBeNull();
    await expect(page.getByTestId("placed-box-readout-text")).toContainText(
        "4 × 2",
    );

    await page.mouse.dblclick(t3.x, t3.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([3]);
    // Inside, the other members' outline shows, and a click picks one marcher
    await expect.poll(async () => (await placedBoxes(page)).length).toBe(1);
    const t5 = await marcherScreen(page, 5);
    await page.mouse.click(t5.x, t5.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([5]);
    // Escape leaves the box, selecting it whole again
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
});

test("a selected box's handle stretches it and saves at once, as one undo step", async ({
    show,
}) => {
    const { page } = show;
    await placeBox(show);
    const steps = await undoSteps(show);
    const before = await savedPositions(show, 0);

    const t1 = await marcherScreen(page, 1);
    await page.mouse.click(t1.x, t1.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    const handles = (await shapeOverlay(page))!.handles;
    const se = handles.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
    await drag(page, se, { x: se.x + 60, y: se.y + 30 });

    let after: Position[] = before;
    await expect
        .poll(async () => {
            after = await savedPositions(show, 0);
            return JSON.stringify(after) !== JSON.stringify(before);
        })
        .toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    // Stretched: wider and deeper, with the same members
    const width = (ps: Position[]) =>
        Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    expect(width(after)).toBeGreaterThan(width(before));
    // Still selected as a box
    expect((await readField(page)).selection).toEqual(ALL);
    await expectCanvasMatchesShow(show);
});

test("the View tab's numbers-only labels draw drill order, not drill numbers", async ({
    show,
}) => {
    const { page } = show;
    expect((await drawnMarchers(page)).map((m) => m.drillNumber)).toContain(
        "T1",
    );
    await setUiSettings(page, { marcherLabels: "numbers" });
    await expect
        .poll(async () =>
            (await drawnMarchers(page)).map((m) => m.drillNumber).sort(),
        )
        .toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
});
