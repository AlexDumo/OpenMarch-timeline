/* eslint-disable no-console -- a command-line tool: it reports what it recorded */
// cspell:words faststart hstack libx movflags longtask mjpeg
// Prototype (#968): records the home page hero variants and measures them.
// Build first (pnpm --dir apps/website run build), then:
//
//   node apps/website/scripts/hero-proto.mjs clips  [--out dir]   one clip per variant, 60 fps
//   node apps/website/scripts/hero-proto.mjs touch  [--out dir]   the three on a phone, side by side
//   node apps/website/scripts/hero-proto.mjs stills [--out dir]   reduced motion, light and dark
//   node apps/website/scripts/hero-proto.mjs perf                 frame cost on a throttled CPU
//
// Clips are filmed frame by frame with the hero's clock handed over (?rec), so they come out
// the same every time whatever the machine is doing. Chromium draws on the GPU (ANGLE on Vulkan).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const require = createRequire(path.join(WEBSITE, "package.json"));
const { chromium } = require("@playwright/test");

const [mode = "clips", ...rest] = process.argv.slice(2);
const outAt = rest.indexOf("--out");
const out = path.resolve(
    outAt >= 0 ? rest[outAt + 1] : "/mnt/data/om-capture/hero-968",
);
fs.mkdirSync(out, { recursive: true });

const onlyAt = rest.indexOf("--only");
const VARIANTS =
    onlyAt >= 0 ? rest[onlyAt + 1].split(",") : ["form", "show", "file"];
const FPS = 60;
const GPU = [
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
];

const port = 4400 + Math.floor(Math.random() * 400);
const server = spawn("npx", ["astro", "preview", "--port", String(port)], {
    cwd: WEBSITE,
    stdio: "ignore",
});
const base = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
    if (
        await fetch(base).then(
            () => true,
            () => false,
        )
    )
        break;
    await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({ args: GPU });

async function renderer(page) {
    return page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return gl
            ? gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
            : "no WebGL";
    });
}

/** A pointer drawn into the page, since a headless browser shows none */
const POINTER = `
(() => {
    const el = document.createElement("div");
    el.id = "rec-pointer";
    el.style.cssText = "position:fixed;left:0;top:0;z-index:99999;pointer-events:none;display:none";
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8-6.5 1.6L8.5 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "rec-ring";
    ring.style.cssText = "position:fixed;left:0;top:0;z-index:99998;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #111;opacity:0";
    addEventListener("DOMContentLoaded", () => document.body.append(el, ring));
    addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return;
        el.style.display = "block";
        el.style.transform = "translate(" + (e.clientX - 3) + "px," + (e.clientY - 2) + "px)";
    }, true);
    addEventListener("pointerdown", (e) => {
        ring.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
        ring.dataset.age = "0";
    }, true);
    window.__recFrame = () => {
        const age = Number(ring.dataset.age ?? 99);
        ring.dataset.age = String(age + 1);
        ring.style.opacity = String(Math.max(0, 1 - age / 24));
        ring.style.scale = String(0.5 + Math.min(1, age / 24) * 0.6);
    };
})();`;

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * A script of pointer moves as [seconds, x, y, "click"?] legs: glide to (x, y) over that long (a
 * leg to where it already is rests there). Returns where the pointer is at each frame.
 */
function path2frames(start, legs) {
    const frames = [];
    let at = start;
    for (const [seconds, x, y, action] of legs) {
        const count = Math.round(seconds * FPS);
        for (let i = 1; i <= count; i++) {
            const t = smooth(i / count);
            frames.push({
                x: at.x + (x - at.x) * t,
                y: at.y + (y - at.y) * t,
                click: action === "click" && i === count,
            });
        }
        at = { x, y };
    }
    return frames;
}

/** Films `frames` frames of the page into `file`, calling `each(i)` before each one */
async function film(page, file, size, frames, each) {
    const cdp = await page.context().newCDPSession(page);
    const ffmpeg = spawn(
        "ffmpeg",
        [
            "-y",
            "-loglevel",
            "error",
            "-f",
            "image2pipe",
            "-framerate",
            String(FPS),
            "-c:v",
            "mjpeg",
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            file,
        ],
        { stdio: ["pipe", "inherit", "inherit"] },
    );
    for (let i = 0; i < frames; i++) {
        await each(i);
        await page.evaluate((dt) => {
            window.__recFrame?.();
            window.__hero.advance(dt);
        }, 1 / FPS);
        const shot = await cdp.send("Page.captureScreenshot", {
            format: "jpeg",
            quality: 93,
            clip: { x: 0, y: 0, ...size, scale: 1 },
        });
        if (!ffmpeg.stdin.write(Buffer.from(shot.data, "base64")))
            await new Promise((r) => ffmpeg.stdin.once("drain", r));
    }
    ffmpeg.stdin.end();
    await new Promise((r) => ffmpeg.on("close", r));
}

async function open(context, variant, query = "rec") {
    const page = await context.newPage();
    await page.addInitScript(POINTER);
    await page.goto(`${base}/?hero=${variant}&${query}`);
    await page.waitForFunction(() => window.__hero);
    // The page's own entrance animations run in real time: let them finish
    await page.waitForTimeout(2200);
    return page;
}

// What the pointer does in each variant's clip, on a 1280 × 720 page
const DESKTOP = { width: 1280, height: 720 };
const SCRIPTS = {
    // Form: stand (it changes form in place), drift (it marches after the pointer set by
    // set), stand, cross, click, then a fast whip it chases over several sets
    form: {
        start: { x: 640, y: 270 },
        legs: [
            [3.6, 640, 270],
            [3.0, 340, 330],
            [3.4, 340, 330],
            [2.4, 940, 250],
            [3.0, 940, 250],
            [0.2, 940, 250, "click"],
            [2.2, 940, 250],
            [0.6, 330, 240],
            [6.0, 330, 240],
        ],
    },
    // Show: the band runs its sets while the pointer drifts and steers it
    show: {
        start: { x: 640, y: 60 },
        legs: [
            [1.0, 640, 230],
            [3.0, 640, 230],
            [2.5, 330, 290],
            [3.0, 330, 290],
            [3.0, 930, 210],
            [3.0, 930, 210],
            [2.0, 640, 260],
            [2.5, 640, 260],
        ],
    },
    // File: lead the file around, stop (it forms), step off, stop again
    file: {
        start: { x: 80, y: 250 },
        legs: [
            [0.8, 400, 180],
            [0.7, 640, 330],
            [0.8, 900, 220],
            [2.6, 900, 220],
            [0.7, 700, 380],
            [0.7, 420, 300],
            [0.6, 300, 170],
            [0.7, 560, 230],
            [2.8, 560, 230],
            [0.8, 840, 330],
            [0.6, 1000, 200],
            [0.7, 760, 150],
            [2.8, 760, 150],
            [0.9, 420, 320],
            [2.6, 420, 320],
        ],
    },
};

if (mode === "clips") {
    const context = await browser.newContext({
        viewport: DESKTOP,
        colorScheme: "dark",
    });
    for (const variant of VARIANTS) {
        const page = await open(context, variant);
        if (variant === VARIANTS[0])
            console.log("note: rendering:", await renderer(page));
        const { start, legs } = SCRIPTS[variant];
        const frames = path2frames(start, legs);
        await page.mouse.move(start.x, start.y);
        const file = path.join(out, `hero-${variant}.mp4`);
        await film(page, file, DESKTOP, frames.length, async (i) => {
            const f = frames[i];
            await page.mouse.move(f.x, f.y);
            if (f.click) await page.mouse.click(f.x, f.y);
        });
        console.log(file, `${(frames.length / FPS).toFixed(1)} s`);
        await page.close();
    }
}

if (mode === "touch") {
    // A phone: no cursor, so the autopilot leads; a tap moves the band there and asks for the
    // next shape
    const PHONE = { width: 390, height: 760 };
    const seconds = 14;
    // On the heading, which is not a link
    const taps = { 300: { x: 80, y: 300 }, 560: { x: 310, y: 262 } };
    const files = [];
    for (const variant of VARIANTS) {
        const context = await browser.newContext({
            viewport: PHONE,
            deviceScaleFactor: 2,
            hasTouch: true,
            isMobile: true,
            colorScheme: "dark",
        });
        const page = await open(context, variant);
        const file = path.join(out, `touch-${variant}.mp4`);
        await film(page, file, PHONE, seconds * FPS, async (i) => {
            if (taps[i]) await page.touchscreen.tap(taps[i].x, taps[i].y);
        });
        files.push(file);
        await context.close();
    }
    const all = path.join(out, "hero-touch.mp4");
    if (files.length === 1) fs.copyFileSync(files[0], all);
    else
        await new Promise((r) =>
            spawn(
                "ffmpeg",
                [
                    "-y",
                    "-loglevel",
                    "error",
                    ...files.flatMap((f) => ["-i", f]),
                    "-filter_complex",
                    "[0:v]pad=iw+16:ih:0:0:black[a];[1:v]pad=iw+16:ih:0:0:black[b];[a][b][2:v]hstack=inputs=3",
                    "-c:v",
                    "libx264",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    all,
                ],
                { stdio: "inherit" },
            ).on("close", r),
        );
    console.log(all, `${seconds} s`);
}

if (mode === "stills") {
    for (const scheme of ["dark", "light"]) {
        const context = await browser.newContext({
            viewport: DESKTOP,
            colorScheme: scheme,
            reducedMotion: "reduce",
        });
        for (const variant of VARIANTS) {
            const page = await context.newPage();
            await page.goto(`${base}/?hero=${variant}&rec`);
            await page.waitForFunction(() => window.__hero);
            await page.waitForTimeout(1200);
            const file = path.join(out, `still-${variant}.${scheme}.png`);
            await page.screenshot({ path: file });
            console.log(file);
            await page.close();
        }
        await context.close();
    }
}

if (mode === "perf") {
    // Real time, a pointer sweeping the hero, the CPU slowed 4× (a mid-range phone) and 6× (a
    // slow one). Cost is the hero's own work per frame: moving the marchers and drawing them.
    const setups = [
        {
            name: "desktop 1280",
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
        },
        {
            name: "phone 390",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            hasTouch: true,
            isMobile: true,
        },
    ];
    const rows = [];
    for (const { name, ...setup } of setups) {
        for (const rate of [1, 4, 6]) {
            for (const variant of VARIANTS) {
                const context = await browser.newContext(setup);
                const page = await context.newPage();
                const cdp = await context.newCDPSession(page);
                await cdp.send("Emulation.setCPUThrottlingRate", { rate });
                await page.addInitScript(() => {
                    window.__long = [];
                    new PerformanceObserver((list) => {
                        for (const e of list.getEntries())
                            window.__long.push(Math.round(e.duration));
                    }).observe({ type: "longtask", buffered: true });
                });
                await page.goto(`${base}/?hero=${variant}`);
                await page.waitForFunction(() => window.__hero, null, {
                    timeout: 60000,
                });
                await page.waitForTimeout(1500);
                const longBefore = await page.evaluate(
                    () => window.__long.length,
                );
                await page.evaluate(() => window.__hero.resetPerf());
                const w = setup.viewport.width;
                const t0 = Date.now();
                // 8 seconds: sweep, stop, click, sweep
                while (Date.now() - t0 < 8000) {
                    const t = (Date.now() - t0) / 1000;
                    const moving = t % 2.6 < 1.5;
                    if (moving && !setup.hasTouch)
                        await page.mouse.move(
                            w * (0.5 + 0.38 * Math.sin(t * 2.1)),
                            260 + 110 * Math.sin(t * 3.3),
                        );
                    else if (setup.hasTouch && Math.floor(t * 10) % 26 === 0)
                        // On the heading: a tap on a link would leave the page
                        await page.touchscreen.tap(
                            w * (0.3 + 0.4 * Math.random()),
                            250 + 60 * Math.random(),
                        );
                    await page.waitForTimeout(16);
                }
                const perf = await page.evaluate(() => window.__hero.perf());
                const long = await page.evaluate(() => window.__long);
                const row = {
                    setup: name,
                    cpu: `${rate}×`,
                    variant,
                    fps: perf.fps.toFixed(0),
                    "mean ms": perf.meanMs.toFixed(2),
                    "max ms": perf.maxMs.toFixed(1),
                    "long tasks at load (ms)":
                        long.slice(0, longBefore).join(" ") || "-",
                    "long tasks running (ms)":
                        long.slice(longBefore).join(" ") || "-",
                };
                rows.push(row);
                console.log(JSON.stringify(row));
                await context.close();
            }
        }
    }
    console.table(rows);
    fs.writeFileSync(
        path.join(out, "perf.json"),
        JSON.stringify(rows, null, 2),
    );
}

await browser.close();
server.kill();
