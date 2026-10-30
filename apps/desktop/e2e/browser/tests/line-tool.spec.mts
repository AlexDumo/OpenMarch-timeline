import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid, savedPositions, type Position } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type { FieldTestShapeOverlay } from "../../../src/field/fieldTestApi";

// The Line (#523, spec #522): L opens it on the selected marchers, a drag draws
// a straight line in Fit (its interval worked out), typing an interval keeps it
// (the line grows from its pivot), the spacing menu offers Interval on the
// path, Enter places it as one undo step, and a click on a member reopens it,
// where a dragged end saves on release with the interval kept.

// Eight trumpets scattered, all in view.
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

test.beforeEach(async ({ show }) => {
    await expectCanvasMatchesShow(show);
});

type Point = { x: number; y: number };

/** Positions are saved to three decimals. */
const CLOSE = 1e-3;

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

/** What the shape tool draws once its spots have glided to where they're going */
async function shapeOverlay(page: Page): Promise<FieldTestShapeOverlay | null> {
    await page.waitForFunction(
        () => window.fieldTest!.shapeOverlay!()?.gliding !== true,
    );
    return page.evaluate(() => window.fieldTest!.shapeOverlay!());
}

async function drag(page: Page, from: Point, to: Point) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
}

/** How many undo steps the show has. */
const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

const recipes = (show: Show) =>
    show.query<{ kind: string; kind_version: number; params: string }>(
        "SELECT kind, kind_version, params FROM timeline_shape_recipes ORDER BY id",
    );

const onSpots = async (show: Show, spots: readonly Point[]) =>
    (await savedPositions(show, 0)).every((p) =>
        spots.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < CLOSE),
    );

/** The spots in order along x, and the distance between each and the next */
function gaps(spots: readonly Point[]): number[] {
    const sorted = [...spots].sort((a, b) => a.x - b.x);
    return sorted
        .slice(1)
        .map((p, i) => Math.hypot(p.x - sorted[i]!.x, p.y - sorted[i]!.y));
}

const interval = (page: Page, readout: string) =>
    page.getByTestId(readout).getByTestId("shape-editor-interval").innerText();

test("change: L draws a Fit line, a typed interval keeps it, Enter places it as one undo step, and a member reopens it", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;

    // In the Shapes tab after Box and Circle, greyed out with nobody selected
    await page.getByRole("tab", { name: "Shapes" }).click();
    const line = page.getByTestId("shapes-tab-line");
    await expect(line).toHaveAccessibleName("Line");
    await expect(line).toBeDisabled();
    await expect(page.getByTestId("shapes-tab-reason")).toHaveText(
        "Select marchers first",
    );
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(line).toBeEnabled();

    const steps = await undoSteps(show);
    await page.keyboard.press("l");
    await expect(page.getByTestId("shape-tool-hint")).toContainText(
        "draw a line",
    );

    // A drag 10½ steps long: 8 marchers, Fit, 1½ steps apart
    const y = cf.y - 20 * S;
    const from = { x: cf.x - 14 * S, y };
    const to = { x: cf.x - 3.5 * S, y };
    await drag(page, await toScreen(page, from), await toScreen(page, to));
    await expect.poll(() => interval(page, "shape-tool-readout")).toBe("1½");
    const spacing = page.getByTestId("shape-choice-spacing");
    await expect(spacing).toHaveAttribute("data-value", "fit");
    const drawn = (await shapeOverlay(page))!;
    expect(drawn.spots).toHaveLength(ALL.length);
    for (const gap of gaps(drawn.spots))
        expect(Math.abs(gap - 1.5 * S)).toBeLessThan(CLOSE);
    expect(drawn.handles).toHaveLength(2);

    // Typing 2 keeps the interval: the line grows from its center to 14 steps
    await page
        .getByTestId("shape-tool-readout")
        .getByTestId("shape-editor-interval")
        .click();
    await page.getByTestId("shape-editor-interval-input").fill("2");
    await page.keyboard.press("Enter");
    await expect.poll(() => interval(page, "shape-tool-readout")).toBe("2");
    await expect(spacing).toHaveAttribute("data-value", "keep");
    const kept = (await shapeOverlay(page))!;
    for (const gap of gaps(kept.spots))
        expect(Math.abs(gap - 2 * S)).toBeLessThan(CLOSE);
    const xs = kept.spots.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(cf.x - 15.75 * S, 3);
    expect(Math.max(...xs)).toBeCloseTo(cf.x - 1.75 * S, 3);

    // The spacing menu offers Interval on the path, anchored three ways
    await spacing.click();
    const rows = page
        .getByTestId("shape-choice-spacing-content")
        .getByRole("menuitemradio");
    await expect(rows).toHaveText([
        "Fit",
        "Keep interval",
        "Interval on the path, from the start",
        "Interval on the path, centered",
        "Interval on the path, from the end",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-choice-spacing-content")).toBeHidden();
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();

    // Enter places everyone on the spots, positions and recipe as one undo step
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await expect.poll(() => onSpots(show, kept.spots)).toBe(true);
    await waitForIdle(page);
    expect(await undoSteps(show)).toBe(steps + 1);
    const [recipe] = await recipes(show);
    expect([recipe.kind, recipe.kind_version]).toEqual(["line", 2]);
    const stored = JSON.parse(recipe.params);
    expect(stored.spacing.mode).toBe("keep");
    expect(stored.spacing.groups[0].interval).toBeCloseTo(2 * S);
    expect(stored.points).toHaveLength(2);

    // Undo takes back both; redo brings both back
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedPositions(show, 0)).toEqual(asPositions(HOME));
    await expect.poll(async () => (await recipes(show)).length).toBe(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => onSpots(show, kept.spots)).toBe(true);
    await expect.poll(async () => (await recipes(show)).length).toBe(1);
    await waitForIdle(page);

    // A click on a member reopens the line with the same points and interval
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    const t3 = (await drawnMarchers(page)).find((m) => m.id === 3)!.screen;
    await page.mouse.click(t3.x, t3.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();
    await expect.poll(() => interval(page, "placed-box-readout")).toBe("2");
    await expect(page.getByTestId("shape-choice-spacing")).toHaveAttribute(
        "data-value",
        "keep",
    );
    // Its two handles are on the same ends
    const reopened = (await shapeOverlay(page))!;
    const ends = [
        await toScreen(page, { x: cf.x - 15.75 * S, y }),
        await toScreen(page, { x: cf.x - 1.75 * S, y }),
    ];
    const handles = [...reopened.handles].sort((a, b) => a.x - b.x);
    expect(handles).toHaveLength(2);
    handles.forEach((h, i) => {
        expect(Math.abs(h.x - ends[i]!.x)).toBeLessThan(1);
        expect(Math.abs(h.y - ends[i]!.y)).toBeLessThan(1);
    });

    // Its right end, dragged down, turns the line about its left end and saves
    // on release, everyone still 2 steps apart
    const right = [...reopened.handles].sort((a, b) => b.x - a.x)[0]!;
    const left = { x: cf.x - 15.75 * S, y };
    await drag(
        page,
        right,
        await toScreen(page, { x: left.x, y: left.y + 10 * S }),
    );
    await expect
        .poll(async () => {
            const rows = await recipes(show);
            const p = JSON.parse(rows.at(-1)!.params).points[1];
            return [Math.round((p.x - left.x) / S), Math.round((p.y - y) / S)];
        })
        .toEqual([0, 14]);
    await waitForIdle(page);
    const saved = await savedPositions(show, 0);
    const down = [...saved].sort((a, b) => a.y - b.y);
    for (let i = 1; i < down.length; i++) {
        expect(Math.abs(down[i]!.x - left.x)).toBeLessThan(CLOSE);
        expect(Math.abs(down[i]!.y - down[i - 1]!.y - 2 * S)).toBeLessThan(
            CLOSE,
        );
    }
});

test("change: Escape discards an open line and the show is untouched", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    const steps = await undoSteps(show);
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("l");
    const y = cf.y - 20 * S;
    await drag(
        page,
        await toScreen(page, { x: cf.x - 14 * S, y }),
        await toScreen(page, { x: cf.x - 3.5 * S, y }),
    );
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    expect(await savedPositions(show, 0)).toEqual(asPositions(HOME));
    expect(await recipes(show)).toEqual([]);
    expect(await undoSteps(show)).toBe(steps);
});

// Measured (#527): a diagonal drawn from yard line to yard line starts in ↔,
// where a typed interval is how far apart neighbors are side to side, every
// saved x exactly that far from the last and on the step grid.
test("change: a diagonal from yard line to yard line is measured ↔, placing marchers an interval apart in x on the grid", async ({
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

    // From the 40 yard line to the 45, 6 steps deeper
    const from = { x: cf.x - 16 * S, y: cf.y - 24 * S };
    const to = { x: cf.x - 8 * S, y: cf.y - 18 * S };
    await drag(page, await toScreen(page, from), await toScreen(page, to));
    const measured = page.getByTestId("shape-choice-measured");
    await expect(measured).toHaveAttribute("data-value", "x");

    // The menu offers the true distance too; ↕ is there, this line going one
    // way front to back as well
    await measured.click();
    const rows = page
        .getByTestId("shape-choice-measured-content")
        .getByRole("menuitemradio");
    await expect(rows).toHaveText([
        "True distance",
        "Side to side",
        "Front to back",
    ]);
    await expect(rows.nth(2)).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    // 1½ steps side to side, grown from the center onto the grid
    await page
        .getByTestId("shape-tool-readout")
        .getByTestId("shape-editor-interval")
        .click();
    await page.getByTestId("shape-editor-interval-input").fill("1.5");
    await page.keyboard.press("Enter");
    await expect.poll(() => interval(page, "shape-tool-readout")).toBe("1½");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);

    const [recipe] = await recipes(show);
    const stored = JSON.parse(recipe.params);
    expect(stored.measured).toBe("x");
    expect(stored.spacing.mode).toBe("keep");
    const saved = [...(await savedPositions(show, 0))].sort(
        (a, b) => a.x - b.x,
    );
    expect(saved).toHaveLength(ALL.length);
    for (let i = 1; i < saved.length; i++)
        expect(Math.abs(saved[i]!.x - saved[i - 1]!.x - 1.5 * S)).toBeLessThan(
            CLOSE,
        );
    for (const p of saved) {
        const halves = ((p.x - cf.x) / S) * 2;
        expect(Math.abs(halves - Math.round(halves))).toBeLessThan(CLOSE);
    }
    // Still on the line as drawn
    const slope = (to.y - from.y) / (to.x - from.x);
    for (const p of saved)
        expect(Math.abs(p.y - (from.y + (p.x - from.x) * slope))).toBeLessThan(
            CLOSE * 2,
        );

    // Reopened, it's still ↔
    await page.keyboard.press("Escape");
    const t3 = (await drawnMarchers(page)).find((m) => m.id === 3)!.screen;
    await page.mouse.click(t3.x, t3.y);
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();
    await expect(page.getByTestId("shape-choice-measured")).toHaveAttribute(
        "data-value",
        "x",
    );
});
