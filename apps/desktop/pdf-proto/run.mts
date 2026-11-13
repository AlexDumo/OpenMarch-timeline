// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
/**
 * Drives the prototype page (pdf-proto/) in Chromium, Firefox and WebKit:
 * makes the fixture PDFs, the zips, a Unicode sample and a large show, and
 * records timings and peak memory. Output goes to $OUT (default
 * /mnt/data/pdf-web-proto/pdfmake/out).
 *
 *   PROTO_OUT=.../proto-dist npx vite build -c pdf-proto/vite.config.mts
 *   (serve proto-dist on :7791)  npx tsx pdf-proto/run.mts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";

const FIX = "/mnt/data/pdf-web-proto/fixtures";
const OUT = process.env.OUT ?? "/mnt/data/pdf-web-proto/pdfmake/out";
const URL = process.env.URL ?? "http://127.0.0.1:7791/index.html";
const only = process.env.BROWSERS?.split(",");

const model = JSON.parse(fs.readFileSync(`${FIX}/sheet-model.json`, "utf8"));
const base = {
    includeMeasures: model.options.includeMeasures,
    terse: model.options.terse,
    useXY: model.options.useXY,
    baseName: "fixture",
    now: "2026-11-12T12:00:00Z",
};

const unicodeModel = {
    showName: "Unicode Sample",
    marchers: [
        ["Ana García-Núñez", "Latin-1"],
        ["Émile Zoë Østergaard", "Latin-1"],
        ["Łukasz Dvořák Šťastný", "Latin Extended-A"],
        ["Nguyễn Văn An", "Vietnamese"],
        ["Ольга Иванова", "Cyrillic"],
        ["Ελένη Παπαδοπούλου", "Greek"],
        ["李小龍 / 山田太郎", "CJK"],
        ["محمد علي", "Arabic"],
        ["Smile 😀 ★ ♫", "Emoji and symbols"],
    ].map(([name, section], i) => ({
        name,
        displayName: name,
        drillNumber: `U${i + 1}`,
        section,
        rows: model.marchers[0].rows.slice(0, 3),
    })),
};

function bigModel(n: number) {
    const marchers = Array.from({ length: n }, (_, i) => {
        const src = model.marchers[i % model.marchers.length];
        return {
            ...src,
            drillNumber: `${src.drillNumber.replace(/\d+/, "")}${i + 1}`,
            section: `${src.section} ${Math.floor(i / 25) + 1}`,
        };
    });
    return { showName: "Large Show", marchers };
}

/** Peak RSS (MB) of this process's descendant browser processes. */
function treeRss(): number {
    const rows = execSync("ps -eo pid=,ppid=,rss=")
        .toString()
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
    return total / 1024;
}

const results: Record<string, unknown>[] = [];

async function runBrowser(name: string, type: BrowserType) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const browser = await type.launch();
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning")
            errors.push(`${m.type()}: ${m.text()}`);
    });
    await page.goto(URL);
    await page.waitForFunction(
        () => document.getElementById("status")?.textContent === "ready",
    );

    const make = async (
        label: string,
        m: unknown,
        options: Record<string, unknown>,
        save: boolean,
    ) => {
        let peak = treeRss();
        const before = peak;
        const timer = setInterval(() => {
            peak = Math.max(peak, treeRss());
        }, 100);
        let r;
        try {
            r = await page.evaluate(
                async ([m, o, returnBytes]) => {
                    const opts = { ...(o as Record<string, unknown>) };
                    opts.now = new Date(opts.now as string);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (window as any).pdfProto.make(m, opts, {
                        returnBytes,
                    });
                },
                [m, options, save] as const,
            );
        } catch (e) {
            clearInterval(timer);
            results.push({ browser: name, label, error: String(e) });
            console.log(name, label, "ERROR", String(e).slice(0, 300));
            return;
        }
        clearInterval(timer);
        const ext = r.name.endsWith(".zip") ? "zip" : "pdf";
        if (save && r.base64)
            fs.writeFileSync(
                path.join(dir, `${label}.${ext}`),
                Buffer.from(r.base64, "base64"),
            );
        const row = {
            browser: name,
            label,
            ms: Math.round(r.ms),
            bytes: r.size,
            files: r.pdfs.length,
            rssBeforeMB: Math.round(before),
            rssPeakMB: Math.round(peak),
        };
        results.push(row);
        console.log(JSON.stringify(row));
    };

    const helv = { ...base, font: "Helvetica" };
    const robo = { ...base, font: "Roboto" };
    // warm-up (first load of pdfmake + font chunk is timed separately)
    const t0 = Date.now();
    await make(
        "warmup-full-helvetica",
        model,
        { ...helv, quarterPages: false, organizeBySection: false },
        false,
    );
    results.push({
        browser: name,
        label: "first-call-incl-load",
        ms: Date.now() - t0,
    });
    await make(
        "full-helvetica",
        model,
        { ...helv, quarterPages: false, organizeBySection: false },
        true,
    );
    await make(
        "quarter-helvetica",
        model,
        { ...helv, quarterPages: true, organizeBySection: false },
        true,
    );
    await make(
        "full-roboto",
        model,
        { ...robo, quarterPages: false, organizeBySection: false },
        true,
    );
    await make(
        "quarter-roboto",
        model,
        { ...robo, quarterPages: true, organizeBySection: false },
        true,
    );
    await make(
        "full-by-section",
        model,
        { ...helv, quarterPages: false, organizeBySection: true },
        true,
    );
    await make(
        "quarter-by-section",
        model,
        { ...helv, quarterPages: true, organizeBySection: true },
        true,
    );
    await make(
        "unicode-helvetica",
        unicodeModel,
        { ...helv, quarterPages: false, organizeBySection: false },
        true,
    );
    await make(
        "unicode-roboto",
        unicodeModel,
        { ...robo, quarterPages: false, organizeBySection: false },
        true,
    );
    const big = bigModel(150);
    await make(
        "large150-full",
        big,
        { ...helv, quarterPages: false, organizeBySection: false },
        true,
    );
    await make(
        "large150-quarter",
        big,
        { ...helv, quarterPages: true, organizeBySection: false },
        true,
    );
    await make(
        "large150-full-by-section",
        big,
        { ...helv, quarterPages: false, organizeBySection: true },
        false,
    );
    if (name === "chromium") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await make(
            "large150-full-4xthrottle",
            big,
            { ...helv, quarterPages: false, organizeBySection: false },
            false,
        );
        await make(
            "fixture-full-4xthrottle",
            model,
            { ...helv, quarterPages: false, organizeBySection: false },
            false,
        );
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }

    // The real hand-off: a download triggered from the page
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.evaluate(
            async ([m, o]) => {
                const opts = { ...(o as Record<string, unknown>) };
                opts.now = new Date(opts.now as string);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (window as any).pdfProto.make(m, opts, {
                    returnBytes: false,
                    triggerDownload: true,
                });
            },
            [
                model,
                { ...helv, quarterPages: false, organizeBySection: true },
            ] as const,
        ),
    ]);
    const dl = path.join(dir, `download-${download.suggestedFilename()}`);
    await download.saveAs(dl);
    results.push({
        browser: name,
        label: "download-event",
        file: download.suggestedFilename(),
        bytes: fs.statSync(dl).size,
    });
    results.push({ browser: name, label: "console-errors", errors });
    await browser.close();
}

const browsers: [string, BrowserType][] = [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
];
for (const [name, type] of browsers) {
    if (only && !only.includes(name)) continue;
    try {
        await runBrowser(name, type);
    } catch (e) {
        results.push({ browser: name, fatal: String(e) });
        console.log(name, "FATAL", e);
    }
}
fs.writeFileSync(
    path.join(OUT, `results${only ? "-" + only.join("-") : ""}.json`),
    JSON.stringify(results, null, 2),
);
