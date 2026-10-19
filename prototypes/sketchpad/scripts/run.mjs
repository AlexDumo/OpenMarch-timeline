// Headless Chromium checks for the sketchpad spike.
// Usage: node scripts/run.mjs [baseUrl]   (expects `vite preview` on :5199)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:5199/";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SHOTS = path.join(ROOT, "shots");
const EXPORTS = path.join(ROOT, "exports");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(EXPORTS, { recursive: true });
const results = {};
const log = (k, v) => { results[k] = v; console.log(k, JSON.stringify(v)); };

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"] });

async function open(query = "", ctx = context) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 300)); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.sketchReady === true);
  await page.waitForTimeout(400);
  return page;
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(SHOTS, name) }); return name; };

// Adds the drawings used across checks. Returns ids.
async function drawScene(page) {
  return page.evaluate(() => {
    const { api } = window.sketch;
    const { convertToExcalidrawElements } = window.__ex;
    const STEP = 12, YARD = 1.6 * STEP, EZ = 10 * YARD;
    const yx = (yd) => EZ + yd * YARD;
    const els = convertToExcalidrawElements([
      { type: "rectangle", id: "rect-dots", x: yx(20), y: 330, width: 16 * STEP, height: 10 * STEP, backgroundColor: "#e03131", fillStyle: "om-dots", strokeColor: "#e03131", strokeWidth: 2 },
      { type: "ellipse", id: "ell-stag", x: yx(35), y: 300, width: 18 * STEP, height: 14 * STEP, backgroundColor: "#1971c2", fillStyle: "om-dots-staggered", strokeColor: "#1971c2", strokeWidth: 2 },
      { type: "rectangle", id: "rect-even", x: yx(55), y: 330, width: 15 * STEP, height: 9 * STEP, backgroundColor: "#7048e8", fillStyle: "om-dots-even", strokeColor: "#7048e8", strokeWidth: 2, roundness: { type: 3 } },
      { type: "ellipse", id: "ell-dots", x: yx(70), y: 560, width: 14 * STEP, height: 14 * STEP, backgroundColor: "#f08c00", fillStyle: "om-dots", strokeColor: "#f08c00", strokeWidth: 1 },
      { type: "diamond", id: "dia-hach", x: yx(72), y: 290, width: 140, height: 140, backgroundColor: "#2f9e44", fillStyle: "hachure", strokeColor: "#2f9e44" },
      { type: "arrow", id: "arrow-1", x: yx(28), y: 520, points: [[0, 0], [240, 120]], strokeColor: "#1e1e1e", strokeWidth: 2 },
      { type: "text", id: "title", x: yx(20), y: 250, text: "Opener: block to wedge", fontSize: 28, strokeColor: "#1e1e1e" },
    ], { regenerateIds: false });
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els] });
    window.sketch.addSticky("Brass: hold 4 counts\nthen expand", yx(42), 600);
    return api.getSceneElements().length;
  });
}

// ---- probe lines for alignment: Excalidraw red lines offset by 24 scene units from the
// underlay's blue 50-yard line and blue front-hash row.
async function addProbes(page) {
  await page.evaluate(() => {
    const { api, probeX, probeY } = window.sketch;
    const { convertToExcalidrawElements } = window.__ex;
    const els = convertToExcalidrawElements([
      { type: "line", id: "probe-v", x: probeX, y: -200, points: [[0, 0], [0, 1500]], strokeColor: "#ff0000", strokeWidth: 4, roughness: 0 },
      { type: "line", id: "probe-h", x: -200, y: probeY, points: [[0, 0], [2800, 0]], strokeColor: "#ff0000", strokeWidth: 4, roughness: 0 },
    ], { regenerateIds: false }).map((e) => ({ ...e, locked: true }));
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: {} } });
  });
}

// In-page pixel analysis of a screenshot (PNG), independent of app state: the underlay draws
// 12-unit blue bands (50 yard line, front hash row) and Excalidraw draws 4-unit red lines on
// their centers. In every pixel row/column, each blue+red run should have the red part centered;
// the error is (red center - run center) in screen px. Median and max over all rows/columns.
async function measureShot(page, buf) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const cls = (i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; if (g > 100 || (r < 120 && b < 120)) return 0; return r > b ? 2 : 1; };
    const scan = (len, count, idx) => {
      const errs = [], bad = [];
      for (let k = 0; k < count; k += 2) {
        let start = -1, reds = [], blues = 0;
        for (let t = 0; t <= len; t++) {
          const v = t < len ? cls(idx(k, t)) : 0;
          if (v) { if (start < 0) { start = t; reds = []; blues = 0; } if (v === 2) reds.push(t); else blues++; }
          else if (start >= 0) {
            const runLen = t - start;
            // a band crossing: blue on both sides of the red line, not too wide (skip the cross of the two bands)
            if (reds.length && blues >= 2 && runLen < 200) {
              const rc = reds.reduce((a, b) => a + b, 0) / reds.length;
              const e = rc - (start + t - 1) / 2;
              errs.push(e);
              if (Math.abs(e) > 2 && bad.length < 4) bad.push([k, start, t]);
            }
            start = -1;
          }
        }
      }
      errs.sort((a, b) => a - b);
      const abs = errs.map(Math.abs).sort((a, b) => a - b);
      return errs.length ? { n: errs.length, median: +errs[errs.length >> 1].toFixed(2), maxAbs: +abs[abs.length - 1].toFixed(2), p95Abs: +abs[Math.floor(abs.length * 0.95)].toFixed(2), over2: abs.filter((v) => v > 2).length, bad } : { n: 0 };
    };
    const rows = scan(W, H, (y, x) => (y * W + x) * 4); // vertical band -> scan rows
    const cols = scan(H, W, (x, y) => (y * W + x) * 4); // horizontal band -> scan columns
    const s = window.sketch.api.getAppState();
    return { zoomNow: +s.zoom.value.toFixed(3), x: rows, y: cols };
  }, buf.toString("base64"));
}

async function wheel(page, dx, dy, ctrl = false, at = [700, 430]) {
  await page.evaluate(([dx, dy, ctrl, at]) => {
    const el = document.querySelector(".excalidraw__canvas.interactive") || document.querySelector("canvas.interactive");
    el.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, ctrlKey: ctrl, clientX: at[0], clientY: at[1], bubbles: true, cancelable: true }));
  }, [dx, dy, ctrl, at]);
}

// ===================== 1. underlay + drawings =====================
{
  const page = await open("?field=svg");
  await shot(page, "01-field-underlay.png");
  log("elementsBefore", await drawScene(page));
  // a rectangle drawn with the mouse, then filled with staggered dots from the panel
  await page.mouse.click(700, 790); // focus the canvas
  await page.keyboard.press("r");
  await page.mouse.move(980, 560); await page.mouse.down(); await page.mouse.move(1080, 640, { steps: 8 }); await page.mouse.up();
  await page.click('[data-testid="fill-staggered"]');
  // freedraw with the mouse
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 790); // the panel button took focus; give it back to the canvas
  await page.keyboard.press("7");
  await page.mouse.move(300, 650); await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(300 + i * 8, 650 + Math.sin(i / 3) * 25);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.sketch.api.updateScene({ appState: { selectedElementIds: {} } }));
  await page.waitForTimeout(200);
  await shot(page, "02-drawings-on-field.png");
  log("fillStylesInScene", await page.evaluate(() => window.sketch.api.getSceneElements().map((e) => e.fillStyle).filter((f) => f.startsWith("om-"))));

  // style toggles
  await page.evaluate(() => window.sketch.setFieldStyle((s) => ({ ...s, grid: false, lineColor: "#ffd43b" })));
  await page.waitForTimeout(150);
  await shot(page, "03-field-style-nogrid-yellow.png");
  await page.evaluate(() => window.sketch.setFieldStyle((s) => ({ ...s, grid: true, lineColor: "#ffffff" })));

  // zoomed in on the dots
  for (let i = 0; i < 6; i++) await wheel(page, 0, -100, true, [470, 360]);
  await page.waitForTimeout(200);
  await shot(page, "04-zoomed-dots-detail.png");

  // ---------- exports ----------
  await page.evaluate(() => window.sketch.api.updateScene({ appState: { zoom: { value: 0.55 }, scrollX: 40, scrollY: 140 } }));
  const svgInfo = await page.evaluate(() => window.sketch.exportCompositeSvgInfo());
  log("exportSvgInfo", svgInfo);
  const svgText = await page.evaluate(() => window.sketch.exportCompositeSvg());
  fs.writeFileSync(path.join(EXPORTS, "sketch.svg"), svgText);
  log("exportSvgHasOmDotsPaths", (svgText.match(/<path/g) || []).length);
  const png = await page.evaluate(() => window.sketch.exportPngDataUrl());
  fs.writeFileSync(path.join(EXPORTS, "sketch.png"), Buffer.from(png.split(",")[1], "base64"));
  const pdf = await page.evaluate(() => window.sketch.exportPdfDataUrl());
  fs.writeFileSync(path.join(EXPORTS, "sketch.pdf"), Buffer.from(pdf.split(",")[1], "base64"));
  log("exportBytes", { svg: svgText.length, png: fs.statSync(path.join(EXPORTS, "sketch.png")).size, pdf: fs.statSync(path.join(EXPORTS, "sketch.pdf")).size });

  // ---------- save / load / template ----------
  const saveRes = await page.evaluate(() => {
    const s = window.sketch;
    s.save();
    const tpl = s.saveAsTemplate();
    const before = s.api.getSceneElements().length;
    s.api.updateScene({ elements: [] });
    const cleared = s.api.getSceneElements().length;
    s.load();
    const after = s.api.getSceneElements();
    s.load(tpl);
    return { before, cleared, after: after.length, fills: after.map((e) => e.fillStyle).filter((f) => f.startsWith("om-")), rows: s.readTable().map((r) => ({ id: r.id, kind: r.kind, bytes: r.json.length })) };
  });
  log("saveLoad", saveRes);
  await page.waitForTimeout(200);
  await shot(page, "05-after-load-from-table.png");

  // ---------- undo is independent of the field ----------
  const undoRes = await page.evaluate(async () => {
    const { api } = window.sketch;
    const n0 = api.getSceneElements().length;
    window.sketch.addSticky("undo me", 100, 100);
    const n1 = api.getSceneElements().length;
    return { n0, n1 };
  });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  undoRes.afterUndo = await page.evaluate(() => window.sketch.api.getSceneElements().length);
  log("undo", undoRes);

  // ---------- image drop ----------
  const pngBytes = fs.readFileSync(path.join(SHOTS, "01-field-underlay.png")).toString("base64");
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bin], "photo.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector(".excalidraw__canvas.interactive");
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: 1150, clientY: 250, bubbles: true, cancelable: true }));
    }
  }, pngBytes);
  await page.waitForTimeout(1200);
  log("imageDrop", await page.evaluate(() => ({ images: window.sketch.api.getSceneElements().filter((e) => e.type === "image").map((e) => ({ status: e.status, w: Math.round(e.width) })), files: Object.keys(window.sketch.api.getFiles()).length })));
  await page.evaluate(() => window.sketch.api.updateScene({ appState: { selectedElementIds: {} } }));
  await shot(page, "06-image-dropped.png");
  await page.close();
}

// ===================== 2. alignment during pan/zoom =====================
{
  const page = await open("?field=svg&probe=1");
  await addProbes(page);
  await page.waitForTimeout(200);
  const states = [];
  states.push(await measureShot(page, await page.screenshot()));
  await shot(page, "07-probe-static.png");
  const moves = [[200, 0, false], [0, 150, false], [0, -300, true, [400, 300]], [-500, 80, false], [0, -400, true, [900, 600]], [0, 600, true, [700, 430]]];
  for (const [dx, dy, ctrl, at] of moves) {
    await wheel(page, dx, dy, ctrl, at);
    await page.waitForTimeout(80);
    states.push(await measureShot(page, await page.screenshot()));
  }
  await shot(page, "08-probe-after-zoom.png");
  log("alignmentStatic", states);

  // mid-motion: continuous wheel pan + zoom inside the page, screenshots taken while it runs
  // in-page driver: each call pans (oscillating, steered back toward the probe crossing) and zooms
  // in then out (Excalidraw zooms around the last pointer position), so the bands stay on screen while zoom and scroll both change every frame
  await page.evaluate(() => {
    const el = document.querySelector(".excalidraw__canvas.interactive");
    window.__drive = (i) => {
      const { api, probeX, probeY } = window.sketch;
      const s = api.getAppState(), z = s.zoom.value;
      const px = (probeX + s.scrollX) * z, py = (probeY + s.scrollY) * z;
      el.dispatchEvent(new WheelEvent("wheel", { deltaX: (px - 650) * 0.3 + 30 * Math.cos(i / 5), deltaY: (py - 480) * 0.3 + 20 * Math.sin(i / 7), bubbles: true, cancelable: true, clientX: px, clientY: py }));
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 40 < 20 ? -10 : 10, ctrlKey: true, bubbles: true, cancelable: true, clientX: px + 40, clientY: py - 60 }));
    };
    let i = 0;
    window.__panning = true;
    const tick = () => { if (!window.__panning) return; window.__drive(i++); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const motion = [];
  for (let i = 0; i < 16; i++) {
    const buf = await page.screenshot();
    if (i === 8) fs.writeFileSync(path.join(SHOTS, "09-probe-mid-motion.png"), buf);
    motion.push(await measureShot(page, buf));
  }
  await page.evaluate(() => { window.__panning = false; });
  log("alignmentMidMotion", motion);

  // per-frame in-page check: read the static canvas row each frame and compare with the underlay transform
  const perFrame = await page.evaluate(async () => {
    const el = document.querySelector(".excalidraw__canvas.interactive");
    const stat = document.querySelector("canvas.excalidraw__canvas.static") || document.querySelectorAll(".excalidraw canvas")[0];
    const g = document.querySelector('[data-testid="field-underlay"] g');
    const dpr = window.devicePixelRatio;
    const ctx = stat.getContext("2d");
    const { probeX, probeY } = window.sketch;
    const errs = [];
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      // what the underlay is showing right now
      const m = /scale\(([^)]+)\) translate\(([^ ]+) ([^)]+)\)/.exec(g.getAttribute("transform"));
      const z = +m[1], sx = +m[2], sy = +m[3];
      const row = Math.round((probeY - 100 + sy) * z * dpr);
      if (row < 0 || row >= stat.height) { window.__drive(i); continue; }
      const d = ctx.getImageData(0, row, stat.width, 1).data;
      const reds = [];
      for (let x = 0; x < stat.width; x++) if (d[x * 4] > 150 && d[x * 4 + 1] < 90 && d[x * 4 + 2] < 90 && d[x * 4 + 3] > 200) reds.push(x);
      const red = reds.reduce((a, b) => a + b, 0) / reds.length / dpr;
      const expected = (probeX + sx) * z;
      if (Number.isFinite(red)) errs.push(Math.abs(red - expected));
      window.__drive(i);
    }
    if (!errs.length) return { frames: 0 };
    errs.sort((a, b) => a - b);
    return { frames: errs.length, skipped: 90 - errs.length, medianPx: +errs[errs.length >> 1].toFixed(2), p95Px: +errs[Math.floor(errs.length * 0.95)].toFixed(2), maxPx: +errs[errs.length - 1].toFixed(2) };
  });
  log("alignmentPerFrame", perFrame);
  await page.close();
}

// ===================== 3. frame cost per field mode =====================
for (const mode of ["svg", "elements", "image"]) {
  const page = await open(`?field=${mode}`);
  await drawScene(page);
  await page.waitForTimeout(300);
  if (mode !== "svg") await shot(page, `10-field-as-${mode}.png`);
  const bench = await page.evaluate(async () => {
    const el = document.querySelector(".excalidraw__canvas.interactive");
    const deltas = [];
    const handler = [];
    let last = performance.now();
    for (let i = 0; i < 180; i++) {
      const t0 = performance.now();
      el.dispatchEvent(new WheelEvent("wheel", { deltaX: 10, deltaY: 4, bubbles: true, cancelable: true, clientX: 700, clientY: 430 }));
      if (i % 3 === 0) el.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 60 < 30 ? -8 : 8, ctrlKey: true, bubbles: true, cancelable: true, clientX: 700, clientY: 430 }));
      handler.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
    return { frameMs: stats(deltas.slice(5)), syncHandlerMs: stats(handler.slice(5)), elements: window.sketch.api.getSceneElements().length };
  });
  log(`bench_${mode}`, bench);
  if (mode === "elements") {
    // locked field elements: do they leak into select-all / save?
    await page.mouse.click(700, 120);
    await page.keyboard.press("Control+a");
    log("elementsMode_selectAll", await page.evaluate(() => {
      const sel = window.sketch.api.getAppState().selectedElementIds;
      const els = window.sketch.api.getSceneElements();
      return { selected: Object.keys(sel).length, fieldSelected: els.filter((e) => sel[e.id] && e.customData?.omField).length, total: els.length };
    }));
  }
  await page.close();
}

// ===================== 4. copy/paste between two tabs =====================
{
  const a = await open("?field=svg");
  const b = await open("?field=svg");
  await drawScene(a);
  await a.bringToFront();
  await a.mouse.click(700, 120);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+c");
  await a.waitForTimeout(300);
  const clip = await a.evaluate(() => navigator.clipboard.readText());
  log("clipboardPayload", { bytes: clip.length, type: (() => { try { return JSON.parse(clip).type; } catch { return clip.slice(0, 40); } })() });
  await b.bringToFront();
  await b.mouse.move(700, 430);
  await b.mouse.click(700, 430);
  await b.keyboard.press("Control+v");
  await b.waitForTimeout(500);
  log("pasteInTabB", await b.evaluate(() => {
    const els = window.sketch.api.getSceneElements();
    return { count: els.length, omFills: els.filter((e) => e.fillStyle.startsWith("om-")).map((e) => e.fillStyle), sticky: els.filter((e) => e.customData?.omSticky).length, text: els.filter((e) => e.type === "text").length };
  }));
  await b.evaluate(() => window.sketch.api.updateScene({ appState: { selectedElementIds: {} } }));
  await shot(b, "11-pasted-in-second-tab.png");
  await a.close(); await b.close();
}

// ===================== 5. collab over BroadcastChannel =====================
{
  const a = await open("?field=svg&collab=1&tab=A");
  const b = await open("?field=svg&collab=1&tab=B");
  await drawScene(a);
  await a.waitForTimeout(300);
  const r1 = await b.evaluate(() => ({ count: window.sketch.api.getSceneElements().length, stats: window.sketch.collabStats() }));
  // concurrent edits: A moves rect-dots, B recolors ell-stag, at the same time
  await Promise.all([
    a.evaluate(() => { const { api } = window.sketch; api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === "rect-dots" ? { ...e, x: e.x + 120, version: e.version + 1, versionNonce: 7 } : e)) }); }),
    b.evaluate(() => { const { api } = window.sketch; api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === "ell-stag" ? { ...e, backgroundColor: "#c2255c", strokeColor: "#c2255c", version: e.version + 1, versionNonce: 9 } : e)) }); }),
  ]);
  // B drags an element with the mouse (real interaction stream)
  await b.bringToFront();
  await b.evaluate(() => window.sketch.api.updateScene({ appState: { selectedElementIds: {} } }));
  await a.waitForTimeout(400);
  const snap = (p) => p.evaluate(() => Object.fromEntries(window.sketch.api.getSceneElements().filter((e) => ["rect-dots", "ell-stag"].includes(e.id)).map((e) => [e.id, { x: Math.round(e.x), bg: e.backgroundColor, v: e.version }])));
  log("collab", { afterInitialDraw: r1, a: await snap(a), b: await snap(b), statsA: await a.evaluate(() => window.sketch.collabStats()), statsB: await b.evaluate(() => window.sketch.collabStats()) });
  await shot(a, "12-collab-tab-A.png");
  await shot(b, "13-collab-tab-B.png");
  await a.close(); await b.close();
}

// render the exported SVG on its own to check it
{
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 660 });
  await page.setContent(`<body style="margin:0;background:#fff"><img style="width:1400px" src="data:image/svg+xml;base64,${fs.readFileSync(path.join(EXPORTS, "sketch.svg")).toString("base64")}"></body>`);
  await page.waitForTimeout(300);
  await shot(page, "15-svg-export-rendered.png");
  await page.close();
}
fs.writeFileSync(path.join(ROOT, "scripts", "results.json"), JSON.stringify(results, null, 2));
await browser.close();
