// The Start here chapter (guides/start/*).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
/** A show from before timelines (the demo, as 0.1.7 saved it). */
const PAGE_ERA_SHOW = path.join(DESKTOP, "web/public/demos/part1-demo.dots");

/** Hides toasts and closes the low-quality field notice, so nothing sits over the picture. */
async function tidy(page) {
    await page
        .getByRole("button", { name: "Got it" })
        .click({ timeout: 1500 })
        .catch(() => {});
    await page
        .locator("[data-sonner-toast]")
        .evaluateAll((els) =>
            els.forEach((e) => (e.style.visibility = "hidden")),
        )
        .catch(() => {});
}

/** The timeline a few pages into the show, nothing selected on the field. */
async function timelineAtPage3({ page, around, wait }) {
    await wait(3000);
    await tidy(page);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("KeyE");
    await page.keyboard.press("KeyE");
    await wait(1500);
    await tidy(page);
    // Home to Page 4 only, so the page boxes, the move's bar and the flags can be read
    const pane = await around(page.getByTestId("timeline-pane"), 0);
    const p4 = await page
        .locator('[data-timeline-range-page="12"]')
        .first()
        .boundingBox();
    return {
        box: { ...pane, width: Math.round(p4.x + p4.width + 24 - pane.x) },
    };
}

/** Opens the Settings window on `section`, sized for a picture, and frames all of it. */
export async function settingsWindow({ app, page, wait }, sectionLabel) {
    const opened = app.waitForEvent("window");
    await page.evaluate(() => window.electron.openSettingsWindow());
    const settings = await opened;
    await settings.waitForLoadState("domcontentloaded");
    const size = { width: 900, height: 640 };
    await app.evaluate(
        ({ BrowserWindow }, { s, url }) => {
            const win = BrowserWindow.getAllWindows().find(
                (w) => w.webContents.getURL() === url,
            );
            win.setContentBounds({ x: 0, y: 0, ...s });
            win.webContents.setBackgroundThrottling(false);
        },
        { s: size, url: settings.url() },
    );
    await wait(800);
    if (sectionLabel)
        await settings
            .getByRole("button", { name: sectionLabel, exact: true })
            .or(settings.getByRole("tab", { name: sectionLabel, exact: true }))
            .first()
            .click();
    await wait(800);
    // No focus ring on the section just chosen
    await settings.evaluate(() => document.activeElement?.blur());
    await wait(300);
    return {
        target: settings,
        box: { x: 0, y: 0, ...size },
    };
}

/**
 * Opens File › New File and goes through the new-show steps up to Performers, with eight
 * trumpets entered and not yet created. Returns the dialog.
 */
async function newShowToPerformers({ page, wait }) {
    await wait(3000);
    await tidy(page);
    await page.getByRole("tab", { name: "File" }).click();
    await wait(500);
    await page.getByRole("button", { name: "New File" }).first().click();
    await wait(1200);
    const dialog = page.getByRole("dialog").last();
    const next = () =>
        dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByText("Start blank show").click();
    await wait(400);
    await next();
    await wait(800);
    await dialog.getByPlaceholder("Show name").fill("Fall Show");
    await wait(600);
    await next(); // Project details
    await wait(800);
    await next(); // Activity
    await wait(800);
    await next(); // Field setup
    await wait(1000);
    await dialog.getByLabel(/quantity/i).fill("8");
    await dialog.getByRole("combobox").first().click();
    await wait(400);
    await page.getByRole("option", { name: "Trumpet", exact: true }).click();
    await wait(800);
    await page.mouse.move(5, 500);
    return dialog;
}

/** Makes a new show of eight trumpets through File › New File, and waits for it to open. */
async function createNewShow(ctx) {
    const { page, wait } = ctx;
    const dialog = await newShowToPerformers(ctx);
    await dialog.getByRole("button", { name: /^Create 8 Trumpet/ }).click();
    await wait(800);
    for (let i = 0; i < 5; i++) {
        const create = dialog.getByRole("button", { name: "Create show" });
        if (await create.isVisible().catch(() => false)) break;
        // Next where it can go on (it keeps the marchers just made), Skip where it can't
        const next = dialog.getByRole("button", { name: "Next", exact: true });
        if (await next.isEnabled().catch(() => false)) await next.click();
        else
            await dialog
                .getByRole("button", { name: /^Skip( for now)?$/ })
                .first()
                .click();
        await wait(1500);
    }
    await dialog.getByRole("button", { name: "Create show" }).click();
    await page.waitForFunction(
        () => (window.fieldTest?.marchers().length ?? 0) === 8,
        null,
        { timeout: 60000 },
    );
    await wait(3000);
    await tidy(page);
    await page.mouse.move(800, 500);
    await wait(500);
}

const shots = [
    {
        id: "start-new-show-performers",
        kind: "still",
        // The new-show window's Performers step, eight trumpets entered
        async setup(ctx) {
            const dialog = await newShowToPerformers(ctx);
            return { box: await ctx.around(dialog, 0) };
        },
    },
    {
        id: "start-new-show",
        kind: "still",
        mode: "basic",
        // The editor straight after Create show: the marchers in rows, no pages yet
        async setup(ctx) {
            await createNewShow(ctx);
            return {};
        },
    },
    {
        id: "start-select-first-page",
        kind: "clip",
        mode: "basic",
        // In the new show, selecting Page 1's box: the page is selected and the playhead
        // goes to its end
        async setup(ctx) {
            const { page } = ctx;
            await createNewShow(ctx);
            const pane = await page.getByTestId("timeline-pane").boundingBox();
            return {
                box: {
                    x: Math.floor(pane.x),
                    y: Math.floor(pane.y),
                    width: 760,
                    height: Math.ceil(pane.height),
                },
            };
        },
        async perform({ page, film, overlay, box }) {
            await overlay.enable();
            // Page 1's box: the first wide page box (home's is narrow)
            const boxes = await page
                .locator("[data-timeline-range-page]")
                .evaluateAll((els) =>
                    els.map((e) => {
                        const r = e.getBoundingClientRect();
                        return { x: r.x, y: r.y, width: r.width };
                    }),
                );
            const p1 = boxes
                .filter((r) => r.width > 60)
                .sort((m, n) => m.x - n.x)[0];
            const target = { x: p1.x + p1.width / 2, y: p1.y + 13 };
            const rest = { x: box.x + 120, y: box.y + box.height - 20 };
            await page.mouse.move(rest.x, rest.y);
            await film.hold(0.4);
            await film.moveTo(page, rest, target, 0.8);
            await page.mouse.down();
            await film.hold(0.1);
            await page.mouse.up();
            await film.hold(0.6);
            await film.moveTo(page, target, rest, 0.5);
            await film.hold(1.6);
        },
    },
    {
        id: "start-timeline-basic",
        kind: "still",
        mode: "basic",
        setup: timelineAtPage3,
    },
    {
        id: "start-timeline-expert",
        kind: "still",
        mode: "expert",
        // The same page, with a few marchers split off into a move of their own, so the
        // timeline shows a move's bar under the pages
        async setup(ctx) {
            const { page, wait } = ctx;
            const framed = await timelineAtPage3(ctx);
            const picks = await page.evaluate(() =>
                window.fieldTest
                    .marchers()
                    .filter((m) => m.onScreen)
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .slice(0, 6)
                    .map((m) => m.screen),
            );
            await page.mouse.click(picks[0].x, picks[0].y);
            await page.keyboard.down("Shift");
            for (const p of picks.slice(1)) await page.mouse.click(p.x, p.y);
            await page.keyboard.up("Shift");
            await wait(500);
            await page.keyboard.press("Control+KeyK");
            await wait(500);
            await page.keyboard.type("Split selected marchers");
            await wait(500);
            await page.keyboard.press("Enter");
            await wait(2000);
            await tidy(page);
            await page.mouse.move(5, 500);
            return framed;
        },
    },
    {
        id: "start-basic-expert-mark",
        kind: "still",
        mode: "expert",
        // A move across Page 5's flag made in Expert (S1–S3, Pages 5 and 5A selected together),
        // then the show opened in Basic: the pages get an E, pointed at to show its tooltip
        async setup({ page, wait }) {
            await wait(3000);
            await tidy(page);
            const box = (id) =>
                page.locator(`[data-timeline-range-page="${id}"]`).first();
            await box(13).click({ position: { x: 8, y: 13 } });
            await wait(1200);
            await page.keyboard.down("Shift");
            await box(14).click({ position: { x: 8, y: 13 } });
            await page.keyboard.up("Shift");
            await wait(1200);
            const pts = await page.evaluate(() =>
                window.fieldTest
                    .marchers()
                    .filter((m) => ["S1", "S2", "S3"].includes(m.label))
                    .map((m) => m.screen),
            );
            await page.mouse.click(pts[0].x, pts[0].y);
            await page.keyboard.down("Shift");
            for (const p of pts.slice(1)) await page.mouse.click(p.x, p.y);
            await page.keyboard.up("Shift");
            await wait(500);
            const from = pts[0];
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            for (let i = 1; i <= 12; i++) {
                await page.mouse.move(from.x + 5 * i, from.y - 4 * i);
                await wait(25);
            }
            await page.mouse.up();
            await wait(1500);
            await page.keyboard.press("Escape");
            // Switch to Basic as a reader would, from the command palette
            await page.keyboard.press("Control+KeyK");
            await wait(500);
            await page.keyboard.type("Switch to Basic");
            await wait(500);
            await page.keyboard.press("Enter");
            await wait(2500);
            await tidy(page);
            const mark = page.getByTestId("basic-expert-mark").first();
            await mark.waitFor({ timeout: 10000 });
            await mark.hover();
            await wait(1200);
            const a = await box(13).boundingBox();
            const b = await box(14).boundingBox();
            const pane = await page.getByTestId("timeline-pane").boundingBox();
            const tip = await page
                .locator("[data-radix-popper-content-wrapper]")
                .first()
                .boundingBox();
            const x = Math.max(0, Math.floor(Math.min(a.x - 60, tip.x - 12)));
            const y = Math.floor(Math.min(a.y - 20, tip.y - 12));
            const right = Math.min(
                1600,
                Math.ceil(Math.max(b.x + b.width + 40, tip.x + tip.width + 12)),
            );
            return {
                box: {
                    x,
                    y,
                    width: right - x,
                    height: Math.ceil(pane.y + pane.height) - y,
                },
            };
        },
    },
    {
        id: "start-convert-dialog",
        kind: "still",
        // The app confirms the demo's own conversion when it starts, so this opens a second
        // copy of the page-era show, which asks again over the open show.
        async setup({ page, around, wait }) {
            await wait(2000);
            await tidy(page);
            const folder = "/tmp/Shows";
            fs.mkdirSync(folder, { recursive: true });
            const file = path.join(folder, "Fall Show.dots");
            fs.copyFileSync(PAGE_ERA_SHOW, file);
            for (const old of fs.readdirSync(folder))
                if (old.includes(".pre-conversion"))
                    fs.rmSync(path.join(folder, old));
            await page.evaluate((f) => window.electron.openRecentFile(f), file);
            const dialog = page.getByTestId("convert-show-dialog");
            await dialog.waitFor({ timeout: 20000 });
            await wait(800);
            return { box: await around(dialog, 0) };
        },
    },
    {
        id: "start-report-drawer",
        kind: "still",
        // The report drawer over the editor, before signing in (the recorder isn't signed in)
        async setup({ page, around, wait }) {
            await wait(2000);
            await tidy(page);
            await page
                .getByRole("button", { name: "Submit bug or feedback" })
                .click();
            const drawer = page.getByRole("dialog", {
                name: "Report a bug or send feedback",
            });
            await drawer.waitFor({ timeout: 10000 });
            await wait(800);
            await page.mouse.move(5, 500);
            // Only the top: the rest of the drawer is empty until you sign in
            const box = await around(drawer, 8);
            return { box: { ...box, height: 280 } };
        },
    },
];

export default shots;
