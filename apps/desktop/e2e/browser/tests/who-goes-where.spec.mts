import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { drawnMarchers, expectCanvasMatchesShow, readField } from "../app.mjs";
import { fieldGrid, savedPositions } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type { FieldTestShapeOverlay } from "../../../src/field/fieldTestApi";

// Who goes where (docs/timeline/research/shapes/09-who-goes-where.md): the
// menu lists every option and greys out the ones that don't fit with the
// reason; W picks by hand, the 1st marcher picked taking the 1st spot picked,
// with Tab switching between marchers and spots and Backspace taking back a
// pick; Shift+W swaps two marchers; Enter ends picking and Enter places.

// Six trumpets in a column, all in view.
const HOME: SeedPosition[] = [
    [1, 600, 200],
    [2, 600, 240],
    [3, 600, 280],
    [4, 600, 320],
    [5, 600, 360],
    [6, 600, 400],
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
    allowedPageErrors: [/Audio worklet error/],
});

test.beforeEach(async ({ show }) => {
    await expectCanvasMatchesShow(show);
});

type Point = { x: number; y: number };
const CLOSE = 1e-3;

async function toScreen(page: Page, p: Point): Promise<Point> {
    const [marcher] = await drawnMarchers(page);
    const { zoom } = (await readField(page)).viewport;
    return {
        x: marcher.screen.x + (p.x - marcher.x) * zoom,
        y: marcher.screen.y + (p.y - marcher.y) * zoom,
    };
}

async function shapeOverlay(page: Page): Promise<FieldTestShapeOverlay> {
    await page.waitForFunction(
        () => window.fieldTest!.shapeOverlay!()?.gliding !== true,
    );
    return (await page.evaluate(() => window.fieldTest!.shapeOverlay!()))!;
}

async function drag(page: Page, from: Point, to: Point) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
}

async function clickAt(page: Page, p: Point) {
    const s = await toScreen(page, p);
    await page.mouse.click(s.x, s.y);
}

const home = (id: number): Point => {
    const [, x, y] = HOME.find(([m]) => m === id)!;
    return { x, y };
};

test("change: the menu greys out what doesn't fit, W picks by hand back and forth, Shift+W swaps, and Enter places", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;

    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("l");
    const y = cf.y - 10 * S;
    await drag(
        page,
        await toScreen(page, { x: cf.x - 12 * S, y }),
        await toScreen(page, { x: cf.x - 2 * S, y }),
    );
    const drawn = await shapeOverlay(page);
    expect(drawn.spots).toHaveLength(ALL.length);
    const spots = [...drawn.spots].sort((a, b) => a.x - b.x);

    // Every option is listed; with no order set, Keep order and Inside out are
    // greyed out, and one section greys out Within sections: each says what it
    // does and why it doesn't fit in a tip behind its ?, and no option has
    // words under its name
    await page.getByTestId("shape-order").click();
    await expect(
        page
            .getByTestId("shape-order-content")
            .getByRole("menuitemradio")
            .locator("[data-label]"),
    ).toHaveText([
        "Least travel",
        "Keep order",
        "Reverse order",
        "Inside out",
        "Zipper",
        "Within sections",
    ]);
    await expect(page.getByTestId("shape-order-keep")).toHaveAttribute(
        "aria-disabled",
        "true",
    );
    await expect(page.getByTestId("shape-order-inside-note")).toHaveCount(0);
    await expect(page.getByTestId("shape-order-keep-tip-icon")).toBeVisible();
    await page.getByTestId("shape-order-keep").hover();
    await expect(page.getByTestId("shape-order-keep-tip")).toContainText(
        "These marchers have no order yet",
    );
    await page.getByTestId("shape-order-sections").hover();
    await expect(page.getByTestId("shape-order-keep-tip")).toBeHidden();
    await expect(page.getByTestId("shape-order-sections-tip")).toContainText(
        "Everyone here is in one section",
    );
    await expect(page.getByTestId("shape-order-readout")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-order-content")).toBeHidden();

    // W: picking by hand, from the marchers first
    await page.keyboard.press("w");
    await expect(page.getByTestId("shape-pick-bar")).toBeVisible();
    // Its own bar in place of the editor's rows, with the option the rest follow
    await expect(page.getByTestId("shape-tool-readout-bar")).toBeHidden();
    await expect(page.getByTestId("shape-tool-readout-fill")).toBeHidden();
    await expect(
        page.getByTestId("shape-pick-bar").getByTestId("shape-order"),
    ).toContainText("Least travel");
    await expect(page.getByTestId("shape-pick-marchers")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    // Names show where the marchers start; the spots are bare
    await expect(page.getByTestId("fieldShapePickName")).toHaveText([
        "T1",
        "T2",
        "T3",
        "T4",
        "T5",
        "T6",
    ]);
    await expect(page.getByTestId("fieldShapeSpotLabel")).toHaveCount(0);
    // T1, T2 and T3, then the three rightmost spots, right to left
    await clickAt(page, home(1));
    await clickAt(page, home(2));
    await clickAt(page, home(3));
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "3 marchers wait for spots",
    );
    await clickAt(page, spots[5]!);
    await clickAt(page, spots[4]!);
    await clickAt(page, spots[3]!);
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "Pick a marcher or a spot",
    );
    // A pick from the spots brought them forward; Tab switches back
    await expect(page.getByTestId("shape-pick-spots")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("shape-pick-marchers")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    // Backspace takes back a pick still waiting for a partner
    await clickAt(page, home(4));
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "1 marcher waits for a spot",
    );
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "Pick a marcher or a spot",
    );

    // Shift+W: T2 and T3 trade spots
    await page.keyboard.press("Shift+w");
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "Click a marcher",
    );
    await clickAt(page, home(2));
    await expect(page.getByTestId("shape-pick-status")).toHaveText(
        "Click the marcher to trade with",
    );
    await clickAt(page, home(3));

    // Enter ends picking, and Enter again places
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-pick-bar")).toBeHidden();
    await expect(page.getByTestId("shape-pick-clear")).toBeVisible();
    // The button says some marchers are placed by hand on top of the option
    await expect(page.getByTestId("shape-order")).toContainText(
        "Least travel · 3 by hand",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    const saved = await savedPositions(show, 0);
    const at = (id: number) => saved.find((p) => p.id === id)!;
    const on = (id: number, spot: Point) =>
        Math.hypot(at(id).x - spot.x, at(id).y - spot.y) < CLOSE;
    expect(on(1, spots[5]!)).toBe(true);
    expect(on(2, spots[3]!)).toBe(true);
    expect(on(3, spots[4]!)).toBe(true);
});
