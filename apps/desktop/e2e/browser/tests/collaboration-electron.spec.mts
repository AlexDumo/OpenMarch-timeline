/* eslint-disable no-console */
// cspell:words collab
/**
 * The collaboration spike's Electron check (docs/collaboration/spike/RESULTS.md, WP-E): window A
 * is the built Electron app, window B the browser harness (`openPeer`), both against a local
 * sync server. Runs only in the `electron-scenarios` project (needs `pnpm run build`,
 * `pnpm run build:browser` and a display):
 *
 *   pnpm exec playwright test --project=electron-scenarios e2e/browser/tests/collaboration-electron.spec.mts
 *
 * Screenshots of both windows go to `SPIKE_SHOTS` (default: the test's output folder, `shots/`).
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium as playwrightChromium, type Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    createMarchers,
    dragMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    selectPage,
} from "../app.mjs";
import { seedShowSql } from "../seed.mjs";
import {
    allowSyncServer,
    openPeer,
    startSyncServer,
    syncedTables,
    syncState,
    type SyncServer,
} from "../collab.mjs";

test.use({
    seedSql: seedShowSql({
        beats: 16,
        measureStarts: [1, 5, 9, 13],
        pageStarts: [1],
    }),
    allowedPageErrors: [/Audio worklet error/],
});

let server: SyncServer | undefined;
let stateDir: string | undefined;

test.afterAll(async () => {
    await server?.stop();
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
});

const positions = async (page: Page) =>
    (await drawnMarchers(page))
        .map(({ id, x, y }) => ({
            id,
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
        }))
        .sort((a, b) => a.id - b.id);

const pendingZero = (page: Page) =>
    expect
        .poll(() => page.evaluate(() => window.__sync!.state().pending))
        .toBe(0);

async function draggable(page: Page, index = 0) {
    const box = (await page.getByTestId("fieldCanvas").first().boundingBox())!;
    const inside = (await drawnMarchers(page)).filter(
        (m) =>
            m.onScreen &&
            m.screen.x > box.x + 2 &&
            m.screen.x < box.x + box.width - 200 &&
            m.screen.y > box.y + 2 &&
            m.screen.y < box.y + box.height - 200,
    );
    if (inside.length === 0) throw new Error("No marcher to drag");
    return inside[index % inside.length];
}

/** As in collaboration.spec.mts: commit in `from` to data landing / drawn in `to`, in ms. */
async function measuredDrag(
    from: Show,
    to: Show,
    by: { x: number; y: number },
    index = 0,
) {
    const marcher = await draggable(from.page, index);
    const watch = to.page.evaluate(
        ({ id, x, y }) =>
            new Promise<number>((resolve) => {
                const tick = () => {
                    const m = window
                        .fieldTest!.marchers()
                        .find((d) => d.id === id);
                    if (
                        m &&
                        (Math.abs(m.x - x) > 0.01 || Math.abs(m.y - y) > 0.01)
                    )
                        resolve(Date.now());
                    else requestAnimationFrame(tick);
                };
                tick();
            }),
        { id: marcher.id, x: marcher.x, y: marcher.y },
    );
    const before = await from.page.evaluate(
        () => window.__sync!.events().length,
    );
    await dragMarcher(from.page, marcher.drillNumber, by);
    const drawnAt = await watch;
    await pendingZero(from.page);
    const fromEvents = (
        await from.page.evaluate(() => window.__sync!.events())
    ).slice(before);
    const local = fromEvents.filter((e) => e.kind === "local").pop()!;
    const ack = fromEvents.find(
        (e) => e.kind === "ack" && e.opId === local.opId,
    )!;
    const remoteEvent = () =>
        to.page.evaluate(
            (opId) =>
                window
                    .__sync!.events()
                    .find((e) => e.kind === "remote" && e.opId === opId),
            local.opId,
        );
    await expect.poll(remoteEvent).toBeTruthy();
    const remote = (await remoteEvent())!;
    // Electron and the test process share a clock (same machine), so the differences hold
    return {
        ack: ack.at - local.at,
        received:
            remote.at -
            (remote.writeMs ?? 0) -
            (remote.waitedMs ?? 0) -
            local.at,
        writeMs: remote.writeMs ?? -1,
        applied: remote.at - local.at,
        drawn: drawnAt - local.at,
    };
}

// eslint-disable-next-line max-lines-per-function
test("Electron window and browser window edit one show", async ({
    show,
    target,
}, testInfo) => {
    test.skip(target !== "electron", "Electron check only");
    test.setTimeout(240_000);
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sync-electron-"));
    server = await startSyncServer(stateDir);
    const shots = process.env.SPIKE_SHOTS ?? testInfo.outputPath("shots");
    if (shots) fs.mkdirSync(shots, { recursive: true });

    const a = show;
    // The sync dev UI and server URL come from local storage; the fixture has no init script
    // for Electron, so set them and reload
    await a.page.evaluate((url) => {
        localStorage.setItem("openmarch:syncDev", "1");
        localStorage.setItem("openmarch:syncServer", url);
    }, server.url);
    await a.page.reload();
    await expect(a.page.locator("canvas").first()).toBeVisible({
        timeout: 20_000,
    });
    await expect
        .poll(() => a.page.evaluate(() => typeof window.__sync))
        .toBe("object");
    // No `local-network-access` grant for Electron, as in the shipped app: only the fixture's
    // "no network" route is lifted for the server
    await a.page.route(`${server.url}/**`, (route) => route.continue());
    const where = await a.page.evaluate(() => [
        window.location.origin,
        navigator.userAgent,
    ]);
    console.log("Electron renderer origin and user agent:", where);

    const { sessionId } = await a.page.evaluate(() =>
        window.__sync!.makeCollaborative(),
    );
    expect(await syncState(a.page)).toBe("live");

    const browser = await playwrightChromium.launch();
    const b = await openPeer(browser, testInfo, "window-b");
    try {
        await allowSyncServer(b.page, server.url);
        await b.page.evaluate(
            (id) => window.__sync!.joinSession(id),
            sessionId,
        );
        expect(await syncState(b.page)).toBe("live");
        expect(await syncedTables(b.page)).toEqual(await syncedTables(a.page));

        await createMarchers(a.page, { quantity: 4, section: "Baritone" });
        await pendingZero(a.page);
        await expect
            .poll(() => positions(b.page))
            .toEqual(await positions(a.page));
        expect((await positions(b.page)).length).toBe(4);

        await selectPage(a, "Page 1");
        await selectPage(b, "Page 1");
        const aToB = [];
        const bToA = [];
        for (let i = 0; i < 4; i++)
            aToB.push(
                await measuredDrag(a, b, { x: 60, y: i % 2 ? -40 : 40 }, i % 3),
            );
        for (let i = 0; i < 3; i++)
            bToA.push(
                await measuredDrag(
                    b,
                    a,
                    { x: -50, y: i % 2 ? 30 : -30 },
                    i % 3,
                ),
            );
        await expectCanvasMatchesShow(a);
        await expectCanvasMatchesShow(b);
        expect(await syncedTables(b.page)).toEqual(await syncedTables(a.page));

        if (shots) {
            await a.page.screenshot({
                path: path.join(shots, "electron-window-a.png"),
            });
            await b.page.screenshot({
                path: path.join(shots, "browser-window-b.png"),
            });
        }
        console.log(
            "Electron latency (ms):",
            JSON.stringify({
                electronToBrowser: aToB,
                browserToElectron: bToA,
            }),
        );
    } finally {
        await b.close();
        await browser.close();
    }
});
