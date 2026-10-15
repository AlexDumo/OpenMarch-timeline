import { test, expect } from "../fixtures.mjs";
import { drawnMarchers, expectCanvasMatchesShow } from "../app.mjs";
import { seedShowSql } from "../seed.mjs";

// Two marchers trade places over page 1 (beats 1 to 16, half a second each):
// at any time, T1 has moved as far right as T2 has moved left.
test.use({
    seedSql: seedShowSql({
        beats: 16,
        measureStarts: [1, 5, 9, 13],
        pageStarts: [1],
        marchers: [1, 2].map((id) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [
            [
                [1, 400, 300],
                [2, 600, 300],
            ],
            [
                [1, 600, 300],
                [2, 400, 300],
            ],
        ],
    }),
});

type Sample = { t1: { x: number; y: number }; t2: { x: number; y: number } };

test("playback draws the marchers where the show puts them at each moment", async ({
    show,
}) => {
    const { page } = show;
    await expectCanvasMatchesShow(show);

    await page.keyboard.press("Space");

    // Read the field on every frame for a while, as it plays
    const samples: Sample[] = await page.evaluate(
        () =>
            new Promise<Sample[]>((resolve) => {
                const out: Sample[] = [];
                const start = performance.now();
                const read = () => {
                    const marchers = window.fieldTest!.marchers();
                    const at = (label: string) => {
                        const { x, y } = marchers.find(
                            (m) => m.label === label,
                        )!;
                        return { x, y };
                    };
                    out.push({ t1: at("T1"), t2: at("T2") });
                    if (performance.now() - start < 2500)
                        requestAnimationFrame(read);
                    else resolve(out);
                };
                requestAnimationFrame(read);
            }),
    );
    await page.keyboard.press("Space");

    // Mid-move: somewhere strictly between the two pages' positions
    const moving = samples.filter(({ t1 }) => t1.x > 400.5 && t1.x < 599.5);
    expect(moving.length, "frames drawn mid-move").toBeGreaterThan(5);
    for (const { t1, t2 } of samples) {
        // Both are on the same moment of the same move
        expect(t1.x + t2.x).toBeCloseTo(1000, 1);
        expect(t1.y).toBeCloseTo(300, 1);
        expect(t2.y).toBeCloseTo(300, 1);
    }
    // Time only goes forward while playing
    for (let i = 1; i < samples.length; i++)
        expect(samples[i].t1.x).toBeGreaterThanOrEqual(
            samples[i - 1].t1.x - 0.01,
        );

    // Paused, the field holds the moment it stopped at
    await expect
        .poll(async () => {
            const drawn = await drawnMarchers(page);
            const t1 = drawn.find((m) => m.drillNumber === "T1")!;
            const t2 = drawn.find((m) => m.drillNumber === "T2")!;
            return Math.abs(t1.x + t2.x - 1000) < 0.01 && t1.x > 400;
        })
        .toBe(true);
});
