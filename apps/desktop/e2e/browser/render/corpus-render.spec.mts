import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { waitForField } from "../app.mjs";
import {
    compose,
    field,
    setFabricView,
    settle,
    type View,
} from "./compare.mjs";
import { makeStressShow } from "./stressShow.mjs";

/**
 * The parity gate's render comparisons (#189, run in #208): the corpus of
 * shows (both demo shows and the 1,925-marcher stress show) at several zooms
 * and playback times, Fabric against the new field at the same view. Not a
 * pass/fail suite: it writes side-by-sides and diffs for a person to review
 * (see README.md here). Three first, then Fabric:
 *
 *     FIELD=three pnpm exec playwright test --project=render corpus-render
 *     FIELD=fabric pnpm exec playwright test --project=render corpus-render
 *
 * Output goes to `RENDER_OUT` (default `$TMPDIR/openmarch-field-render`),
 * with the stress show written there on first use.
 */

const OUT = path.resolve(
    process.env.RENDER_OUT ?? path.join(os.tmpdir(), "openmarch-field-render"),
);
const FIELD = process.env.FIELD === "three" ? "three" : "fabric";
const desktop = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
const DEMOS = path.join(desktop, "view3d-web/public/demos");
const STRESS = path.join(OUT, "stress-1925.dots");

const SHOWS = [
    { name: "part1", file: path.join(DEMOS, "part1-demo.dots") },
    { name: "daft-punk", file: path.join(DEMOS, "lhb-daft-punk-pt2.dots") },
    { name: "stress", file: STRESS },
];

/** Playback times: pages after the first, then beats on (mid-move). */
const TIMES = [
    { name: "home", pages: 0, beats: 0 },
    { name: "page4", pages: 4, beats: 0 },
    { name: "page4+4", pages: 4, beats: 4 },
    { name: "page8+2", pages: 8, beats: 2 },
];

/**
 * Zooms, as a factor of the opening fit, reached with small Ctrl+wheel steps
 * (a pinch in trackpad mode) at the marchers' center. The Fabric pass copies
 * the view.
 */
const ZOOMS = [
    { name: "fit", factor: 1 },
    { name: "near", factor: 2.5 },
    { name: "close", factor: 6 },
];

const SIZE = { width: 1600, height: 1000 };

/**
 * Hides what the app draws over the field (toolbars, badges), but not the
 * field's own overlays.
 */
async function hideChrome(page: Page) {
    await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="fieldCanvas"]')!;
        const box = canvas.getBoundingClientRect();
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
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
}

/** Waits until the field shows the same page and marchers twice in a row. */
async function settled(page: Page) {
    let last = "";
    await expect
        .poll(
            async () => {
                const now = await page.evaluate(() =>
                    JSON.stringify([
                        window.fieldTest!.pageId(),
                        window.fieldTest!.marchers().map((m) => [m.x, m.y]),
                    ]),
                );
                const same = now === last && now.length > 20;
                last = now;
                return same;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
}

async function goTo(
    page: Page,
    first: number | null,
    pages: number,
    beats: number,
) {
    await page.keyboard.press("Home");
    // Home lands on the first page; wait so the keys below count from it
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.pageId()))
        .toBe(first);
    for (let i = 0; i < pages; i++) await page.keyboard.press("e");
    for (let i = 0; i < beats; i++) await page.keyboard.press("Shift+E");
}

/** Zooms the new field in to `factor` times its zoom, at the marchers' center. */
async function zoomIn(page: Page, factor: number) {
    if (factor === 1) return;
    const zoomNow = () =>
        page.evaluate(() => window.fieldTest!.viewport().zoom);
    const target = (await zoomNow()) * factor;
    const at = await page.evaluate(() => {
        const shown = window.fieldTest!.marchers().filter((m) => m.onScreen);
        const x = shown.reduce((s, m) => s + m.screen.x, 0) / shown.length;
        const y = shown.reduce((s, m) => s + m.screen.y, 0) / shown.length;
        return { x, y };
    });
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    while ((await zoomNow()) < target) {
        await page.mouse.wheel(0, -10);
        await settle(page);
    }
    await page.keyboard.up("Control");
}

/** The field's box on screen. */
async function shot(page: Page) {
    const box = (await field(page).boundingBox())!;
    return page.screenshot({ clip: box });
}

for (const show of SHOWS)
    test.describe(show.name, () => {
        test.use({ showFile: show.file });
        test.beforeAll(() => {
            fs.mkdirSync(OUT, { recursive: true });
            if (show.file === STRESS)
                makeStressShow(
                    path.join(DEMOS, "lhb-daft-punk-pt2.dots"),
                    STRESS,
                );
        });

        for (const zoom of ZOOMS)
            test(`render at ${zoom.name}`, async ({ show: app }) => {
                test.setTimeout(600_000);
                const { page } = app;
                await page.setViewportSize(SIZE);
                // The Fabric field fits the show only when it opens
                await page.reload();
                await waitForField(page);
                await settled(page);
                await page.waitForTimeout(500);
                const firstPage = await page.evaluate(() =>
                    window.fieldTest!.pageId(),
                );
                const base = (time: string) =>
                    path.join(OUT, `corpus-${show.name}-${zoom.name}-${time}`);
                let view: View;
                if (FIELD === "three") {
                    await zoomIn(page, zoom.factor);
                    await settle(page);
                    view = (await page.evaluate(() =>
                        window.fieldTest!.viewport(),
                    )) as View;
                } else {
                    view = JSON.parse(
                        fs.readFileSync(
                            `${base(TIMES[0]!.name)}.view.json`,
                            "utf8",
                        ),
                    ) as View;
                }
                await hideChrome(page);
                for (const time of TIMES) {
                    await goTo(page, firstPage, time.pages, time.beats);
                    await settled(page);
                    if (FIELD === "fabric") await setFabricView(page, view);
                    await settle(page);
                    await page.waitForTimeout(500);
                    const file = base(time.name);
                    if (FIELD === "three") {
                        fs.writeFileSync(
                            `${file}.view.json`,
                            JSON.stringify(view),
                        );
                        fs.writeFileSync(`${file}.three.png`, await shot(page));
                        continue;
                    }
                    const fabric = await shot(page);
                    fs.writeFileSync(`${file}.fabric.png`, fabric);
                    const composed = await compose(
                        page,
                        fabric,
                        fs.readFileSync(`${file}.three.png`),
                    );
                    fs.writeFileSync(`${file}.compare.png`, composed.png);
                    fs.appendFileSync(
                        path.join(OUT, "summary.tsv"),
                        `corpus-${show.name}-${time.name}\t${zoom.name}\t${composed.differing}\t${composed.total}\t${(
                            (100 * composed.differing) /
                            composed.total
                        ).toFixed(2)}%\n`,
                    );
                }
            });
    });
