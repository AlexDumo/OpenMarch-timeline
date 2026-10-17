import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:8787";
const out = process.env.OUT ?? "/tmp/om-sync-shots";
const browser = await chromium.launch();
const ctxA = await browser.newContext({
    viewport: { width: 1300, height: 820 },
});
const A = await ctxA.newPage();
const errs = [];
A.on("pageerror", (e) => errs.push("A " + e.message));
A.on(
    "console",
    (m) => m.type() === "error" && errs.push("A console " + m.text()),
);
await A.goto(BASE);
await A.click("text=Generated demo band");
await A.waitForSelector("#field [data-marcher]");
await A.screenshot({ path: `${out}/1-solo.png` });
await A.getByRole("button", { name: "Make collaborative" }).click();
await A.locator(".card")
    .getByRole("button", { name: "Make collaborative" })
    .click();
await A.getByRole("button", { name: "Done" }).click();
await A.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
const url = A.url();
const ctxB = await browser.newContext({
    viewport: { width: 1300, height: 820 },
});
const B = await ctxB.newPage();
B.on("pageerror", (e) => errs.push("B " + e.message));
B.on(
    "console",
    (m) => m.type() === "error" && errs.push("B console " + m.text()),
);
await B.goto(url);
await B.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
// A drags marcher W1 on page 1
const box = await A.locator('[data-marcher="1"] circle').boundingBox();
await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await A.mouse.down();
await A.mouse.move(box.x + 80, box.y + 60, { steps: 6 });
await A.mouse.up();
await B.waitForTimeout(500);
const posA = await A.locator('[data-marcher="1"] circle').getAttribute("cx");
// B goes to page 1 end to compare
await B.click("text=page ▶");
await A.waitForTimeout(200);
const posB = await B.locator('[data-marcher="1"] circle').getAttribute("cx");
console.log("A cx", posA, "B cx", posB);
await A.screenshot({ path: `${out}/2-A.png` });
await B.screenshot({ path: `${out}/2-B.png` });
// B selects battery and resizes a move on the timeline
await B.locator("#sections li", { hasText: "Battery" })
    .locator("button", { hasText: "select" })
    .click();
await B.waitForSelector("#timeline [data-move]");
const bar = B.locator("#timeline [data-move]").nth(1);
const bb = await bar.boundingBox();
const moveId = await bar.getAttribute("data-move");
await B.mouse.move(bb.x + bb.width - 2, bb.y + 5);
await B.mouse.down();
await B.mouse.move(bb.x + bb.width + 60, bb.y + 5, { steps: 5 });
await B.mouse.up();
await A.waitForTimeout(400);
const endA = await A.evaluate((id) => {
    const r = window.__S?.show.moves.find((m) => m.id === Number(id));
    return r && [r.start_beat, r.end_beat];
}, moveId);
console.log("A sees resized move", moveId, endA);
// A (head) inserts 4 counts at count 8
await A.click("text=Start");
for (let i = 0; i < 8; i++)
    await A.keyboard.press("ArrowRight").catch(() => {});
await A.evaluate(() => {
    window.__S.playhead = 8;
});
await A.click("text=Insert 4 counts at playhead");
await B.waitForTimeout(400);
console.log(
    "B total beats",
    await B.evaluate(() => window.__S.total),
    "B flags",
    await B.evaluate(() => window.__S.flags.join(",")),
);
await B.screenshot({ path: `${out}/3-B-battery.png` });
console.log(await B.locator("#log").innerText());
// solo import of a real file
const C = await (
    await browser.newContext({ viewport: { width: 1300, height: 820 } })
).newPage();
C.on("pageerror", (e) => errs.push("C " + e.message));
await C.goto(BASE);
await C.click("text=part1-demo.dots");
await C.waitForSelector("#field [data-marcher]");
console.log(
    "C import",
    await C.evaluate(() => [
        window.__S.show.marchers.length,
        window.__S.show.moves.length,
        window.__S.flags.length,
        window.__S.total,
    ]),
);
await C.screenshot({ path: `${out}/4-import.png` });
console.log("errors", errs);
await browser.close();
