import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:8787";
const out = process.env.OUT ?? "/tmp/om-sync-shots";
const browser = await chromium.launch();
const errs = [];
const page = async (id, name, color) => {
    const p = await (
        await browser.newContext({ viewport: { width: 1300, height: 820 } })
    ).newPage();
    p.on("pageerror", (e) => errs.push(name + " " + e.message));
    await p.goto(BASE);
    await p.evaluate(
        (u) => sessionStorage.setItem("om-sync-user", JSON.stringify(u)),
        { id, name, color },
    );
    return p;
};
const A = await page("a", "Alex", "#17bebb");
await A.reload();
await A.click("text=Generated demo band");
await A.getByRole("button", { name: "Make collaborative" }).click();
await A.locator(".card")
    .getByRole("button", { name: "Make collaborative" })
    .click();
await A.getByRole("button", { name: "Done" }).click();
await A.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
const B = await page("b", "Sam", "#ff6fb5");
await B.goto(A.url());
await B.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Live"),
);
for (const P of [A, B]) await P.selectOption("#network select", "1500");
const dragMarcher = async (P, id, dx, dy) => {
    const c = await P.locator(`[data-marcher="${id}"] circle`).boundingBox();
    await P.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await P.mouse.down();
    await P.mouse.move(c.x + c.width / 2 + dx, c.y + c.height / 2 + dy, {
        steps: 5,
    });
    await P.mouse.up();
};
await dragMarcher(A, 5, 0, -40);
await B.waitForTimeout(300);
await dragMarcher(B, 5, 0, 40);
await A.waitForTimeout(4500);
console.log(
    "A log",
    await A.locator("#log").innerText(),
    "pending",
    await A.evaluate(() => window.__S.conn.pending.length),
    "lat",
    await A.evaluate(() => window.__S.conn.latencyMs),
    "state",
    await A.evaluate(() => window.__S.conn.state),
);
console.log(
    "B log",
    await B.locator("#log").innerText(),
    "pending",
    await B.evaluate(() => window.__S.conn.pending.length),
);
console.log("A toasts:", await A.locator("#toasts").innerText());
console.log("B toasts:", await B.locator("#toasts").innerText());
await A.screenshot({ path: `${out}/p4-A-lost.png` });
await B.screenshot({ path: `${out}/p4-B-won.png` });
const ya = await A.evaluate(
    () =>
        window.__S.show.moves.find(
            (m) => m.marcher_id === 5 && m.start_beat === 0,
        ).y,
);
const yb = await B.evaluate(
    () =>
        window.__S.show.moves.find(
            (m) => m.marcher_id === 5 && m.start_beat === 0,
        ).y,
);
console.log("converged y", ya, yb);
await A.click("text=Put mine back");
await A.waitForTimeout(3500);
const ya2 = await A.evaluate(
    () =>
        window.__S.show.moves.find(
            (m) => m.marcher_id === 5 && m.start_beat === 0,
        ).y,
);
const yb2 = await B.evaluate(
    () =>
        window.__S.show.moves.find(
            (m) => m.marcher_id === 5 && m.start_beat === 0,
        ).y,
);
console.log("after put back", ya2, yb2);
// delete vs edit
for (const P of [A, B]) await P.selectOption("#network select", "1500");
await A.locator("#sections li", { hasText: "Brass" })
    .locator("button", { hasText: "select" })
    .click();
await B.locator("#sections li", { hasText: "Brass" })
    .locator("button", { hasText: "select" })
    .click();
const bar = (P) => P.locator("#timeline [data-move]").first();
const id = await bar(A).getAttribute("data-move");
await bar(A).click();
await A.keyboard.press("Delete");
await B.waitForTimeout(200);
const bb = await bar(B).boundingBox();
await B.mouse.move(bb.x + bb.width - 2, bb.y + 5);
await B.mouse.down();
await B.mouse.move(bb.x + bb.width + 50, bb.y + 5, { steps: 4 });
await B.mouse.up();
await B.waitForTimeout(4500);
console.log(
    "B toasts (delete vs edit):",
    await B.locator("#toasts").innerText(),
);
await B.screenshot({ path: `${out}/p4-B-deleted.png` });
console.log("errors", errs);
await browser.close();
