// cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp
// Spike #995 runner (inside the openmarch-e2e container, cwd apps/desktop).
// node run.mjs electron-file | electron-http | web
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2];
const desktop = process.cwd();
const req = createRequire(path.join(desktop, "package.json"));
const OUT = process.env.OUT || "/out";
const MODELS = "/scenario/models";
const GPU = process.env.OM_GPU === "1";
const GL = ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=vulkan", "--enable-features=Vulkan"];

function serve(root) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((rq, rs) => {
    let p = decodeURIComponent(new URL(rq.url, "http://x").pathname);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { rs.writeHead(403); return rs.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) f = path.join(root, "index.html");
    rs.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(rs);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

let page, close;
if (mode.startsWith("electron")) {
  const { _electron } = req("playwright");
  const env = { ...process.env, PLAYWRIGHT_SESSION: "true" };
  if (mode === "electron-http") {
    const { url } = await serve(path.join(desktop, "dist"));
    env.VITE_DEV_SERVER_URL = url;
  } else delete env.VITE_DEV_SERVER_URL;
  const packaged = mode === "electron-packaged";
  const exe = packaged ? fs.readdirSync(path.join(desktop, "release")).map((v) => path.join(desktop, "release", v, "linux-unpacked")).find((d) => fs.existsSync(d)) : null;
  const bin = packaged ? path.join(exe, fs.readdirSync(exe).find((f) => /^@?openmarch(desktop)?$/i.test(f))) : req("electron");
  const app = await _electron.launch({
    executablePath: bin,
    args: [...(packaged ? [] : [path.join(desktop, "dist-electron/main/index.js")]), "--no-sandbox", "--no-audio", ...(GPU ? GL : [])],
    env,
  });
  page = await app.firstWindow();
  close = () => app.close();
} else {
  const { chromium } = req("playwright");
  const { url } = await serve(path.join(desktop, "dist-web"));
  const browser = await chromium.launch({ headless: false, args: GPU ? GL : [] });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(url);
  close = () => browser.close();
}
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.waitForFunction(() => !!window.__spikeModelImport, null, { timeout: 120000 });

const result = { mode, url: page.url() };
result.renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "no webgl";
});
result.metaCsp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null);
result.probe = await page.evaluate(() => window.__spikeProbe());
console.log(JSON.stringify({ mode, renderer: result.renderer, probe: result.probe }, null, 1));

result.runs = [];
const jobs = fs.readdirSync(MODELS).filter((f) => f.endsWith(".glb")).sort().map((f) => ({ f, unitScale: 1, zUp: false }));
jobs.push({ f: "boombox_2k.glb", unitScale: 0.01, zUp: true, tag: "cm+zup" });
for (const job of jobs) {
  const b64 = fs.readFileSync(path.join(MODELS, job.f)).toString("base64");
  for (let rep = 0; rep < (job.tag ? 1 : 2); rep++) {
    const r = await page.evaluate(([b64, o]) => window.__spikeModelImport(b64, o), [b64, { triangleCap: 20000, textureCap: 1024, unitScale: job.unitScale, zUp: job.zUp }]);
    const name = `${mode}-${job.f.replace(".glb", "")}${job.tag ? "-" + job.tag : ""}-r${rep}`;
    if (r.outB64) fs.writeFileSync(path.join(OUT, `${name}.glb`), Buffer.from(r.outB64, "base64"));
    delete r.outB64;
    r.name = name;
    result.runs.push(r);
    console.log(name, r.ok ? "ok" : "FAIL " + r.error, JSON.stringify(r.steps), r.wasm.simplifierReady);
  }
}
result.logs = logs.filter((l) => /CSP|Content Security|wasm|WebAssembly|spike|error/i.test(l)).slice(0, 40);
fs.writeFileSync(path.join(OUT, `${mode}.json`), JSON.stringify(result, null, 1));
await close();
process.exit(0);
