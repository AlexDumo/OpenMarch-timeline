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
await B.locator("#sections li", { hasText: "Battery" })
    .locator("button", { hasText: "claim" })
    .click();
await A.locator("#sections li", { hasText: "Guard" })
    .locator("button", { hasText: "claim" })
    .click();
await A.waitForTimeout(300);
// B tries to drag guard marcher 40
const dragMarcher = async (P, id, dx, dy) => {
    const c = await P.locator(`[data-marcher="${id}"] circle`).boundingBox();
    await P.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await P.mouse.down();
    await P.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
    await P.mouse.up();
};
await dragMarcher(B, 40, 60, 40);
await B.waitForTimeout(200);
console.log("B toasts:", await B.locator("#toasts").innerText());
await B.screenshot({ path: `${out}/p3-B-blocked.png` });
// A (head) drags battery marcher 30 -> asked to override
await dragMarcher(A, 30, 60, -60);
await A.waitForTimeout(200);
console.log("A toasts:", await A.locator("#toasts").innerText());
await A.screenshot({ path: `${out}/p3-A-asked.png` });
await A.click("text=Override claim");
await B.waitForTimeout(400);
console.log("B toasts after override:", await B.locator("#toasts").innerText());
console.log("B log:", await B.locator("#log").innerText());
await B.screenshot({ path: `${out}/p3-B-overridden.png` });
console.log("errors", errs);
await browser.close();
