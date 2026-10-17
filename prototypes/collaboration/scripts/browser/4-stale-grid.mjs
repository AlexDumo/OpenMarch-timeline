import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:8787";
const browser = await chromium.launch();
const errs = [];
const page = async () => {
    const p = await (
        await browser.newContext({ viewport: { width: 1300, height: 820 } })
    ).newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    return p;
};
const A = await page();
await A.goto(BASE);
await A.click("text=Generated demo band");
await A.getByRole("button", { name: "Make collaborative" }).click();
await A.locator(".card")
    .getByRole("button", { name: "Make collaborative" })
    .click();
await A.getByRole("button", { name: "Done" }).click();
await A.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
const B = await page();
await B.goto(A.url());
await B.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
for (const P of [A, B]) await P.selectOption("#network select", "1500");
await B.locator("#sections li", { hasText: "Brass" })
    .locator("button", { hasText: "select" })
    .click();
await A.evaluate(() => {
    window.__S.playhead = 8;
});
await A.click("text=Insert 4 counts at playhead");
await B.waitForTimeout(300);
const bar = B.locator("#timeline [data-move]").first();
const bb = await bar.boundingBox();
await B.mouse.move(bb.x + bb.width - 2, bb.y + 5);
await B.mouse.down();
await B.mouse.move(bb.x + bb.width + 50, bb.y + 5, { steps: 4 });
await B.mouse.up();
await B.waitForTimeout(5000);
console.log("B toasts:", await B.locator("#toasts").innerText());
const snap = (P) =>
    P.evaluate(() =>
        JSON.stringify(
            window.__S.show.moves
                .map((m) => [m.id, m.start_beat, m.end_beat])
                .sort(),
        ),
    );
console.log("converged", (await snap(A)) === (await snap(B)));
console.log("errors", errs);
await browser.close();
