import { test, expect } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    selectPage,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Record path (prototype, 2026-11-25): with T1 selected, Alt+Shift+R counts in four clicks,
// then plays the move at the playhead while a drag on the field moves T1 with the pointer. The
// take is saved as T1's exact path, with its end spot where it ended, in one undo step.

const HOME: SeedPosition[] = [
    [1, 500, 300],
    [2, 600, 300],
];
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
    allowedPageErrors: [/Audio worklet error/],
});

test("change: Record path saves the drag as T1's exact path and moves its end spot, in one undo step", async ({
    show,
}) => {
    test.setTimeout(60_000);
    const { page } = show;
    await expectCanvasMatchesShow(show);
    await selectPage(show, "Page 2");
    await clickMarcher(page, "T1");
    const [before] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );

    await page.keyboard.press("Alt+Shift+R");
    const counter = page.getByTestId("record-path-counter");
    await expect(counter).toBeVisible();
    await expect(counter).toContainText("Recording", { timeout: 10_000 });

    const t1 = (await drawnMarchers(page)).find((m) => m.id === 1)!;
    await page.mouse.move(t1.screen.x, t1.screen.y);
    await page.mouse.down();
    for (let i = 1; i <= 120; i++) {
        await page.mouse.move(
            t1.screen.x + i * 2,
            t1.screen.y - 60 * Math.sin((i / 120) * Math.PI),
        );
        await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect(counter).toBeHidden({ timeout: 20_000 });
    await waitForIdle(page);

    const rows = await show.query<{ exact_path: string }>(
        "SELECT exact_path FROM timeline_routes WHERE exact_path IS NOT NULL",
    );
    expect(rows).toHaveLength(1);
    const path = JSON.parse(rows[0]!.exact_path) as {
        shapes: { kind: string; points: [number, number][] }[];
        keys: { tick: number; u: number }[];
    };
    expect(path.shapes[0]!.kind).toBe("points");
    expect(path.shapes[0]!.points.length).toBeGreaterThan(2);
    // The arc up and over: some point well above the start
    expect(
        Math.min(...path.shapes[0]!.points.map((p) => p[1])),
    ).toBeLessThan(300 - 20);
    const [after] = await show.query<{ count: number }>(
        "SELECT COUNT(DISTINCT history_group) AS count FROM history_undo",
    );
    expect(after!.count).toBe(before!.count + 1);
});
