import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import { field, OUT, LABEL, settle } from "./compare.mjs";
import { isolate } from "../timeline.mjs";

/**
 * Set vs Following's look on the field (#300, #301): a Following marcher's
 * edge is dashed at full strength: an outline round its fill at 60%, a shape
 * without one with nothing inside. An X dashes its
 * own lines. The field test API's `following` says what the field means to
 * draw; this checks the pixels.
 *
 * - The test on white asserts the dashes and the fill for every shape.
 * - The contact sheet captures every shape and style, Set beside Following,
 *   on white, a dark theme and turf (with `TURF_IMAGE` naming a field image;
 *   skipped without), at the opening zoom and at 3×, plus an isolated move.
 *   Captures go to `OUT/<LABEL>/following-*.png` for a person to review.
 *
 *     TURF_IMAGE=~/turf.png pnpm exec playwright test --project=render following-look
 */

const SHAPES = ["circle", "square", "triangle", "x"] as const;
const STYLES = [
    { name: "filled", fill: "rgba(220,0,0,1)", outline: "NULL" },
    { name: "outline", fill: "rgba(0,0,0,0)", outline: "rgba(0,0,200,1)" },
    { name: "both", fill: "rgba(220,0,0,1)", outline: "rgba(0,0,0,1)" },
] as const;

/** One section per shape and style, two marchers each: Set (moves over page 1) and Following (stays). */
const sections = SHAPES.flatMap((shape, row) =>
    STYLES.map((style, column) => ({
        shape,
        style,
        name: `${shape}-${style.name}`,
        set: row * 6 + column * 2 + 1,
        following: row * 6 + column * 2 + 2,
        x: 300 + column * 110,
        y: 300 + row * 55,
    })),
);
const marchers = sections.flatMap((s) => [
    { id: s.set, section: s.name, prefix: "S", order: s.set },
    { id: s.following, section: s.name, prefix: "F", order: s.following },
]);
const home: SeedPosition[] = sections.flatMap((s) => [
    [s.set, s.x, s.y - 16] as const,
    [s.following, s.x + 40, s.y] as const,
]);
const page1: SeedPosition[] = sections.flatMap((s) => [
    [s.set, s.x, s.y] as const,
    [s.following, s.x + 40, s.y] as const,
]);

const SHOW_SQL = [
    ...seedShowSql({
        beats: 16,
        measureStarts: [1, 5, 9, 13],
        pageStarts: [1],
        marchers,
        positions: [home, page1],
    }),
    `INSERT INTO section_appearances (section, fill_color, outline_color, shape_type, visible, label_visible) VALUES ${sections
        .map(
            (s) =>
                `('${s.name}', '${s.style.fill}', ${
                    s.style.outline === "NULL" ? "NULL" : `'${s.style.outline}'`
                }, '${s.shape}', 1, 1)`,
        )
        .join(", ")}`,
];

const color = (r: number, g: number, b: number) =>
    `json('{"r":${r},"g":${g},"b":${b},"a":1}')`;
const DARK_SQL = `UPDATE field_properties SET json_data = json_set(json_data,
    '$.theme.background', ${color(24, 28, 36)},
    '$.theme.primaryStroke', ${color(235, 235, 235)},
    '$.theme.secondaryStroke', ${color(120, 130, 150)},
    '$.theme.tertiaryStroke', ${color(60, 66, 80)},
    '$.theme.defaultMarcher.label', ${color(240, 240, 240)})`;
const turfSql = (file: string) => [
    `UPDATE field_properties SET image = X'${fs.readFileSync(file).toString("hex")}',
        json_data = json_set(json_data, '$.showFieldImage', json('true'),
            '$.imageFillOrFit', 'fill', '$.backgroundImageOpacity', 1)`,
];

/** Waits until page 1's flag is shown with every Following marcher marked so. */
async function onPage1(page: Page) {
    await page.setViewportSize({ width: 2000, height: 1400 });
    await page.waitForFunction(
        (n) => window.fieldTest?.marchers().length === n,
        marchers.length,
    );
    await page.keyboard.press("e");
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    window
                        .fieldTest!.marchers()
                        .filter((m) => m.following)
                        .map((m) => m.id).length,
            ),
        )
        .toBe(sections.length);
    await settle(page);
    await page.waitForTimeout(300);
}

/** Zooms the field about the marchers with Ctrl+wheel until its zoom is at least `times` what it was. */
async function zoomBy(page: Page, times: number) {
    const start = await zoomOf(page);
    const box = (await field(page).boundingBox())!;
    const screens = await page.evaluate(() =>
        window.fieldTest!.marchers().map((m) => m.screen),
    );
    const x = screens.reduce((sum, s) => sum + s.x, 0) / screens.length;
    const y = screens.reduce((sum, s) => sum + s.y, 0) / screens.length;
    await page.mouse.move(
        Math.min(Math.max(x, box.x + 10), box.x + box.width - 10),
        Math.min(Math.max(y, box.y + 10), box.y + box.height - 10),
    );
    await page.keyboard.down("Control");
    await expect
        .poll(
            async () => {
                await page.mouse.wheel(0, -30);
                return zoomOf(page);
            },
            { intervals: [100], timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(start * times);
    await page.keyboard.up("Control");
    await centerMarchers(page);
}

/** Pans (wheel, trackpad mode) until the marchers' middle is the field's. */
async function centerMarchers(page: Page) {
    const box = (await field(page).boundingBox())!;
    const offset = async () => {
        const screens = await page.evaluate(() =>
            window.fieldTest!.marchers().map((m) => m.screen),
        );
        const xs = screens.map((s) => s.x);
        const ys = screens.map((s) => s.y);
        return {
            x:
                (Math.min(...xs) + Math.max(...xs)) / 2 -
                (box.x + box.width / 2),
            y:
                (Math.min(...ys) + Math.max(...ys)) / 2 -
                (box.y + box.height / 2),
        };
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
        .poll(
            async () => {
                const { x, y } = await offset();
                if (Math.abs(x) < 4 && Math.abs(y) < 4) return true;
                await page.mouse.wheel(x, y);
                return false;
            },
            { intervals: [150], timeout: 10_000 },
        )
        .toBe(true);
    await settle(page);
    await page.waitForTimeout(300);
}

const zoomOf = async (page: Page) =>
    (await page.evaluate(() => window.fieldTest!.viewport())).zoom;

/** Captures the marchers and a margin round them, as the viewport shows them. */
async function capture(page: Page, name: string, margin = 30) {
    const screens = await page.evaluate(() =>
        window.fieldTest!.marchers().map((m) => m.screen),
    );
    const zoom = await zoomOf(page);
    const pad = margin * zoom;
    const xs = screens.map((s) => s.x);
    const ys = screens.map((s) => s.y);
    const clip = {
        x: Math.max(0, Math.min(...xs) - pad),
        y: Math.max(0, Math.min(...ys) - pad),
        width: Math.max(...xs) - Math.min(...xs) + 2 * pad,
        height: Math.max(...ys) - Math.min(...ys) + 2 * pad,
    };
    const folder = path.join(OUT, LABEL);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
        path.join(folder, `${name}.png`),
        await page.screenshot({ clip }),
    );
}

test.describe("following look", () => {
    test.use({ seedSql: SHOW_SQL });

    test("a Following edge is dashed at full strength, round a 60% fill only inside an outline", async ({
        show,
    }) => {
        const { page } = show;
        await onPage1(page);
        await zoomBy(page, 3);
        const png = await field(page).screenshot();
        const box = (await field(page).boundingBox())!;
        const scale = png.readUInt32BE(16) / box.width;
        const drawn = await page.evaluate(() =>
            window.fieldTest!.marchers().map((m) => ({
                id: m.id,
                screen: m.screen,
            })),
        );
        const at = (id: number) => {
            const { screen } = drawn.find((m) => m.id === id)!;
            return {
                x: (screen.x - box.x) * scale,
                y: (screen.y - box.y) * scale,
            };
        };
        const checked = sections.filter((s) => s.style.name !== "outline");
        const profiles = await edgeProfiles(
            page,
            png,
            checked.map((s) => ({
                shape: s.shape,
                set: at(s.set),
                following: at(s.following),
            })),
        );
        for (const [i, s] of checked.entries()) {
            const profile = profiles[i]!;
            // Every dash at the Set shape's full contrast, with a gap between each
            const least = s.shape === "triangle" ? 6 : 8;
            expect(profile.gaps, `${s.name} gaps`).toBeGreaterThanOrEqual(
                least,
            );
            expect(profile.dash, `${s.name} dash`).toBeGreaterThan(0.9);
            // An X's lines are its dashes; it has no fill
            if (s.shape === "x") continue;
            // Inside a dashed outline the fill is at 60%; without an outline, nothing
            if (s.style.name === "both")
                expect(profile.fill, `${s.name} fill`).toBeCloseTo(0.6, 1);
            else expect(profile.fill, `${s.name} fill`).toBeLessThan(0.1);
        }
    });

    test("contact sheet on white", async ({ show }) => {
        const { page } = show;
        await onPage1(page);
        await capture(page, "following-white-fit");
        await zoomBy(page, 3);
        await capture(page, "following-white-3x");
    });
});

test.describe("following look, dark", () => {
    test.use({ seedSql: [...SHOW_SQL, DARK_SQL] });
    test("contact sheet on a dark theme", async ({ show }) => {
        const { page } = show;
        await onPage1(page);
        await capture(page, "following-dark-fit");
        await zoomBy(page, 3);
        await capture(page, "following-dark-3x");
    });
});

const TURF = process.env.TURF_IMAGE;
test.describe("following look, turf", () => {
    test.skip(!TURF, "Set TURF_IMAGE to a field image to capture on turf");
    test.use({ seedSql: TURF ? [...SHOW_SQL, ...turfSql(TURF)] : SHOW_SQL });
    test("contact sheet on turf", async ({ show }) => {
        const { page } = show;
        await page.waitForFunction(
            () => window.fieldTest?.fieldImage() != null,
        );
        await onPage1(page);
        await capture(page, "following-turf-fit");
        await zoomBy(page, 3);
        await capture(page, "following-turf-3x");
    });
});

// Over page 2 (beats 9–17) T1 and T2 move (T1 with a detour), T3 has a stay
// move and T4 holds.
// Isolating that move on its flag: T1 and T2 Set, T3 Following, T4 dimmed
// outside it, beside the move's gray dashed ghosts
test.describe("following look, isolated", () => {
    test.use({
        seedSql: [
            ...seedShowSql({
                beats: 24,
                measureStarts: [1, 5, 9, 13, 17, 21],
                pageStarts: [1, 9],
                marchers: [1, 2, 3, 4].map((id) => ({
                    id,
                    section: "Trumpet",
                    prefix: "T",
                    order: id,
                })),
                positions: [
                    [
                        [1, 400, 300],
                        [2, 450, 300],
                        [3, 500, 300],
                        [4, 550, 300],
                    ],
                    [
                        [1, 400, 330],
                        [2, 450, 330],
                        [3, 500, 330],
                        [4, 550, 330],
                    ],
                    [
                        [1, 400, 370],
                        [2, 450, 370],
                        [3, 500, 330],
                        [4, 550, 330],
                    ],
                ],
            }),
            // T4 (slot 3) has no move over page 2: it holds there
            "DELETE FROM timeline_assignments WHERE transition_id = 2 AND marcher_id = 4",
            "DELETE FROM timeline_slot_destinations WHERE transition_id = 2 AND slot_index = 3",
            "UPDATE timeline_transitions SET slot_count = 3 WHERE id = 2",
            // A detour takes T1 out of page 2's move over beats 11–13, so
            // isolating that move draws T1's ghost
            "INSERT INTO timelines (id, start_beat, end_beat) VALUES (3, 11, 13)",
            `INSERT INTO timeline_transitions (id, timeline_id, slot_count, start_beat, end_beat)
             VALUES (3, 3, 1, 11, 13)`,
            "INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES (3, 0, 370, 345)",
            `INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat, layer)
             VALUES (1, 3, 0, 11, 13, 1)`,
            "DELETE FROM timeline_change_log",
        ],
    });
    test("an isolated move beside Following marchers", async ({ show }) => {
        const { page } = show;
        await page.setViewportSize({ width: 2000, height: 1400 });
        await page.waitForFunction(
            () => window.fieldTest?.marchers().length === 4,
        );
        await isolate(page, 8);
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window
                        .fieldTest!.marchers()
                        .map((m) =>
                            m.dimmed
                                ? "dimmed"
                                : m.following
                                  ? "following"
                                  : "set",
                        ),
                ),
            )
            .toEqual(["set", "set", "following", "dimmed"]);
        await zoomBy(page, 3);
        await capture(page, "following-isolated-3x", 60);
        // Mid-move, where the move's ghosts show
        await page.keyboard.press("Shift+Q");
        await settle(page);
        await page.waitForTimeout(400);
        await capture(page, "following-isolated-mid-move-3x", 60);
    });
});

type ShapeName = (typeof SHAPES)[number];
type Point = { x: number; y: number };

/** The colors at device-pixel `points` in a field capture, as [r, g, b]. */
const pixelsAt = (page: Page, png: Buffer, points: readonly Point[]) =>
    page.evaluate(
        async ({ base64, points }) => {
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(
                new Blob([bytes], { type: "image/png" }),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            return points.map(({ x, y }) => {
                const d = context.getImageData(
                    Math.round(x),
                    Math.round(y),
                    1,
                    1,
                ).data;
                return [d[0]!, d[1]!, d[2]!];
            });
        },
        { base64: png.toString("base64"), points },
    );

/** How far a color is from the field's: the most any channel differs, 0 to 255. */
const contrast = (color: number[], background: number[]) =>
    Math.max(...color.map((v, i) => Math.abs(v - background[i]!)));

const SQUARE_HALF = 5 * Math.sqrt(Math.PI) * 0.6;
const TRIANGLE_HW = 6;
const TRIANGLE_HH = TRIANGLE_HW * Math.sqrt(3) * 0.5;

/** Points along a closed polygon, `steps` in all. */
function around(corners: readonly [number, number][], steps: number) {
    const path: [number, number][] = [];
    const each = steps / corners.length;
    corners.forEach(([x0, y0], c) => {
        const [x1, y1] = corners[(c + 1) % corners.length]!;
        for (let k = 0; k < each; k++)
            path.push([
                x0 + ((x1 - x0) * k) / each,
                y0 + ((y1 - y0) * k) / each,
            ]);
    });
    return path;
}

/**
 * Points, in shape units from the marcher, along the middle of a Following
 * shape's dashed edge (inset by half its width), or along an X's four arms.
 */
function edgePath(shape: ShapeName, inset: number): [number, number][] {
    const steps = 400;
    if (shape === "circle")
        return Array.from({ length: steps }, (_, k) => {
            const a = (k / steps) * Math.PI * 2;
            return [Math.cos(a) * (5 - inset), Math.sin(a) * (5 - inset)];
        });
    if (shape === "square") {
        const h = SQUARE_HALF - inset;
        return around(
            [
                [-h, -h],
                [h, -h],
                [h, h],
                [-h, h],
            ],
            steps,
        );
    }
    if (shape === "triangle") {
        // Shrunk toward the centroid by the inset
        const centroid = TRIANGLE_HH / 3;
        const inRadius = TRIANGLE_HW / Math.sqrt(3);
        const k = (inRadius - inset) / inRadius;
        const corners: [number, number][] = [
            [-TRIANGLE_HW, TRIANGLE_HH],
            [0, -TRIANGLE_HH],
            [TRIANGLE_HW, TRIANGLE_HH],
        ];
        return around(
            corners.map(([x, y]) => [x * k, centroid + (y - centroid) * k]),
            steps,
        );
    }
    return [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
    ].flatMap(([sx, sy]) =>
        Array.from({ length: steps / 4 }, (_, j): [number, number] => {
            const t = 0.08 + 0.88 * (j / (steps / 4));
            return [sx! * 6 * t, sy! * 6 * t];
        }),
    );
}

/**
 * For each Following shape and the Set one beside it, in a field capture at
 * device-pixel centers: how many gaps its dashed edge (or an X's lines) has,
 * its dashes' contrast as a share of the Set shape's, and its middle's (its
 * fill's opacity). Shapes are measured in the Set circle's scale.
 */
async function edgeProfiles(
    page: Page,
    png: Buffer,
    pairs: readonly { shape: ShapeName; set: Point; following: Point }[],
) {
    // Pixels per shape unit: the Set circle's radius along its middle row
    const circle = pairs.find((p) => p.shape === "circle")!.set;
    const row = await pixelsAt(
        page,
        png,
        Array.from({ length: 200 }, (_, dx) => ({
            x: circle.x + dx,
            y: circle.y,
        })),
    );
    const [field] = await pixelsAt(page, png, [
        { x: circle.x - 60, y: circle.y },
    ]);
    const radius = row.findIndex(
        (c) => contrast(c, field!) < contrast(row[0]!, field!) / 2,
    );
    const unit = (radius - 0.5) / 5;
    const inset = Math.max(1.75, 2 / unit) / 2;
    const profiles = [];
    for (const { shape, set, following } of pairs) {
        const [background, middle] = await pixelsAt(page, png, [
            { x: set.x - 60, y: set.y },
            { x: set.x, y: set.y + (shape === "triangle" ? 1.732 * unit : 0) },
        ]);
        const full = contrast(middle!, background!);
        const share = (colors: number[][]) =>
            colors.map((c) => contrast(c, background!) / full);
        const path = edgePath(shape, inset);
        const values = share(
            await pixelsAt(
                page,
                png,
                path.map(([x, y]) => ({
                    x: following.x + x * unit,
                    y: following.y + y * unit,
                })),
            ),
        );
        // A gap is a run where the edge drops well under full strength
        const on = values.map((v) => v > 0.85);
        const gaps = on.filter((v, k) => v && !on[(k + 1) % on.length]).length;
        const dashes = values.filter((v) => v > 0.85);
        const [fill] = share(
            await pixelsAt(page, png, [
                {
                    x: following.x,
                    y: following.y + (shape === "triangle" ? 1.732 * unit : 0),
                },
            ]),
        );
        profiles.push({
            shape,
            gaps,
            dash:
                dashes.reduce((sum, v) => sum + v, 0) /
                Math.max(1, dashes.length),
            fill: fill!,
        });
    }
    return profiles;
}
