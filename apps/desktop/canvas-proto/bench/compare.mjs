// Same machine, same flags: the Fabric editor (web build) vs the three.js prototype.
// Measures in-page rAF intervals during playback and during a real mouse drag of every marcher.
import { chromium } from "/home/alex/GitHub/OpenMarch-follow/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs";
import fs from "node:fs";
const DEMOS = "/tmp/claude-1000/-home-alex-GitHub-OpenMarch/9517f0a0-57e1-5eb0-8199-ff2359dc5002/scratchpad/three-proto/apps/desktop/view3d-web/public/demos/";
const BACKENDS = {
  swiftshader: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  llvmpipe: ["--use-angle=gl-egl", "--ignore-gpu-blocklist"],
};
const [app, show, backend = "llvmpipe", throttle = "1", outFile = "compare.json"] = process.argv.slice(2);
const browser = await chromium.launch({ args: BACKENDS[backend] });
// Fabric's canvas is ~1190x600 inside its 1600x900 window; give the prototype the same stage size.
const viewport = app === "fabric" ? { width: 1600, height: 900 } : { width: 1190, height: 680 };
const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
page.setDefaultTimeout(280000);

const recordFrames = (ms) => page.evaluate((ms) => new Promise((resolve) => {
  const iv = []; let last = 0; const t0 = performance.now();
  const longTasks = []; let po;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration); }); po.observe({ type: "longtask" }); } catch {}
  const tick = (now) => { if (last) iv.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(tick); else { po?.disconnect(); resolve({ iv, longTasks }); } };
  requestAnimationFrame(tick);
}), ms);
const summarize = ({ iv, longTasks }) => {
  const s = (iv.length > 4 ? iv.slice(3) : iv).sort((a, b) => a - b);
  if (!s.length) return { frames: 0, fps: 0, p50: 0, p95: 0, max: 0, over50ms: 0, longTaskMs: 0 };
  const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return { frames: s.length, fps: +(s.length / (s.reduce((a, b) => a + b, 0) / 1000)).toFixed(1), p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over50ms: s.filter((x) => x > 50).length, longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)) };
};

let markerScreen;
if (app === "fabric") {
  await page.goto("http://127.0.0.1:7780/", { timeout: 120000 });
  await page.getByText("Got it").click({ timeout: 60000 }).catch(() => {});
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Open File").click()]);
  await chooser.setFiles(DEMOS + ({ lhb: "lhb-daft-punk-pt2.dots", lhbx5: "lhb-x5.dots" }[show] ?? "part1-demo.dots"));
  await page.waitForFunction(() => window.canvas?.getCanvasMarchers?.().length > 0, null, { timeout: 280000 });
  await page.waitForTimeout(3000);
  // Grab the middle of the active selection's box (Fabric drags the whole selection from there).
  markerScreen = () => page.evaluate(() => {
    const c = window.canvas; const r = c.upperCanvasEl.getBoundingClientRect();
    const b = c.getActiveObject().getBoundingRect();
    return [r.left + b.left + b.width / 2, r.top + b.top + b.height / 2];
  });
} else {
  await page.goto(`http://127.0.0.1:${process.env.PROTO_PORT ?? 5191}/?show=${show}&aa=0&dpr=1&renderer=${app === "proto2d" ? "2d" : "webgl"}`);
  await page.waitForFunction(() => window.__proto?.ready);
  await page.evaluate(() => window.__proto.ready);
  await page.waitForTimeout(1000);
  markerScreen = () => page.evaluate(() => {
    const ed = window.__proto.editor; const r = ed.container.getBoundingClientRect();
    const [x, y] = ed.scene.view.fieldToScreen(ed.display[0], ed.display[1]);
    return [r.left + x, r.top + y];
  });
}
if (+throttle > 1) { const s = await ctx.newCDPSession(page); await s.send("Emulation.setCPUThrottlingRate", { rate: +throttle }); }
const marchers = await page.evaluate(() => window.canvas?.getCanvasMarchers?.().length ?? window.__proto.editor.source.count);
const out = { app, show, backend, throttle: +throttle, marchers };

// Focus the field by clicking an empty spot, then play.
const focusField = () => page.mouse.click(...(app === "fabric" ? [90, 300] : [20, 120]));
const readTime = () => app === "fabric"
  ? page.evaluate(() => (document.body.innerText.match(/\d\d:\d\d\.\d{3}/) || ["?"])[0])
  : page.evaluate(() => window.__proto.editor.time.toFixed(0));
// Positions of every marcher, to prove a drag moved them all.
const positions = () => app === "fabric"
  ? page.evaluate(() => window.canvas.getCanvasMarchers().map((m) => { const t = m.calcTransformMatrix(); return [t[4], t[5]]; }))
  : page.evaluate(() => { const d = window.__proto.editor.display; const o = []; for (let i = 0; i < d.length; i += 2) o.push([d[i], d[i + 1]]); return o; });
await focusField();
out.timeBeforePlay = await readTime();
await page.keyboard.press("Space");
await page.waitForTimeout(500);
out.play = summarize(await recordFrames(5000));
out.timeDuringPlay = await readTime();
await page.keyboard.press("Space");
await page.waitForTimeout(1500);

// Go to a page with positions, select all, drag them around with the mouse.
if (app === "fabric") { await page.keyboard.press("e"); await page.keyboard.press("e"); }
else { await page.keyboard.press("KeyE"); }
await page.waitForTimeout(1000);
await focusField();
await page.keyboard.press("Control+a");
await page.waitForTimeout(800);
const before = await positions();
const [mx, my] = await markerScreen();
await page.mouse.move(mx, my);
await page.mouse.down();
const framesP = recordFrames(4000);
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 4000) {
  const a = i++ / 10;
  await page.mouse.move(mx + Math.sin(a) * 120, my + Math.cos(a) * 60);
}
out.drag = summarize(await framesP);
out.dragMoves = i;
await page.mouse.move(mx + 60, my + 30);
await page.waitForTimeout(300);
const during = await positions();
out.movedDuringDrag = during.filter((p, k) => Math.hypot(p[0] - before[k][0], p[1] - before[k][1]) > 1).length;
await page.mouse.up();
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : [];
all.push(out); fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
await page.screenshot({ path: `cmp-${app}-${show}-${backend}-t${throttle}.png` });
await browser.close();
