import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    readField,
    selectPage,
    waitForIdle,
} from "../app.mjs";
import { fieldGrid } from "../positions.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Pathways step 15 (fork #656, spec v0.9 R-14 "Group schedule", Appendix I.8) as reworked by
// interaction round 7 (spec, "Loose paths (round 7)"; owner 2026-11-15). With a 2 × 2 block
// selected on Page 2 (by a marquee), P draws one group path from the middle of their starts, and
// Enter saves it as one undo step. The block isn't a placed shape, so the path doesn't stay one
// live group path: each member gets its own identical copy of it, on a lane of its own slot that
// keeps its offset in the block (ADR 0017), and their moves stay `direct`. Every member walks the
// one drawn path in its place in the block. Undo takes it away and redo brings back the same
// copies. One member selected shows only its own line, and Remove path takes only that marcher's.
// The whole block selected again shows the copies as one path ("4 paths"), and Remove path takes
// them all; the toast says for how many marchers. A live group path (kept only for a placed
// shape's members) and its Detach and Rejoin are covered by timelineGroupRoutes.test.ts,
// timelineLoosePaths.test.ts and timelineDetachParity.test.ts.

const HOME: SeedPosition[] = [
    [1, 500, 300],
    [2, 540, 300],
    [3, 500, 340],
    [4, 540, 340],
];
// Page 2 slides the block 400 field units to the right: its end set is its start moved over
const PAGE2: SeedPosition[] = HOME.map(([id, x, y]) => [id, x + 400, y]);

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
        positions: [HOME, HOME, PAGE2],
    }),
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

const routes = (show: Show) =>
    show.query<{ id: number; geometry: string }>(
        "SELECT id, geometry FROM timeline_routes ORDER BY id",
    );

/** Each marcher in move `timelineId`: the lane on its slot (route and offset), and its move's style */
const walkers = (show: Show, timelineId: number) =>
    show.query<{
        marcher: number;
        route: number | null;
        ox: number | null;
        oy: number | null;
        style: string;
    }>(
        `SELECT a.marcher_id AS marcher, l.route_id AS route, l.offset_x AS ox,
                l.offset_y AS oy, t.path_style AS style
           FROM timeline_assignments a JOIN timeline_transitions t ON t.id = a.transition_id
           LEFT JOIN timeline_lanes l
             ON l.transition_id = a.transition_id AND l.slot_index = a.slot_index
          WHERE t.timeline_id = ${timelineId} ORDER BY a.marcher_id`,
    );

const overlay = (page: Page) =>
    page.evaluate(() => {
        const o = window.fieldTest!.shapeOverlay?.() ?? null;
        return o
            ? {
                  lanes: o.lanes,
                  rings: o.memberRings.map((r) => r.kind),
                  labels: o.memberRings.map((r) => r.label),
              }
            : null;
    });

const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

/** A marquee from field point `from` to field point `to`, as a person selects the block */
async function marquee(page: Page, from: Point, to: Point) {
    const a = await toScreen(page, from);
    const b = await toScreen(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await waitForIdle(page);
}

test("change: P with a block selected draws one path; each member walks its own copy in its place; Remove path takes one member's or the block's", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    const onGrid = (p: Point): Point => ({
        x: cf.x + Math.round((p.x - cf.x) / (S / 2)) * (S / 2),
        y: cf.y + Math.round((p.y - cf.y) / (S / 2)) * (S / 2),
    });
    // The block, by a marquee from its top-right past its bottom-left. A click on empty field
    // first lets go of any selection, so no path or path bar is under the marquee
    const selectBlock = async () => {
        const empty = await toScreen(page, { x: 300, y: 300 + 20 * S });
        await page.mouse.click(empty.x, empty.y);
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual([]);
        await marquee(page, { x: 985, y: 260 }, { x: 860, y: 370 });
        await expect
            .poll(async () => (await readField(page)).selection)
            .toEqual([1, 2, 3, 4]);
    };

    await selectPage(show, "Page 2");
    await selectBlock();
    const steps = await undoSteps(show);
    await page.keyboard.press("p");
    await expect(page.getByTestId("path-pen-banner")).toContainText(
        "Group path for 4 marchers",
    );

    // One corner above the block's middle, halfway along; Enter saves the group path
    const corner = onGrid({ x: 720, y: 320 - 8 * S });
    const at = await toScreen(page, corner);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press("Enter");
    await waitForIdle(page);

    // Saved as each member's own copy of the one path drawn: the same geometry, from the middle
    // of their starts to the middle of their ends through the corner
    await expect.poll(async () => (await routes(show)).length).toBe(4);
    const saved = await routes(show);
    expect(new Set(saved.map((r) => r.geometry)).size).toBe(1);
    const geometry = JSON.parse(saved[0]!.geometry) as {
        from: [number, number];
        to: [number, number];
        points: { at: [number, number] }[];
    };
    expect(geometry.from).toEqual([520, 320]);
    expect(geometry.to).toEqual([920, 320]);
    // Points are stored to a thousandth of a field unit
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]!.at[0]).toBeCloseTo(corner.x, 3);
    expect(geometry.points[0]!.at[1]).toBeCloseTo(corner.y, 3);
    // Each member's lane walks its own copy with its offset in the block; the moves stay direct
    const [{ timeline }] = await show.query<{ timeline: number }>(
        `SELECT t.timeline_id AS timeline FROM timeline_lanes l
           JOIN timeline_transitions t ON t.id = l.transition_id
          WHERE l.route_id = ${saved[0]!.id} LIMIT 1`,
    );
    const drawn = await walkers(show, timeline);
    expect(drawn.map((w) => w.route).sort()).toEqual(
        saved.map((r) => r.id).sort(),
    );
    expect(drawn.map((w) => w.style)).toEqual(Array(4).fill("direct"));
    const offsets = [
        [-20, -20],
        [20, -20],
        [-20, 20],
        [20, 20],
    ];
    expect(drawn.map((w) => [w.ox, w.oy])).toEqual(offsets);
    expect(await undoSteps(show)).toBe(steps + 1);
    // Every member's line is drawn
    await expect.poll(async () => (await overlay(page))?.lanes).toBe(4);

    // They walk the path in their places: halfway through the move (four of its eight counts back
    // from its end) the block's middle is at the corner, each member its offset from it
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Q");
    await expect(page.getByTestId("timeline-readout")).toContainText("ct 4/8");
    await expect
        .poll(async () =>
            (await drawnMarchers(page))
                .sort((a, b) => a.id - b.id)
                .map((m) => [
                    Math.round(m.x - corner.x),
                    Math.round(m.y - corner.y),
                ]),
        )
        .toEqual(offsets);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+E");
    await expect(page.getByTestId("timeline-readout")).toContainText("ct 8/8");

    // Undo takes it away; redo brings back the same copies
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await routes(show)).length).toBe(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(async () => routes(show)).toEqual(saved);

    // One member selected: only its own line. Remove path takes only its copy, as one undo step
    await clickMarcher(page, "T2");
    await expect.poll(async () => (await overlay(page))?.lanes).toBe(1);
    const line = await toScreen(page, {
        x: corner.x + offsets[1]![0]!,
        y: corner.y + offsets[1]![1]!,
    });
    const beforeOne = await undoSteps(show);
    await page.mouse.click(line.x, line.y, { button: "right" });
    const fieldMenu = page.getByTestId("field-menu");
    await expect(fieldMenu.getByTestId("field-menu-removePath")).toBeVisible();
    await fieldMenu.getByTestId("field-menu-removePath").click();
    await expect(
        page.getByText("Removed the path for 1 marcher"),
    ).toBeVisible();
    await expect.poll(async () => (await routes(show)).length).toBe(3);
    expect((await walkers(show, timeline)).map((w) => w.route)).toEqual([
        drawn[0]!.route,
        null,
        drawn[2]!.route,
        drawn[3]!.route,
    ]);
    expect(await undoSteps(show)).toBe(beforeOne + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    await expect.poll(async () => routes(show)).toEqual(saved);

    // The whole block selected again: its identical copies show as one path, labeled "4 paths", and
    // Remove path, from the path bar's ···, takes every member's as one undo step
    await selectBlock();
    await expect.poll(async () => (await overlay(page))?.lanes).toBe(4);
    await expect(page.getByTestId("path-group-label")).toHaveText("4 paths");
    const beforeAll = await undoSteps(show);
    await page.getByTestId("path-more").click();
    await page.getByTestId("path-more-menu").getByTestId("path-remove").click();
    await expect(
        page.getByText("Removed the path for 4 marchers"),
    ).toBeVisible();
    await expect.poll(async () => (await routes(show)).length).toBe(0);
    expect((await walkers(show, timeline)).map((w) => w.route)).toEqual(
        Array(4).fill(null),
    );
    expect(await undoSteps(show)).toBe(beforeAll + 1);
    await expectCanvasMatchesShow(show);
});
