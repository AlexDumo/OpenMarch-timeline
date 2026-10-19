import { chromium } from "playwright-core";
const exe = process.env.HOME + "/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";
const out = "/home/alex/GitHub/OpenMarch-sketch/docs/sketchpad/design/";
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1340, height: 900 }, deviceScaleFactor: 2 });
await p.goto("file://" + out + "mockups.html");
await p.evaluate(() => document.fonts.ready);
const ids = ["a","b","c","d","e"];
const names = {a:"main-editor-overlay",b:"sketchpad-window",c:"new-sketch-dialog",d:"export-dialog",e:"empty-states"};
for (const id of ids) await p.locator("#frame-" + id).screenshot({ path: `${out}mockup-${id}-${names[id]}.png` });
if (process.argv[2] === "light") {
  await p.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await p.locator("#frame-b").screenshot({ path: `${out}mockup-b-sketchpad-window-light.png` });
  await p.locator("#frame-a").screenshot({ path: `${out}mockup-a-main-editor-overlay-light.png` });
}
await b.close();
