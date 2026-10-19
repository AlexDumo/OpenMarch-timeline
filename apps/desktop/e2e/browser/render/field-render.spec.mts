import fs from "node:fs";
import type { Page } from "@playwright/test";
import {
    createFieldTheme,
    FieldProperties,
    type FieldTheme,
} from "@openmarch/core";
import { tsImport } from "tsx/esm/api";
import { test, expect } from "../fixtures.mjs";
import { field, OUT, saveCapture, settle } from "./compare.mjs";
import { seedShowSql } from "../seed.mjs";

/**
 * Render captures of the field itself (#200; see README.md here). Not a
 * pass/fail suite: it writes screenshots, and with `RENDER_BASE` side-by-sides
 * and diffs against an earlier run, for a person to review:
 *
 *     RENDER_LABEL=before pnpm exec playwright test --project=render field-render
 *     RENDER_LABEL=after RENDER_BASE=before pnpm exec playwright test --project=render field-render
 *
 * Output goes to `RENDER_OUT` (default `$TMPDIR/openmarch-field-render`).
 */

/** A 64 by 24 PNG: a checkerboard of 8 px squares with a red border, wider than any field. */
const IMAGE_PNG = fs
    .readFileSync(new URL("./field-image.png", import.meta.url))
    .toString("hex");

const DARK_THEME: FieldTheme = createFieldTheme({
    background: { r: 24, g: 28, b: 36, a: 1 },
    primaryStroke: { r: 235, g: 235, b: 235, a: 1 },
    secondaryStroke: { r: 120, g: 130, b: 150, a: 1 },
    tertiaryStroke: { r: 60, g: 66, b: 80, a: 1 },
    fieldLabel: { r: 250, g: 200, b: 60, a: 0.8 },
    externalLabel: { r: 140, g: 200, b: 255, a: 1 },
});

type Case = {
    name: string;
    fieldProperties: FieldProperties;
    /** The user's grid and half line settings; both on by default. */
    gridLines?: boolean;
    halfLines?: boolean;
    image?: boolean;
};

// The app's built-in field templates (its sources aren't ES modules Node can load directly)
type Templates = Record<string, FieldProperties>;
const templatesModule = (await tsImport(
    "../../../src/global/classes/FieldProperties.templates.ts",
    import.meta.url,
)) as { default: Templates | { default: Templates } };
const templates: Templates =
    "default" in templatesModule.default
        ? (templatesModule.default.default as Templates)
        : (templatesModule.default as Templates);
const hs = templates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;
const variant = (base: FieldProperties, overrides: Partial<FieldProperties>) =>
    new FieldProperties({ ...base, ...overrides });

const CASES: Case[] = [
    ...Object.entries(templates).map(([name, fieldProperties]) => ({
        name: `template-${name}`,
        fieldProperties,
    })),
    {
        name: "theme-dark-hs",
        fieldProperties: variant(hs, { theme: DARK_THEME }),
    },
    {
        name: "theme-dark-indoor",
        fieldProperties: variant(templates.INDOOR_50x80_8to5, {
            theme: DARK_THEME,
        }),
    },
    {
        name: "theme-translucent-lines",
        fieldProperties: variant(hs, {
            theme: createFieldTheme({
                primaryStroke: { r: 0, g: 0, b: 160, a: 0.5 },
                secondaryStroke: { r: 200, g: 0, b: 0, a: 0.4 },
                tertiaryStroke: { r: 0, g: 120, b: 0, a: 0.25 },
            }),
        }),
    },
    {
        name: "variant-no-hashes",
        fieldProperties: variant(hs, { useHashes: false }),
    },
    {
        name: "variant-labels-hidden",
        fieldProperties: variant(hs, {
            topLabelsVisible: false,
            rightLabelsVisible: false,
        }),
    },
    {
        name: "variant-half-lines-2x3",
        fieldProperties: variant(hs, {
            halfLineXInterval: 2,
            halfLineYInterval: 3,
        }),
    },
    { name: "setting-no-grid", fieldProperties: hs, gridLines: false },
    { name: "setting-no-half", fieldProperties: hs, halfLines: false },
    {
        name: "setting-no-grid-no-half",
        fieldProperties: hs,
        gridLines: false,
        halfLines: false,
    },
    {
        name: "image-fit",
        fieldProperties: variant(hs, {
            showFieldImage: true,
            imageFillOrFit: "fit",
            backgroundImageOpacity: 1,
        }),
        image: true,
    },
    {
        name: "image-fill-half-opacity",
        fieldProperties: variant(hs, {
            showFieldImage: true,
            imageFillOrFit: "fill",
            backgroundImageOpacity: 0.5,
        }),
        image: true,
    },
    {
        name: "image-fit-dark-indoor",
        fieldProperties: variant(templates.INDOOR_50x80_8to5, {
            theme: DARK_THEME,
            showFieldImage: true,
            imageFillOrFit: "fit",
            backgroundImageOpacity: 0.6,
        }),
        image: true,
    },
];

/** Window sizes: the whole field small, and large enough to read lines and labels. */
const SIZES = [
    { name: "fit", width: 1600, height: 1000 },
    { name: "large", width: 3600, height: 2200 },
] as const;

async function setGridSettings(
    page: Page,
    gridLines: boolean,
    halfLines: boolean,
) {
    if (gridLines && halfLines) return;
    await page.evaluate(
        ([gridLines, halfLines]) => {
            const key = Object.keys(localStorage).find((k) =>
                /ui.?settings/i.test(k),
            );
            if (!key) throw new Error("No UI settings in localStorage");
            const settings = JSON.parse(localStorage.getItem(key)!);
            localStorage.setItem(
                key,
                JSON.stringify({ ...settings, gridLines, halfLines }),
            );
        },
        [gridLines, halfLines] as const,
    );
    await page.reload();
    await expect(field(page)).toBeVisible({ timeout: 20_000 });
}

for (const c of CASES) {
    test.describe(c.name, () => {
        test.use({
            seedSql: [
                `UPDATE field_properties SET json_data = '${JSON.stringify(
                    c.fieldProperties,
                ).replace(/'/g, "''")}'${
                    c.image ? `, image = X'${IMAGE_PNG}'` : ""
                }`,
            ],
        });

        test("render", async ({ show }) => {
            const { page } = show;
            fs.mkdirSync(OUT, { recursive: true });
            await setGridSettings(
                page,
                c.gridLines ?? true,
                c.halfLines ?? true,
            );
            if (c.image)
                await expect
                    .poll(() =>
                        page.evaluate(
                            () => window.fieldTest?.fieldImage() ?? null,
                        ),
                    )
                    .not.toBeNull();
            // Hide what's drawn over the field (zoom controls, badges), so only the field is compared
            await page.evaluate(() => {
                const canvas = document.querySelector(
                    '[data-testid="fieldCanvas"]',
                )!;
                const box = canvas.getBoundingClientRect();
                for (const el of document.querySelectorAll<HTMLElement>(
                    "body *",
                )) {
                    if (el.contains(canvas) || canvas.contains(el)) continue;
                    if (el.querySelector("canvas")) continue;
                    const r = el.getBoundingClientRect();
                    const overlaps =
                        r.right > box.left &&
                        r.left < box.right &&
                        r.bottom > box.top &&
                        r.top < box.bottom;
                    if (overlaps && el.tagName !== "CANVAS")
                        el.style.visibility = "hidden";
                }
            });

            for (const size of SIZES) {
                await page.setViewportSize(size);
                await settle(page);
                await page.waitForTimeout(300);
                await page.waitForTimeout(500);
                await saveCapture(
                    page,
                    `${c.name}-${size.name}`,
                    await field(page).screenshot(),
                    [c.name, size.name],
                );
            }
        });
    });
}

/** Over page 1, T1 moves and T2 stays where it began: on page 1's flag T1 is Set and T2 Following. */
const SET_AND_FOLLOWING = seedShowSql({
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
            [2, 480, 300],
        ],
        [
            [1, 400, 340],
            [2, 480, 300],
        ],
    ],
});

/**
 * Set vs Following (#301): the one pixel check that a Following marcher is
 * drawn faded next to a Set one (the field test API's `following` says what
 * the field means to draw, not the pixels). Over page 1, T1 moves and T2
 * stays where it began, so on page 1's flag T1 is Set and T2 is Following.
 */
test.describe("following-fade", () => {
    test.use({
        seedSql: SET_AND_FOLLOWING,
    });

    test("a Following dot is fainter than a Set one", async ({ show }) => {
        const { page } = show;
        await page.waitForFunction(
            () => window.fieldTest?.marchers().length === 2,
        );
        await page.keyboard.press("e");
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.fieldTest!.marchers().map((m) => m.following),
                ),
            )
            .toEqual([false, true]);
        const [set, following] = await capturedContrasts(
            page,
            "following-fade",
        );
        expect(set).toBeGreaterThan(40);
        // About half as strong: 0.5 opacity over the field
        expect(following).toBeGreaterThan(set * 0.3);
        expect(following).toBeLessThan(set * 0.7);

        // #302: Stop eases the fade back in, ending at the same look
        await page.keyboard.press("Space");
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.fieldTest!.marchers().map((m) => m.following),
                ),
            )
            .toEqual([false, false]);
        await page.keyboard.press("Space");
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.fieldTest!.marchers().map((m) => m.following),
                ),
            )
            .toEqual([false, true]);
        const [setAfter, followingAfter] = await capturedContrasts(
            page,
            "following-fade-after-stop",
        );
        expect(Math.abs(setAfter - set)).toBeLessThan(8);
        expect(Math.abs(followingAfter - following)).toBeLessThan(8);
    });
});

/**
 * The hollow Following look (#308, behind `openmarch.followingLook`): the same
 * show, with T2 Following drawn as a ring in its own color and no fill, and T1
 * Set drawn filled.
 */
test.describe("following-hollow", () => {
    test.use({
        seedSql: SET_AND_FOLLOWING,
        initScript: `localStorage.setItem("openmarch.followingLook", "hollow")`,
    });

    test("a Following dot is a ring in its own color with an empty center", async ({
        show,
    }) => {
        const { page } = show;
        await page.waitForFunction(
            () => window.fieldTest?.marchers().length === 2,
        );
        await page.keyboard.press("e");
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.fieldTest!.marchers().map((m) => m.following),
                ),
            )
            .toEqual([false, true]);
        await settle(page);
        await page.waitForTimeout(300);
        const png = await field(page).screenshot();
        await saveCapture(page, "following-hollow", png, ["following-hollow"]);
        const box = (await field(page).boundingBox())!;
        const toDevice = (c: { x: number; y: number }) => ({
            x: (c.x - box.x) * (png.readUInt32BE(16) / box.width),
            y: (c.y - box.y) * (png.readUInt32BE(20) / box.height),
        });
        const [set, following] = await page.evaluate(() =>
            window.fieldTest!.marchers().map((m) => m.screen),
        );
        const a = toDevice(set!);
        const b = toDevice(following!);
        // They stand 80 and 40 field units apart: device px per field unit
        const unit = Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(80, 40);
        // Points around the Following dot inside its 5-unit edge, along the ring band
        const around = [3.6, 4.0, 4.4].flatMap((r) =>
            [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
                x: b.x + r * unit * Math.cos((k * Math.PI) / 4),
                y: b.y + r * unit * Math.sin((k * Math.PI) / 4),
            })),
        );
        // The field near the Following dot in a few places, as its center may sit on a grid line
        const nearby = [-40, 40].flatMap((d) => [
            { x: b.x + d, y: b.y },
            { x: b.x, y: b.y + d },
        ]);
        const shades = await pixelShades(page, png, [
            a,
            b,
            ...nearby,
            ...around,
        ]);
        const [setDot, center] = shades;
        const fields = shades.slice(2, 2 + nearby.length);
        const ring = shades.slice(2 + nearby.length);
        const distance = (p: number[], q: number[]) =>
            Math.max(...p.map((v, i) => Math.abs(v - q[i]!)));
        // The Set dot is filled, the Following one's center is the field
        expect(
            Math.min(...fields.map((shade) => distance(setDot!, shade))),
        ).toBeGreaterThan(40);
        expect(
            Math.min(...fields.map((shade) => distance(center!, shade))),
        ).toBeLessThan(10);
        // Its ring is the marcher's own color, at full strength
        expect(
            Math.min(...ring.map((shade) => distance(shade, setDot!))),
        ).toBeLessThan(30);
    });
});

/**
 * Captures the settled field (well past the fade's ease) as `name`, and reads
 * each marcher's dot contrast in it, in the field test API's order.
 */
async function capturedContrasts(page: Page, name: string) {
    await settle(page);
    await page.waitForTimeout(300);
    const png = await field(page).screenshot();
    await saveCapture(page, name, png, ["following-fade"]);
    const box = (await field(page).boundingBox())!;
    const centers = await page.evaluate(() =>
        window.fieldTest!.marchers().map((m) => m.screen),
    );
    return dotContrasts(
        page,
        png,
        centers.map((c) => ({
            x: (c.x - box.x) * (png.readUInt32BE(16) / box.width),
            y: (c.y - box.y) * (png.readUInt32BE(20) / box.height),
        })),
    ) as Promise<[number, number]>;
}

/**
 * How far each dot's center is from the field just above it (clear of the dot
 * and its label), 0 to 255, in a field capture at device-pixel `points`.
 */
const dotContrasts = (
    page: Page,
    png: Buffer,
    points: readonly { x: number; y: number }[],
) =>
    page.evaluate(
        async ({ base64, points }) => {
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(
                new Blob([bytes], { type: "image/png" }),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            const shade = (x: number, y: number) => {
                const d = context.getImageData(
                    Math.round(x),
                    Math.round(y),
                    1,
                    1,
                ).data;
                return [d[0]!, d[1]!, d[2]!];
            };
            return points.map(({ x, y }) => {
                const dot = shade(x, y);
                const around = shade(x, y - 40);
                return Math.max(
                    ...dot.map((value, i) => Math.abs(value - around[i]!)),
                );
            });
        },
        { base64: png.toString("base64"), points },
    );

/** Each device-pixel point's RGB, 0 to 255, in a field capture. */
const pixelShades = (
    page: Page,
    png: Buffer,
    points: readonly { x: number; y: number }[],
) =>
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
