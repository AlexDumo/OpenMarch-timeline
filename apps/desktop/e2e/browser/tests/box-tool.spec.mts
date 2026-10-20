import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    selectPage,
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
// half-step grid, its handles stretch it, − and + change the files, a drag
// inside moves it, Enter places it as one undo step and Escape cancels. The
// shape frame (08-shape-system-ux.md): the knob turns it, the floating
// editor's ⋯ row flips it, who goes where holds through both, and everyone
// else fades while it's open.
// Placed boxes (07-placed-boxes.md): a click on a member selects the whole
// box, a double click goes inside it, and a selected box's handles stretch it
// and save at once. The View tab's label forms come with it.
// Specs: docs/timeline/research/shapes/06-box-v1.md, 07-placed-boxes.md and
// 08-shape-system-ux.md.

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
    // The time-stretch worklet (#216) can't load in the harness (see props.spec.mts)
    allowedPageErrors: [/Audio worklet error/],
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

/** The floating editor's numbers: "4 × 2 · 2 × 2 steps" */
async function readout(page: Page): Promise<string> {
    const bar = page.getByTestId("shape-tool-readout");
    const size = await bar.getByTestId("shape-editor-size").innerText();
    const across = await bar.getByTestId("shape-editor-across").innerText();
    const deep = await bar.getByTestId("shape-editor-deep").innerText();
    return `${size} · ${across} × ${deep} steps`;
}

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

test("handles stretch the intervals with files and ranks fixed, + adds a file, and a drag inside moves the box", async ({
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

    await page.getByRole("button", { name: "One more across" }).click();
    await expect.poll(() => readout(page)).toMatch(/^5 × 2 · /);
    await page.getByRole("button", { name: "One fewer across" }).click();
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

test("change: the knob turns the box and ⋯ flips it, each marcher keeping their spot, and the rest fade", async ({
    show,
}) => {
    const { page } = show;
    const { grid } = await drawBox(show);
    let overlay = (await shapeOverlay(page))!;
    expect(overlay.stage).toBe("open");
    // Eight marchers: each spot says who stands there
    expect([...overlay.labels].sort()).toEqual(
        ALL.map((id) => `T${id}`).sort(),
    );
    const before = overlay.walks;

    // Drag the knob a quarter turn clockwise around the pivot: the box's
    // center by default
    const xs0 = before.map((w) => w.to.x);
    const ys0 = before.map((w) => w.to.y);
    const pivot = {
        x: (Math.min(...xs0) + Math.max(...xs0)) / 2,
        y: (Math.min(...ys0) + Math.max(...ys0)) / 2,
    };
    const pivotScreen = await toScreen(page, pivot);
    const knob = overlay.knob!;
    const v = { x: knob.x - pivotScreen.x, y: knob.y - pivotScreen.y };
    await drag(
        page,
        knob,
        { x: pivotScreen.x - v.y, y: pivotScreen.y + v.x },
        { steps: 20 },
    );
    overlay = (await shapeOverlay(page))!;
    // Everyone keeps their own spot: each walk's end turned 90° around the
    // pivot. A quarter turn lands back on the half-step grid, which can shift
    // the box by up to a quarter step.
    const slack = grid.pixelsPerStep / 4 + 1;
    overlay.walks.forEach((w, i) => {
        const was = before[i].to;
        expect(w.from).toEqual(before[i].from);
        expect(
            Math.abs(w.to.x - (pivot.x - (was.y - pivot.y))),
        ).toBeLessThanOrEqual(slack);
        expect(
            Math.abs(w.to.y - (pivot.y + (was.x - pivot.x))),
        ).toBeLessThanOrEqual(slack);
    });
    // The numbers follow the field: 4 × 2 turned a quarter reads 2 × 4
    expect(await readout(page)).toMatch(/^2 × 4 · /);

    // ⋯ → flip side to side: mirrored about the center's line, same marchers;
    // neither order is lit after it
    const turned = overlay.walks;
    // The quarter turn may have moved the center a little back onto the grid
    const xs1 = turned.map((w) => w.to.x);
    const turnedMid = (Math.min(...xs1) + Math.max(...xs1)) / 2;
    await page.getByTestId("shape-editor-more").click();
    await page.getByTestId("shape-editor-flip-across").click();
    // Those on the center's line stay; everyone else crosses to the other side
    await expect
        .poll(async () =>
            (await shapeOverlay(page))!.walks.some(
                (w, i) => Math.abs(w.to.x - turned[i].to.x) > 1,
            ),
        )
        .toBe(true);
    const flipped = (await shapeOverlay(page))!.walks;
    flipped.forEach((w, i) => {
        expect(
            Math.abs(w.to.x - (2 * turnedMid - turned[i].to.x)),
        ).toBeLessThanOrEqual(slack);
        expect(w.to.y).toBeCloseTo(turned[i].to.y, 3);
    });
    await expect(page.getByTestId("shape-editor-order-kept")).toBeVisible();
    await expect(
        page.getByTestId("shape-editor-order").getByRole("radio", {
            checked: true,
        }),
    ).toHaveCount(0);

    // Nobody moves until Place. Enter still places after a click on the
    // editor's buttons: they don't keep the focus
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).map((p) => {
                const w = flipped[ALL.indexOf(p.id)];
                return Math.hypot(w.to.x - p.x, w.to.y - p.y) < CLOSE;
            }),
        )
        .toEqual(ALL.map(() => true));
});

test("change: while a box is open everyone else fades, and nobody once it closes", async ({
    show,
}) => {
    const { page } = show;
    const dimmedIds = async () =>
        (await drawnMarchers(page)).filter((m) => m.dimmed).map((m) => m.id);
    // Box only some of them
    await page.mouse.click(...(await screenOf(page, 1)));
    await page.keyboard.down("Shift");
    await page.mouse.click(...(await screenOf(page, 2)));
    await page.keyboard.up("Shift");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([1, 2]);
    await page.keyboard.press("b");
    await expect.poll(dimmedIds).toEqual([3, 4, 5, 6, 7, 8]);
    await page.keyboard.press("Escape");
    await expect.poll(dimmedIds).toEqual([]);
});

const screenOf = async (page: Page, id: number): Promise<[number, number]> => {
    const m = (await drawnMarchers(page)).find((d) => d.id === id)!;
    return [m.screen.x, m.screen.y];
};

const toasts = (page: Page) => page.locator("[data-sonner-toast]");

/** Whether every marcher stands on page 0 on one of `spots`. */
const onSpots = async (show: Show, spots: readonly Point[]) =>
    (await savedPositions(show, 0)).every((p) =>
        spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
    );

test("change: Escape discards an open box with no toast, and undo right after brings it back", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await drawBox(show);
    // A change in the box's own history, which comes back too
    await page.getByRole("button", { name: "One more across" }).click();
    const numbers = await readout(page);
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect(toasts(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await readout(page)).toBe(numbers);
    expect((await shapeOverlay(page))!.spots).toEqual(spots);
    // The show was never touched
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await undoSteps(show)).toBe(steps);
    // Undo goes on through the box's own history
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readout(page)).not.toBe(numbers);
});

test("change: Escape while typing a number cancels only the number", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const numbers = await readout(page);
    await page.getByTestId("shape-editor-across").click();
    await page.keyboard.type("7");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-editor-across-input")).toBeHidden();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await readout(page)).toBe(numbers);
    // The next Escape discards the box
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
});

test("change: scrubbing with a box open places it where it was drawn as one undo step, with no toast", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await drawBox(show);
    const spots = (await shapeOverlay(page))!.spots;
    // One beat on: the moment the box was drawn at is left
    await page.keyboard.press("Shift+E");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, spots)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    await expect(toasts(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedPositions(show, 0)).toEqual(asPositions(HOME));
});

test("change: changing the selection with a box open places it as one undo step, with no toast", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    // Box only the first two
    await page.mouse.click(...(await screenOf(page, 1)));
    await page.keyboard.down("Shift");
    await page.mouse.click(...(await screenOf(page, 2)));
    await page.keyboard.up("Shift");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([1, 2]);
    await page.keyboard.press("b");
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await drag(
        page,
        await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 23 * S }),
    );
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    const spots = (await shapeOverlay(page))!.spots;

    await selectAll(page);
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    const placed = async () =>
        (await savedPositions(show, 0))
            .filter((p) => p.id <= 2)
            .every((p) =>
                spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
            );
    await expect.poll(placed).toBe(true);
    await waitForIdle(page);
    // Nobody else moved
    expect((await savedPositions(show, 0)).filter((p) => p.id > 2)).toEqual(
        asPositions(HOME).filter((p) => p.id > 2),
    );
    expect(await undoSteps(show)).toBe(steps + 1);
    await expect(toasts(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedPositions(show, 0)).toEqual(asPositions(HOME));
});

test("change: the rotation is a number in ⋯ you type, and Tab goes from number to number", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    await page.getByTestId("shape-editor-more").click();
    await page.getByTestId("shape-editor-rotation").click();
    await page.keyboard.type("90");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-editor-rotation")).toHaveText("90°");
    // Turned a quarter, across is still side to side on the field
    await expect.poll(() => readout(page)).toMatch(/^2 × 4 · /);
    // + makes it one wider on the field
    await page.getByRole("button", { name: "One more across" }).click();
    await expect.poll(() => readout(page)).toMatch(/^3 × 3 · /);

    // Tab: from the side-to-side spacing straight into front to back
    await page.getByTestId("shape-editor-across").click();
    await page.keyboard.type("2");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("shape-editor-deep-input")).toBeFocused();
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await expect.poll(() => readout(page)).toBe("3 × 3 · 2 × 3 steps");
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

// The open shape is measured from the start flag (#346, spec #344): its hollow
// rings and walks start where each marcher stands at the start flag, not where
// the page has them at the playhead. On page 2 that's page 1's positions; at
// home it's the home spots.
const shifted = (dy: number): SeedPosition[] =>
    HOME.map(([id, x, y]) => [id, x, y + dy]);
const PAGE_1 = shifted(60);
const PAGE_2 = shifted(120);

/** The rings' points, sorted, to compare with where marchers stand */
const sortedPoints = (points: readonly Point[]) =>
    [...points].sort((a, b) => a.x - b.x || a.y - b.y);

const expectSamePoints = (
    actual: readonly Point[],
    expected: readonly SeedPosition[],
) => {
    const a = sortedPoints(actual);
    const e = sortedPoints(expected.map(([, x, y]) => ({ x, y })));
    expect(a).toHaveLength(e.length);
    a.forEach((p, i) => {
        expect(p.x).toBeCloseTo(e[i]!.x, 3);
        expect(p.y).toBeCloseTo(e[i]!.y, 3);
    });
};

for (const editorMode of ["expert", "basic"] as const) {
    test.describe(`measured from the start flag (${editorMode})`, () => {
        test.use({
            appSettings: { optOutAnalytics: true, editorMode },
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
                positions: [HOME, PAGE_1, PAGE_2],
            }),
        });

        test("on a page, rings and walks start at the start flag, not at the playhead", async ({
            show,
        }) => {
            const { page } = show;
            await selectPage(show, "Page 2");
            // The field shows the playhead: page 2's positions
            await expect
                .poll(async () =>
                    (await drawnMarchers(page)).map((m) => m.y).sort(),
                )
                .toEqual(PAGE_2.map(([, , y]) => y).sort());
            await drawBox(show);
            const overlay = (await shapeOverlay(page))!;
            expectSamePoints(overlay.rings, PAGE_1);
            expectSamePoints(
                overlay.walks.map((w) => w.from),
                PAGE_1,
            );
        });

        test("at home, rings and walks start at the home spots", async ({
            show,
        }) => {
            const { page } = show;
            await selectPage(show, "Page 2");
            await page.keyboard.press("Home");
            await expect
                .poll(async () =>
                    (await drawnMarchers(page)).map((m) => m.y).sort(),
                )
                .toEqual(HOME.map(([, , y]) => y).sort());
            await drawBox(show);
            const overlay = (await shapeOverlay(page))!;
            expectSamePoints(overlay.rings, HOME);
            expectSamePoints(
                overlay.walks.map((w) => w.from),
                HOME,
            );
        });
    });
}

// The inspector's Transform section (#349, spec #344): the pivot grid, the
// rotation and the flips for any selection, and for a shape scaling by
// interval in half steps. A plain selection writes positions only, no recipe.

const recipeCount = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM timeline_shape_recipes",
    );
    return row.count;
};

/** "3½" as 3.5 */
const halves = (text: string) =>
    Number(text.replace("½", "").trim() || "0") +
    (text.includes("½") ? 0.5 : 0);

/** The open box's spacings in the floating editor, in steps */
async function spacings(page: Page): Promise<[number, number]> {
    const bar = page.getByTestId("shape-tool-readout");
    return [
        halves(await bar.getByTestId("shape-editor-across").innerText()),
        halves(await bar.getByTestId("shape-editor-deep").innerText()),
    ];
}

test("change: the Transform section flips and turns a plain selection around the pivot, writing positions only", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    const section = page.getByTestId("transform-section");
    await expect(section).toBeVisible();
    // A plain selection has no scale
    await expect(section.getByTestId("transform-scale-more")).toHaveCount(0);
    const steps = await undoSteps(show);

    // Around the left edge: everyone mirrors to the left of the leftmost marcher
    const left = Math.min(...HOME.map(([, x]) => x));
    await section.getByTestId("transform-pivot-w").click();
    await section.getByTestId("transform-flip-across").click();
    await expect
        .poll(() => savedPositions(show, 0))
        .toEqual(asPositions(HOME.map(([id, x, y]) => [id, 2 * left - x, y])));
    expect(await undoSteps(show)).toBe(steps + 1);
    expect(await recipeCount(show)).toBe(0);

    // A quarter turn clockwise around the back-left corner of their box
    const flipped = await savedPositions(show, 0);
    const corner = {
        x: Math.min(...flipped.map((p) => p.x)),
        y: Math.min(...flipped.map((p) => p.y)),
    };
    await section.getByTestId("transform-pivot-nw").click();
    const rotation = section.getByRole("textbox", { name: "Rotation" });
    await rotation.fill("90");
    await rotation.blur();
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) => {
                const was = flipped.find((f) => f.id === p.id)!;
                const want = {
                    x: corner.x - (was.y - corner.y),
                    y: corner.y + (was.x - corner.x),
                };
                return Math.hypot(p.x - want.x, p.y - want.y) < 0.01;
            }),
        )
        .toBe(true);
    expect(await undoSteps(show)).toBe(steps + 2);
    expect(await recipeCount(show)).toBe(0);
    await expectCanvasMatchesShow(show);
});

test("change: a box's − and + in the Transform section change its spacing by half a step", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const section = page.getByTestId("transform-section");
    const [across, deep] = await spacings(page);

    await section.getByTestId("transform-scale-more").click();
    await expect.poll(() => spacings(page)).toEqual([across + 0.5, deep + 0.5]);
    await section.getByTestId("transform-scale-less").click();
    await section.getByTestId("transform-scale-less").click();
    await expect.poll(() => spacings(page)).toEqual([across - 0.5, deep - 0.5]);
    // Still open: nobody moves until Place
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
});

test("change: handles snap spacings to half steps, Alt to tenths, with a length readout while dragging", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const se = () =>
        shapeOverlay(page).then((o) =>
            o!.handles.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a)),
        );

    let tip: string | null = null;
    let from = await se();
    await drag(
        page,
        from,
        { x: from.x + 47, y: from.y + 23 },
        {
            beforeRelease: async () => {
                tip = (await shapeOverlay(page))!.tip;
            },
        },
    );
    expect(tip).toMatch(/^[\d½]+ × [\d½]+ steps · ↔ [\d½]+ ↕ [\d½]+ apart$/);
    expect((await shapeOverlay(page))!.tip).toBeNull();
    for (const s of await spacings(page)) expect((s * 2) % 1).toBe(0);

    // With Alt: tenths
    from = await se();
    await page.keyboard.down("Alt");
    await drag(page, from, { x: from.x + 13, y: from.y + 7 });
    await page.keyboard.up("Alt");
    const bar = page.getByTestId("shape-tool-readout");
    for (const id of ["shape-editor-across", "shape-editor-deep"]) {
        const text = await bar.getByTestId(id).innerText();
        expect(text).toMatch(/^\d+(\.\d)?$|^[\d½]+$/);
    }
});

test("change: a placed box comes back turned and flipped when selected again", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const section = page.getByTestId("transform-section");
    await section.getByTestId("transform-rotation").click();
    await page.getByTestId("transform-rotation-input").fill("30");
    await page.getByTestId("transform-rotation-input").press("Enter");
    await section.getByTestId("transform-flip-deep").click();
    const turned = await section.getByTestId("transform-rotation").innerText();
    expect(turned).not.toBe("0°");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    const [recipe] = await show.query<{ params: string }>(
        "SELECT params FROM timeline_shape_recipes",
    );
    const stored = JSON.parse(recipe.params);
    expect(stored.flipY ?? stored.flipX).toBe(true);

    const t1 = await marcherScreen(page, 1);
    await page.mouse.click(t1.x, t1.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(section.getByTestId("transform-rotation")).toHaveText(turned);
});
