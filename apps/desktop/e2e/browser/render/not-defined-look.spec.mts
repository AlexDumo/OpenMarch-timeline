import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";
import { field, OUT, LABEL, settle } from "./compare.mjs";
import { isolate } from "../timeline.mjs";

/**
 * The Not defined look on the field (#300, #301, #478): a Not defined
 * marcher's edge is dashed at full strength: an outline round its fill at 60%, a shape
 * without one with nothing inside. An X dashes its
 * own lines. The field test API's `notDefined` says what the field means to
 * draw; this checks the pixels.
 *
 * - The tests on white assert the dashes (at the opening zoom and 3×) and
 *   the fill (3×) for every shape and style.
 * - A label off a keyframe is checked to be lighter in weight than one on a
 *   keyframe, not fainter (#324).
 * - The contact sheet captures every shape and style, Defined beside Not
 *   defined,
 *   on white, a dark theme and turf (with `TURF_IMAGE` naming a field image;
 *   skipped without), at the opening zoom and at 3×, plus an isolated move.
 *   Captures go to `OUT/<LABEL>/not-defined-*.png` for a person to review.
 *
 *     TURF_IMAGE=~/turf.png pnpm exec playwright test --project=render not-defined-look
 */

const SHAPES = ["circle", "square", "triangle", "x"] as const;
const STYLES = [
    { name: "filled", fill: "rgba(220,0,0,1)", outline: "NULL" },
    { name: "outline", fill: "rgba(0,0,0,0)", outline: "rgba(0,0,200,1)" },
    { name: "both", fill: "rgba(220,0,0,1)", outline: "rgba(0,0,0,1)" },
] as const;

/**
 * One section per shape and style, two marchers each: Defined (moves over page 1, so page 1's flag
 * is its keyframe) and Not defined (no move over page 1: it shows its home, its slot left vacant,
 * since a stay move would decide it, #468, #478).
 */
const sections = SHAPES.flatMap((shape, row) =>
    STYLES.map((style, column) => ({
        shape,
        style,
        name: `${shape}-${style.name}`,
        defined: row * 6 + column * 2 + 1,
        notDefined: row * 6 + column * 2 + 2,
        // Clear of the yard lines (every 90 field units), which would fill a gap
        x: 310 + column * 120,
        y: 300 + row * 55,
    })),
);
const marchers = sections.flatMap((s) => [
    { id: s.defined, section: s.name, prefix: "S", order: s.defined },
    { id: s.notDefined, section: s.name, prefix: "F", order: s.notDefined },
]);
const home: SeedPosition[] = sections.flatMap((s) => [
    [s.defined, s.x, s.y - 16] as const,
    [s.notDefined, s.x + 40, s.y] as const,
]);
const page1: SeedPosition[] = sections.flatMap((s) => [
    [s.defined, s.x, s.y] as const,
    [s.notDefined, s.x + 40, s.y] as const,
]);

const SHOW_SQL = [
    ...seedShowSql({
        beats: 16,
        measureStarts: [1, 5, 9, 13],
        pageStarts: [1],
        marchers,
        positions: [home, page1],
    }),
    `DELETE FROM timeline_assignments WHERE transition_id = 1 AND marcher_id IN (${sections
        .map((s) => s.notDefined)
        .join(", ")})`,
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
/**
 * The grid's lines in the field's own white: a Not defined fill is 60% opaque, so a line under it
 * darkens the gap it shows through. The measured tests are about the marchers, not the field.
 */
const NO_GRID_SQL = `UPDATE field_properties SET json_data = json_set(json_data,
    '$.theme.secondaryStroke', ${color(255, 255, 255)},
    '$.theme.tertiaryStroke', ${color(255, 255, 255)})`;
const turfSql = (file: string) => [
    `UPDATE field_properties SET image = X'${fs.readFileSync(file).toString("hex")}',
        json_data = json_set(json_data, '$.showFieldImage', json('true'),
            '$.imageFillOrFit', 'fill', '$.backgroundImageOpacity', 1)`,
];

/** Waits until page 1's flag is shown with every Not defined marcher marked so. */
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
                        .filter((m) => m.notDefined)
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

test.describe("Not defined look", () => {
    test.use({ seedSql: SHOW_SQL });

    test("contact sheet on white", async ({ show }) => {
        const { page } = show;
        await onPage1(page);
        await capture(page, "not-defined-white-fit");
        await zoomBy(page, 3);
        await capture(page, "not-defined-white-3x");
    });
});

// Measured without labels: at the opening zoom a label touches its shape's
// top edge and would fill a gap there
test.describe("Not defined look, measured", () => {
    test.use({
        seedSql: [
            ...SHOW_SQL,
            "UPDATE section_appearances SET label_visible = 0",
            NO_GRID_SQL,
        ],
    });

    for (const zoom of [
        { name: "the opening zoom", times: 1 },
        { name: "3×", times: 3 },
    ])
        test(`a Not defined edge is dashed at full strength at ${zoom.name}`, async ({
            show,
        }) => {
            const { page } = show;
            await onPage1(page);
            if (zoom.times > 1) await zoomBy(page, zoom.times);
            await expectDashed(page);
        });

    // #302: Stop eases the dashes in, ending at the same look. At 3×, where every gap is counted
    test("Stop after Play ends at the full dashed look", async ({ show }) => {
        const { page } = show;
        await onPage1(page);
        await zoomBy(page, 3);
        const notDefined = () =>
            page.evaluate(
                () =>
                    window.fieldTest!.marchers().filter((m) => m.notDefined)
                        .length,
            );
        await page.keyboard.press("Space");
        await expect.poll(notDefined).toBe(0);
        await page.keyboard.press("Space");
        // Who's Not defined is known at once, before the ease is done
        await expect.poll(notDefined).toBe(sections.length);
        await settle(page);
        await page.waitForTimeout(300);
        await expectDashed(page);
    });
});

test.describe("Not defined look, dark", () => {
    test.use({ seedSql: [...SHOW_SQL, DARK_SQL] });
    test("contact sheet on a dark theme", async ({ show }) => {
        const { page } = show;
        await onPage1(page);
        await capture(page, "not-defined-dark-fit");
        await zoomBy(page, 3);
        await capture(page, "not-defined-dark-3x");
    });
});

const TURF = process.env.TURF_IMAGE;
test.describe("Not defined look, turf", () => {
    test.skip(!TURF, "Set TURF_IMAGE to a field image to capture on turf");
    test.use({ seedSql: TURF ? [...SHOW_SQL, ...turfSql(TURF)] : SHOW_SQL });
    test("contact sheet on turf", async ({ show }) => {
        const { page } = show;
        await page.waitForFunction(
            () => window.fieldTest?.fieldImage() != null,
        );
        await onPage1(page);
        await capture(page, "not-defined-turf-fit");
        await zoomBy(page, 3);
        await capture(page, "not-defined-turf-3x");
    });
});

// Over page 2 (beats 9–17) T1 and T2 move (T1 with a detour), T3 has a stay
// move (its end is a keyframe, #468) and T4 has no move (Not defined).
// Isolating that move on its flag: T1, T2 and T3 Defined, T4 dimmed outside
// it, not dashed; mid-move they're walking, so still solid (#478), beside the
// move's gray dashed ghosts
test.describe("Not defined look, isolated", () => {
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
            // T4 (slot 3) has no move over page 2: it's Not defined there
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
    test("an isolated move beside a Not defined marcher", async ({ show }) => {
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
                                : m.notDefined
                                  ? "notDefined"
                                  : "defined",
                        ),
                ),
            )
            .toEqual(["defined", "defined", "defined", "dimmed"]);
        await zoomBy(page, 3);
        await capture(page, "not-defined-isolated-3x", 60);
        // Mid-move, where the move's ghosts show
        await page.keyboard.press("Shift+Q");
        await settle(page);
        await page.waitForTimeout(400);
        await capture(page, "not-defined-isolated-mid-move-3x", 60);
    });
});

// #324: a label off a keyframe is lighter in weight than one on a keyframe,
// at full opacity. S12 moves over page 1 (its flag is a keyframe), F12 has no
// move there (Not defined, off a keyframe); their "12"s
// are the same glyphs at the same size, so the thinner one has less ink but
// the same darkest stroke
test.describe("label weight off a keyframe", () => {
    test.use({
        seedSql: [
            ...seedShowSql({
                beats: 16,
                measureStarts: [1, 5, 9, 13],
                pageStarts: [1],
                marchers: [
                    { id: 1, section: "Trumpet", prefix: "S", order: 12 },
                    { id: 2, section: "Trumpet", prefix: "F", order: 12 },
                ],
                positions: [
                    [
                        [1, 400, 284],
                        [2, 460, 300],
                    ],
                    [
                        [1, 400, 300],
                        [2, 460, 300],
                    ],
                ],
            }),
            // F12 has no move over page 1, its slot left vacant
            "DELETE FROM timeline_assignments WHERE transition_id = 1 AND marcher_id = 2",
        ],
    });

    test("a label off a keyframe is drawn thinner than one on a keyframe, as dark", async ({
        show,
    }) => {
        const { page } = show;
        await page.setViewportSize({ width: 2000, height: 1400 });
        await page.waitForFunction(
            () => window.fieldTest?.marchers().length === 2,
        );
        await page.keyboard.press("e");
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.fieldTest!.marchers().map((m) => m.notDefined),
                ),
            )
            .toEqual([false, true]);
        await zoomBy(page, 3);
        const [keyframe, offKeyframe] = await labelInk(page, [1, 2]);
        // Less ink: the strokes are thinner
        expect(offKeyframe!.ink / keyframe!.ink).toBeLessThan(0.85);
        expect(offKeyframe!.ink / keyframe!.ink).toBeGreaterThan(0.4);
        // Full opacity: the strokes' middles are as dark as a keyframe label's
        expect(offKeyframe!.peak).toBeGreaterThan(keyframe!.peak * 0.9);
    });
});

/**
 * How much ink the last two characters of each marcher's three-character
 * label have in a field capture on white (the sum of each device pixel's
 * contrast, 0 to 1), and the darkest pixel's contrast.
 */
async function labelInk(page: Page, ids: readonly number[]) {
    const png = await field(page).screenshot();
    const box = (await field(page).boundingBox())!;
    const scale = png.readUInt32BE(16) / box.width;
    const zoom = await zoomOf(page);
    const drawn = await page.evaluate(() =>
        window.fieldTest!.marchers().map((m) => ({
            id: m.id,
            screen: m.screen,
        })),
    );
    // LabelsLayer: 14 units per em, centered 11 units above the dot; a
    // monospace advance is 0.6 em
    const em = 14 * zoom * scale;
    const advance = 0.6 * em;
    const rects = ids.map((id) => {
        const { screen } = drawn.find((m) => m.id === id)!;
        const x = (screen.x - box.x) * scale;
        const y = (screen.y - box.y) * scale - 11 * zoom * scale;
        return {
            x0: Math.round(x - 0.45 * advance),
            x1: Math.round(x + 1.45 * advance),
            // Clear of the dot below
            y0: Math.round(y - 0.5 * em),
            y1: Math.round(y + 0.35 * em),
        };
    });
    return page.evaluate(
        async ({ base64, rects }) => {
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(
                new Blob([bytes], { type: "image/png" }),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            const { data, width } = context.getImageData(
                0,
                0,
                bitmap.width,
                bitmap.height,
            );
            return rects.map(({ x0, x1, y0, y1 }) => {
                let ink = 0;
                let peak = 0;
                for (let y = y0; y < y1; y++)
                    for (let x = x0; x < x1; x++) {
                        const p = (y * width + x) * 4;
                        const c =
                            Math.max(
                                255 - data[p]!,
                                255 - data[p + 1]!,
                                255 - data[p + 2]!,
                            ) / 255;
                        ink += c;
                        peak = Math.max(peak, c);
                    }
                return { ink, peak };
            });
        },
        { base64: png.toString("base64"), rects },
    );
}

type ShapeName = (typeof SHAPES)[number];

/**
 * Checks the full Not defined look in a field capture: every Not defined shape's
 * edge dashed at full strength (fewer, longer dashes on a small shape), and
 * its fill 60% inside an outline, nothing without one.
 */
async function expectDashed(page: Page) {
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
    // Device pixels per shape unit, as the marchers layer sizes a dot: a field unit, but never
    // under a 1.5 CSS px radius (`dotSizes`, selectionRing.ts)
    const zoom = await zoomOf(page);
    const unit = Math.max(zoom, 1.5 / 5) * scale;
    const profiles = await edgeProfiles(
        page,
        png,
        unit,
        sections.map((s) => ({
            shape: s.shape,
            style: s.style,
            notDefined: at(s.notDefined),
        })),
    );
    for (const [i, s] of sections.entries()) {
        const profile = profiles[i]!;
        // Dashes at any size: fewer, longer ones on a small shape (gaps of 2 px or more)
        if (profile.small) {
            // A small shape is 7 px across, its dashes a pixel or two on the pixel grid: where
            // each one lands changes how its edges blend, so a count there reads gaps that aren't
            // and misses some that are. Its edge must still be broken; 3× counts every gap.
            // A square's or triangle's corner over a 60% fill dips like a gap even drawn solid,
            // so those two only count at 3×
            const cornersDip =
                s.style.name === "both" &&
                (s.shape === "square" || s.shape === "triangle");
            if (!cornersDip)
                expect(profile.gaps, `${s.name} gaps`).toBeGreaterThanOrEqual(
                    1,
                );
        } else {
            // Exactly the shader's: NOT_DEFINED_LOOK's dashes round a circle, a gap between
            // each of a side's (or an X arm's) dashes, corners solid
            const designed = { circle: 8, square: 8, triangle: 6, x: 8 }[
                s.shape
            ];
            expect(profile.gaps, `${s.name} gaps`).toBe(designed);
        }
        expect(profile.dash, `${s.name} dash`).toBeGreaterThan(0.8);
        // The fill, where it's big enough to read: 60% inside an
        // outline, nothing without one (an X's lines are its dashes)
        if (profile.small || s.shape === "x" || s.style.name === "outline")
            continue;
        if (s.style.name === "both")
            expect(profile.fill, `${s.name} fill`).toBeCloseTo(0.6, 1);
        else expect(profile.fill, `${s.name} fill`).toBeLessThan(0.1);
    }
}

type Point = { x: number; y: number };

/** The colors at device-pixel `points` in a field capture, as [r, g, b], interpolated between pixels. */
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
            const { data, width } = context.getImageData(
                0,
                0,
                bitmap.width,
                bitmap.height,
            );
            const at = (x: number, y: number, c: number) =>
                data[(y * width + x) * 4 + c]!;
            // Bilinear, between the four pixel centers round the point
            return points.map(({ x, y }) => {
                const x0 = Math.floor(x - 0.5);
                const y0 = Math.floor(y - 0.5);
                const fx = x - 0.5 - x0;
                const fy = y - 0.5 - y0;
                return [0, 1, 2].map(
                    (c) =>
                        at(x0, y0, c) * (1 - fx) * (1 - fy) +
                        at(x0 + 1, y0, c) * fx * (1 - fy) +
                        at(x0, y0 + 1, c) * (1 - fx) * fy +
                        at(x0 + 1, y0 + 1, c) * fx * fy,
                );
            });
        },
        { base64: png.toString("base64"), points },
    );

/** How far a color is from the field's: the most any channel differs, 0 to 255. */
const contrast = (color: number[], background: number[]) =>
    Math.max(...color.map((v, i) => Math.abs(v - background[i]!)));

const WHITE = [255, 255, 255];
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

/** Points along a shape's edge, in shape units: round a closed outline, or along an open line. */
type EdgeRun = { points: [number, number][]; closed: boolean };

/**
 * Runs of points, in shape units from the marcher, along the middle of a Not
 * defined shape's dashed edge (inset by half its width), or along each of an
 * X's four arms, from near its middle to near its tip.
 */
function edgeRuns(shape: ShapeName, inset: number): EdgeRun[] {
    const steps = 400;
    const closed = (points: [number, number][]) => [{ points, closed: true }];
    if (shape === "circle")
        return closed(
            Array.from({ length: steps }, (_, k) => {
                const a = (k / steps) * Math.PI * 2;
                return [Math.cos(a) * (5 - inset), Math.sin(a) * (5 - inset)];
            }),
        );
    if (shape === "square") {
        const h = SQUARE_HALF - inset;
        return closed(
            around(
                [
                    [-h, -h],
                    [h, -h],
                    [h, h],
                    [-h, h],
                ],
                steps,
            ),
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
        return closed(
            around(
                corners.map(([x, y]) => [x * k, centroid + (y - centroid) * k]),
                steps,
            ),
        );
    }
    // An arm's ends are dashes (corners solid); its tip's antialiased end is no gap, so each arm
    // is its own open run rather than one loop that would count each tip as a gap
    return [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
    ].map(([sx, sy]) => ({
        closed: false,
        points: Array.from({ length: steps / 4 }, (_, j): [number, number] => {
            const t = 0.08 + 0.88 * (j / (steps / 4 - 1));
            return [sx! * 6 * t, sy! * 6 * t];
        }),
    }));
}

/**
 * How many gaps a run of edge strengths has: a gap falls under `gapBelow`
 * between two dashes over `dashAbove`, so a run's open ends never count. A
 * closed run is read once round from its strongest point, a dash, back to it.
 */
function countGaps(
    { values, closed }: { values: readonly number[]; closed: boolean },
    dashAbove: number,
    gapBelow: number,
) {
    let run = values;
    if (closed) {
        const start = values.indexOf(Math.max(...values));
        run = [...values.slice(start), ...values.slice(0, start + 1)];
    }
    let gaps = 0;
    let afterDash = false;
    let inGap = false;
    for (const v of run) {
        if (v > dashAbove) {
            if (inGap) gaps++;
            afterDash = true;
            inGap = false;
        } else if (v < gapBelow && afterDash) inGap = true;
    }
    return gaps;
}

/**
 * At each point of `path` (shape units round `center`), the most contrast
 * with the white field across a pixel either side of it, so half a pixel off
 * doesn't miss a thin band.
 */
async function strongestAcross(
    page: Page,
    png: Buffer,
    { points: path, closed }: EdgeRun,
    center: Point,
    unit: number,
) {
    const across = [-1, -0.5, 0, 0.5, 1].map((px) => px / unit);
    const n = path.length;
    const points = path.flatMap(([x, y], k) => {
        // An open run's ends take their one neighbor's direction
        const [nx, ny] = path[closed ? (k + 1) % n : Math.min(k + 1, n - 1)]!;
        const [px, py] = path[closed ? (k + n - 1) % n : Math.max(k - 1, 0)]!;
        const length = Math.hypot(nx - px, ny - py) || 1;
        const normal = [(ny - py) / length, -(nx - px) / length];
        return across.map((t) => ({
            x: center.x + (x + normal[0]! * t) * unit,
            y: center.y + (y + normal[1]! * t) * unit,
        }));
    });
    const colors = await pixelsAt(page, png, points);
    return path.map((_, k) =>
        Math.max(
            ...colors
                .slice(k * across.length, (k + 1) * across.length)
                .map((c) => contrast(c, WHITE)),
        ),
    );
}

/** A CSS color's red, green and blue. */
const rgbOf = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number);

/**
 * For each Not defined shape, in a field capture at device-pixel centers: how
 * many gaps its dashed edge (or an X's lines) has, its dashes' contrast as a
 * share of its own color's, whether it's small on screen (the shader's fewer
 * dashes), and its middle's contrast as a share of its fill's. `unit` is
 * device pixels per shape unit.
 */
async function edgeProfiles(
    page: Page,
    png: Buffer,
    unit: number,
    shapes: readonly {
        shape: ShapeName;
        style: (typeof STYLES)[number];
        notDefined: Point;
    }[],
) {
    const field = WHITE;
    // The shader's switch to fewer dashes, at a 4 CSS px radius (the harness draws at 1 device px each)
    const small = unit * 5 < 4;
    // The dashed edge's width, and the middle of its band from the shape's edge
    const width = Math.max(1.75, 2 / unit);
    const profiles = [];
    for (const { shape, style, notDefined } of shapes) {
        const outlined = style.outline !== "NULL" && shape !== "x";
        const color = rgbOf(outlined ? style.outline : style.fill);
        const full = contrast(color, field);
        const inset = outlined ? width / 2 - 0.5 : width / 2;
        const runs = await Promise.all(
            edgeRuns(shape, inset).map(async (run) => ({
                closed: run.closed,
                values: (
                    await strongestAcross(page, png, run, notDefined, unit)
                ).map((c) => c / full),
            })),
        );
        // Inside an outline a gap shows the 60% fill; elsewhere, the field
        const [dashAbove, gapBelow] =
            style.name === "both" && shape !== "x" ? [0.85, 0.75] : [0.6, 0.45];
        const gaps = runs.reduce(
            (sum, run) => sum + countGaps(run, dashAbove, gapBelow),
            0,
        );
        const dashes = runs
            .flatMap((run) => run.values)
            .filter((v) => v > dashAbove)
            .sort((a, b) => a - b);
        const [middle] = await pixelsAt(page, png, [
            {
                x: notDefined.x,
                y: notDefined.y + (shape === "triangle" ? 1.732 * unit : 0),
            },
        ]);
        profiles.push({
            shape,
            small,
            gaps,
            dash: dashes[Math.floor(dashes.length * 0.9)] ?? 0,
            fill: contrast(middle!, field) / contrast(rgbOf(style.fill), field),
        });
    }
    return profiles;
}
