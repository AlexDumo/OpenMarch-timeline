import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    expectCanvasMatchesShow,
    longPress,
    readField,
    tap,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid, savedPositions, type Position } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Split here (#1336): a placed Line split in two between two marchers, nobody
// moving, as one undo step. With a mouse, hovering a gap of the selected line
// shows scissors just off it, and a click on them splits there. A finger has no
// hover: a tap on the gap shows them, and a tap on them splits. A long press on
// the gap opens the field menu with Shape: Split here, as a right-click does.

// Twelve trumpets scattered on the field
const HOME: SeedPosition[] = Array.from({ length: 12 }, (_, i) => [
    i + 1,
    480 + (i % 4) * 90,
    280 + Math.floor(i / 4) * 70,
]);
const ALL = HOME.map(([id]) => id);

const SEED = seedShowSql({
    beats: 16,
    pageStarts: [],
    measureStarts: [1, 5, 9, 13],
    marchers: HOME.map(([id]) => ({
        id,
        section: "Trumpet",
        prefix: "T",
        order: id,
    })),
    positions: [HOME],
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

const recipes = (show: Show) =>
    show.query<{ kind: string }>(
        "SELECT kind FROM timeline_shape_recipes ORDER BY id",
    );

const byId = (rows: readonly Position[]) =>
    [...rows].sort((a, b) => a.id - b.id);

/**
 * Everyone on a straight Line, placed with the mouse and left selected: twelve
 * marchers `apart` steps apart (6 by default). Returns the middle of the gap
 * between the fourth and fifth along it, clear of the line's handles at its ends
 * and middle, on screen; and a point on empty field behind the line.
 */
async function placeLine(
    show: Show,
    apart = 6,
): Promise<Point & { away: Point }> {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("l");
    const y = cf.y - 20 * S;
    const half = ((ALL.length - 1) / 2) * apart * S;
    const from = { x: cf.x - half, y };
    const to = { x: cf.x + half, y };
    const a = await toScreen(page, from);
    const b = await toScreen(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await recipes(show)).length).toBe(1);
    await waitForIdle(page);
    const gap = await toScreen(page, { x: from.x + 3.5 * apart * S, y });
    const away = await toScreen(page, { x: cf.x, y: y - 30 * S });
    return { ...gap, away };
}

/** The middle of the scissors drawn, on screen */
async function scissorsAt(page: Page): Promise<Point> {
    const scissors = page.getByTestId("fieldSplitScissors");
    await expect(scissors).toBeVisible();
    const box = (await scissors.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Two lines where there was one, everyone where they stood */
async function expectSplit(show: Show, before: readonly Position[]) {
    await expect
        .poll(async () => (await recipes(show)).map((r) => r.kind))
        .toEqual(["line", "line"]);
    const after = byId(await savedPositions(show, 0));
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
        expect(p.id).toBe(before[i]!.id);
        expect(Math.abs(p.x - before[i]!.x)).toBeLessThan(1e-3);
        expect(Math.abs(p.y - before[i]!.y)).toBeLessThan(1e-3);
    });
}

test.describe("with a mouse", () => {
    test.use({ seedSql: SEED, allowedPageErrors: [/Audio worklet error/] });

    test.beforeEach(async ({ show }) => {
        await expectCanvasMatchesShow(show);
    });

    test("change: hovering a gap of the selected line shows scissors; a click on them splits it there as one undo step, nobody moving", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show);
        const before = byId(await savedPositions(show, 0));
        await page.mouse.move(gap.x, gap.y, { steps: 4 });
        const at = await scissorsAt(page);
        await expect(page.getByTestId("fieldSplitMark")).toBeVisible();

        // Pressed and dragged off them, nothing splits
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await page.mouse.down();
        await page.mouse.move(at.x + 80, at.y + 80, { steps: 6 });
        await page.mouse.up();
        await waitForIdle(page);
        expect(await recipes(show)).toHaveLength(1);

        await page.mouse.move(gap.x, gap.y, { steps: 6 });
        const again = await scissorsAt(page);
        await page.mouse.move(again.x, again.y, { steps: 6 });
        await page.mouse.click(again.x, again.y);
        await expectSplit(show, before);

        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(async () => (await recipes(show)).length).toBe(1);
    });

    test("change: on a line with marchers two steps apart, hovering the middle of a gap shows the scissors; Escape takes them away", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show, 2);
        const before = byId(await savedPositions(show, 0));
        await page.mouse.move(gap.x, gap.y, { steps: 4 });
        const at = await scissorsAt(page);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("fieldSplitScissors")).toHaveCount(0);

        await page.keyboard.press("ControlOrMeta+a");
        await page.mouse.move(gap.x + 1, gap.y, { steps: 2 });
        await page.mouse.move(gap.x, gap.y, { steps: 2 });
        const again = await scissorsAt(page);
        expect(Math.hypot(again.x - at.x, again.y - at.y)).toBeLessThan(2);
        await page.mouse.move(again.x, again.y, { steps: 6 });
        await page.mouse.click(again.x, again.y);
        await expectSplit(show, before);
    });
});

test.describe("with a finger", () => {
    test.use({
        seedSql: SEED,
        // A touch screen, in the touch layout; the line is placed with the mouse
        touchScreen: true,
        initScript: "localStorage.setItem('openmarch:inputMode', 'touch');",
        allowedPageErrors: [/Audio worklet error/],
    });

    test.beforeEach(async ({ show }) => {
        await expectCanvasMatchesShow(show);
    });

    test("change: a tap on a gap of the selected line shows the scissors, and a tap on them splits it there", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show);
        // The mouse away, so nothing hovers
        await page.mouse.move(5, 5);
        const before = byId(await savedPositions(show, 0));
        await expect(page.getByTestId("fieldSplitScissors")).toHaveCount(0);
        await tap(page, gap);
        const at = await scissorsAt(page);
        // They stay after the finger lifts, through the next frames
        await page.evaluate(
            () =>
                new Promise((done) =>
                    requestAnimationFrame(() => requestAnimationFrame(done)),
                ),
        );
        await expect(page.getByTestId("fieldSplitScissors")).toBeVisible();
        await tap(page, at);
        await expectSplit(show, before);
    });

    test("change: on a line with marchers two steps apart, a tap in the middle of a gap shows the scissors, and they split it", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show, 2);
        await page.mouse.move(5, 5);
        const before = byId(await savedPositions(show, 0));
        await tap(page, gap);
        await tap(page, await scissorsAt(page));
        await expectSplit(show, before);
    });

    test("change: scissors a tap showed go away when the line is put down, by a tap on empty field or Escape", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show);
        await page.mouse.move(5, 5);
        const scissors = page.getByTestId("fieldSplitScissors");
        await tap(page, gap);
        await expect(scissors).toBeVisible();
        await tap(page, gap.away);
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual([]);
        await expect(scissors).toHaveCount(0);

        // Selected again, then Escape
        await page.keyboard.press("ControlOrMeta+a");
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual(ALL);
        await tap(page, gap);
        await expect(scissors).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(scissors).toHaveCount(0);
        expect(await recipes(show)).toHaveLength(1);
    });

    test("change: a long press on a gap of the selected line offers Shape: Split here in the field menu", async ({
        show,
    }) => {
        const { page } = show;
        const gap = await placeLine(show);
        await page.mouse.move(5, 5);
        const before = byId(await savedPositions(show, 0));
        await longPress(page, gap);
        const entry = page.getByTestId("field-menu-shapeSplitHere");
        await expect(entry).toBeVisible();
        await expect(entry).toBeEnabled();
        const box = (await entry.boundingBox())!;
        await tap(page, {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        });
        await expectSplit(show, before);
    });
});
