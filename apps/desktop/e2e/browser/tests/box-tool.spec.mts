import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    openSettings,
    expectCanvasMatchesShow,
    readField,
    selectPage,
    setUiSettings,
    waitForField,
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
// The View tab keeps the toggles flipped while working; set-once looks,
// shape focus among them, live in Settings › Field (#418).
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

/**
 * What the shape tool draws once its spots have settled: after a change the marchers glide to
 * their new spots for about 150 ms (#387), so this waits for the glide to land
 */
async function shapeOverlay(page: Page): Promise<FieldTestShapeOverlay | null> {
    await page.waitForFunction(
        () => window.fieldTest!.shapeOverlay!()?.gliding !== true,
    );
    return page.evaluate(() => window.fieldTest!.shapeOverlay!());
}

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

/**
 * Turns on the open shape's pathways, off by default (#403), for scenarios that read the walks.
 * The setting reloads the app, and the marchers are drawn a little after the field is back: wait
 * for them, or Ctrl/Cmd+A right after selects nobody
 */
async function showPathways(show: Show) {
    await setUiSettings(show.page, { shapeWalks: true });
    await expectCanvasMatchesShow(show);
}

test.beforeEach(async ({ show }) => {
    await expectCanvasMatchesShow(show);
});

test("B opens the box tool, and a drag draws a box edge to edge on half steps, moving nobody yet", async ({
    show,
}) => {
    const { page } = show;
    await showPathways(show);
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
    await showPathways(show);
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

test("change: the View tab keeps only labels, paths, shapes and 3D; the rest moved to Settings › Field", async ({
    show,
}) => {
    const { page } = show;
    await page.getByRole("tab", { name: "View" }).click();
    // Nothing but these: grid lines, half lines, label size and position,
    // step-size warnings and shape focus moved to Settings
    await expect(page.getByRole("tabpanel", { name: "View" }))
        .toMatchAriaSnapshot(`
      - tabpanel "View":
        - /children: equal
        - text: Labels
        - combobox "Labels"
        - button "Next paths":
          - text: Next paths
          - img
        - text: Shapes
        - combobox "Shapes"
        - button "Open 3D View":
          - text: Open 3D View
          - img
    `);

    const settings = await openSettings(page, "Field");
    for (const name of ["Grid lines", "Half lines", "Step size warnings"])
        await expect(settings.getByRole("switch", { name })).toBeVisible();
    for (const name of ["Normal", "Above the dot", "Fade the rest"])
        await expect(settings.getByRole("radio", { name })).toBeChecked();
});

test("change: Settings › Field › While shaping changes who fades on the open field at once", async ({
    show,
}) => {
    const { page } = show;
    const settings = await openSettings(page, "Field");
    const dimmedIds = async () =>
        (await drawnMarchers(page)).filter((m) => m.dimmed).map((m) => m.id);
    await page.bringToFront();
    await page.mouse.click(...(await screenOf(page, 1)));
    await page.keyboard.down("Shift");
    await page.mouse.click(...(await screenOf(page, 2)));
    await page.keyboard.up("Shift");
    await page.keyboard.press("b");
    await expect.poll(dimmedIds).toEqual([3, 4, 5, 6, 7, 8]);

    // Only while a drag draws it: an open box at rest fades nobody
    await settings
        .getByRole("radio", { name: "Fade only while drawing" })
        .click();
    await expect.poll(dimmedIds).toEqual([]);
    await settings.getByRole("radio", { name: "Fade the rest" }).click();
    await expect.poll(dimmedIds).toEqual([3, 4, 5, 6, 7, 8]);
});

test("change: Settings › Field › Grid lines redraws the open field at once", async ({
    show,
}) => {
    const { page } = show;
    const field = () => page.getByTestId("fieldCanvas").first().screenshot();
    const settings = await openSettings(page, "Field");
    await waitForIdle(page);
    const withGrid = await field();
    await settings.getByRole("switch", { name: "Grid lines" }).click();
    await expect.poll(async () => (await field()).equals(withGrid)).toBe(false);
});

test("change: an open box fades everyone else, still readable, and once drawn hides its own marchers' dots for its spots and start rings; placing or Escape brings them back", async ({
    show,
}) => {
    const { page } = show;
    const looks = async () =>
        Object.fromEntries(
            (await drawnMarchers(page)).map((m) => [
                m.id,
                `${m.opacity === 1 ? "full" : m.opacity === 0 ? "hidden" : "faint"}${m.labelShown ? "" : " no-label"}`,
            ]),
        );
    const expected = (mine: string, others: string) =>
        Object.fromEntries(ALL.map((id) => [id, id <= 2 ? mine : others]));
    const boxTwo = async () => {
        await page.mouse.click(...(await screenOf(page, 1)));
        await page.keyboard.down("Shift");
        await page.mouse.click(...(await screenOf(page, 2)));
        await page.keyboard.up("Shift");
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual([1, 2]);
        await page.keyboard.press("b");
        // Armed, nothing drawn: the two still show where they stand
        await expect.poll(looks).toEqual(expected("full", "faint"));
        const grid = await fieldGrid(show);
        const S = grid.pixelsPerStep;
        const cf = grid.centerFront;
        await drag(
            page,
            await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
            await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 23 * S }),
        );
        await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    };

    await boxTwo();
    await expect.poll(looks).toEqual(expected("hidden no-label", "faint"));
    // Where they come from is the start rings, pathways or not; pathways add the walks
    expect((await shapeOverlay(page))!.rings).toHaveLength(2);
    expect((await shapeOverlay(page))!.walks).toHaveLength(0);
    await page.getByTestId("shape-editor-pathways").click();
    await expect
        .poll(async () => (await shapeOverlay(page))!.walks)
        .toHaveLength(2);
    expect((await shapeOverlay(page))!.rings).toHaveLength(2);
    await page.keyboard.press("Escape");
    await expect.poll(looks).toEqual(expected("full", "full"));

    await boxTwo();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(looks).toEqual(expected("full", "full"));
});

test("change: the chip and the Transform section draw their direction marks as icons, never as text a font may make an emoji", async ({
    show,
}) => {
    const { page } = show;
    const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
    await drawBox(show);
    const chip = page.getByTestId("shape-tool-readout");
    await expect(chip.locator('[data-glyph="across"]')).toHaveCount(1);
    await expect(chip.locator('[data-glyph="deep"]')).toHaveCount(1);
    expect(await chip.innerText()).not.toMatch(PICTOGRAPHIC);
    const transform = page.getByTestId("transform-section");
    await expect(transform).toBeVisible();
    expect(await transform.innerText()).not.toMatch(PICTOGRAPHIC);
    await expect(transform.locator("[data-glyph]")).not.toHaveCount(0);
});

test("change: start positions show as faint dots in the marchers' own color", async ({
    show,
}) => {
    const { page } = show;
    await page.mouse.click(...(await screenOf(page, 1)));
    await page.keyboard.down("Shift");
    await page.mouse.click(...(await screenOf(page, 2)));
    await page.keyboard.up("Shift");
    await page.keyboard.press("b");
    const ghosts = page.getByTestId("fieldShapeStartGhost");
    await expect(ghosts).toHaveCount(2);
    const fill = (await drawnMarchers(page)).find((m) => m.id === 1)!.look.fill;
    await expect(ghosts.first()).toHaveAttribute("fill", fill!);
});

test("change: the knob turns in 15° steps, as the field's rotate handle does, and freely with Alt", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const rotation = page.getByTestId("shape-editor-rotation");
    await page.getByTestId("shape-editor-more").click();
    /** Drags the knob `degrees` clockwise around the box's center dot */
    const turnKnob = async (degrees: number) => {
        const overlay = (await shapeOverlay(page))!;
        const knob = overlay.knob!;
        const c = overlay.centerDot!;
        const a = (degrees * Math.PI) / 180;
        const v = { x: knob.x - c.x, y: knob.y - c.y };
        await drag(
            page,
            knob,
            {
                x: c.x + v.x * Math.cos(a) - v.y * Math.sin(a),
                y: c.y + v.x * Math.sin(a) + v.y * Math.cos(a),
            },
            { steps: 20 },
        );
    };
    const degreesShown = async () =>
        Number((await rotation.innerText()).replace("°", ""));

    await turnKnob(37);
    await expect.poll(degreesShown).toBe(30);

    await page.keyboard.down("Alt");
    await turnKnob(37);
    await page.keyboard.up("Alt");
    const free = await degreesShown();
    expect(free % 15).not.toBe(0);
    expect(free).toBeGreaterThan(55);
    expect(free).toBeLessThan(80);

    // Typed, a rotation stays as typed
    await rotation.click();
    await page.keyboard.type("37");
    await page.keyboard.press("Enter");
    await expect(rotation).toHaveText("37°");
});

test("change: the open box's controls fade while the pointer is away from it, and come back over it or a handle", async ({
    show,
}) => {
    const { page } = show;
    const { grid } = await drawBox(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    const calm = async () => (await shapeOverlay(page))!.calm;
    const handleOpacity = () =>
        page
            .getByTestId("fieldShapeHandle")
            .first()
            .evaluate((el) => getComputedStyle(el).opacity);
    const boxFill = () =>
        page
            .getByTestId("fieldShapeMode")
            .locator("polygon")
            .first()
            .getAttribute("fill");

    // Away from the box, on empty field: faint controls and no fill, the spots as they were
    const away = await toScreen(page, { x: cf.x + 20 * S, y: cf.y - 5 * S });
    await page.mouse.move(away.x, away.y);
    await expect.poll(calm).toBe(true);
    await expect.poll(handleOpacity).toBe("0.25");
    await expect.poll(boxFill).toBe("none");
    expect((await shapeOverlay(page))!.spots).toHaveLength(ALL.length);

    // Over the box: full strength
    const spots = (await shapeOverlay(page))!.spots;
    const xs = spots.map((p) => p.x);
    const ys = spots.map((p) => p.y);
    const inside = await toScreen(page, {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    });
    await page.mouse.move(inside.x, inside.y);
    await expect.poll(calm).toBe(false);
    await expect.poll(handleOpacity).toBe("1");
    await expect.poll(boxFill).not.toBe("none");

    // Away again, then over a handle
    await page.mouse.move(away.x, away.y);
    await expect.poll(calm).toBe(true);
    const [handle] = (await shapeOverlay(page))!.handles;
    await page.mouse.move(handle.x, handle.y);
    await expect.poll(calm).toBe(false);

    // Off the field (down on the timeline): faint again
    const timeline = await page.getByTestId("timeline-loop").boundingBox();
    await page.mouse.move(timeline!.x - 40, timeline!.y + 4);
    await expect.poll(calm).toBe(true);
});

test("change: the open box always shows its start rings, and starts with no walks; the floating editor's Pathways toggle shows and hides the walks", async ({
    show,
}) => {
    const { page } = show;
    const pathways = page.getByTestId("shape-editor-pathways");
    await drawBox(show);
    let overlay = (await shapeOverlay(page))!;
    expect(overlay.walks).toEqual([]);
    expect(overlay.rings).toHaveLength(ALL.length);
    expect(overlay.spots).toHaveLength(ALL.length);
    await expect(pathways).toHaveAttribute("aria-pressed", "false");

    await pathways.click();
    await expect
        .poll(async () => (await shapeOverlay(page))!.walks)
        .toHaveLength(ALL.length);
    expect((await shapeOverlay(page))!.rings).toHaveLength(ALL.length);
    await expect(pathways).toHaveAttribute("aria-pressed", "true");

    await pathways.click();
    await expect
        .poll(async () => (await shapeOverlay(page))!.walks)
        .toEqual([]);
    overlay = (await shapeOverlay(page))!;
    expect(overlay.rings).toHaveLength(ALL.length);
    await expect(pathways).toHaveAttribute("aria-pressed", "false");
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

// Option B (#416): moving around the timeline keeps an open shape open, tied
// to the moment it was drawn at. Away from it the shape and its editor hide
// behind a chip with Go back. Only Enter or Place places it (owner lab
// feedback): Enter and Escape act only on a shape you can see, playback and
// Visuals hide it until they end, and a new selection leaves it open.

const awayChip = (page: Page) => page.getByTestId("shape-away-chip");

/** What the open box looks like: its numbers, spots, who goes where and pivot */
async function openBox(page: Page) {
    const overlay = (await shapeOverlay(page))!;
    return {
        numbers: await readout(page),
        spots: overlay.spots,
        walks: overlay.walks,
        pivot: overlay.pivotMark,
    };
}

test("change: scrubbing, page keys and timeline clicks keep an open box open; away it hides behind a chip, and Go back shows it unchanged", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await showPathways(show);
    await drawBox(show);
    await page.getByRole("button", { name: "One more across" }).click();
    const before = await openBox(page);

    // One beat on: the box was drawn at home
    await page.keyboard.press("Shift+E");
    await expect(awayChip(page)).toBeVisible();
    await expect(page.getByTestId("shape-away-chip-text")).toHaveText(
        "Shape open at home",
    );
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.shapeOverlay!()))
        .toBeNull();
    // Page keys and a click on the timeline don't place it either
    await page.keyboard.press("e");
    await selectPage(show, "Page 2");
    await expect(awayChip(page)).toBeVisible();
    await waitForIdle(page);
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await undoSteps(show)).toBe(steps);
    await expect(toasts(page)).toHaveCount(0);

    await awayChip(page).getByRole("button", { name: "Go back" }).click();
    await expect(awayChip(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await openBox(page)).toEqual(before);

    // Coming back another way shows it too
    await page.keyboard.press("Shift+E");
    await expect(awayChip(page)).toBeVisible();
    await page.keyboard.press("Shift+Q");
    await expect(awayChip(page)).toBeHidden();
    expect(await openBox(page)).toEqual(before);
    expect(await undoSteps(show)).toBe(steps);
});

test("change: away from an open box, Enter and Escape leave it alone; back at its moment Enter places it as one undo step", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await drawBox(show);
    const before = await openBox(page);
    await page.keyboard.press("Shift+E");
    await expect(awayChip(page)).toBeVisible();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await waitForIdle(page);
    await expect(awayChip(page)).toBeVisible();
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await undoSteps(show)).toBe(steps);

    await awayChip(page).getByRole("button", { name: "Go back" }).click();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await openBox(page)).toEqual(before);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, before.spots)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    await expect(toasts(page)).toHaveCount(0);
});

test("change: the away chip's Dismiss discards the waiting box with no toast, and undo right after brings it back", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await drawBox(show);
    const before = await openBox(page);
    await page.keyboard.press("Shift+E");
    await awayChip(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(awayChip(page)).toBeHidden();
    await expect(toasts(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(awayChip(page)).toBeVisible();
    await awayChip(page).getByRole("button", { name: "Go back" }).click();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await openBox(page)).toEqual(before);
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await undoSteps(show)).toBe(steps);
});

for (const [how, start] of [
    ["B", (page: Page) => page.keyboard.press("b")],
    [
        "the Shapes tab",
        async (page: Page) => {
            await page.getByRole("tab", { name: "Shapes" }).click();
            await page.getByTestId("shapes-tab-block").click();
        },
    ],
] as const)
    test(`change: ${how} away from a waiting box starts a new one here, dismissing the old one, which undo before drawing brings back`, async ({
        show,
    }) => {
        const { page } = show;
        const steps = await undoSteps(show);
        await drawBox(show);
        const before = await openBox(page);
        await page.keyboard.press("Shift+E");
        await expect(awayChip(page)).toBeVisible();

        await start(page);
        await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
        await expect(awayChip(page)).toBeHidden();
        await expect(toasts(page)).toHaveCount(0);

        // Nothing drawn yet: undo brings the waiting box back, still at home
        await page.keyboard.press("ControlOrMeta+z");
        await expect(page.getByTestId("shape-tool-hint")).toBeHidden();
        await expect(awayChip(page)).toBeVisible();

        // Start over again and draw: Enter places the new box here
        await start(page);
        const grid = await fieldGrid(show);
        const S = grid.pixelsPerStep;
        const cf = grid.centerFront;
        await drag(
            page,
            await toScreen(page, { x: cf.x + 5 * S, y: cf.y - 25 * S }),
            await toScreen(page, { x: cf.x + 15 * S, y: cf.y - 19 * S }),
        );
        await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
        const { spots } = await openBox(page);
        expect(spots).not.toEqual(before.spots);
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
        await waitForIdle(page);
        expect(await undoSteps(show)).toBe(steps + 1);
        // The new box was placed here: the marchers stand on its spots at the playhead
        const onNewSpots = async () =>
            (await drawnMarchers(page)).every((m) =>
                spots.some((p) => Math.hypot(p.x - m.x, p.y - m.y) < 0.01),
            );
        await expect.poll(onNewSpots).toBe(true);
    });

test("change: playing hides an open box until it stops, and Visuals until the Editor is back; neither places it", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await drawBox(show);
    const before = await openBox(page);

    await page.keyboard.press("Space");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect(awayChip(page)).toBeHidden();
    // Stopping goes back to where Play was pressed: the box's moment
    await page.keyboard.press("Space");
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await openBox(page)).toEqual(before);

    await page.getByTestId("workspace-view-visuals").click();
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect(awayChip(page)).toBeHidden();
    await page.getByTestId("workspace-view-editor").click();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await openBox(page)).toEqual(before);

    await waitForIdle(page);
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await undoSteps(show)).toBe(steps);
});

test("change: changing the selection leaves an open box open for its own marchers, and Enter places only them", async ({
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
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await waitForIdle(page);
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect((await shapeOverlay(page))!.spots).toEqual(spots);

    await page.keyboard.press("Enter");
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

/** The latest recipe saved: its params and how many members it has */
async function latestRecipe(show: Show) {
    const [row] = await show.query<{ params: string; members: number }>(
        `SELECT r.params AS params,
            (SELECT COUNT(*) FROM timeline_shape_recipe_marchers m WHERE m.recipe_id = r.id) AS members
         FROM timeline_shape_recipes r ORDER BY r.id DESC LIMIT 1`,
    );
    return { params: JSON.parse(row.params), members: row.members };
}

/** Goes inside the placed box at marcher `id` and drags it `by` screen pixels, out of the box */
async function dragOutOfBox(page: Page, id: number, by: Point) {
    const at = await marcherScreen(page, id);
    // A click selects the box whole, then a double click goes inside it
    await page.mouse.click(at.x, at.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toContain(id);
    await page.mouse.dblclick(at.x, at.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([id]);
    await drag(page, at, { x: at.x + by.x, y: at.y + by.y });
    await waitForIdle(page);
}

// Close up (#392, spec #385): a placed shape that lost members keeps its holes
// until Close up, in the chip's ⋯ row and the inspector, lays it out again for
// the members left by least travel, as one undo step.
test("change: Close up shows only with holes, lays a box that lost two out for six as one undo step, and undo brings the holes back", async ({
    show,
}) => {
    const { page } = show;
    await placeBox(show);

    // No holes: no Close up
    const t1 = await marcherScreen(page, 1);
    await page.mouse.click(t1.x, t1.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.getByTestId("shape-editor-more").click();
    await expect(page.getByTestId("shape-editor-more-row")).toBeVisible();
    await expect(page.getByTestId("shape-editor-close-up")).toHaveCount(0);
    await expect(page.getByTestId("shape-section-close-up")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Two leave: their spots stay empty, and the toast offers Close up
    await dragOutOfBox(page, 7, { x: 0, y: 160 });
    await expect(
        toasts(page).filter({ hasText: "left the box" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await dragOutOfBox(page, 8, { x: 0, y: 160 });
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await latestRecipe(show)).members).toBe(6);
    expect((await latestRecipe(show)).params.spots).toBe(8);
    const holed = await savedPositions(show, 0);

    const t2 = await marcherScreen(page, 2);
    await page.mouse.click(t2.x, t2.y);
    const members = ALL.filter((id) => id !== 7 && id !== 8);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(members);
    await expect(page.getByTestId("placed-box-readout")).toContainText(
        "2 empty",
    );
    await expect(page.getByTestId("shape-section-close-up")).toBeVisible();
    const steps = await undoSteps(show);
    await page.getByTestId("shape-editor-more").click();
    await page.getByTestId("shape-editor-close-up").click();

    // Laid out for six: no holes left, everyone on a spot of the box
    await expect
        .poll(async () => (await latestRecipe(show)).params.spots)
        .toBe(6);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    expect((await latestRecipe(show)).members).toBe(6);
    await expect(page.getByTestId("placed-box-readout")).not.toContainText(
        "empty",
    );
    await expect(page.getByTestId("shape-section-close-up")).toHaveCount(0);
    const closed = await savedPositions(show, 0);
    // Each member stands on a spot of its own in the recipe saved
    const placed = await show.query<{
        marcher_id: number;
        slot: number;
        x: number;
        y: number;
    }>(
        `SELECT marcher_id, slot, x, y FROM timeline_shape_recipe_marchers
         WHERE recipe_id = (SELECT MAX(id) FROM timeline_shape_recipes)`,
    );
    expect(placed.map((m) => m.slot).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const m of placed) {
        const p = closed.find((c) => c.id === m.marcher_id)!;
        expect(Math.hypot(p.x - m.x, p.y - m.y)).toBeLessThan(CLOSE);
    }
    // The two who left stay where they went
    for (const id of [7, 8])
        expect(closed.find((p) => p.id === id)).toEqual(
            holed.find((p) => p.id === id),
        );

    // One undo puts the holes back
    await page.keyboard.press("ControlOrMeta+z");
    await expect
        .poll(async () => (await latestRecipe(show)).params.spots)
        .toBe(8);
    await expect.poll(() => savedPositions(show, 0)).toEqual(holed);
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
            await showPathways(show);
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
            await showPathways(show);
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

test("change: with a kind armed and nothing drawn yet, the Transform section shows the selection's controls", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    await page.keyboard.press("b");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    const section = page.getByTestId("transform-section");
    await expect(section).toBeVisible();
    await expect(
        section.getByRole("textbox", { name: "Rotation" }),
    ).toBeVisible();
    await expect(section.getByTestId("transform-flip-across")).toBeVisible();
    await expect(section.getByTestId("transform-scale-more")).toHaveCount(0);
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

test("change: handles snap spacings to half steps, Alt to hundredths, with a length readout while dragging, and a typed spacing keeps hundredths", async ({
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

    // With Alt: hundredths (#411)
    from = await se();
    await page.keyboard.down("Alt");
    await drag(page, from, { x: from.x + 13, y: from.y + 7 });
    await page.keyboard.up("Alt");
    const bar = page.getByTestId("shape-tool-readout");
    for (const id of ["shape-editor-across", "shape-editor-deep"]) {
        const text = await bar.getByTestId(id).innerText();
        expect(text).toMatch(/^\d+(\.\d{1,2})?$|^[\d½]+$/);
    }
    for (const s of await spacings(page))
        expect(Math.abs(s * 100 - Math.round(s * 100))).toBeLessThan(1e-6);

    // Typed, a spacing keeps its hundredths rather than going to half steps
    await page.getByTestId("shape-editor-across").click();
    await page.keyboard.type("2.37");
    await page.keyboard.press("Enter");
    await expect(bar.getByTestId("shape-editor-across")).toHaveText("2.37");
});

test("change: a typed 1 2/3 stays exactly 1⅔ steps and shows as 1⅔, − and + leave the box where it was, and Save keeps 2⅔ exactly (#423)", async ({
    show,
}) => {
    const { page } = show;
    const { grid } = await drawBox(show);
    const S = grid.pixelsPerStep;
    const bar = page.getByTestId("shape-tool-readout");
    /** The distinct gaps between neighbors side to side and front to back, in steps */
    const gaps = async () => {
        const { spots } = (await shapeOverlay(page))!;
        const apart = (vs: number[]) => {
            const sorted = [...new Set(vs.map((v) => v.toFixed(6)))]
                .map(Number)
                .sort((a, b) => a - b);
            return sorted.slice(1).map((v, i) => (v - sorted[i]) / S);
        };
        return {
            across: apart(spots.map((p) => p.x)),
            deep: apart(spots.map((p) => p.y)),
        };
    };
    const allClose = (vs: number[], want: number) => {
        expect(vs.length).toBeGreaterThan(0);
        for (const v of vs) expect(Math.abs(v - want)).toBeLessThan(1e-4);
    };

    await page.getByTestId("shape-editor-across").click();
    await page.keyboard.type("1 2/3");
    await page.keyboard.press("Enter");
    await expect(bar.getByTestId("shape-editor-across")).toHaveText("1⅔");
    allClose((await gaps()).across, 5 / 3);

    // − and + around the center come back to the same spots, not shifted a sixth of a step
    const before = (await shapeOverlay(page))!.spots;
    for (const more of [true, false, true, false, false, true])
        await sizeButton(page, more).click();
    const after = (await shapeOverlay(page))!.spots;
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
        expect(Math.abs(p.x - before[i].x)).toBeLessThan(1e-6);
        expect(Math.abs(p.y - before[i].y)).toBeLessThan(1e-6);
    });

    await page.getByTestId("shape-editor-deep").click();
    await page.keyboard.type("2⅔");
    await page.keyboard.press("Enter");
    await expect(bar.getByTestId("shape-editor-deep")).toHaveText("2⅔");
    allClose((await gaps()).deep, 8 / 3);

    // Saved, the show's copy keeps the intervals exactly, not as shown
    await page.getByTestId("shape-editor-more").click();
    await page.getByTestId("shape-editor-save").click();
    const name = page.getByTestId("shape-editor-save-name");
    await expect(name).toHaveValue("Box 1⅔ × 2⅔ apart");
    await page.keyboard.press("Enter");
    await expect
        .poll(
            async () =>
                (await show.query("SELECT id FROM saved_shapes")).length,
        )
        .toBe(1);
    const [{ intervals }] = await show.query<{ intervals: string }>(
        "SELECT intervals FROM saved_shapes",
    );
    const saved = JSON.parse(intervals) as { across: number; deep: number };
    expect(Math.abs(saved.across - 5 / 3)).toBeLessThan(1e-9);
    expect(Math.abs(saved.deep - 8 / 3)).toBeLessThan(1e-9);
});

test("change: stretching a box's side near a yard line lands its edge on the line, the spacing exactly what that takes, with a guide while dragging (#425)", async ({
    show,
}) => {
    const { page } = show;
    const { grid, pressed } = await drawBox(show);
    const S = grid.pixelsPerStep;
    const bar = page.getByTestId("shape-tool-readout");
    // 4 files from 15 steps left of the 50: the 45 on side 2 is 23 steps on, 7⅔ apart
    const yardLine = grid.centerFront.x + 8 * S;
    const overlay = (await shapeOverlay(page))!;
    const xs = overlay.spots.map((p) => p.x);
    const left = Math.min(...xs);
    expect(Math.abs(left - pressed.x)).toBeLessThan(CLOSE);
    const maxX = Math.max(...overlay.handles.map((h) => h.x));
    const east = overlay.handles
        .filter((h) => Math.abs(h.x - maxX) < 1)
        .sort((a, b) => a.y - b.y)[1]!;
    const target = await toScreen(page, { x: yardLine, y: grid.centerFront.y });

    let guides: { from: Point; to: Point }[] = [];
    let onGuides: Point[] = [];
    await drag(
        page,
        east,
        { x: target.x + 1, y: east.y },
        {
            beforeRelease: async () => {
                const during = await page.evaluate(
                    () => window.fieldTest!.shapeOverlay!()!,
                );
                guides = during.guides;
                onGuides = during.onGuides;
            },
        },
    );
    // While dragging, a guide along the yard line and the marchers on it tinted
    expect(
        guides.some(
            (g) =>
                Math.abs(g.from.x - yardLine) < CLOSE &&
                Math.abs(g.to.x - yardLine) < CLOSE,
        ),
    ).toBe(true);
    expect(onGuides.length).toBeGreaterThan(0);
    for (const p of onGuides)
        expect(Math.abs(p.x - yardLine)).toBeLessThan(CLOSE);

    await expect(bar.getByTestId("shape-editor-across")).toHaveText("7⅔");
    const after = (await shapeOverlay(page))!;
    const afterXs = after.spots.map((p) => p.x);
    // The left edge stayed, the right edge is on the line, and the guide cleared on release
    expect(Math.abs(Math.min(...afterXs) - left)).toBeLessThan(CLOSE);
    expect(Math.abs(Math.max(...afterXs) - yardLine)).toBeLessThan(CLOSE);
    expect(after.guides).toEqual([]);
});

test("change: clicking the picked kind in the Shapes tab closes the tool while nothing is drawn, and does nothing once a box is", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await page.getByRole("tab", { name: "Shapes" }).click();
    const box = page.getByTestId("shapes-tab-block");
    const hint = page.getByTestId("shape-tool-hint");

    // Armed with nothing drawn: a second click closes the tool
    await box.click();
    await expect(hint).toBeVisible();
    await box.click();
    await expect(hint).toBeHidden();
    await expect(box).toHaveAttribute("aria-pressed", "false");
    expect((await readField(page)).selection).toEqual(ALL);

    // Drawn: the click does nothing, and Escape still discards
    await box.click();
    await drag(
        page,
        await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
    );
    const drawn = (await shapeOverlay(page))!;
    await box.click();
    await expect(box).toHaveAttribute("aria-pressed", "true");
    expect((await shapeOverlay(page))!.spots).toEqual(drawn.spots);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
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

// How a shape is filled (#386, spec #385): the host's distributor lays the
// box out in Files, Short back, as it always was, and the recipe keeps the
// distribution. The inspector's mode switch offers Grid, Outline and Spread.

test("change: a placed box keeps its distribution, Files with the short rank at the back, and the mode switch shows Grid", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    await expect(page.getByTestId("shape-tool-section")).toBeVisible();
    await expect(page.getByTestId("shape-mode-files")).toHaveAttribute(
        "data-state",
        "on",
    );
    await expect(page.getByTestId("shape-mode-outline")).toBeVisible();
    const spots = (await shapeOverlay(page))!.spots;

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    // Everyone stands on a spot the open box showed
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) =>
                spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
            ),
        )
        .toBe(true);
    await waitForIdle(page);
    const [recipe] = await show.query<{ params: string }>(
        "SELECT params FROM timeline_shape_recipes",
    );
    const stored = JSON.parse(recipe.params);
    expect(stored.distribution).toEqual({
        mode: "files",
        layout: { family: "shortBack", files: stored.files, byFile: false },
        stagger: [0, 1],
    });
    expect(stored).not.toHaveProperty("pattern");

    // Selected again, the placed box is read back from its recipe, in Files
    await page.keyboard.press("Escape");
    const t1 = await marcherScreen(page, 1);
    await page.mouse.click(t1.x, t1.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(page.getByTestId("shape-mode-files")).toHaveAttribute(
        "data-state",
        "on",
    );
});

// Outline (#390): spots round the edge at the interval with one on every
// corner, in the space the box took up. An odd count takes one spot out of a
// side: by default the back spreads evenly; "Leaves a gap" shows the gap as a
// dashed ring, and a click on another spot between corners moves it there.

/**
 * Opens the box tool on T1–T7 (an odd count), draws a box, switches it to
 * Outline and picks "Leaves a gap". Checks its corners and that the gap starts
 * on the back, near its middle; returns the open outline, its edges and the
 * undo steps before.
 */
async function outlineOnSeven(show: Show) {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await clickMarcher(page, "T8", { add: true });
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL.slice(0, 7));
    await page.keyboard.press("b");
    await drag(
        page,
        await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
    );
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    const steps = await undoSteps(show);
    await page.getByTestId("shape-mode-outline").click();
    // The short side spreads evenly by default, with no gap to show; "Leaves
    // a gap" shows the gap
    await expect(page.getByTestId("outline-gap-spread")).toHaveAttribute(
        "data-state",
        "on",
    );
    expect((await shapeOverlay(page))!.gaps).toEqual([]);
    await page.getByTestId("outline-gap-gap").click();
    await expect
        .poll(async () => (await shapeOverlay(page))?.gaps.length)
        .toBe(1);

    const open = (await shapeOverlay(page))!;
    expect(open.spots).toHaveLength(7);
    const xs = open.outline!.map((p) => p.x);
    const ys = open.outline!.map((p) => p.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [back, front] = [Math.min(...ys), Math.max(...ys)];
    const isCorner = (p: Point) =>
        (Math.abs(p.x - left) < CLOSE || Math.abs(p.x - right) < CLOSE) &&
        (Math.abs(p.y - back) < CLOSE || Math.abs(p.y - front) < CLOSE);
    // Every corner has a marcher; the gap is on the back, near its middle
    for (const x of [left, right])
        for (const y of [back, front])
            expect(
                open.spots.some((s) => Math.hypot(s.x - x, s.y - y) < CLOSE),
            ).toBe(true);
    const [gap] = open.gaps;
    expect(gap!.y).toBeCloseTo(back, 3);
    const across = Math.min(
        ...open.spots
            .filter((s) => Math.abs(s.y - front) < CLOSE)
            .map((s, _, row) =>
                Math.min(
                    ...row
                        .filter((o) => o !== s)
                        .map((o) => Math.abs(o.x - s.x)),
                ),
            ),
    );
    expect(Math.abs(gap!.x - (left + right) / 2)).toBeLessThanOrEqual(
        across / 2 + CLOSE,
    );
    await expect(page.getByTestId("outline-gap-back")).toHaveAttribute(
        "data-state",
        "on",
    );
    return { open, gap: gap!, back, isCorner, steps };
}

test("change: Outline on 7 spreads the back by default, leaves its middle out on request, a click on a spot between corners moves the gap, and the placed box keeps it", async ({
    show,
}) => {
    const { page } = show;
    const { open, gap, back, isCorner, steps } = await outlineOnSeven(show);

    // A click on a spot between corners off the back moves the gap there
    const target = open.spots.find(
        (s) => !isCorner(s) && Math.abs(s.y - back) > CLOSE,
    )!;
    const at = await toScreen(page, target);
    await page.mouse.click(at.x, at.y);
    await expect
        .poll(async () => {
            const moved = (await shapeOverlay(page))!.gaps[0];
            return moved && Math.hypot(moved.x - target.x, moved.y - target.y);
        })
        .toBeLessThan(CLOSE);
    const moved = (await shapeOverlay(page))!;
    expect(moved.spots).toHaveLength(7);
    expect(
        moved.spots.some(
            (s) => Math.hypot(s.x - target.x, s.y - target.y) < CLOSE,
        ),
    ).toBe(false);
    // The old gap has a marcher again
    expect(
        moved.spots.some((s) => Math.hypot(s.x - gap!.x, s.y - gap!.y) < CLOSE),
    ).toBe(true);

    // "Spreads evenly" spreads that side and leaves no gap to show
    await page.getByTestId("outline-gap-spread").click();
    await expect
        .poll(async () => (await shapeOverlay(page))!.gaps.length)
        .toBe(0);
    expect((await shapeOverlay(page))!.spots).toHaveLength(7);
    // Undo brings the gap back
    await page.keyboard.press("ControlOrMeta+z");
    await expect
        .poll(async () => (await shapeOverlay(page))!.gaps.length)
        .toBe(1);

    // Placed, the recipe keeps the gap, and everyone stands on a spot
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    const [recipe] = await show.query<{ params: string }>(
        "SELECT params FROM timeline_shape_recipes",
    );
    const stored = JSON.parse(recipe.params);
    expect(stored.distribution.mode).toBe("outline");
    expect(stored.distribution.oddGap.style).toBe("gap");
    expect(stored.distribution.oddGap.side).not.toBe("back");
    const placed = (await savedPositions(show, 0)).filter((p) => p.id !== 8);
    expect(
        placed.every((p) =>
            spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
        ),
    ).toBe(true);
});

// Even spread (#391, spec #385): a scatter with no visible files, the closest
// pair one interval apart. Reshuffle in the chip and the inspector moves to the
// next seed as one undo step, and the recipe keeps the seed and generator.

/** The closest distance between any two spots */
const closestPair = (spots: readonly Point[]) =>
    Math.min(
        ...spots.flatMap((p, i) =>
            spots.slice(i + 1).map((q) => Math.hypot(q.x - p.x, q.y - p.y)),
        ),
    );

const sameSpots = (a: readonly Point[], b: readonly Point[]) =>
    a.length === b.length &&
    a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < CLOSE);

test("change: Spread scatters the box one interval apart, Reshuffle gives a new layout as one undo step, and the placed box reshuffles again", async ({
    show,
}) => {
    const { page } = show;
    const { grid } = await drawBox(show);
    const S = grid.pixelsPerStep;
    const steps = await undoSteps(show);
    const bar = page.getByTestId("shape-tool-readout");
    await expect(page.getByTestId("shape-editor-reshuffle")).toHaveCount(0);

    await page.getByTestId("shape-mode-spread").click();
    await expect(page.getByTestId("shape-mode-spread")).toHaveAttribute(
        "data-state",
        "on",
    );
    // A spread has no files or ranks: the chip shows its one spacing
    await expect(bar.getByTestId("shape-editor-size")).toHaveCount(0);
    await expect(bar.getByTestId("shape-editor-deep")).toHaveCount(0);
    // Steps as the chip writes them: "2", "1½", "½"
    const text = await bar.getByTestId("shape-editor-across").innerText();
    const across =
        Number(text.replace("½", "") || 0) + (text.includes("½") ? 0.5 : 0);
    const first = (await shapeOverlay(page))!.spots;
    expect(first).toHaveLength(ALL.length);
    expect(Math.abs(closestPair(first) - across * S)).toBeLessThan(CLOSE);

    // Reshuffle in the chip: a new layout, still one interval apart
    const reshuffle = bar.getByTestId("shape-editor-reshuffle");
    await expect(reshuffle).toHaveAttribute("data-seed", "1");
    await reshuffle.click();
    await expect(reshuffle).toHaveAttribute("data-seed", "2");
    const second = (await shapeOverlay(page))!.spots;
    expect(sameSpots(first, second)).toBe(false);
    expect(Math.abs(closestPair(second) - across * S)).toBeLessThan(CLOSE);

    // One undo step brings the first layout back, redo the second
    await page.keyboard.press("ControlOrMeta+z");
    await expect(reshuffle).toHaveAttribute("data-seed", "1");
    expect(sameSpots((await shapeOverlay(page))!.spots, first)).toBe(true);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(reshuffle).toHaveAttribute("data-seed", "2");
    expect(sameSpots((await shapeOverlay(page))!.spots, second)).toBe(true);

    // Enter places everyone on the spread as one undo step, its seed kept
    await page.keyboard.press("Enter");
    await expect(bar).toBeHidden();
    await expect.poll(() => onSpots(show, second)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    const recipeParams = async () => {
        const [recipe] = await show.query<{ params: string }>(
            "SELECT params FROM timeline_shape_recipes",
        );
        return JSON.parse(recipe.params);
    };
    expect((await recipeParams()).distribution).toEqual({
        mode: "spread",
        seed: 2,
        generator: 1,
        count: ALL.length,
    });

    // Selected again, it reopens in Spread at its seed; the inspector's
    // Reshuffle saves the next layout as one undo step
    await page.keyboard.press("Escape");
    const t1 = await marcherScreen(page, 1);
    await page.mouse.click(t1.x, t1.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(page.getByTestId("shape-mode-spread")).toHaveAttribute(
        "data-state",
        "on",
    );
    const again = page.getByTestId("shape-section-reshuffle");
    await expect(again).toHaveAttribute("data-seed", "2");
    await again.click();
    await expect
        .poll(async () => (await recipeParams()).distribution.seed)
        .toBe(3);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 2);
    // The marchers moved to the new layout
    await expect.poll(() => onSpots(show, second)).toBe(false);
});

// The box's layouts (#387, spec #385; owner lab feedback 2026-10-23): the
// inspector lists Full · Stagger · Rounded · Short back · Notched with live
// thumbnails, a layout the count can't make greyed in its place with what it
// needs; a layout menu sits under the chip, and ↻ beside the size turns the box
// a quarter. Picking a version lays the box out in it, the recipe keeps it, and
// the next box starts in it.

/** How many spots stand on each line across, back first */
const rankCounts = (spots: readonly Point[]) => {
    const by = new Map<number, number>();
    for (const s of spots) {
        const y = Math.round(s.y * 100) / 100;
        by.set(y, (by.get(y) ?? 0) + 1);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
};

test("change: the layout picker lays the box out in the version picked, the recipe keeps it, and the next box starts in it", async ({
    show,
}) => {
    const { page } = show;
    await page.evaluate(() =>
        localStorage.removeItem("openmarch:shapeLastLayout"),
    );
    await drawBox(show);
    const picker = page.getByTestId("shape-layout-picker");
    await expect(picker).toBeVisible();
    // 8 marchers: every layout but Notched, which stays in its place greyed
    // with what would make it
    await expect(page.getByTestId("shape-layout-row-full")).toBeVisible();
    await expect(
        page.getByTestId("shape-layout-notched-missing"),
    ).toBeDisabled();
    await expect(page.getByTestId("shape-layout-notched-missing")).toHaveText(
        "add 2",
    );
    const stagger = page.getByTestId("shape-layout-stagger-0");
    await expect(stagger).toHaveText("3 × 3");
    await expect(stagger).toHaveAttribute(
        "title",
        "Stagger 3 × 3: 3 / 2 / 3, front to back",
    );
    await expect(stagger).toHaveAttribute("aria-pressed", "false");

    await stagger.click();
    await expect(stagger).toHaveAttribute("aria-pressed", "true");
    const bar = page.getByTestId("shape-tool-readout");
    await expect(bar.getByTestId("shape-editor-size")).toHaveText("3 × 3");
    await expect(bar.getByTestId("shape-layout-menu")).toHaveText(/Stagger/);
    const spots = (await shapeOverlay(page))!.spots;
    expect(spots).toHaveLength(8);
    expect(rankCounts(spots)).toEqual([3, 2, 3]);

    await page.keyboard.press("Enter");
    await expect(bar).toBeHidden();
    await waitForIdle(page);
    const [recipe] = await show.query<{ params: string }>(
        "SELECT params FROM timeline_shape_recipes",
    );
    expect(JSON.parse(recipe.params).distribution).toEqual({
        mode: "files",
        layout: { family: "stagger", files: 3, byFile: false },
        stagger: [0, 1],
    });
    // Everyone stands on a spot the open box showed
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) =>
                spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
            ),
        )
        .toBe(true);

    // The next box starts in the layout picked last
    await page.keyboard.press("Escape");
    await drawBox(show);
    await expect(page.getByTestId("shape-layout-stagger-0")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    expect(rankCounts((await shapeOverlay(page))!.spots)).toEqual([3, 2, 3]);
});

test("change: the layout menu under the chip switches layout, ↻ turns the box a quarter, and undo puts each back", async ({
    show,
}) => {
    const { page } = show;
    await page.evaluate(() =>
        localStorage.removeItem("openmarch:shapeLastLayout"),
    );
    await drawBox(show);
    const bar = page.getByTestId("shape-tool-readout");
    const before = (await shapeOverlay(page))!.spots;
    await bar.getByTestId("shape-layout-menu").click();
    const menu = page.getByTestId("shape-layout-menu-content");
    await expect(menu).toBeVisible();
    // Every layout in its place; Notched greyed with what it needs for 8
    await expect(
        menu.getByTestId("shape-layout-menu-row-notched"),
    ).toBeDisabled();
    await expect(menu.getByTestId("shape-layout-menu-row-notched")).toHaveText(
        /add 2/,
    );
    // Hovering a layout shows its versions beside the list
    await menu.getByTestId("shape-layout-menu-row-rounded").hover();
    await menu.getByTestId("shape-layout-menu-version-rounded-0").click();
    await expect(menu).toBeHidden();
    await expect(bar.getByTestId("shape-layout-menu")).toHaveText(/Rounded/);
    expect(rankCounts((await shapeOverlay(page))!.spots)).toEqual([2, 4, 2]);
    await expect(bar.getByTestId("shape-editor-size")).toHaveText("4 × 3");

    // ↻ turns it a quarter: the deep version, without the ⋯ row
    await bar.getByTestId("shape-editor-quarter-turn").click();
    await expect(bar.getByTestId("shape-editor-size")).toHaveText("3 × 4");
    expect(rankCounts((await shapeOverlay(page))!.spots)).toEqual([1, 3, 3, 1]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(bar.getByTestId("shape-editor-size")).toHaveText("4 × 3");
    await page.keyboard.press("ControlOrMeta+z");
    await expect
        .poll(async () => (await shapeOverlay(page))!.spots)
        .toEqual(before);
});

// The size number's − and + (owner lab feedback on #387; the owner picked
// center + glide in the lab): the box grows about its center without creeping,
// and the marchers glide to their new spots rather than jump.

const sizeButton = (page: Page, more: boolean) =>
    page.getByTestId("shape-tool-readout").getByRole("button", {
        name: more ? "One more across" : "One fewer across",
    });

test("change: − and + come back to the same spots, so the box doesn't creep", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const before = (await shapeOverlay(page))!.spots;
    for (const more of [true, true, false, false, false, true]) {
        await sizeButton(page, more).click();
    }
    await expect
        .poll(async () => (await shapeOverlay(page))!.spots)
        .toEqual(before);
});

test.describe("the glide", () => {
    /** Presses + and reads the drawing 40 ms later, in one go, while a glide would still run */
    const plusAndPeek = (page: Page) =>
        page.evaluate(async () => {
            const plus = [...document.querySelectorAll("button")].find(
                (b) => b.getAttribute("aria-label") === "One more across",
            )!;
            plus.click();
            await new Promise((r) => setTimeout(r, 40));
            return window.fieldTest!.shapeOverlay!()!;
        });

    test("change: after + the marchers slide to their new spots rather than jump", async ({
        show,
    }) => {
        const { page } = show;
        await drawBox(show);
        const before = (await shapeOverlay(page))!.spots;
        const mid = await plusAndPeek(page);
        expect(mid.gliding).toBe(true);
        const after = (await shapeOverlay(page))!.spots;
        expect(after).not.toEqual(before);
        // Part way: neither where they were nor where they land
        expect(mid.spots).not.toEqual(after);
        expect(mid.spots).not.toEqual(before);
    });

    test("change: with reduced motion asked for, the marchers go straight to their new spots", async ({
        show,
    }) => {
        const { page } = show;
        await page.emulateMedia({ reducedMotion: "reduce" });
        await drawBox(show);
        const mid = await plusAndPeek(page);
        expect(mid.gliding).toBe(false);
        expect(mid.spots).toEqual((await shapeOverlay(page))!.spots);
    });
});

// The pivot on the field (#350): Cmd/Ctrl-drag from the center dot pulls it
// out into a yellow crosshair, it snaps to marchers, turns go around it, it is
// saved with the box, and a double click sends it back to the center.

const near = (a: Point, b: Point, px = 1.5) =>
    Math.hypot(a.x - b.x, a.y - b.y) <= px;

test("change: Cmd/Ctrl-drag from the center dot pulls the pivot out onto a marcher, turns go around it, and the placed box keeps it until a double click", async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const section = page.getByTestId("transform-section");
    let overlay = (await shapeOverlay(page))!;
    expect(overlay.pivotMark).toBeNull();
    const center = overlay.centerDot!;

    // A plain drag on the center dot would move the box; with Ctrl/Cmd it
    // pulls the pivot out, and it snaps onto T1 near where it's let go
    const t1 = await marcherScreen(page, 1);
    await page.keyboard.down("ControlOrMeta");
    await drag(page, center, { x: t1.x + 3, y: t1.y - 2 });
    await page.keyboard.up("ControlOrMeta");
    overlay = (await shapeOverlay(page))!;
    expect(near(overlay.pivotMark!, t1)).toBe(true);
    expect(near(overlay.centerDot!, center)).toBe(true);
    // Off the grid's 9 points, so none of them is lit
    await expect(section.locator('[aria-checked="true"]')).toHaveCount(0);

    // A quarter turn swings the box around T1; the crosshair stays put
    await section.getByTestId("transform-rotation").click();
    await page.getByTestId("transform-rotation-input").fill("90");
    await page.getByTestId("transform-rotation-input").press("Enter");
    overlay = (await shapeOverlay(page))!;
    expect(near(overlay.pivotMark!, t1)).toBe(true);
    const swung = {
        x: t1.x - (center.y - t1.y),
        y: t1.y + (center.x - t1.x),
    };
    expect(near(overlay.centerDot!, swung, 3)).toBe(true);

    // Placed, the recipe keeps the pivot
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);
    const stored = async () => {
        const [recipe] = await show.query<{ params: string }>(
            "SELECT params FROM timeline_shape_recipes",
        );
        return JSON.parse(recipe.params).pivot;
    };
    expect(typeof (await stored())).toBe("object");
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);

    // Selected again, its pivot is where it was left
    const member = await marcherScreen(page, 2);
    await page.mouse.click(member.x, member.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect
        .poll(async () => {
            const mark = (await shapeOverlay(page))?.pivotMark;
            return mark != null && near(mark, t1);
        })
        .toBe(true);

    // A double click on it sends it back to the center, saved as one step
    const steps = await undoSteps(show);
    await page.mouse.dblclick(t1.x, t1.y);
    await expect
        .poll(async () => (await shapeOverlay(page))?.pivotMark ?? null)
        .toBeNull();
    await expect.poll(stored).toBeUndefined();
    expect(await undoSteps(show)).toBe(steps + 1);
    await expect(section.getByTestId("transform-pivot-c")).toHaveAttribute(
        "aria-checked",
        "true",
    );
});

// The command bar (#354): `/` and ⌘K open one bar; Shape › Box docks it at the
// top of the field and asks the box's numbers one at a time, the box showing
// live on the field.

const bar = (page: Page) => page.getByTestId("docked-command-bar");
const answer = (page: Page) => page.getByTestId("docked-command-input");
const question = (page: Page) => bar(page).locator("label");

test("change: / opens the command bar, and Shape › Box asks each number with a default while the box shows live", async ({
    show,
}) => {
    const { page } = show;
    const steps = await undoSteps(show);
    await selectAll(page);
    await page.keyboard.press("/");
    await page.getByRole("combobox").fill("box");
    await expect(page.getByRole("option").first()).toHaveText(/^Shape › Box/);
    await page.keyboard.press("Enter");

    // Docked, not the centered palette, and the box is already on the field.
    // How it's filled comes first (#390): Enter keeps Grid
    await expect(bar(page)).toBeVisible();
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(question(page)).toHaveText(/^Fill/);
    await expect(answer(page)).toHaveValue("Grid");
    await page.keyboard.press("Enter");
    await expect(question(page)).toHaveText(/^Size/);
    const size = await answer(page).inputValue();
    expect(size).toMatch(/^\d+ × \d+$/);
    expect((await shapeOverlay(page))!.spots).toHaveLength(ALL.length);
    expect(await readout(page)).toBe(`${size} · 2 × 2 steps`);

    // Each keystroke shows on the field
    await answer(page).fill("4x2");
    await expect.poll(() => readout(page)).toBe("4 × 2 · 2 × 2 steps");
    await page.keyboard.press("Enter");
    await expect(question(page)).toHaveText(/^Side-to-side/);
    await expect(answer(page)).toHaveValue("2");
    await answer(page).fill("3");
    await expect.poll(() => readout(page)).toBe("4 × 2 · 3 × 2 steps");

    // Backspace in an empty answer goes back a step, keeping its answer
    await answer(page).fill("");
    await page.keyboard.press("Backspace");
    await expect(question(page)).toHaveText(/^Size/);
    await expect(answer(page)).toHaveValue("4x2");
    await page.keyboard.press("Enter");
    await answer(page).fill("3");
    await page.keyboard.press("Enter");
    await expect(question(page)).toHaveText(/^Front-to-back/);

    // Last, the layout (#387), as the picker labels it
    await page.keyboard.press("Enter");
    await expect(question(page)).toHaveText(/^Layout/);
    await expect(answer(page)).toHaveValue("Full 4 × 2");

    // The show is untouched until the last answer, which places the box as one undo step
    expect(await readout(page)).toBe("4 × 2 · 3 × 2 steps");
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, spots)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
});

test('change: a one-liner such as "box 4x2 3" fills the answers ahead and shows them at once, and Escape puts back the box that was open', async ({
    show,
}) => {
    const { page } = show;
    await drawBox(show);
    const numbers = await readout(page);
    const spots = (await shapeOverlay(page))!.spots;

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("box 4x2 3");
    await expect(page.getByRole("option").first()).toHaveText(
        /^Shape › Box 4x2 · 3/,
    );
    await page.keyboard.press("Enter");
    // Opens at the first step it didn't fill, with everything it did fill on the field. Started
    // from the open box: its depth spacing is its own
    await expect(question(page)).toHaveText(/^Front-to-back/);
    const deep = numbers.split(" × ").at(-1);
    await expect.poll(() => readout(page)).toBe(`4 × 2 · 3 × ${deep}`);

    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
    // The box drawn before, as it was, still open
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    expect(await readout(page)).toBe(numbers);
    expect((await shapeOverlay(page))!.spots).toEqual(spots);
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
});

test("change: with nobody selected, Shape › Box is greyed out with why", async ({
    show,
}) => {
    const { page } = show;
    await page.keyboard.press("/");
    await page.getByRole("combobox").fill("box");
    const box = page.getByRole("option").filter({ hasText: /^Shape › Box/ });
    await expect(box).toHaveAttribute("aria-disabled", "true");
    await expect(box).toContainText("Select marchers first");
    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeHidden();
});

test("the Shapes tab lists the kinds, greyed out until marchers are selected; picking Box arms it, a drag draws it and Enter places it", async ({
    show,
}) => {
    const { page } = show;
    await showPathways(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await page.getByRole("tab", { name: "Shapes" }).click();
    const box = page.getByTestId("shapes-tab-block");
    // A picture only, drawn from the box's own spots (#378); the name is its label
    await expect(box).toHaveText("");
    await expect(box).toHaveAccessibleName("Box");
    await expect(box.getByTestId("shape-preview")).toHaveAttribute(
        "data-spots",
        "9",
    );

    // Nobody selected: greyed out, and it says why, naming the shape on hover
    expect((await readField(page)).selection).toEqual([]);
    await expect(box).toBeDisabled();
    await expect(page.getByTestId("shapes-tab-reason")).toHaveText(
        "Select marchers first",
    );
    await expect(box.locator("..")).toHaveAttribute(
        "title",
        "Box: Select marchers first",
    );

    await selectAll(page);
    await expect(box).toBeEnabled();
    await expect(page.getByTestId("shapes-tab-reason")).toBeHidden();
    await expect(box).toHaveAttribute("aria-pressed", "false");
    await expect(box).toHaveAttribute("title", /Box.*\bB\b/);

    // Picking it arms the box: the field draws it on the next drag
    await box.click();
    await expect(box).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    expect((await readField(page)).activeGesture).toBe("shape");
    await drag(
        page,
        await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
    );
    const drawn = (await shapeOverlay(page))!;
    expect(drawn.spots).toHaveLength(ALL.length);
    expect(await readout(page)).toMatch(/^4 × 2 · /);

    // Picking the open kind again keeps the shape
    await box.click();
    expect((await shapeOverlay(page))!.spots).toEqual(drawn.spots);

    // Enter places it, even after the tab's button was clicked
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect(box).toHaveAttribute("aria-pressed", "false");
    await expect
        .poll(async () =>
            (await savedPositions(show, 0)).every((p) =>
                drawn.walks.some(
                    (w) => Math.hypot(w.to.x - p.x, w.to.y - p.y) < CLOSE,
                ),
            ),
        )
        .toBe(true);
});

// The favorites ring (#351): hold R around the cursor and let go over a shape
// to arm it, or tap R to keep it open until a click. It holds the starred
// shapes, then the basic kinds.
const ring = (page: Page) => page.getByTestId("shape-ring");
const ringSlot = (page: Page, id: string) =>
    page.getByTestId(`shape-ring-slot-${id}`);

/** Puts the pointer on the field, where the ring opens around it */
async function pointAtField(show: Show): Promise<Point> {
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const at = await toScreen(show.page, {
        x: grid.centerFront.x,
        y: grid.centerFront.y - 20 * S,
    });
    await show.page.mouse.move(at.x, at.y);
    return at;
}

test("holding R opens the ring around the cursor; sliding to Box and letting go arms it", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    const at = await pointAtField(show);
    await page.keyboard.down("r");
    await expect(ring(page)).toBeVisible();
    await expect(ring(page)).toHaveAttribute("data-latched", "false");
    // Opened around the cursor
    const center = (await page.getByTestId("shape-ring-center").boundingBox())!;
    expect(
        Math.hypot(
            center.x + center.width / 2 - at.x,
            center.y + center.height / 2 - at.y,
        ),
    ).toBeLessThan(4);
    const box = ringSlot(page, "block");
    await expect(box).toHaveText("Box");
    // The same picture as the Shapes tab (#378)
    await expect(box.getByTestId("shape-preview")).toHaveAttribute(
        "data-spots",
        "9",
    );
    await expect(box).toHaveAttribute("data-hot", "false");

    await page.mouse.move(at.x, at.y - 90, { steps: 4 });
    await expect(box).toHaveAttribute("data-hot", "true");
    await page.keyboard.up("r");
    await expect(ring(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    expect((await readField(page)).activeGesture).toBe("shape");
});

/** Where the ring's aim line runs, from and to, in window pixels */
async function aimLine(page: Page) {
    const line = page.getByTestId("shape-ring-aim");
    const read = async (name: string) => Number(await line.getAttribute(name));
    return {
        from: { x: await read("x1"), y: await read("y1") },
        to: { x: await read("x2"), y: await read("y2") },
    };
}

test("a line runs from the ring's center to the pointer and follows it, held or latched (#379)", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    const at = await pointAtField(show);
    await page.keyboard.down("r");
    await expect(ring(page)).toBeVisible();
    const center = (await page.getByTestId("shape-ring-center").boundingBox())!;
    const middle = {
        x: center.x + center.width / 2,
        y: center.y + center.height / 2,
    };
    const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const near = (a: Point, b: Point) => expect(gap(a, b)).toBeLessThan(4);

    const opened = await aimLine(page);
    near(opened.from, middle);
    near(opened.to, at);

    // Off toward a corner, past the slots: it still follows, and Box lights up
    await page.mouse.move(at.x + 40, at.y - 200, { steps: 4 });
    await expect
        .poll(async () =>
            gap((await aimLine(page)).to, { x: at.x + 40, y: at.y - 200 }),
        )
        .toBeLessThan(1);
    near((await aimLine(page)).from, middle);
    await expect(ringSlot(page, "block")).toHaveAttribute("data-hot", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.up("r");
    await expect(ring(page)).toBeHidden();

    // A latched ring has it too
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press("r");
    await expect(ring(page)).toHaveAttribute("data-latched", "true");
    await page.mouse.move(at.x - 70, at.y + 30, { steps: 3 });
    await expect
        .poll(async () =>
            gap((await aimLine(page)).to, { x: at.x - 70, y: at.y + 30 }),
        )
        .toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-ring-aim")).toBeHidden();
});

test("tapping R keeps the ring open: a click away dismisses it, a click on Box arms it, and Escape closes it before the shape", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    const at = await pointAtField(show);

    // The Shapes tab says how to open the ring
    await page.getByRole("tab", { name: "Shapes" }).click();
    await expect(page.getByTestId("shapes-tab-ring-hint")).toHaveText(
        "Hold R on the field for the shape ring",
    );
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press("r");
    await expect(ring(page)).toHaveAttribute("data-latched", "true");
    await expect(page.getByTestId("shape-ring-hint")).toBeVisible();
    // A click away dismisses it, and doesn't reach the field
    await page.mouse.click(at.x + 300, at.y + 200);
    await expect(ring(page)).toBeHidden();
    expect((await readField(page)).selection).toEqual(ALL);
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();

    await page.mouse.move(at.x, at.y);
    await page.keyboard.press("r");
    await ringSlot(page, "block").click();
    await expect(ring(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();

    // With the box armed, Escape closes the ring first and keeps the shape
    await page.keyboard.press("r");
    await expect(ring(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ring(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();
});

test("change: every shortcut is in the command palette: the ring opens latched from it, nudges are listed, and Shape › Box shows B", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);
    await pointAtField(show);
    const palette = page.getByRole("combobox");

    // The ring, from the palette: latched, as a tap of R leaves it
    await page.keyboard.press("ControlOrMeta+k");
    await palette.fill("favorites ring");
    await expect(page.getByRole("option").first()).toHaveText(
        /^Favorites ring/,
    );
    await page.keyboard.press("Enter");
    await expect(ring(page)).toHaveAttribute("data-latched", "true");
    await ringSlot(page, "block").click();
    await expect(ring(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();

    // A nudge, with its key
    await page.keyboard.press("ControlOrMeta+k");
    await palette.fill("nudge up");
    await expect(page.getByRole("option").first()).toHaveText(/^Nudge up.*W$/);

    // Box and Circle are Shape › Box and Shape › Circle, with their keys
    await palette.fill("box");
    const shapeBox = page
        .getByRole("option")
        .filter({ hasText: /^Shape › Box/ })
        .first();
    await expect(shapeBox).toHaveText(/B$/);
    await palette.fill("circle");
    await expect(
        page
            .getByRole("option")
            .filter({ hasText: /^Shape › Circle/ })
            .first(),
    ).toHaveText(/O$/);
    await page.keyboard.press("Escape");
});

test("with nobody selected the ring's shapes are greyed out and say why, and letting go over one picks nothing", async ({
    show,
}) => {
    const { page } = show;
    expect((await readField(page)).selection).toEqual([]);
    const at = await pointAtField(show);
    await page.keyboard.down("r");
    const box = ringSlot(page, "block");
    await expect(box).toBeDisabled();
    await expect(page.getByTestId("shape-ring-reason")).toHaveText(
        "Select marchers first",
    );
    await page.mouse.move(at.x, at.y - 90, { steps: 4 });
    await page.keyboard.up("r");
    await expect(ring(page)).toBeHidden();
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();
    expect((await readField(page)).activeGesture).not.toBe("shape");
});

test.describe("with the ring rebound to J", () => {
    test.use({
        initScript: `localStorage.setItem("openmarch:shortcutOverrides", ${JSON.stringify(
            JSON.stringify({ openShapeRing: ["J"] }),
        )});`,
    });

    test("J opens the ring and R no longer does", async ({ show }) => {
        const { page } = show;
        await selectAll(page);
        await pointAtField(show);
        await page.keyboard.press("r");
        await expect(ring(page)).toBeHidden();
        await page.keyboard.press("j");
        await expect(ring(page)).toHaveAttribute("data-latched", "true");
        await page.keyboard.press("Escape");
        await page.getByRole("tab", { name: "Shapes" }).click();
        await expect(page.getByTestId("shapes-tab-ring-hint")).toHaveText(
            "Hold J on the field for the shape ring",
        );
    });
});

// The shape library (#352): a Shapes entry in the left sidebar lists the basic
// kinds; a star puts a shape in the Shapes tab and the ring, for this user
// across shows and restarts. The ninth-star question is a component test
// (ShapeLibraryPanel.test.tsx): with one basic kind, nine can't be starred here.
test("the Shapes tab's Library button opens the library; a star puts Box in the tab and the ring, and it's kept after a reload", async ({
    show,
}) => {
    const { page } = show;
    const shapesTab = () => page.getByRole("tab", { name: "Shapes" }).click();
    await shapesTab();
    await expect(page.getByTestId("shapes-tab-starred-block")).toHaveCount(0);

    await page.getByTestId("shapes-tab-library").click();
    const library = page.getByTestId("shape-library");
    await expect(library).toBeVisible();
    const row = page.getByTestId("shape-library-row-block");
    await expect(row).toContainText("Box");
    await expect(row).toContainText("2 apart");
    const star = page.getByTestId("shape-library-star-block");
    await expect(star).toHaveAttribute("aria-pressed", "false");

    // Before any star the ring's Box only fills an empty slot. R again
    // closes the tapped ring (Escape would also close the sidebar)
    await selectAll(page);
    await pointAtField(show);
    await page.keyboard.press("r");
    await expect(ringSlot(page, "block")).toHaveAttribute(
        "data-starred",
        "false",
    );
    await page.keyboard.press("r");
    await expect(ring(page)).toBeHidden();

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");

    // In the ring, marked as starred
    await pointAtField(show);
    await page.keyboard.press("r");
    await expect(ringSlot(page, "block")).toHaveAttribute(
        "data-starred",
        "true",
    );
    await page.keyboard.press("r");
    await expect(ring(page)).toBeHidden();

    // In the Shapes tab after the divider, and picking it arms the box
    const starred = page.getByTestId("shapes-tab-starred-block");
    await expect(starred).toHaveAccessibleName("Box");
    await starred.click();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();

    // The star is the user's, so it outlasts a reload
    await page.reload();
    await waitForField(page);
    await shapesTab();
    await expect(page.getByTestId("shapes-tab-starred-block")).toBeVisible();
    await page.getByTestId("shape-library-tab").click();
    await expect(star).toHaveAttribute("aria-pressed", "true");

    // Unstarring takes it out of the tab again
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("shapes-tab-starred-block")).toHaveCount(0);
});

// Saved shapes (#353): ☆ Save keeps a shape's kind and spacing, not its size
// or count, starred, in the user's library and in the show; picked for another
// selection it draws at its spacing, and the show keeps its copy for a machine
// whose library doesn't have it.
/**
 * Draws a box on everyone, sets its spacing to 2½ × 1½ and saves it from the
 * ⋯ row as "Wide box", leaving it open. Returns the saved shape's id.
 */
async function saveWideBox(show: Show): Promise<string> {
    const { page } = show;
    await drawBox(show);
    await page.getByTestId("shape-editor-across").click();
    await page.keyboard.type("2.5");
    await page.keyboard.press("Enter");
    await expect.poll(() => readout(page)).toBe("4 × 2 · 2½ × 6 steps");
    await page.getByTestId("shape-editor-deep").click();
    await page.keyboard.type("1.5");
    await page.keyboard.press("Enter");
    await expect.poll(() => readout(page)).toBe("4 × 2 · 2½ × 1½ steps");

    // Save asks for a name, offering the kind and its spacing
    await page.getByTestId("shape-editor-more").click();
    await page.getByTestId("shape-editor-save").click();
    const name = page.getByTestId("shape-editor-save-name");
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Box 2½ × 1½ apart");
    await name.fill("Wide box");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-editor-save")).toHaveText(
        "Saved as Wide box",
    );
    // Enter named it: the box is still open
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();

    // The show keeps a copy: the kind and its intervals, no size or count
    await expect
        .poll(() =>
            show.query<{ name: string; kind: string; intervals: string }>(
                "SELECT name, kind, intervals FROM saved_shapes",
            ),
        )
        .toEqual([
            {
                name: "Wide box",
                kind: "block",
                intervals: JSON.stringify({ across: 2.5, deep: 1.5 }),
            },
        ]);
    const [{ id }] = await show.query<{ id: string }>(
        "SELECT id FROM saved_shapes",
    );
    return id;
}

test("change: ☆ Save keeps a box's spacing as a starred saved shape that draws at that spacing on another selection, and the show keeps a copy", async ({
    show,
}) => {
    const { page } = show;
    const id = await saveWideBox(show);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();

    // Starred: it's in the Shapes tab. Picked for five marchers, a drag draws
    // a box of five at the saved spacing
    await page.keyboard.press("Escape");
    for (const [i, drill] of ["T1", "T2", "T3", "T4", "T5"].entries())
        await clickMarcher(page, drill, { add: i > 0 });
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([1, 2, 3, 4, 5]);
    await page.getByRole("tab", { name: "Shapes" }).click();
    const starred = page.getByTestId(`shapes-tab-starred-${id}`);
    await expect(starred).toHaveAccessibleName("Wide box");
    // Its picture is drawn at its own spacing, so it isn't the plain box's (#378)
    const picture = (id: string) =>
        page.getByTestId(id).getByTestId("shape-preview").innerHTML();
    expect(await picture(`shapes-tab-starred-${id}`)).not.toBe(
        await picture("shapes-tab-block"),
    );
    await starred.click();
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await drag(
        page,
        await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
        await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
    );
    expect((await shapeOverlay(page))!.spots).toHaveLength(5);
    await expect.poll(() => readout(page)).toMatch(/ · 2½ × 1½ steps$/);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    // An ordinary box recipe: it reopens without the saved shape
    await expect
        .poll(async () =>
            (
                await show.query<{ kind: string }>(
                    "SELECT kind FROM timeline_shape_recipes",
                )
            ).map((r) => r.kind),
        )
        .toEqual(["block"]);

    // On a machine whose library doesn't have it, the show still lists it,
    // and it can be deleted there
    await page.evaluate(() => localStorage.removeItem("openmarch:savedShapes"));
    await page.reload();
    await waitForField(page);
    await page.getByTestId("shape-library-tab").click();
    const row = page.getByTestId(`shape-library-row-${id}`);
    await expect(row).toContainText("Wide box");
    await expect(row).toContainText("Box · 2½ × 1½ apart · this show only");
    await page.getByTestId(`shape-library-delete-${id}`).click();
    await expect(row).toHaveCount(0);
    await expect
        .poll(() => show.query("SELECT id FROM saved_shapes"))
        .toEqual([]);
    await expect(page.getByTestId("shape-library-saved-empty")).toBeVisible();
});

test("change: ☆ Save at the bottom of the inspector's shape section saves a selected placed box, starred in the library", async ({
    show,
}) => {
    const { page } = show;
    await placeBox(show);
    const t3 = await marcherScreen(page, 3);
    await page.mouse.click(t3.x, t3.y);
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();

    const section = page.getByTestId("shape-tool-section");
    await section.getByTestId("shape-section-save").click();
    const name = section.getByTestId("shape-section-save-name");
    await expect(name).toBeFocused();
    await name.fill("Placed box");
    await section.getByTestId("shape-section-save-confirm").click();
    await expect(section.getByTestId("shape-section-save")).toHaveText(
        "Saved as Placed box",
    );

    await expect
        .poll(() => show.query("SELECT name FROM saved_shapes"))
        .toEqual([{ name: "Placed box" }]);
    const [{ id }] = await show.query<{ id: string }>(
        "SELECT id FROM saved_shapes",
    );
    await page.getByTestId("shape-library-tab").click();
    await expect(page.getByTestId(`shape-library-row-${id}`)).toContainText(
        "Placed box",
    );
    await expect(page.getByTestId(`shape-library-star-${id}`)).toHaveAttribute(
        "aria-pressed",
        "true",
    );
});

// Saved shapes keep a description, how they're filled and their dates (#393):
// saved with a description, the show's copy has them all, and on a machine
// whose library doesn't have it the library lists it with its description and
// can take it in, dates and all.
test("change: a box saved with a description reopens from the show's copy with its description, distribution and dates", async ({
    show,
}) => {
    const { page } = show;
    await placeBox(show);
    const t3 = await marcherScreen(page, 3);
    await page.mouse.click(t3.x, t3.y);
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();

    const section = page.getByTestId("shape-tool-section");
    await section.getByTestId("shape-section-save").click();
    const name = section.getByTestId("shape-section-save-name");
    await expect(name).toBeFocused();
    await name.fill("Opener block");
    const description = "Company front for the opener, then into the arc";
    await section
        .getByTestId("shape-section-save-description")
        .fill(description);
    await page.keyboard.press("Enter");
    await expect(section.getByTestId("shape-section-save")).toHaveText(
        "Saved as Opener block",
    );

    type Row = {
        id: string;
        description: string | null;
        distribution: string | null;
        created_at: string;
        updated_at: string;
    };
    await expect
        .poll(
            async () =>
                (await show.query<Row>("SELECT * FROM saved_shapes")).length,
        )
        .toBe(1);
    const [copy] = await show.query<Row>("SELECT * FROM saved_shapes");
    expect(copy.description).toBe(description);
    // Files, Short back: the layout without its size
    expect(JSON.parse(copy.distribution!)).toEqual({
        mode: "files",
        layout: { family: "shortBack", byFile: false },
        stagger: [0, 1],
    });
    expect(copy.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(copy.updated_at).toBe(copy.created_at);

    // Another machine: my library doesn't have it, the show's copy does
    await page.evaluate(() => localStorage.removeItem("openmarch:savedShapes"));
    await page.reload();
    await waitForField(page);
    await page.getByTestId("shape-library-tab").click();
    const row = page.getByTestId(`shape-library-row-${copy.id}`);
    await expect(row).toContainText("Opener block");
    await expect(row).toContainText("this show only");
    const shown = page.getByTestId(`shape-library-description-${copy.id}`);
    await expect(shown).toHaveText(description);
    await expect(shown).toHaveAttribute("title", description);

    // Taken into my library, it keeps the description and dates
    await page.getByTestId(`shape-library-add-${copy.id}`).click();
    await expect(row).not.toContainText("this show only");
    const library = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("openmarch:savedShapes") ?? "[]"),
    );
    expect(library).toEqual([
        expect.objectContaining({
            id: copy.id,
            name: "Opener block",
            description,
            distribution: JSON.parse(copy.distribution!),
            createdAt: copy.created_at,
            updatedAt: copy.updated_at,
        }),
    ]);
});

// Another show, with my library from the show a shape was saved in: the
// harness opens one show per test, so this show starts with the user's
// library as the app keeps it (#353 "saved shapes appear in another show").
const SAVED_ELSEWHERE = {
    id: "0b6c1f4e-6f5d-4a0e-9a57-3f1f2f6b9b11",
    name: "Wide box",
    kind: "block",
    kindVersion: 1,
    intervals: { across: 2.5, deep: 1.5 },
};

test.describe("another show, with a shape saved in my library", () => {
    test.use({
        initScript: `localStorage.setItem("openmarch:savedShapes", ${JSON.stringify(
            JSON.stringify([SAVED_ELSEWHERE]),
        )})`,
    });

    test("change: the library lists my saved shape, and placing it from there gives this show its own copy", async ({
        show,
    }) => {
        const { page } = show;
        const { id } = SAVED_ELSEWHERE;
        expect(await show.query("SELECT id FROM saved_shapes")).toEqual([]);

        await page.getByTestId("shape-library-tab").click();
        const row = page.getByTestId(`shape-library-row-${id}`);
        await expect(row).toContainText("Wide box");
        await expect(row).toContainText("Box · 2½ × 1½ apart");
        await expect(row).not.toContainText("this show only");

        await selectAll(page);
        await page.getByTestId(`shape-library-pick-${id}`).click();
        await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
        const grid = await fieldGrid(show);
        const S = grid.pixelsPerStep;
        const cf = grid.centerFront;
        await drag(
            page,
            await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S }),
            await toScreen(page, { x: cf.x - 5 * S, y: cf.y - 19 * S }),
        );
        await expect.poll(() => readout(page)).toMatch(/ · 2½ × 1½ steps$/);
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("shape-tool-readout")).toBeHidden();

        await expect
            .poll(() =>
                show.query(
                    "SELECT id, name, kind, intervals FROM saved_shapes",
                ),
            )
            .toEqual([
                {
                    id,
                    name: "Wide box",
                    kind: "block",
                    intervals: JSON.stringify(SAVED_ELSEWHERE.intervals),
                },
            ]);
    });
});

// The circle (#389, spec #385): a closed kind with no corners, filled in
// Outline by the host's distributor. It comes after Box in the Shapes tab, the
// ring and the command bar, is drawn from its center out, and its one handle
// sets the interval between neighbors (the chord), which sets its size.

const circleInterval = (page: Page) =>
    page
        .getByTestId("shape-tool-readout")
        .getByTestId("shape-editor-interval")
        .innerText();

/** Each spot's distance to the next one round `center` */
function chords(spots: readonly Point[], center: Point): number[] {
    const round = [...spots].sort(
        (a, b) =>
            Math.atan2(a.y - center.y, a.x - center.x) -
            Math.atan2(b.y - center.y, b.x - center.x),
    );
    return round.map((p, i) => {
        const next = round[(i + 1) % round.length];
        return Math.hypot(next.x - p.x, next.y - p.y);
    });
}

test("change: O opens the circle tool; a drag from the center draws it, its handle sets the interval, and Enter places everyone one interval apart", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    const steps = await undoSteps(show);
    await selectAll(page);
    await page.keyboard.press("o");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    await expect(page.getByTestId("shape-tool-section")).toContainText(
        "draw a circle",
    );

    // From the center out to a rim 8 steps away: 8 marchers, a chord of 6.1,
    // so 6 steps apart
    const center = { x: cf.x - 10 * S, y: cf.y - 22 * S };
    await drag(
        page,
        await toScreen(page, center),
        await toScreen(page, { x: center.x + 8 * S, y: center.y }),
    );
    await expect.poll(() => circleInterval(page)).toBe("6");
    const drawn = (await shapeOverlay(page))!;
    expect(drawn.spots).toHaveLength(ALL.length);
    for (const chord of chords(drawn.spots, center))
        expect(Math.abs(chord - 6 * S)).toBeLessThan(CLOSE);
    // The first marcher stands front-center
    const r = (6 * S) / (2 * Math.sin(Math.PI / 8));
    expect(
        drawn.spots.some(
            (p) =>
                Math.abs(p.x - center.x) < CLOSE &&
                Math.abs(p.y - (center.y + r)) < CLOSE,
        ),
    ).toBe(true);
    // Outline and Spread, Outline on (and never Grid)
    await expect(page.getByTestId("shape-tool-section")).toBeVisible();
    await expect(page.getByTestId("shape-mode-outline")).toHaveAttribute(
        "data-state",
        "on",
    );
    await expect(page.getByTestId("shape-mode-spread")).toBeVisible();
    await expect(page.getByTestId("shape-mode-files")).toHaveCount(0);

    // One handle, on the rim: dragged out to 12 steps it makes the marchers 9
    // steps apart, the center kept
    expect(drawn.handles).toHaveLength(1);
    await drag(
        page,
        drawn.handles[0],
        await toScreen(page, { x: center.x + 12 * S, y: center.y }),
    );
    await expect.poll(() => circleInterval(page)).toBe("9");
    const resized = (await shapeOverlay(page))!;
    for (const chord of chords(resized.spots, center))
        expect(Math.abs(chord - 9 * S)).toBeLessThan(CLOSE);

    // Enter places everyone on the spots as one undo step, and the recipe is
    // the circle's, in Outline
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, resized.spots)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    const [recipe] = await show.query<{
        kind: string;
        kind_version: number;
        params: string;
    }>("SELECT kind, kind_version, params FROM timeline_shape_recipes");
    expect([recipe.kind, recipe.kind_version]).toEqual(["circle", 2]);
    const stored = JSON.parse(recipe.params);
    expect(stored.distribution).toEqual({
        mode: "outline",
        oddGap: { side: "back", at: null, style: "spread" },
    });
    expect(stored.interval).toBeCloseTo(9 * S);
});

test("change: the circle comes after Box in the Shapes tab, the ring and the command bar, which asks its interval", async ({
    show,
}) => {
    const { page } = show;
    await selectAll(page);

    // The Shapes tab: a picture of itself, named on hover, right after Box
    await page.getByRole("tab", { name: "Shapes" }).click();
    const tabKinds = page.locator(
        '[data-testid="shapes-tab-block"], [data-testid="shapes-tab-circle"]',
    );
    await expect(tabKinds).toHaveCount(2);
    expect(
        await tabKinds.evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-testid")),
        ),
    ).toEqual(["shapes-tab-block", "shapes-tab-circle"]);
    const circle = page.getByTestId("shapes-tab-circle");
    await expect(circle).toHaveAccessibleName("Circle");
    await expect(circle.getByTestId("shape-preview")).toHaveAttribute(
        "data-spots",
        "9",
    );

    // The ring: the basic kinds in the same order
    await pointAtField(show);
    await page.keyboard.down("r");
    await expect(ring(page)).toBeVisible();
    const slots = await page
        .locator('[data-testid^="shape-ring-slot-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(slots.slice(0, 2)).toEqual([
        "shape-ring-slot-block",
        "shape-ring-slot-circle",
    ]);
    await expect(ringSlot(page, "circle")).toHaveText("Circle");
    await page.keyboard.up("r");
    await page.keyboard.press("Escape");
    await expect(ring(page)).toBeHidden();

    // The command bar: Shape › Circle asks how it's filled (Enter keeps
    // Outline), then its one number, and places it
    await page.keyboard.press("/");
    await page.getByRole("combobox").fill("circle");
    await expect(page.getByRole("option").first()).toHaveText(
        /^Shape › Circle/,
    );
    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeVisible();
    await expect(question(page)).toHaveText(/^Fill/);
    await expect(answer(page)).toHaveValue("Outline");
    await page.keyboard.press("Enter");
    await expect(question(page)).toHaveText(/^Spacing between neighbors/);
    await expect(answer(page)).toHaveValue("2");
    expect((await shapeOverlay(page))!.spots).toHaveLength(ALL.length);
    await answer(page).fill("3");
    await expect.poll(() => circleInterval(page)).toBe("3");
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeHidden();
    await expect.poll(() => onSpots(show, spots)).toBe(true);
});

// Placed shapes of any kind (#397): a placed circle is selected by a click on
// a member and edited in place through its kind, like a placed box.

test("change: a click on a placed circle's member selects it whole, its handle changes the interval and saves at once, and inside it the outline says Circle", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await page.keyboard.press("o");
    const center = { x: cf.x - 10 * S, y: cf.y - 22 * S };
    await drag(
        page,
        await toScreen(page, center),
        await toScreen(page, { x: center.x + 8 * S, y: center.y }),
    );
    await expect.poll(() => circleInterval(page)).toBe("6");
    const spots = (await shapeOverlay(page))!.spots;
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, spots)).toBe(true);
    await waitForIdle(page);
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);

    // A click on a member selects the whole circle, which draws its own
    // outline and one handle, and shows its numbers
    const t3 = await marcherScreen(page, 3);
    await page.mouse.click(t3.x, t3.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect
        .poll(async () => (await shapeOverlay(page))?.handles.length)
        .toBe(1);
    expect((await readField(page)).handles).toBeNull();
    await expect(page.getByTestId("placed-box-summary")).toHaveText(
        "Circle · 6 steps",
    );
    // A circle has no count across to step
    await expect(
        page.getByTestId("placed-box-summary").getByRole("button"),
    ).toHaveCount(0);
    await expect(
        page
            .getByTestId("placed-box-readout")
            .getByTestId("shape-editor-interval"),
    ).toHaveText("6");

    // Its handle, dragged out to 12 steps, saves at once as one undo step:
    // everyone 9 steps from the next, round the same center
    const steps = await undoSteps(show);
    const [handle] = (await shapeOverlay(page))!.handles;
    await drag(
        page,
        handle,
        await toScreen(page, { x: center.x + 12 * S, y: center.y }),
    );
    await expect
        .poll(async () => {
            const [row] = await show.query<{ params: string }>(
                "SELECT params FROM timeline_shape_recipes ORDER BY id DESC LIMIT 1",
            );
            return JSON.parse(row.params).interval / S;
        })
        .toBeCloseTo(9);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    const after = await savedPositions(show, 0);
    for (const chord of chords(after, center))
        expect(Math.abs(chord - 9 * S)).toBeLessThan(CLOSE);
    expect((await readField(page)).selection).toEqual(ALL);
    await expect(page.getByTestId("placed-box-summary")).toHaveText(
        "Circle · 9 steps",
    );
    await expectCanvasMatchesShow(show);

    // Inside it, the outline of the rest is drawn and labelled
    await page.mouse.dblclick(t3.x, t3.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toHaveLength(1);
    await expect
        .poll(async () => (await placedBoxes(page)).map((b) => b.label))
        .toEqual(["Circle · 9 steps"]);
});
