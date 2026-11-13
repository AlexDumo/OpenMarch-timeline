/**
 * Drives the print-dialog prototype in Chromium, Firefox and WebKit.
 *
 *   OUT=/mnt/data/pdf-web-proto/print-dialog/harness-dist pnpm exec vite build -c web/print-proto/vite.config.mts
 *   node web/print-proto/run.mts [--large]
 *
 * The print dialog itself can't be automated, so for each browser and engine
 * this lays the sheets out with the real module (preparePrint), checks that
 * print() is called on the iframe, and then:
 * - Chromium: page.pdf() of the exact laid-out document (Chromium's own
 *   print-to-PDF, the same code "Save as PDF" runs);
 * - every browser: a screenshot of the first page (Paged.js pages are real
 *   pages; native documents are shown with print media emulated, which has
 *   no pages and so no margin boxes: a proxy only).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, firefox, webkit, type Browser } from "@playwright/test";

const ROOT = "/mnt/data/pdf-web-proto";
const OUT = `${ROOT}/print-dialog`;
const DIST = `${OUT}/harness-dist`;
const LARGE = process.argv.includes("--large");
const SHOW = "Fixture Show 2026";

type Sheet = { name: string; section: string; renderedPage: string };
const fixtures = {
    full: JSON.parse(
        fs.readFileSync(`${ROOT}/fixtures/sheets-full.json`, "utf8"),
    ) as Sheet[],
    quarter: JSON.parse(
        fs.readFileSync(`${ROOT}/fixtures/sheets-quarter.json`, "utf8"),
    ) as Sheet[],
};
/** 150 marchers: the 8 fixture marchers repeated (quarter has 3 sheets each). */
function scaled(mode: "full" | "quarter"): Sheet[] {
    const per = mode === "full" ? 1 : 3;
    const src = fixtures[mode];
    const out: Sheet[] = [];
    for (let m = 0; m < 150; m++) {
        const base = (m % 8) * per;
        for (let k = 0; k < per; k++) out.push(src[base + k]);
    }
    return out;
}

// --- static server for the harness build ---------------------------------
const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = url === "/" ? `${DIST}/index.html` : path.join(DIST, url);
    if (url === "/sheets-full.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(fs.readFileSync(`${ROOT}/fixtures/sheets-full.json`));
    }
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
    }
    const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const BASE = `http://127.0.0.1:${port}/`;

// --- memory: RSS of every process below this one --------------------------
function treeRssKb(): number {
    try {
        const out = execSync(`ps -o pid=,ppid=,rss= -A`, { encoding: "utf8" });
        const rows = out
            .trim()
            .split("\n")
            .map((l) => l.trim().split(/\s+/).map(Number));
        const kids = new Map<number, number[]>();
        for (const [pid, ppid] of rows) {
            if (!kids.has(ppid)) kids.set(ppid, []);
            kids.get(ppid)!.push(pid);
        }
        const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
        let total = 0;
        const stack = [...(kids.get(process.pid) ?? [])];
        while (stack.length) {
            const pid = stack.pop()!;
            total += rss.get(pid) ?? 0;
            stack.push(...(kids.get(pid) ?? []));
        }
        return total;
    } catch {
        return 0;
    }
}
async function withPeakRss<T>(fn: () => Promise<T>) {
    const before = treeRssKb();
    let peak = before;
    const timer = setInterval(() => {
        peak = Math.max(peak, treeRssKb());
    }, 100);
    try {
        const result = await fn();
        peak = Math.max(peak, treeRssKb());
        return { result, beforeMb: before / 1024, peakMb: peak / 1024 };
    } finally {
        clearInterval(timer);
    }
}

// --- run ------------------------------------------------------------------
const results: Record<string, unknown>[] = [];
const browsers = { chromium, firefox, webkit } as const;
const GPU_ARGS = [
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
];

const only = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",");
for (const [browserName, type] of Object.entries(browsers)) {
    if (!only.includes(browserName)) continue;
    const browser: Browser = await type.launch(
        browserName === "chromium" ? { args: GPU_ARGS } : {},
    );
    const context = await browser.newContext({
        viewport: { width: 1000, height: 1100 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) =>
        console.log(`[${browserName}] pageerror`, e.message),
    );
    await page.goto(BASE);
    await page.waitForFunction(() => "harness" in window);
    const native = await page.evaluate(() =>
        (window as any).harness.supportsNativeMarginBoxes(),
    );

    for (const mode of ["full", "quarter"] as const) {
        for (const engine of (process.env.ENGINES ?? "native,pagedjs").split(
            ",",
        ) as ("native" | "pagedjs")[]) {
            if (
                process.env.MODES &&
                !process.env.MODES.split(",").includes(mode)
            )
                continue;
            const tag = `${browserName}-${mode}-${engine}${LARGE ? "-large" : ""}`;
            const sheets = (LARGE ? scaled(mode) : fixtures[mode]).map(
                (s) => s.renderedPage,
            );
            const row: Record<string, unknown> = {
                tag,
                browser: browserName,
                browserVersion: browser.version(),
                mode,
                engine,
                sheets: sheets.length,
                autoEngine: native ? "native" : "pagedjs",
            };
            try {
                const {
                    result: prep,
                    peakMb,
                    beforeMb,
                } = await withPeakRss(() =>
                    page.evaluate(
                        (req) => (window as any).harness.prepare(req),
                        {
                            sheets,
                            quarterPages: mode === "quarter",
                            showName: SHOW,
                            engine,
                            timeoutMs: Number(
                                process.env.TIMEOUT_MS ?? 120_000,
                            ),
                        },
                    ),
                );
                Object.assign(row, {
                    prepareMs: Math.round(prep.ms),
                    pagedPages: prep.pages,
                    quarterFit: prep.quarterFit,
                    title: prep.title,
                    rssBeforeMb: Math.round(beforeMb),
                    rssPeakMb: Math.round(peakMb),
                });
                const printed = await page.evaluate(() =>
                    (window as any).harness.printStubbed(),
                );
                row.printCall = printed;

                const html: string = await page.evaluate(() =>
                    (window as any).harness.serialize(),
                );
                if (!LARGE) fs.writeFileSync(`${OUT}/docs/${tag}.html`, html);

                // Render the laid-out document on its own page
                const doc = await context.newPage();
                await doc.setContent(html, { waitUntil: "load" });
                if (browserName === "chromium") {
                    const t0 = Date.now();
                    const pdfPath = LARGE
                        ? `${OUT}/large/${tag}.pdf`
                        : `${OUT}/pdf/${tag}.pdf`;
                    // Chromium's print-to-PDF with the dialog's defaults:
                    // Letter, CSS margins, background graphics off
                    const { peakMb: pdfPeak } = await withPeakRss(() =>
                        doc.pdf({
                            path: pdfPath,
                            preferCSSPageSize: true,
                            printBackground: false,
                        }),
                    );
                    row.pdfMs = Date.now() - t0;
                    row.pdfPeakRssMb = Math.round(pdfPeak);
                    row.pdfBytes = fs.statSync(pdfPath).size;
                }
                if (!LARGE) {
                    if (engine === "pagedjs") {
                        const first = doc.locator(".pagedjs_page").first();
                        await first.screenshot({
                            path: `${OUT}/shots/${tag}-p1.png`,
                        });
                        await doc
                            .locator(".pagedjs_page")
                            .nth(1)
                            .screenshot({ path: `${OUT}/shots/${tag}-p2.png` });
                        row.pagedPagesInDoc = await doc
                            .locator(".pagedjs_page")
                            .count();
                    } else {
                        // Proxy: print media, no pagination, first 11in only
                        await doc.emulateMedia({ media: "print" });
                        await doc.setViewportSize({ width: 816, height: 1056 });
                        await doc.screenshot({
                            path: `${OUT}/shots/${tag}-printmedia.png`,
                        });
                    }
                }
                await doc.close();
                row.iframesAfterRemove = await page.evaluate(() =>
                    (window as any).harness.remove(),
                );
                row.ok = true;
            } catch (e) {
                row.ok = false;
                row.error = String(e).slice(0, 500);
            }
            console.log(JSON.stringify(row));
            results.push(row);
        }
    }
    await browser.close();
}
server.close();
fs.writeFileSync(
    `${OUT}/results${LARGE ? "-large" : ""}-${only.join("+")}.json`,
    JSON.stringify(results, null, 2),
);
