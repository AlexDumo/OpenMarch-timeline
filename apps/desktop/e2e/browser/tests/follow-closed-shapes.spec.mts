import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    addPageAt,
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    selectPage,
    setUiSettings,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid, savedPositions, type Position } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import type { FieldTestShapeOverlay } from "../../../src/field/fieldTestApi";

// Follow around any closed shape (pathways step 10, fork #1213; owner, 2026-11-23: "if I have a
// bunch of curves and then it goes back to the original point, I can't have it follow around that
// shape like I can with a circle"). Sixteen marchers stand at home in a bean: a closed curve that
// bends both ways, placed by hand, so neither a circle nor a box. On the next page Shift+L goes
// around the smooth loop through them. And marchers placed with the Line tool on a closed
// five-sided shape go around that shape's own outline, corners kept. Between counts they are on
// the outline, not cutting from spot to spot.

const N = 16;
const C = { x: 640, y: 400 };
/** One step in the seeded field's units (8 to 5) */
const STEP = 11.25;
const BEAN: SeedPosition[] = Array.from({ length: N }, (_, i) => {
    const t = (2 * Math.PI * i) / N;
    const r = (10 + 3 * Math.cos(2 * t) - 2 * Math.cos(t)) * STEP;
    return [i + 1, C.x + r * Math.cos(t), C.y + 0.8 * r * Math.sin(t)];
});
const ALL = BEAN.map(([id]) => id);

test.use({
    seedSql: seedShowSql({
        beats: 48,
        pageStarts: [16, 32],
        measureStarts: Array.from({ length: 12 }, (_, i) => 1 + i * 4),
        marchers: BEAN.map(([id]) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [BEAN, BEAN, BEAN],
    }),
    // The time-stretch worklet (#216) can't load in the harness (see props.spec.mts)
    allowedPageErrors: [/Audio worklet error/],
});

type Point = { x: number; y: number };

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
/** Every marcher's position at each of `beats`, from the resolver the app draws with */
const positionsAt = (page: Page, beats: number[]) =>
    page.evaluate(
        (bs) => window.openmarchResolver!.positionsAt(bs),
        beats,
    ) as Promise<Record<number, number[][]>>;
const selectAll = async (page: Page) => {
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
};
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

test.beforeEach(async ({ show }) => {
    await setUiSettings(show.page, { followTheLeader: true });
    await expectCanvasMatchesShow(show);
});

test("change: marchers standing in a closed curve that is neither a circle nor a box: Shift+L goes around the smooth loop through them, each onto the next one's spot, on the curve between counts", async ({
    show,
}) => {
    const { page } = show;
    await selectPage(show, "Page 1");
    await selectAll(page);
    const before = await savedPositions(show, 0);
    await page.keyboard.press("Shift+L");
    // it opens going around, as on a circle: nobody moved, a marcher to grab
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    await expect(page.getByTestId("toolbar-follow-trail")).toHaveText(
        "Following",
    );
    const steps = await undoSteps(show);
    // drag one marcher onto its neighbor's spot: one spot around
    const rings = (await overlay(page))!.memberRings;
    expect(rings).toHaveLength(N);
    const grabbed = before.find((p) => p.id === 5)!;
    const next = before.find((p) => p.id === 6)!;
    const from = await toScreen(page, grabbed);
    const to = await toScreen(page, next);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await expect
        .poll(async () => (await overlay(page))?.tip ?? "")
        .toBe("1 spot");
    await page.mouse.up();
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    // everyone onto the next one's spot around the bean
    const after = await savedPositions(show, 1);
    for (const p of after) {
        const want = before.find((b) => b.id === (p.id % N) + 1)!;
        expect(near(p, want), `T${p.id}`).toBeLessThan(0.01);
    }
    // Between counts they walk the curve, not the straight line from spot to spot: midway, most
    // are off that line by a real distance (the bean's bends), and nobody has left the loop's
    // neighborhood
    const mid = await positionsAt(page, [16, 24, 32]);
    let curved = 0;
    for (const id of ALL) {
        const [a, m, b] = mid[id]!.map(([x, y]) => ({ x: x!, y: y! }));
        const chordMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (near(m!, chordMid) > 0.15 * STEP) curved++;
        expect(near(m!, chordMid), `T${id}`).toBeLessThan(2 * STEP);
    }
    expect(curved).toBeGreaterThanOrEqual(N / 2);
});

test("change: a marcher pulled out of the closed curve leads a trail the rest follow, written with Enter", async ({
    show,
}) => {
    const { page } = show;
    await selectPage(show, "Page 1");
    await selectAll(page);
    const before = await savedPositions(show, 1);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    // T1 stands at the bean's right end: pull it straight out to the right
    const lead = before.find((p) => p.id === 1)!;
    const from = await toScreen(page, lead);
    const out = { x: lead.x + 8 * STEP, y: lead.y };
    const outAt = await toScreen(page, out);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(outAt.x, outAt.y, { steps: 20 });
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    await expect(page.getByTestId("follow-status")).toContainText(
        "T1 pulled out",
    );
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-spacing")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    const after = await savedPositions(show, 1);
    const end = after.find((p) => p.id === 1)!;
    expect(near(end, out)).toBeLessThan(STEP);
    for (const p of after) {
        const b = before.find((q) => q.id === p.id)!;
        expect(near(p, b), `T${p.id}`).toBeGreaterThan(STEP / 2);
    }
});

test("change: marchers placed with the Line tool on a closed five-sided shape go around that shape's own outline, turning at its corners", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    await page.keyboard.press("l");
    // A five-sided shape, clicked corner by corner and closed on its first corner (#529)
    const corners = [
        { x: cf.x - 22 * S, y: cf.y - 34 * S },
        { x: cf.x - 8 * S, y: cf.y - 34 * S },
        { x: cf.x - 3 * S, y: cf.y - 24 * S },
        { x: cf.x - 15 * S, y: cf.y - 14 * S },
        { x: cf.x - 27 * S, y: cf.y - 24 * S },
    ];
    const click = async (at: Point) => {
        const on = await toScreen(page, at);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        await page.mouse.click(on.x, on.y);
    };
    for (const corner of corners) await click(corner);
    await click(corners[0]!);
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await expect(page.getByTestId("shape-choice-ends")).toHaveAttribute(
        "data-value",
        "closed",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);
    await page.keyboard.press("Escape");
    const placed = await savedPositions(show, 0);
    /** How far `at` is from the shape's sides */
    const offShape = (at: Point) =>
        Math.min(
            ...corners.map((a, i) => {
                const b = corners[(i + 1) % corners.length]!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const f = Math.max(
                    0,
                    Math.min(
                        1,
                        ((at.x - a.x) * dx + (at.y - a.y) * dy) /
                            (dx * dx + dy * dy),
                    ),
                );
                return Math.hypot(a.x + f * dx - at.x, a.y + f * dy - at.y);
            }),
        );
    for (const p of placed) expect(offShape(p), `T${p.id}`).toBeLessThan(0.05);

    await selectPage(show, "Page 1");
    await selectAll(page);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    await page.keyboard.press("2");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    // Between counts everyone is on the shape's own sides: around its corners, not cutting them
    // (a smooth loop through the marchers would round the corners off)
    const beats = [17, 19, 20.5, 22, 24, 26.5, 28, 30, 31];
    const mid = await positionsAt(page, beats);
    for (const id of ALL)
        for (const [x, y] of mid[id]!)
            expect(offShape({ x: x!, y: y! }), `T${id}`).toBeLessThan(0.05 * S);
    // and everyone moved on, two spots
    const after: Position[] = await savedPositions(show, 1);
    for (const p of after) {
        const was = placed.find((q) => q.id === p.id)!;
        expect(near(p, was), `T${p.id}`).toBeGreaterThan(S);
        expect(offShape(p), `T${p.id}`).toBeLessThan(0.05);
    }
});

test("change: marchers placed with the Curve tool on a closed curve (its first point clicked again) go around the curve itself: one clicked, the whole shape selected, dragged around, on the drawn curve between counts", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    await selectAll(page);
    // Curve, in the Shapes tab: five points around a bean, closed by a click on the first one
    await page.getByRole("tab", { name: "Shapes" }).click();
    await page.getByTestId("shapes-tab-curve").click();
    const at = (dx: number, dy: number) => ({
        x: cf.x + dx * S,
        y: cf.y + dy * S,
    });
    const points = [
        at(-30, -30),
        at(-18, -36),
        at(-6, -30),
        at(-10, -20),
        at(-24, -18),
    ];
    const click = async (to: Point) => {
        const on = await toScreen(page, to);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        await page.mouse.click(on.x, on.y);
    };
    for (const point of points) await click(point);
    await click(points[0]!);
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await expect(page.getByTestId("shape-choice-ends")).toHaveAttribute(
        "data-value",
        "closed",
    );
    // the curve as drawn, to measure against
    const drawn = (await overlay(page))!.outline!;
    expect(drawn.length).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);
    await page.keyboard.press("Escape");
    const placed = await savedPositions(show, 0);
    /** How far `p` is from the curve as drawn */
    const offCurve = (p: Point) =>
        Math.min(
            ...drawn.map((a, i) => {
                const b = drawn[(i + 1) % drawn.length]!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const f = Math.max(
                    0,
                    Math.min(
                        1,
                        ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                            (dx * dx + dy * dy || 1),
                    ),
                );
                return Math.hypot(a.x + f * dx - p.x, a.y + f * dy - p.y);
            }),
        );
    for (const p of placed)
        expect(offCurve(p), `T${p.id}`).toBeLessThan(0.05 * S);

    await selectPage(show, "Page 1");
    await selectAll(page);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    const steps = await undoSteps(show);
    // one marcher dragged along the curve, past two of its neighbors' spots
    const rings = (await overlay(page))!.memberRings;
    const grabbed = rings[4]!.at;
    const from = await toScreen(page, grabbed);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let k = drawn.reduce(
        (best, p, i) =>
            near(p, grabbed) < near(drawn[best]!, grabbed) ? i : best,
        0,
    );
    const spacing = Math.min(
        ...placed
            .filter((p) => near(p, grabbed) > 0.01)
            .map((p) => near(p, grabbed)),
    );
    for (let gone = 0; gone < 2 * spacing; ) {
        const next = (k + 1) % drawn.length;
        gone += near(drawn[k]!, drawn[next]!);
        k = next;
        const on = await toScreen(page, drawn[k]!);
        await page.mouse.move(on.x, on.y);
    }
    await expect
        .poll(async () => (await overlay(page))?.tip ?? "")
        .toMatch(/^[1-9]\d* spots?$/);
    await expect(page.getByTestId("follow-status")).toContainText("Holding T");
    await page.mouse.up();
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    // everyone moved on, still on the curve, and on the curve between counts too
    const after = await savedPositions(show, 1);
    for (const p of after) {
        const was = placed.find((q) => q.id === p.id)!;
        expect(near(p, was), `T${p.id}`).toBeGreaterThan(S);
        expect(offCurve(p), `T${p.id}`).toBeLessThan(0.05 * S);
    }
    const mid = await positionsAt(page, [17, 19.5, 22, 24, 26.5, 29, 31]);
    for (const id of ALL)
        for (const [x, y] of mid[id]!)
            expect(offCurve({ x: x!, y: y! }), `T${id}`).toBeLessThan(0.05 * S);
});

test("change: a placed shape clicked on the next page shows its editing bar; while Following the bar steps aside, and it is back when Follow is left", async ({
    show,
}) => {
    const { page } = show;
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    // A closed Curve placed on the last page, then a page added after it, which carries its spots
    await selectPage(show, "Page 2");
    await selectAll(page);
    await page.getByRole("tab", { name: "Shapes" }).click();
    await page.getByTestId("shapes-tab-curve").click();
    const at = (dx: number, dy: number) => ({
        x: cf.x + dx * S,
        y: cf.y + dy * S,
    });
    const points = [
        at(-30, -30),
        at(-18, -36),
        at(-6, -30),
        at(-10, -20),
        at(-24, -18),
    ];
    const click = async (to: Point) => {
        const on = await toScreen(page, to);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        await page.mouse.click(on.x, on.y);
    };
    for (const point of points) await click(point);
    await click(points[0]!);
    await expect(page.getByTestId("shape-tool-readout")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shape-tool-readout")).toBeHidden();
    await waitForIdle(page);
    await page.keyboard.press("Escape");
    await addPageAt(page, 11);
    await waitForIdle(page);
    await selectPage(show, "Page 3");
    await page.keyboard.press("Escape");
    // one marcher of the shape clicked: the whole shape is selected, its own bar shows
    const [, , , one] = await drawnMarchers(page);
    await page.mouse.click(one!.screen.x, one!.screen.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();
    // Following: only the Follow bar, the shape's own bar gone
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("placed-box-readout")).toHaveCount(0);
    // Esc leaves Follow: the shape is still selected, and its bar is back
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect(page.getByTestId("placed-box-readout")).toBeVisible();
});
