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

const spot = (P, id) =>
    P.evaluate((id) => {
        const m = window.__S.show.moves.find(
            (m) => m.marcher_id === id && m.start_beat === 0,
        );
        return [m.x, m.y];
    }, id);
const nudge = async (P, ids, key) => {
    await P.evaluate((ids) => {
        window.__S.selection = new Set(ids);
    }, ids);
    await P.keyboard.press(key);
    await P.waitForTimeout(250);
};
const undo = async (P) => {
    await P.keyboard.press("Control+z");
    await P.waitForTimeout(300);
};
const toasts = async (P) =>
    (await P.locator("#toasts").innerText()).split("\n").slice(-1)[0];

// 1. undo only my own edit
const w1 = await spot(A, 1),
    w2 = await spot(A, 2);
await nudge(A, [1], "ArrowRight");
await nudge(B, [2], "ArrowRight");
await undo(A);
console.log(
    "own edit undone, other's kept:",
    JSON.stringify(await spot(B, 1)) === JSON.stringify(w1),
    JSON.stringify(await spot(B, 2)) !== JSON.stringify(w2),
);

// 2. partial: I moved W4 and W5, Sam then moved W5
const w4 = await spot(A, 4);
await nudge(A, [4, 5], "ArrowDown");
await nudge(B, [5], "ArrowUp");
await nudge(B, [5], "ArrowUp");
const w5sam = await spot(B, 5);
await undo(A);
console.log(
    "partial undo:",
    JSON.stringify(await spot(B, 4)) === JSON.stringify(w4),
    JSON.stringify(await spot(B, 5)) === JSON.stringify(w5sam),
    "|",
    await toasts(A),
);
await A.screenshot({ path: `${out}/p7-A-partial-undo.png` });

// 3. redo
await A.keyboard.press("Control+Shift+z");
await A.waitForTimeout(300);
console.log("redo:", JSON.stringify(await spot(B, 4)) !== JSON.stringify(w4));

// 4. undo a delete restores the same move id for everyone
await A.locator("#sections li", { hasText: "Guard" })
    .locator("button", { hasText: "select" })
    .click();
const bar = A.locator("#timeline [data-move]").first();
const moveId = Number(await bar.getAttribute("data-move"));
await bar.click();
await A.keyboard.press("Delete");
await A.waitForTimeout(300);
const gone = await B.evaluate(
    (id) => !window.__S.show.moves.some((m) => m.id === id),
    moveId,
);
await undo(A);
const back = await B.evaluate(
    (id) => window.__S.show.moves.some((m) => m.id === id),
    moveId,
);
console.log("delete undone with the same id:", gone, back);

// 5. insert time can't be undone once someone has edited moves on the new grid
await A.evaluate(() => {
    window.__S.playhead = 8;
});
await A.getByRole("button", { name: "Insert 4 counts at playhead" }).click();
await B.waitForTimeout(300);
await B.locator("#sections li", { hasText: "Brass" })
    .locator("button", { hasText: "select" })
    .click();
const bb = await B.locator("#timeline [data-move]").first().boundingBox();
await B.mouse.move(bb.x + bb.width - 2, bb.y + 5);
await B.mouse.down();
await B.mouse.move(bb.x + bb.width + 40, bb.y + 5, { steps: 4 });
await B.mouse.up();
await A.waitForTimeout(400);
const totalBefore = await A.evaluate(() => window.__S.total);
await undo(A);
console.log(
    "structural undo refused:",
    (await A.evaluate(() => window.__S.total)) === totalBefore,
    "|",
    await toasts(A),
);

// 6. solo undo works the same way, with no server
const C = await page("c", "Casey", "#ffc914");
await C.reload();
await C.click("text=Generated demo band");
const c1 = await spot(C, 1);
await nudge(C, [1], "ArrowLeft");
await undo(C);
console.log(
    "solo undo:",
    JSON.stringify(await spot(C, 1)) === JSON.stringify(c1),
);

const snap = (P) =>
    P.evaluate(() =>
        JSON.stringify(
            window.__S.show.moves
                .map((m) => [m.id, m.x, m.y, m.start_beat, m.end_beat])
                .sort(),
        ),
    );
console.log("converged", (await snap(A)) === (await snap(B)));
console.log("errors", errs);
await browser.close();
