import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
    createFieldTheme,
    FieldProperties,
    type FieldTheme,
} from "@openmarch/core";
import { tsImport } from "tsx/esm/api";
import { test, expect } from "../fixtures.mjs";

/**
 * Render comparisons of the field itself, Fabric against the new field
 * (#200; see README.md here). Not a pass/fail suite: it writes screenshots,
 * side-by-sides and diffs for a person to review.
 *
 * Run the new field first, then Fabric, which matches each view to the new
 * field's and composes the comparisons:
 *
 *     FIELD=three pnpm exec playwright test --project=render
 *     FIELD=fabric pnpm exec playwright test --project=render
 *
 * Output goes to `RENDER_OUT` (default `$TMPDIR/openmarch-field-render`).
 */

// Outside `playwright-report`, which each run clears
const OUT = path.resolve(
    process.env.RENDER_OUT ?? path.join(os.tmpdir(), "openmarch-field-render"),
);
const FIELD = process.env.FIELD === "three" ? "three" : "fabric";

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

type View = { zoom: number; pan: { x: number; y: number } };

const field = (page: Page) => page.getByTestId("fieldCanvas").first();

/** Waits for two frames, so the field has drawn what it was last given. */
const settle = (page: Page) =>
    page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                ),
            ),
    );

/**
 * Points the Fabric field at `view` (the field test API's units), through
 * Fabric itself: a capture tool, not a scenario.
 */
async function setFabricView(page: Page, view: View) {
    await page.evaluate((view) => {
        const canvas = (
            window as unknown as {
                canvas: {
                    getWidth(): number;
                    upperCanvasEl: HTMLCanvasElement;
                    setViewportTransform(vpt: number[]): void;
                    requestRenderAll(): void;
                };
            }
        ).canvas;
        const css =
            canvas.upperCanvasEl.getBoundingClientRect().width /
            canvas.getWidth();
        const zoom = view.zoom / css;
        // The field test API's (0, 0) is half a grid line into Fabric's plane
        canvas.setViewportTransform([
            zoom,
            0,
            0,
            zoom,
            view.pan.x / css - zoom / 2,
            view.pan.y / css - zoom / 2,
        ]);
        canvas.requestRenderAll();
    }, view);
    await settle(page);
    await page.waitForTimeout(300);
}

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

/**
 * Builds `[Fabric | new field | diff]` in the page from two PNGs, and how
 * many pixels differ. The diff shows Fabric faded, with pixels that have no
 * match (within 24 in every channel) within one pixel in the other image in
 * red (new field darker) or blue (lighter).
 */
async function compose(page: Page, fabric: Buffer, three: Buffer) {
    const result = await page.evaluate(
        async ([a, b]) => {
            const load = async (b64: string) => {
                const blob = await (
                    await fetch(`data:image/png;base64,${b64}`)
                ).blob();
                return createImageBitmap(blob);
            };
            const [fa, th] = await Promise.all([load(a), load(b)]);
            const w = Math.min(fa.width, th.width);
            const h = Math.min(fa.height, th.height);
            const read = (img: ImageBitmap) => {
                const c = new OffscreenCanvas(w, h);
                const g = c.getContext("2d")!;
                g.drawImage(img, 0, 0);
                return g.getImageData(0, 0, w, h);
            };
            const da = read(fa);
            const db = read(th);
            const diff = new ImageData(w, h);
            const lum = (d: Uint8ClampedArray, i: number) =>
                (d[i] + d[i + 1] + d[i + 2]) / 3;
            const off = (
                p: Uint8ClampedArray,
                q: Uint8ClampedArray,
                i: number,
                j: number,
            ) =>
                Math.max(
                    Math.abs(p[i] - q[j]),
                    Math.abs(p[i + 1] - q[j + 1]),
                    Math.abs(p[i + 2] - q[j + 2]),
                );
            /** Whether pixel `i` of `p` matches a pixel of `q` within one pixel of it. */
            const near = (
                p: Uint8ClampedArray,
                q: Uint8ClampedArray,
                x: number,
                y: number,
            ) => {
                const i = (y * w + x) * 4;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        if (off(p, q, i, (ny * w + nx) * 4) <= 24) return true;
                    }
                return false;
            };
            let differing = 0;
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    const la = lum(da.data, i);
                    // Antialiasing moves edges by up to a pixel: only count
                    // pixels with no match within a pixel, either way
                    if (
                        !near(da.data, db.data, x, y) ||
                        !near(db.data, da.data, x, y)
                    ) {
                        differing++;
                        const darker = lum(db.data, i) < la;
                        diff.data.set(
                            darker ? [220, 0, 0, 255] : [0, 90, 255, 255],
                            i,
                        );
                    } else {
                        const v = 255 - (255 - la) * 0.25;
                        diff.data.set([v, v, v, 255], i);
                    }
                }
            const out = new OffscreenCanvas(w * 3, h);
            const g = out.getContext("2d")!;
            g.drawImage(fa, 0, 0);
            g.drawImage(th, w, 0);
            g.putImageData(diff, w * 2, 0);
            g.font = "bold 20px sans-serif";
            for (const [i, label] of ["Fabric", "three.js", "diff"].entries()) {
                g.fillStyle = "rgba(255,255,255,0.85)";
                g.fillRect(i * w + 8, 8, 110, 30);
                g.fillStyle = "black";
                g.fillText(label, i * w + 16, 30);
            }
            const png = await out.convertToBlob({ type: "image/png" });
            const bytes = new Uint8Array(await png.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000)
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return {
                png: btoa(binary),
                differing,
                total: w * h,
            };
        },
        [fabric.toString("base64"), three.toString("base64")] as const,
    );
    return { ...result, png: Buffer.from(result.png, "base64") };
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
                const base = path.join(OUT, `${c.name}-${size.name}`);
                if (FIELD === "three") {
                    const view = (await page.evaluate(() =>
                        window.fieldTest!.viewport(),
                    )) as View;
                    fs.writeFileSync(`${base}.view.json`, JSON.stringify(view));
                    await page.waitForTimeout(500);
                    fs.writeFileSync(
                        `${base}.three.png`,
                        await field(page).screenshot(),
                    );
                    continue;
                }
                const view = JSON.parse(
                    fs.readFileSync(`${base}.view.json`, "utf8"),
                ) as View;
                await setFabricView(page, view);
                const fabric = await field(page).screenshot();
                fs.writeFileSync(`${base}.fabric.png`, fabric);
                const composed = await compose(
                    page,
                    fabric,
                    fs.readFileSync(`${base}.three.png`),
                );
                fs.writeFileSync(`${base}.compare.png`, composed.png);
                fs.appendFileSync(
                    path.join(OUT, "summary.tsv"),
                    `${c.name}\t${size.name}\t${composed.differing}\t${composed.total}\t${(
                        (100 * composed.differing) /
                        composed.total
                    ).toFixed(2)}%\n`,
                );
            }
        });
    });
}
