// Drives the prototype page in Chromium, Firefox and WebKit, saves the PDFs
// and zips, and records timings and peak memory.
//   npx vite build --config web/renderer/typstPdf/proto/vite.config.mts
//   npx vite preview --config web/renderer/typstPdf/proto/vite.config.mts &
//   node web/renderer/typstPdf/proto/run-browsers.mts [chromium,firefox,webkit] [--large]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, firefox, webkit, type Page } from "@playwright/test";

const OUT = "/mnt/data/pdf-web-proto/typst-wasm/out";
const URL = process.env.PAGE_URL ?? "http://127.0.0.1:17791/";
const names = (process.argv[2] ?? "chromium,firefox,webkit").split(",");
const large = process.argv.includes("--large");
const engines = { chromium, firefox, webkit } as const;

/** Total RSS (MB) of every process below this one: the browser and its children. */
function treeRssMb(): number {
    const out = execFileSync("ps", ["-e", "-o", "pid=,ppid=,rss="], {
        encoding: "utf8",
    });
    // A browser in a Docker container (WS_ENDPOINT): sum that container's processes.
    if (process.env.DOCKER_NAME) {
        const pids = new Set(
            execFileSync(
                "docker",
                ["top", process.env.DOCKER_NAME, "-eo", "pid"],
                { encoding: "utf8" },
            )
                .trim()
                .split("\n")
                .slice(1)
                .map(Number),
        );
        let sum = 0;
        for (const line of out.trim().split("\n")) {
            const [pid, , r] = line.trim().split(/\s+/).map(Number);
            if (pids.has(pid)) sum += r;
        }
        return sum / 1024;
    }
    const kids = new Map<number, number[]>();
    const rss = new Map<number, number>();
    for (const line of out.trim().split("\n")) {
        const [pid, ppid, r] = line.trim().split(/\s+/).map(Number);
        kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
        rss.set(pid, r);
    }
    let total = 0;
    const stack = [...(kids.get(process.pid) ?? [])];
    while (stack.length) {
        const p = stack.pop()!;
        total += rss.get(p) ?? 0;
        stack.push(...(kids.get(p) ?? []));
    }
    return total / 1024;
}

async function withPeak<T>(fn: () => Promise<T>) {
    const before = treeRssMb();
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, treeRssMb())), 100);
    try {
        const value = await fn();
        return {
            value,
            rssBeforeMb: Math.round(before),
            rssPeakMb: Math.round(peak),
        };
    } finally {
        clearInterval(timer);
    }
}

type Opts = {
    layout: "full" | "quarter";
    organizeBySection: boolean;
    marchers?: number;
    model?: unknown;
};

async function run(page: Page, dir: string, label: string, opts: Opts) {
    const wall0 = Date.now();
    const {
        value: r,
        rssBeforeMb,
        rssPeakMb,
    } = await withPeak(() =>
        page.evaluate((o) => window.proto.exportSheets(o as never), opts),
    );
    const file = path.join(dir, `${label}${path.extname(r.name)}`);
    fs.writeFileSync(file, Buffer.from(r.base64, "base64"));
    const row = {
        label,
        file,
        size: r.size,
        pdfCount: r.pdfCount,
        totalMs: Math.round(r.totalMs),
        wallMs: Date.now() - wall0,
        initMs: Math.round(r.timings[0]?.initMs ?? 0),
        compileMs: r.timings.map((t: { compileMs: number }) =>
            Math.round(t.compileMs),
        ),
        rssBeforeMb,
        rssPeakMb,
    };
    console.log(
        JSON.stringify({
            ...row,
            compileMs:
                row.compileMs.length > 6
                    ? `${row.compileMs.length} pdfs, sum ${row.compileMs.reduce((a: number, b: number) => a + b, 0)}`
                    : row.compileMs,
        }),
    );
    return row;
}

const injection = JSON.parse(
    fs.readFileSync(
        "/mnt/data/pdf-web-proto/typst-wasm/injection-model.json",
        "utf8",
    ),
);
const fixture = JSON.parse(
    fs.readFileSync(
        "/mnt/data/pdf-web-proto/fixtures/sheet-model.json",
        "utf8",
    ),
);
const changed = {
    ...fixture,
    marchers: [...fixture.marchers]
        .reverse()
        .map((m: { rows: { sideToSide: string }[] }) => ({
            ...m,
            rows: m.rows.map((r) => ({
                ...r,
                sideToSide: `${r.sideToSide} (2)`,
            })),
        })),
};
const results: Record<string, unknown[]> = {};
for (const name of names) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const engine = engines[name as keyof typeof engines];
    const browser = process.env.WS_ENDPOINT
        ? await engine.connect(process.env.WS_ENDPOINT)
        : await engine.launch(
              process.env.FF_PREFS && name === "firefox"
                  ? { firefoxUserPrefs: JSON.parse(process.env.FF_PREFS) }
                  : {},
          );
    const rows: unknown[] = [];
    const version = browser.version();
    console.log(`== ${name} ${version}`);
    const fresh = async () => {
        const ctx = await browser.newContext(); // empty HTTP cache: a first visit
        const page = await ctx.newPage();
        page.on(
            "console",
            (m) =>
                m.type() === "error" &&
                console.log(`[${name} console] ${m.text()}`),
        );
        page.on("pageerror", (e) => console.log(`[${name} pageerror] ${e}`));
        await page.goto(URL);
        await page.waitForFunction(() => !!window.proto);
        return { ctx, page };
    };
    if (!large) {
        const { ctx, page } = await fresh();
        rows.push(
            await run(page, dir, "full-cold", {
                layout: "full",
                organizeBySection: false,
            }),
        );
        rows.push(
            await run(page, dir, "full-warm", {
                layout: "full",
                organizeBySection: false,
            }),
        );
        rows.push(
            await run(page, dir, "full-warm2", {
                layout: "full",
                organizeBySection: false,
            }),
        );
        // Warm compiler, but every cell changed: no cached layout to reuse.
        rows.push(
            await run(page, dir, "full-warm-newdata", {
                layout: "full",
                organizeBySection: false,
                model: changed,
            }),
        );
        rows.push(
            await run(page, dir, "quarter", {
                layout: "quarter",
                organizeBySection: false,
            }),
        );
        rows.push(
            await run(page, dir, "quarter-warm", {
                layout: "quarter",
                organizeBySection: false,
            }),
        );
        rows.push(
            await run(page, dir, "full-by-section", {
                layout: "full",
                organizeBySection: true,
            }),
        );
        rows.push(
            await run(page, dir, "quarter-by-section", {
                layout: "quarter",
                organizeBySection: true,
            }),
        );
        rows.push(
            await run(page, dir, "injection-full", {
                layout: "full",
                organizeBySection: false,
                model: injection,
            }),
        );
        const chart = await page.evaluate(() => window.proto.chart());
        fs.writeFileSync(
            path.join(dir, "drill-chart.pdf"),
            Buffer.from(chart.base64, "base64"),
        );
        console.log(
            JSON.stringify({
                label: "drill-chart",
                ms: Math.round(chart.ms),
                compileMs: Math.round(chart.compileMs),
            }),
        );
        rows.push({
            label: "drill-chart",
            ms: Math.round(chart.ms),
            compileMs: Math.round(chart.compileMs),
        });
        await ctx.close();
        // Quarter first in a fresh page, to time its cold start too.
        const second = await fresh();
        rows.push(
            await run(second.page, dir, "quarter-cold", {
                layout: "quarter",
                organizeBySection: false,
            }),
        );
        await second.ctx.close();
    } else {
        for (const layout of ["full", "quarter"] as const) {
            const { ctx, page } = await fresh();
            rows.push(
                await run(page, dir, `large-150-${layout}-cold`, {
                    layout,
                    organizeBySection: false,
                    marchers: 150,
                }),
            );
            rows.push(
                await run(page, dir, `large-150-${layout}-warm`, {
                    layout,
                    organizeBySection: false,
                    marchers: 150,
                }),
            );
            if (layout === "full")
                rows.push(
                    await run(page, dir, `large-150-full-by-section`, {
                        layout,
                        organizeBySection: true,
                        marchers: 150,
                    }),
                );
            await ctx.close();
        }
    }
    results[`${name} ${version}`] = rows;
    await browser.close();
}
const file = path.join(OUT, large ? "results-large.json" : "results.json");
const prev = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
fs.writeFileSync(file, JSON.stringify({ ...prev, ...results }, null, 1));
console.log("wrote", file);
