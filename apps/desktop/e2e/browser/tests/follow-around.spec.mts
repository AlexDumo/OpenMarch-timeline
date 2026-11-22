import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    emulateTouchScreen,
    expectCanvasMatchesShow,
    penDrag,
    touchDrag,
    readField,
    selectPage,
    setUiSettings,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid, savedPositions, type Position } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type { FieldTestShapeOverlay } from "../../../src/field/fieldTestApi";

// Go around a box outline with Follow (pathways step 10, owner feedback 2026-11-22): fifteen
// marchers placed with the Box tool in Outline, 4 steps wide and 9 deep. With an odd count the
// back spreads evenly, which on a box this narrow leaves only its two corners, one gap twice the
// across spacing: Follow refused it ("Select marchers standing in a line, curve, arc or box")
// until each gap was judged by its own side's spacing. On the next page Shift+L opens Go around
// with nobody moved. Dragging the
// leader around the outline slides the whole line, with the count by the pointer, and letting
// go writes it in one undo step. Spec Appendix L.11, DO-1.

// Fifteen trumpets scattered, all in view, on three pages
const HOME: SeedPosition[] = Array.from({ length: 15 }, (_, i) => [
    i + 1,
    460 + (i % 5) * 90,
    280 + Math.floor(i / 5) * 90 + (i % 2) * 20,
]);
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

/** Where field point `p` is drawn in the viewport, from where the marchers are drawn */
async function toScreen(page: Page, p: Point): Promise<Point> {
    const [marcher] = await drawnMarchers(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: marcher.screen.x + (p.x - marcher.x) * zoom,
        y: marcher.screen.y + (p.y - marcher.y) * zoom,
    };
}

const overlay = (page: Page): Promise<FieldTestShapeOverlay | null> =>
    page.evaluate(() => window.fieldTest!.shapeOverlay!());

const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

/** Places all fifteen with the Box tool in Outline at home, 4 steps wide and 9 deep */
async function placeOutline(show: Show, pageId = 0) {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("b");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    const from = await toScreen(page, { x: cf.x - 15 * S, y: cf.y - 25 * S });
    const to = await toScreen(page, { x: cf.x - 11 * S, y: cf.y - 16 * S });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await page.getByTestId("shape-mode-menu").click();
    await page.getByTestId("shape-mode-outline").click();
    await expect(page.getByTestId("shape-mode-menu-content")).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect
        .poll(async () => savedPositions(show, pageId))
        .not.toEqual(asPositions(HOME));
    await waitForIdle(page);
    await page.keyboard.press("Escape");
}

test.beforeEach(async ({ show }) => {
    await setUiSettings(show.page, { followTheLeader: true });
    await expectCanvasMatchesShow(show);
});

test("change: Shift+L on a Box tool outline of fifteen opens Go around with nobody moved; dragging the leader slides the line around, and letting go writes it in one undo step", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    const before = await savedPositions(show, 1);
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    const opened = (await overlay(page))!;
    expect(opened.tip).toBe("Drag around the outline, or type how far");
    const steps = await undoSteps(show);

    // The line in walking order, tail first, the leader last: dragging the leader onto the
    // second member's start goes a few places on around the outline
    const rings = opened.memberRings;
    expect(rings).toHaveLength(15);
    expect(rings.at(-1)!.kind).toBe("own");
    const leader = await toScreen(page, rings.at(-1)!.at);
    const target = await toScreen(page, rings[1]!.at);
    await page.mouse.move(leader.x, leader.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 24 });
    await expect
        .poll(async () => (await overlay(page))?.tip ?? "")
        .toMatch(/^[1-9]\d* spots?$/);
    const tip = (await overlay(page))!.tip!;
    await expect(page.getByTestId("follow-round-amount")).toHaveValue(
        tip.split(" ")[0]!,
    );
    // Nothing written while held
    expect(await savedPositions(show, 1)).toEqual(before);
    await page.mouse.up();
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    // everyone moved on around the outline
    const after = await savedPositions(show, 1);
    for (const p of after)
        expect(before.find((b) => b.id === p.id)).not.toEqual(p);
});

test("change: Escape while dragging the line around puts it back, and Enter with nobody moved writes nothing", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    const rings = (await overlay(page))!.memberRings;
    const leader = await toScreen(page, rings.at(-1)!.at);
    const target = await toScreen(page, rings[2]!.at);
    await page.mouse.move(leader.x, leader.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 24 });
    await expect(page.getByTestId("follow-round-amount")).not.toHaveValue("0");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    await page.mouse.up();
    await expect(page.getByTestId("follow-round")).toBeVisible();
    // A typed count shows live; Escape clears it
    await page.keyboard.press("3");
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("3");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    // Enter with nobody moved closes the tool and writes nothing
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps);
});

test("change: Shift+L on the page where the outline is placed says why: they aren't in a shape until the end of this move", async ({
    show,
}) => {
    const { page } = show;
    await selectPage(show, "Page 1");
    await placeOutline(show, 1);
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    // (the harness's own audio notice may be up too)
    await expect(
        page.locator("[data-sonner-toast]", {
            hasText:
                "They aren't in a shape until the end of this move. Go to the next page to follow from there",
        }),
    ).toBeVisible();
    await expect(page.getByTestId("follow-round")).toBeHidden();
});

test("change: on a touch screen, a pencil and a finger each drag the leader around the outline, and letting go writes it", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    const stopTouch = await emulateTouchScreen(page);
    for (const [how, drag] of [
        ["pencil", penDrag],
        ["finger", touchDrag],
    ] as const) {
        await page.keyboard.press("ControlOrMeta+a");
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual(ALL);
        await page.keyboard.press("Shift+L");
        await expect(page.getByTestId("follow-round"), how).toBeVisible();
        const steps = await undoSteps(show);
        const rings = (await overlay(page))!.memberRings;
        await drag(
            page,
            await toScreen(page, rings.at(-1)!.at),
            await toScreen(page, rings[1]!.at),
            { steps: 24 },
        );
        await expect(page.getByTestId("follow-round"), how).toBeHidden();
        await expect.poll(() => undoSteps(show), how).toBe(steps + 1);
        await waitForIdle(page);
        // back as placed, so the next one opens with nobody moved
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => undoSteps(show), how).toBe(steps);
        await waitForIdle(page);
    }
    await stopTouch();
});
