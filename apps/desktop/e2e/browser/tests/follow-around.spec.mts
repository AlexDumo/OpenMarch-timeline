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

// Follow round a box outline in the march order (pathways step 10, owner decision 2026-11-22):
// fifteen marchers placed with the Box tool in Outline, 4 steps wide and 9 deep. With an odd
// count the back spreads evenly, which on a box this narrow leaves only its two corners, one gap
// twice the across spacing. There is one Follow tool: on the next page the designer sets the
// march order (Set order, Shift+O, clicking them leader first), and Shift+L then follows in that
// order; the order runs round the outline, so the trail closes the loop and the leader walks on
// towards the tail's spot. Nobody moves until the leader is dragged round (the count by the
// pointer, one undo step on letting go) or a count typed. With no order set, Follow says to set
// one. Spec Appendix L.11.

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
    for (const id of order) {
        const p = at.find((q) => q.id === id)!;
        const s = await toScreen(page, p);
        await page.mouse.click(s.x, s.y);
    }
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

test("change: Shift+L round a closed outline with no march order says to set one, and opens nothing", async ({
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
    await expect(
        page.locator("[data-sonner-toast]", {
            hasText:
                "These marchers stand all the way around a circle or box outline. Set their march order first",
        }),
    ).toBeVisible();
    await expect(page.getByTestId("follow-round")).toBeHidden();
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
    await expect(page.getByTestId("path-pen-banner")).toContainText(
        "follow in their order",
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

test("change: on a touch screen, a pencil and a finger each drag the leader around the outline, and letting go writes it", async ({
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
    await stopTouch();
});
