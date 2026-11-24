import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    drawnMarchers,
    emulateTouchScreen,
    expectCanvasMatchesShow,
    fieldCursorAt,
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

// Follow on a box outline (pathways step 10, owner 2026-11-22: "I wanted the spread-out tool and
// wrap-around tool to be effectively the same thing. I should be able to drag it around the circle
// or drag it out of the circle. Also it should guess in order first or at least in a circle. It
// should let me pretty much pick any marker I want"). Fifteen marchers placed with the Box tool in
// Outline, 4 steps wide and 9 deep. With an odd count the back spreads evenly, which on a box this
// narrow leaves only its two corners, one gap twice the across spacing. On the next page Shift+L
// opens Follow with nobody moved, order set or not. Any marcher can be grabbed, and leads: dragged
// along the outline the line slides around it, either way (the count by the pointer, one undo
// step on letting go); dragged off the outline it's pulled out into a trail the rest follow. A
// march order set by hand (Set order, Shift+O) is the one walked. Spec Appendix L.11.

// Fifteen trumpets scattered, all in view, on three pages: no line, curve, arc or box among them
const HOME: SeedPosition[] = [
    [1, 470, 300],
    [2, 610, 262],
    [3, 545, 410],
    [4, 720, 330],
    [5, 498, 505],
    [6, 812, 455],
    [7, 655, 488],
    [8, 905, 290],
    [9, 760, 560],
    [10, 580, 600],
    [11, 870, 610],
    [12, 455, 640],
    [13, 690, 395],
    [14, 950, 470],
    [15, 525, 335],
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

/** Each marcher's angle about the middle of where they all stand in `about` (else `at`) */
const anglesOf = (at: readonly Position[], about: readonly Position[] = at) => {
    const cx = about.reduce((s, p) => s + p.x, 0) / about.length;
    const cy = about.reduce((s, p) => s + p.y, 0) / about.length;
    return new Map(at.map((p) => [p.id, Math.atan2(p.y - cy, p.x - cx)]));
};
/** `a` to `b` as a turn between −π and π */
const turn = (a: number, b: number) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
};

/**
 * The selected fifteen's march order, set with Set order on page 1 (a click on each where the
 * field shows them, leader first): counterclockwise round the outline they stand on at its start
 * flag (home's spots), from three past the one at the far right, so neither clockwise nor the
 * guess Follow once fell back to
 */
/** Field points from `a` to `b` whose straight legs pass none of `others` within `clear` */
function legAround(
    a: { x: number; y: number },
    b: { x: number; y: number },
    others: readonly { x: number; y: number }[],
    clear: number,
): { x: number; y: number }[] {
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) =>
        others.some((o) => {
            if (Math.hypot(o.x - p.x, o.y - p.y) < 1) return false;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const t = Math.max(
                0,
                Math.min(
                    1,
                    ((o.x - p.x) * dx + (o.y - p.y) * dy) /
                        (dx * dx + dy * dy || 1),
                ),
            );
            return Math.hypot(p.x + t * dx - o.x, p.y + t * dy - o.y) < clear;
        });
    if (!near(a, b)) return [b];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (let k = 1; k <= 40; k++)
        for (const side of [1, -1]) {
            const via = {
                x: mid.x + side * k * (clear / 2) * n.x,
                y: mid.y + side * k * (clear / 2) * n.y,
            };
            if (!near(a, via) && !near(via, b)) return [via, b];
        }
    throw new Error("no clear way between two marchers");
}

async function setOrder(show: Show): Promise<number[]> {
    const { page } = show;
    const at = await savedPositions(show, 1);
    const starts = await savedPositions(show, 0);
    const angle = anglesOf(starts);
    const round = [...starts].sort(
        (a, b) => angle.get(b.id)! - angle.get(a.id)!,
    );
    const order = [...round.slice(3), ...round.slice(0, 3)].map((p) => p.id);
    const steps = await undoSteps(show);
    // Set order on the Paths tab's toolbar, lit once it's on (a click before then would select)
    await page.getByRole("tab", { name: "Paths" }).click();
    await page.getByTestId("toolbar-set-order").click();
    await expect(page.getByTestId("toolbar-set-order")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    // One drag through them in the order (a click, then a move, sweeps too, picking whoever the
    // pointer passes): each leg goes round everyone else, on the field, so only the next is picked
    const field = new Map(at.map((q) => [q.id, { x: q.x, y: q.y }]));
    const clear = 1.5 * (await fieldGrid(show)).pixelsPerStep;
    const start = await toScreen(page, field.get(order[0]!)!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    let here = field.get(order[0]!)!;
    for (const id of order.slice(1)) {
        const to = field.get(id)!;
        const others = [...field.entries()]
            .filter(([m]) => m !== id)
            .map(([, xy]) => xy);
        for (const via of legAround(here, to, others, clear)) {
            const v = await toScreen(page, via);
            await page.mouse.move(v.x, v.y);
        }
        here = to;
    }
    await page.mouse.up();
    // every one picked: kept, one undo step
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    return order;
}

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

/** The fifteen selected on page 1, where they stand on the outline placed at home */
async function onPageOne(show: Show) {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
}

/**
 * Three neighbors down the outline's right side (its long side, top to bottom, which is clockwise
 * as the field is shown), none of them a corner: the one above, the one in the middle, the one below
 */
function rightSide(rings: FieldTestShapeOverlay["memberRings"]) {
    const right = Math.max(...rings.map((r) => r.at.x));
    const side = rings
        .filter((r) => Math.abs(r.at.x - right) < 0.01)
        .sort((a, b) => a.at.y - b.at.y);
    expect(side.length).toBeGreaterThanOrEqual(5);
    const mid = Math.floor(side.length / 2);
    return {
        above: side[mid - 1]!.at,
        grabbed: side[mid]!.at,
        below: side[mid + 1]!.at,
    };
}

test("change: with no march order set, Shift+L opens anyway; any marcher grabbed leads, and dragged counterclockwise or clockwise they walk that way behind it", async ({
    show,
}) => {
    const { page } = show;
    await onPageOne(show);
    const before = await savedPositions(show, 0);
    const was = anglesOf(before);
    for (const way of ["counterclockwise", "clockwise"] as const) {
        await page.keyboard.press("Shift+L");
        // no refusal for want of an order: it opens with nobody moved
        await expect(page.getByTestId("follow-round"), way).toBeVisible();
        await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
        // Following lives in the top bar: the button says so, a live line says what to do, and
        // (with a mouse) no note sits over the field. Touch keeps its note for now, until the
        // owner decides where the tablet's Following line goes
        await expect(page.getByTestId("toolbar-follow-trail")).toHaveText(
            "Following",
        );
        await expect(page.getByTestId("follow-status")).toContainText(
            "Click or drag a marcher",
        );
        if (test.info().project.name !== "browser-touch")
            await expect(page.getByTestId("path-pen-banner")).toBeHidden();
        const opened = (await overlay(page))!;
        expect(opened.tip).toBe(
            "Click or drag any marcher around the outline or out of it, or type how far",
        );
        const steps = await undoSteps(show);
        // one in the middle of the right side, not the leader the tool guessed
        const { above, grabbed, below } = rightSide(opened.memberRings);
        const guessed = opened.memberRings.find((r) => r.kind === "own")!.at;
        expect(guessed).not.toEqual(grabbed);
        const from = await toScreen(page, grabbed);
        // up the right side is counterclockwise as the field is shown, down it clockwise
        const to = await toScreen(
            page,
            way === "counterclockwise" ? above : below,
        );
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 16 });
        await expect
            .poll(async () => (await overlay(page))?.tip ?? "", {
                message: way,
            })
            .toBe("1 spot");
        // the one grabbed leads now, and the bar says which way
        const held = (await overlay(page))!;
        expect(held.memberRings.find((r) => r.kind === "own")!.at).toEqual(
            grabbed,
        );
        await expect(page.getByTestId("follow-round-way")).toContainText(
            way === "counterclockwise"
                ? "Counterclockwise around"
                : "Clockwise around",
        );
        await page.mouse.up();
        await expect(page.getByTestId("follow-round"), way).toBeHidden();
        await expect.poll(() => undoSteps(show), way).toBe(steps + 1);
        await waitForIdle(page);
        // every one went that way around, onto the next place: nobody the other way
        const after = await savedPositions(show, 1);
        const now = anglesOf(after, before);
        const sign = way === "counterclockwise" ? -1 : 1;
        for (const p of after) {
            const went = turn(was.get(p.id)!, now.get(p.id)!);
            expect(Math.sign(went), `${way} ${p.id}`).toBe(sign);
        }
        // the one grabbed stands where its neighbor that way stood
        const moved = before.find(
            (p) => Math.hypot(p.x - grabbed.x, p.y - grabbed.y) < 0.01,
        )!;
        const end = after.find((p) => p.id === moved.id)!;
        const want = way === "counterclockwise" ? above : below;
        expect(Math.hypot(end.x - want.x, end.y - want.y), way).toBeLessThan(
            0.01,
        );
        // back as placed for the other way
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => undoSteps(show), way).toBe(steps);
        await waitForIdle(page);
        await page.keyboard.press("ControlOrMeta+a");
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual(ALL);
    }
});

test("change: dragging a marcher off the outline pulls it out into a trail the rest follow; back on the outline it slides again; Enter writes the trail in one undo step", async ({
    show,
}) => {
    const { page } = show;
    await onPageOne(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const before = await savedPositions(show, 1);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    const opened = (await overlay(page))!;
    const { grabbed, below } = rightSide(opened.memberRings);
    const from = await toScreen(page, grabbed);
    // straight out of the right side, six steps
    const out = { x: grabbed.x + 6 * S, y: grabbed.y };
    const outAt = await toScreen(page, out);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(outAt.x, outAt.y, { steps: 16 });
    // pulled out: the trail's controls, not the count around
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    await expect(page.getByTestId("follow-status")).toContainText("pulled out");
    // the one grabbed leads the trail
    await expect
        .poll(
            async () =>
                (await overlay(page))?.memberRings.find((r) => r.kind === "own")
                    ?.at,
        )
        .toEqual(grabbed);
    // back onto the outline, a place on: it slides around again, the trail gone
    const on = await toScreen(page, below);
    await page.mouse.move(on.x, on.y, { steps: 16 });
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect
        .poll(async () => (await overlay(page))?.tip ?? "")
        .toBe("1 spot");
    // and out again from there: around one place, then off the outline
    const out2 = { x: below.x + 6 * S, y: below.y };
    const out2At = await toScreen(page, out2);
    await page.mouse.move(out2At.x, out2At.y, { steps: 16 });
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    // nothing written while held, nor on letting go: the trail's first point is placed
    await page.mouse.up();
    expect(await savedPositions(show, 1)).toEqual(before);
    expect(await undoSteps(show)).toBe(steps);
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-spacing")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    const after = await savedPositions(show, 1);
    // the leader ends where it was let go (on the grid there), off the outline
    const starts = await savedPositions(show, 0);
    const leader = starts.find(
        (p) => Math.hypot(p.x - grabbed.x, p.y - grabbed.y) < 0.01,
    )!;
    const end = after.find((p) => p.id === leader.id)!;
    expect(Math.hypot(end.x - out2.x, end.y - out2.y)).toBeLessThan(S);
    // and everyone followed: nobody stands where they stood
    for (const p of after) {
        const b = before.find((q) => q.id === p.id)!;
        expect(Math.hypot(p.x - b.x, p.y - b.y), `${p.id}`).toBeGreaterThan(
            S / 2,
        );
    }
    // Escape while pulled out puts the line back around the outline, nobody moved
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => undoSteps(show)).toBe(steps);
    await waitForIdle(page);
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(outAt.x, outAt.y, { steps: 16 });
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    await page.mouse.up();
    await expect(page.getByTestId("follow-round")).toBeVisible();
    expect(await undoSteps(show)).toBe(steps);
});

test("change: click a marcher, let go, then move: the line slides with no button held and the next click keeps it; carried off the outline, Straight | Curved is on the bar and Enter writes the trail", async ({
    show,
}) => {
    const { page } = show;
    await onPageOne(show);
    const S = (await fieldGrid(show)).pixelsPerStep;
    const before = await savedPositions(show, 1);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    const { grabbed, below } = rightSide((await overlay(page))!.memberRings);
    const from = await toScreen(page, grabbed);
    const to = await toScreen(page, below);
    // While Following the other tabs wait: a click on one says why and doesn't switch
    // (it's marked as waiting, aria-disabled, so the click is forced as a hand's is)
    await page.getByRole("tab", { name: "Alignment" }).click({ force: true });
    await expect(
        page.locator("[data-sonner-toast]", {
            hasText: "Finish or press Esc to leave Follow",
        }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Paths" })).toHaveAttribute(
        "data-state",
        "active",
    );
    await expect(page.getByTestId("toolbar-path-pen")).toBeDisabled();
    await expect(page.getByTestId("toolbar-set-order")).toBeDisabled();
    // a click, not a drag: nothing written; the top bar says it's held, the marcher is haloed
    // and leads at once, and the guess's arrows are gone
    await page.mouse.click(from.x, from.y);
    await expect(page.getByTestId("follow-status")).toContainText("Holding T");
    await expect(page.getByTestId("follow-status")).toContainText(
        "click to drop",
    );
    await expect(page.getByTestId("pathHeldHalo")).toHaveCount(1);
    expect(
        (await overlay(page))!.memberRings.find((r) => r.kind === "own")!.at,
    ).toEqual(grabbed);
    expect(await fieldCursorAt(page, from)).toBe("grabbing");
    // no button held: the line slides with the pointer
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await expect
        .poll(async () => (await overlay(page))?.tip ?? "")
        .toBe("1 spot · click to keep");
    expect(await savedPositions(show, 1)).toEqual(before);
    // the next click keeps it: one undo step
    await page.mouse.click(to.x, to.y);
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => undoSteps(show)).toBe(steps);
    await waitForIdle(page);

    // Again, carried off the outline: the trail follows the pointer with no button held
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await page.mouse.click(from.x, from.y);
    const out = await toScreen(page, { x: grabbed.x + 6 * S, y: grabbed.y });
    await page.mouse.move(out.x, out.y, { steps: 16 });
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    // Escape puts the line back around the outline, nothing held
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    // carried out again, and a click places the trail's first point
    await page.mouse.click(from.x, from.y);
    await page.mouse.move(out.x, out.y, { steps: 16 });
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    await page.mouse.click(out.x, out.y);
    expect(await undoSteps(show)).toBe(steps);
    // Straight | Curve on the bar while the trail is drawn (the pen's switch, DC-1)
    await expect(page.getByTestId("path-draw-straight")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await page.getByTestId("path-draw-curve").click();
    await expect(page.getByTestId("path-draw-curve")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    const next = await toScreen(page, {
        x: grabbed.x + 10 * S,
        y: grabbed.y + 4 * S,
    });
    await page.mouse.click(next.x, next.y);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-spacing")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    // the trail kept its curve: the point clicked in Curve is stored smooth
    const routes = await show.query<{ geometry: string }>(
        "SELECT geometry FROM timeline_routes",
    );
    const smooth = routes.some((r) =>
        (
            JSON.parse(r.geometry) as { points: { tension?: number }[] }
        ).points.some((pt) => (pt.tension ?? 0) > 0),
    );
    expect(smooth).toBe(true);
});

test("change: an order set on the page (not clockwise) is the one Follow walks: each moves on towards the one ahead of them in it, the leader towards the tail", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    // Set order is made at the playhead, the end of the move Follow writes
    const order = await setOrder(show);
    // they start from home's spots, the outline
    const before = await savedPositions(show, 0);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-status")).toContainText(
        "Click or drag a marcher",
    );
    // the line drawn tail first: the order turned round, its first-clicked leading
    const rings = (await overlay(page))!.memberRings;
    expect(rings.at(-1)!.at.x).toBeCloseTo(
        before.find((p) => p.id === order[0])!.x,
        3,
    );
    const steps = await undoSteps(show);
    await page.keyboard.press("1");
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await waitForIdle(page);
    const after = await savedPositions(show, 1);
    const was = anglesOf(before);
    const now = anglesOf(after, before);
    // One spot on: onto the spot of the one ahead in the order, or the empty place on the way
    // to them (the back's gap); every one turned the order's way, never the other
    let onto = 0;
    order.forEach((id, k) => {
        const ahead = order[(k + order.length - 1) % order.length]!;
        const to = turn(was.get(id)!, was.get(ahead)!);
        const went = turn(was.get(id)!, now.get(id)!);
        expect(Math.sign(went), `${id}`).toBe(Math.sign(to));
        expect(Math.abs(went), `${id}`).toBeLessThanOrEqual(
            Math.abs(to) + 1e-6,
        );
        const spot = before.find((p) => p.id === ahead)!;
        const end = after.find((p) => p.id === id)!;
        if (Math.hypot(spot.x - end.x, spot.y - end.y) < 0.01) onto++;
    });
    expect(onto).toBeGreaterThanOrEqual(order.length - 2);
});

test("change: with the order set, Shift+L opens with nobody moved; dragging the leader slides the line around, and letting go writes it in one undo step", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await setOrder(show);
    const before = await savedPositions(show, 1);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    await expect(page.getByTestId("follow-round-amount")).toHaveValue("0");
    const opened = (await overlay(page))!;
    expect(opened.tip).toBe(
        "Click or drag any marcher around the outline or out of it, or type how far",
    );
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
    await setOrder(show);
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

test("change: on a touch screen, a pencil and a finger each drag the leader around the outline, and letting go writes it; a finger pulls a marcher out into a trail", async ({
    show,
}) => {
    const { page } = show;
    await placeOutline(show);
    await selectPage(show, "Page 1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await setOrder(show);
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
    // A finger drags a marcher off the outline: pulled out into a trail, kept with Finish
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual(ALL);
    await page.keyboard.press("Shift+L");
    await expect(page.getByTestId("follow-round")).toBeVisible();
    const steps = await undoSteps(show);
    const S = (await fieldGrid(show)).pixelsPerStep;
    const { grabbed } = rightSide((await overlay(page))!.memberRings);
    await touchDrag(
        page,
        await toScreen(page, grabbed),
        await toScreen(page, { x: grabbed.x + 6 * S, y: grabbed.y }),
        { steps: 24 },
    );
    await expect(page.getByTestId("follow-round")).toBeHidden();
    await expect(page.getByTestId("follow-spacing")).toBeVisible();
    expect(await undoSteps(show)).toBe(steps);
    await page.getByTestId("path-finish").click();
    await expect(page.getByTestId("follow-spacing")).toBeHidden();
    await expect.poll(() => undoSteps(show)).toBe(steps + 1);
    await stopTouch();
});
