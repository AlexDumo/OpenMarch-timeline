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

// Pathways step 1 (fork #643, spec v0.9 Appendix I): the Path pen draws a cornered
// path for one marcher, and draws and edits it as the shape tool's Line does (owner
// lab feedback on #674). With T1 selected on Page 2, P (or Path in the toolbar's
// own Paths tab) starts the pen, clicks place corners on half steps, Backspace takes
// the last back, Enter saves the path as one undo step: a lane on T1's own slot walks it
// (ADR 0017), and T1's move stays `direct`. T1 walks the drawn path: halfway through the
// move it is halfway along it. Undo takes the path away and redo brings the same route
// back. With two marchers selected P draws a group path (step 15). A stored path is shown
// closed with its marcher selected: drawn, with no handles, its bar quiet (interaction
// round 3). A double-click on its line, or Edit path in its right-click menu, opens it;
// Escape closes it again. On the open path, a corner dragged with Shift (fine) lands off
// the grid, a click mid-leg adds a corner, each one undo step, and the corner's menu
// deletes corners; deleting the last one removes the path. Remove path in the bar's ···,
// and in the closed path's right-click menu, makes the move straight again, as does
// Backspace on the open path with no point selected; on a closed path no key does (owner,
// 2026-11-04), so Shift+Backspace doesn't.

const HOME: SeedPosition[] = [
    [1, 500, 300],
    [2, 600, 300],
];
// Page 2 sends T1 forty field units to the right
const PAGE2: SeedPosition[] = [
    [1, 900, 300],
    [2, 600, 300],
];

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

/** The path as the field draws it: its line, and how many handles it has */
const drawnPath = (page: Page) =>
    page.evaluate(() => {
        const overlay = window.fieldTest!.shapeOverlay?.() ?? null;
        return overlay
            ? {
                  points: overlay.outline?.length ?? 0,
                  handles: overlay.handles.length + overlay.addHandles.length,
              }
            : null;
    });

const undoSteps = async (show: Show) => {
    const [row] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    return row.count;
};

test("change: P draws a cornered path for one marcher, Enter saves it as one undo step, undo and redo keep its id, Remove path takes it away", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);
    const grid = await fieldGrid(show);
    const S = grid.pixelsPerStep;
    const cf = grid.centerFront;
    /** `p` on the half-step grid the pen lands corners on */
    const onGrid = (p: Point): Point => ({
        x: cf.x + Math.round((p.x - cf.x) / (S / 2)) * (S / 2),
        y: cf.y + Math.round((p.y - cf.y) / (S / 2)) * (S / 2),
    });
    const click = async (p: Point) => {
        const at = await toScreen(page, p);
        await page.mouse.move(at.x, at.y, { steps: 4 });
        await page.mouse.click(at.x, at.y);
    };

    await selectPage(show, "Page 2");
    // Several marchers: the pen draws one group path for them (step 15, path-group.spec.mts);
    // Escape cancels it
    await clickMarcher(page, "T1");
    await clickMarcher(page, "T2", { add: true });
    await page.keyboard.press("p");
    await expect(page.getByTestId("path-pen-banner")).toContainText(
        "Group path for 2 marchers",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("path-pen-banner")).toBeHidden();

    // One marcher: the pen is in its own tab, and the hint says who it's for
    await clickMarcher(page, "T1");
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([1]);
    const steps = await undoSteps(show);
    await page.getByTestId("toolbar-paths-tab").click();
    await page.getByTestId("toolbar-path-pen").click();
    await expect(page.getByTestId("path-pen-banner")).toContainText("T1");
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "drawing",
    );

    // Two corners: up and over, then down to the end spot
    const c1 = onGrid({ x: 500, y: 300 - 8 * S });
    const c2 = onGrid({ x: 900, y: 300 - 8 * S });
    await click(c1);
    await click(c2);
    // Backspace takes the last back, and it's placed again (after the double-click time,
    // which would finish the path)
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(600);
    await click(c2);
    await page.keyboard.press("Enter");
    await waitForIdle(page);

    const [route] = await routes(show);
    const pointsOf = (r: { geometry: string }) =>
        (
            JSON.parse(r.geometry) as {
                points: { id: string; at: [number, number] }[];
            }
        ).points;
    const geometry = { points: pointsOf(route!) };
    expect(geometry.points).toHaveLength(2);
    expect(geometry.points[0]!.at[0]).toBeCloseTo(c1.x, 3);
    expect(geometry.points[0]!.at[1]).toBeCloseTo(c1.y, 3);
    expect(geometry.points[1]!.at[0]).toBeCloseTo(c2.x, 3);
    expect(await undoSteps(show)).toBe(steps + 1);
    // Saved on a lane of T1's own slot (ADR 0017, an own lane: no offset); its move stays direct
    expect(
        await show.query(
            `SELECT l.route_id AS route, l.offset_x AS ox, l.offset_y AS oy,
                    t.path_style AS style
               FROM timeline_lanes l
               JOIN timeline_transitions t ON t.id = l.transition_id
               JOIN timeline_assignments a
                 ON a.transition_id = l.transition_id AND a.slot_index = l.slot_index
              WHERE a.marcher_id = 1`,
        ),
    ).toEqual([{ route: route!.id, ox: null, oy: null, style: "direct" }]);
    // Finished, the path closes: its bar stays, quiet, and the selected marcher's line is drawn
    // through its corners with nothing to grab (interaction round 3: a selected marcher's own
    // line shows)
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "closed",
    );
    await expect.poll(() => drawnPath(page)).toEqual({ points: 4, handles: 0 });

    // T1 walks the path it was drawn: halfway through the move (four of its eight counts back
    // from its end) it is halfway along it, the middle of the top leg
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Q");
    await expect(page.getByTestId("timeline-readout")).toContainText("ct 4/8");
    const t1At = async () => {
        const t1 = (await drawnMarchers(page)).find((m) => m.id === 1)!;
        return [Math.round(t1.x), Math.round(t1.y)];
    };
    await expect
        .poll(t1At)
        .toEqual([Math.round((c1.x + c2.x) / 2), Math.round(c1.y)]);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+E");
    await expect(page.getByTestId("timeline-readout")).toContainText("ct 8/8");
    await expect.poll(t1At).toEqual([900, 300]);

    // Undo takes it away; redo brings the same route back
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    expect(await routes(show)).toEqual([]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForIdle(page);
    expect(await routes(show)).toEqual([route]);

    // Empty field clears the selection, and the path goes; selecting T1 again shows it closed
    const empty = await toScreen(page, { x: 300, y: 300 + 20 * S });
    await page.mouse.click(empty.x, empty.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    await expect.poll(() => drawnPath(page)).toBeNull();
    await clickMarcher(page, "T1");
    await expect.poll(() => drawnPath(page)).toEqual({ points: 4, handles: 0 });
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "closed",
    );

    // A click on empty field beside the closed path is the field's: it clears the selection
    // A quarter of the way along the top leg: clear of the corner a click mid-leg adds later,
    // which a double-click here would pick instead of the line
    const top = { x: 600, y: c1.y };
    const beside = await toScreen(page, { x: top.x, y: top.y + 2 * S });
    await page.mouse.click(beside.x, beside.y);
    await expect
        .poll(async () => (await readField(page)).selection)
        .toEqual([]);
    await clickMarcher(page, "T1");
    await expect.poll(() => drawnPath(page)).not.toBeNull();

    // A double-click on the path's line opens it, keeping T1 selected: its handles and the
    // floating editor, with no name in it
    const onLine = await toScreen(page, top);
    await page.mouse.move(onLine.x, onLine.y, { steps: 4 });
    await page.mouse.dblclick(onLine.x, onLine.y);
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "open",
    );
    expect((await readField(page)).selection).toEqual([1]);
    expect((await drawnPath(page))!.handles).toBeGreaterThan(0);
    await expect(page.getByTestId("path-editor")).not.toContainText("T1");

    // Escape closes it; it stays drawn, with T1 selected
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "closed",
    );
    await expect.poll(() => drawnPath(page)).toEqual({ points: 4, handles: 0 });
    expect((await readField(page)).selection).toEqual([1]);

    // A right-click on its line: the field's menu offers Edit path and Remove path; Edit path
    // opens it
    await page.mouse.click(onLine.x, onLine.y, { button: "right" });
    const fieldMenu = page.getByTestId("field-menu");
    await expect(fieldMenu).toBeVisible();
    await expect(fieldMenu.getByTestId("field-menu-editPath")).toBeVisible();
    await expect(fieldMenu.getByTestId("field-menu-removePath")).toBeVisible();
    await expect(
        fieldMenu.getByTestId("field-menu-selectAllMarchers"),
    ).toHaveCount(0);
    await fieldMenu.getByTestId("field-menu-editPath").click();
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "open",
    );

    // A corner dragged with Shift (fine) lands where it's let go, off the half steps, as a
    // Line's point does; the held-roles chip names fine while it's dragged. The drag goes past
    // the field's drag threshold (a few screen pixels), so it isn't taken for a click
    const before = await undoSteps(show);
    const from = await toScreen(page, c2);
    const off = { x: c2.x + 1.3 * S, y: c2.y + 0.7 * S };
    const to = await toScreen(page, off);
    await page.mouse.move(from.x, from.y, { steps: 4 });
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.getByTestId("heldRolesChip")).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await waitForIdle(page);
    const dragged = pointsOf((await routes(show))[0]!);
    expect(dragged[0]!.at).toEqual(geometry.points[0]!.at);
    expect(Math.abs(dragged[1]!.at[0] - off.x)).toBeLessThan(1);
    expect(Math.abs(dragged[1]!.at[1] - off.y)).toBeLessThan(1);
    const snapped = onGrid({ x: dragged[1]!.at[0], y: dragged[1]!.at[1] });
    expect(
        Math.hypot(
            snapped.x - dragged[1]!.at[0],
            snapped.y - dragged[1]!.at[1],
        ),
    ).toBeGreaterThan(0.5);
    expect(await undoSteps(show)).toBe(before + 1);

    // A click in the middle of a leg adds a corner there (one undo step)
    await click({
        x: (dragged[0]!.at[0] + dragged[1]!.at[0]) / 2,
        y: (dragged[0]!.at[1] + dragged[1]!.at[1]) / 2,
    });
    await waitForIdle(page);
    await expect
        .poll(async () => pointsOf((await routes(show))[0]!).length)
        .toBe(3);
    expect(await undoSteps(show)).toBe(before + 2);

    // Remove path, from the floating editor's ···
    await page.getByTestId("path-more").click();
    await page.getByTestId("path-more-menu").getByTestId("path-remove").click();
    await waitForIdle(page);
    expect(await routes(show)).toEqual([]);
    await expect(page.getByTestId("path-editor")).toBeHidden();
    // Undo brings it back, with its three corners, closed
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    await expect.poll(async () => (await routes(show)).length).toBe(1);
    await expect.poll(() => drawnPath(page)).toEqual({ points: 5, handles: 0 });
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "closed",
    );

    // Shift+Backspace does nothing to it: Remove path has no key
    await page.keyboard.press("Shift+Backspace");
    await waitForIdle(page);
    expect((await routes(show)).length).toBe(1);

    // Remove path in its right-click menu removes the closed path, as one undo step; undo brings
    // it back
    const beforeRemove = await undoSteps(show);
    await page.mouse.click(onLine.x, onLine.y, { button: "right" });
    await page
        .getByTestId("field-menu")
        .getByTestId("field-menu-removePath")
        .click();
    await waitForIdle(page);
    await expect.poll(async () => routes(show)).toEqual([]);
    expect(await undoSteps(show)).toBe(beforeRemove + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    await expect.poll(async () => (await routes(show)).length).toBe(1);

    // Opened again by a double-click on its line
    await page.mouse.dblclick(onLine.x, onLine.y);
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "open",
    );

    // Open with no point selected, Backspace removes the path (owner, 2026-11-04), one undo step;
    // undo brings it back, and it's opened again
    const beforeKey = await undoSteps(show);
    await page.keyboard.press("Backspace");
    await waitForIdle(page);
    await expect.poll(async () => routes(show)).toEqual([]);
    expect(await undoSteps(show)).toBe(beforeKey + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await waitForIdle(page);
    await expect.poll(async () => (await routes(show)).length).toBe(1);
    await page.mouse.dblclick(onLine.x, onLine.y);
    await expect(page.getByTestId("path-editor")).toHaveAttribute(
        "data-phase",
        "open",
    );

    // The corner's menu deletes corners; the last one removes the path, so none is left with
    // no corner, as one undo step
    const menu = page.getByTestId("shape-menu");
    for (let left = 3; left > 0; left--) {
        const corner = pointsOf((await routes(show))[0]!)[0]!;
        const at = await toScreen(page, { x: corner.at[0], y: corner.at[1] });
        await page.mouse.move(at.x, at.y, { steps: 4 });
        await page.mouse.click(at.x, at.y, { button: "right" });
        await expect(menu).toBeVisible();
        const undoBefore = await undoSteps(show);
        await menu.getByTestId("shape-menu-delete").click();
        await waitForIdle(page);
        if (left > 1)
            await expect
                .poll(async () => pointsOf((await routes(show))[0]!).length)
                .toBe(left - 1);
        else await expect.poll(async () => routes(show)).toEqual([]);
        expect(await undoSteps(show)).toBe(undoBefore + 1);
    }
    await expect(page.getByTestId("path-editor")).toBeHidden();
    await expectCanvasMatchesShow(show);
});
