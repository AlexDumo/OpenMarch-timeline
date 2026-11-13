// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * Drives the built prototype page (vite.config.mts → /mnt/data/pdf-web-proto/html-wasm/dist)
 * in Chromium, Firefox and WebKit, and saves the PDFs each engine makes.
 *
 *   node web/pdf-proto-html-wasm/run.mts [engines=fulgur,ironpress,...] [browsers=chromium,firefox,webkit] [large=1] [zip=1]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { BrowserType } from "@playwright/test";

// PW=<path to @playwright/test> picks a Playwright whose browsers are installed
// (this box has the browser builds for Playwright 1.60, the repo pins 1.64).
const { chromium, firefox, webkit } = (await import(process.env.PW ?? "@playwright/test")) as typeof import("@playwright/test");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const DIST = "/mnt/data/pdf-web-proto/html-wasm/dist";
const OUT = args.out ?? "/mnt/data/pdf-web-proto/html-wasm/out";
const FIX = "/mnt/data/pdf-web-proto/fixtures";
const engines: string[] = (args.engines ?? "fulgur,ironpress,ironpress-nosplit,dompdf,turbo").split(",");
const browsers: string[] = (args.browsers ?? "chromium,firefox,webkit").split(",");
const SHOW = "Fixture Show 2026";

const types: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm",
    ".ttf": "font/ttf", ".json": "application/json", ".css": "text/css",
};
const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
});
await new Promise<void>((r) => server.listen(7792, r));

const fixtures = Object.fromEntries(
    ["full", "quarter"].map((m) => [m, JSON.parse(fs.readFileSync(`${FIX}/sheets-${m}.json`, "utf8"))]),
);

/** Sum of resident memory (MB) of a process tree. */
function treeRssMb(pid: number): number {
    try {
        const out = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" });
        const rows = out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
        const kids = new Map<number, number[]>();
        for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
        const rss = new Map(rows.map(([p, , r]) => [p, r]));
        let sum = 0;
        const stack = [pid];
        while (stack.length) { const p = stack.pop()!; sum += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
        return sum / 1024;
    } catch { return NaN; }
}

const bt: Record<string, BrowserType> = { chromium, firefox, webkit };
const results: unknown[] = [];
for (const b of browsers) {
    // launchServer exposes the browser's process, so its memory can be sampled.
    const srv = await bt[b].launchServer();
    const pid = srv.process().pid;
    const browser = await bt[b].connect(srv.wsEndpoint());
    fs.mkdirSync(`${OUT}/${b}`, { recursive: true });
    for (const engine of engines) {
        const jobs: [string, string[], boolean][] = args.large
            ? [["large-full", Array.from({ length: 150 }, (_, i) => fixtures.full[i % 8].renderedPage), false],
               ["large-quarter", Array.from({ length: 150 }, (_, i) => fixtures.quarter[i % fixtures.quarter.length].renderedPage), true]]
            : [["full", fixtures.full.map((s: { renderedPage: string }) => s.renderedPage), false],
               ["quarter", fixtures.quarter.map((s: { renderedPage: string }) => s.renderedPage), true]];
        for (const [mode, sheets, quarter] of jobs) {
            // A fresh page per job, so load time and memory are per export.
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(String(e)));
            await page.goto("http://localhost:7792/");
            await page.waitForFunction(() => "pdfProto" in window);
            const base = pid ? treeRssMb(pid) : NaN;
            let peak = base;
            const timer = setInterval(() => { if (pid) peak = Math.max(peak, treeRssMb(pid)); }, 100);
            const t0 = Date.now();
            try {
                const r = await page.evaluate(
                    ([e, s, q, n]) => (window as any).pdfProto.run(e, s, q, n),
                    [engine, sheets, quarter, SHOW] as const,
                );
                const wall = Date.now() - t0;
                const file = `${OUT}/${b}/${engine}-${mode}.pdf`;
                fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
                const row = { browser: b, engine, mode, ok: true, inPageMs: Math.round(r.ms), wallMs: wall,
                    bytes: fs.statSync(file).size, peakRssMb: Math.round(peak), baseRssMb: Math.round(base), jsHeapMb: r.heap ? Math.round(r.heap / 1048576) : null, timings: r.timings };
                console.log(JSON.stringify(row));
                results.push(row);
            } catch (err) {
                const row = { browser: b, engine, mode, ok: false, error: String(err).slice(0, 300), pageErrors: errors.slice(0, 3) };
                console.log(JSON.stringify(row));
                results.push(row);
            } finally {
                clearInterval(timer);
                await page.close();
            }
        }
    }
    if (args.zip) {
        const page = await browser.newPage();
        await page.goto("http://localhost:7792/");
        await page.waitForFunction(() => "pdfProto" in window);
        for (const [mode, quarter] of [["full", false], ["quarter", true]] as const) {
            const r = await page.evaluate(
                ([e, s, q, n]) => (window as any).pdfProto.zip(e, s, q, n),
                [args.zipEngine ?? "fulgur", fixtures[mode], quarter, SHOW] as const,
            );
            const file = `${OUT}/${b}/by-section-${mode}.zip`;
            fs.writeFileSync(file, Buffer.from(r.b64, "base64"));
            console.log(JSON.stringify({ browser: b, zip: mode, ms: Math.round(r.ms), bytes: fs.statSync(file).size }));
        }
        await page.close();
    }
    await browser.close();
    await srv.close();
}
fs.writeFileSync(`${OUT}/results${args.large ? "-large" : ""}.json`, JSON.stringify(results, null, 2));
server.close();
