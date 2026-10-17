/* eslint-disable no-console */
/**
 * The collaboration spike's two-window scenario (docs/collaboration/spike/PLAN.md, WP-C).
 *
 * Window A is the fixture's show; window B is a second app in this same process, on its own
 * blank show (`openPeer` in `../collab.mts`: the host bundle imported a second time is a second,
 * independent host with its own database connection). Both talk to a real sync server,
 * `wrangler dev` from `sync-server/`, started on a free port before the tests and stopped by its
 * process group id after them.
 *
 * A makes the show collaborative, B joins; A adds marchers and makes a timeline move by dragging
 * on page 1, B sees the same positions; B's edit shows in A; B goes offline and its edits are
 * refused under a read-only banner; A edits; B reconnects, catches up, and both end with equal
 * synced tables. Remote-edit latency (A's commit to B's field drawing the change) is printed.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    createMarchers,
    dragMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    selectPage,
    waitForIdle,
} from "../app.mjs";
import { seedShowSql } from "../seed.mjs";
import {
    allowSyncServer,
    openPeer,
    startSyncServer,
    SYNC_DEV_INIT,
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
    initScript: SYNC_DEV_INIT,
    // The harness can't load the audio worklet (boot.spec fails on it too); not about sync
    allowedPageErrors: [/Audio worklet error/],
});

let server: SyncServer;
let stateDir: string;

test.beforeAll(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sync-e2e-"));
    server = await startSyncServer(stateDir);
});

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

/** A marcher drawn on screen and away from the field's edges, so a drag stays on the field. */
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

/**
 * Drags a marcher in `from` and measures, in milliseconds, from the drag's commit in `from`
 * (its op's local event) to the data landing in `to` and to `to`'s field drawing it.
 */
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
                    if (m && (Math.abs(m.x - x) > 0.01 || Math.abs(m.y - y) > 0.01))
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
                window.__sync!
                    .events()
                    .find((e) => e.kind === "remote" && e.opId === opId),
            local.opId,
        );
    await expect.poll(remoteEvent).toBeTruthy();
    const remote = (await remoteEvent())!;
    return {
        marcherId: marcher.id,
        ack: ack.at - local.at,
        received: remote.at - (remote.writeMs ?? 0) - (remote.waitedMs ?? 0) - local.at,
        writeMs: remote.writeMs ?? -1,
        applied: remote.at - local.at,
        drawn: drawnAt - local.at,
    };
}

test("two windows edit one show through the sync server", async ({
    show,
    chromium,
}, testInfo) => {
    test.setTimeout(240_000);
    const a = show;
    await allowSyncServer(a.page, server.url);

    // A makes the show collaborative
    const { sessionId } = await a.page.evaluate(() =>
        window.__sync!.makeCollaborative(),
    );
    expect(await syncState(a.page)).toBe("live");
    await expect(a.page.getByTestId("sync-status")).toHaveAttribute(
        "data-sync-state",
        "live",
    );
    expect(
        await a.page.evaluate(() => window.__sync!.state().role),
    ).toBe("owner");

    // B joins: its synced tables become A's
    const b = await openPeer(chromium!, testInfo, "window-b");
    try {
        await allowSyncServer(b.page, server.url);
        await b.page.evaluate(
            (id) => window.__sync!.joinSession(id),
            sessionId,
        );
        expect(await syncState(b.page)).toBe("live");
        expect(await syncedTables(b.page)).toEqual(await syncedTables(a.page));
        await expect(b.page.getByRole("button", { name: "Page 1", exact: true })).toBeVisible();

        // A adds marchers: B draws them where A does
        await createMarchers(a.page, { quantity: 4, section: "Baritone" });
        await pendingZero(a.page);
        await expect.poll(() => positions(b.page)).toEqual(await positions(a.page));
        expect((await positions(b.page)).length).toBe(4);
        // Ids come from A's block (member 1)
        expect(Math.min(...(await positions(a.page)).map((m) => m.id))).toBeGreaterThanOrEqual(2 ** 40);

        // A makes a timeline move on page 1; B, on page 1, draws the same positions
        await selectPage(a, "Page 1");
        await selectPage(b, "Page 1");
        const latencies: Awaited<ReturnType<typeof measuredDrag>>[] = [];
        latencies.push(await measuredDrag(a, b, { x: 120, y: 80 }));
        await expectCanvasMatchesShow(a);
        await expectCanvasMatchesShow(b);
        expect(await positions(b.page)).toEqual(await positions(a.page));
        const assignments = "SELECT * FROM timeline_assignments ORDER BY id";
        expect(await a.query(assignments)).not.toEqual([]);
        expect(await b.query(assignments)).toEqual(await a.query(assignments));

        // B edits: A sees it
        const fromB = await measuredDrag(b, a, { x: 90, y: 140 }, 1);
        await expectCanvasMatchesShow(a);
        expect(await positions(a.page)).toEqual(await positions(b.page));

        // A few more of A's edits, for the latency numbers
        for (let i = 0; i < 4; i++) {
            latencies.push(
                await measuredDrag(a, b, { x: 40, y: i % 2 ? -30 : 30 }, i % 3),
            );
        }
        await expectCanvasMatchesShow(b);

        // B goes offline: read-only, edits refused
        await b.page.evaluate(() => window.__sync!.disconnect());
        await expect.poll(() => syncState(b.page)).toBe("offline");
        await expect(b.page.getByTestId("sync-readonly-banner")).toBeVisible();
        const bSavedBefore = await b.readSnapshot((q) =>
            q("SELECT * FROM timeline_slot_destinations ORDER BY id"),
        );
        const errorsBefore = b.pageErrors.length;
        const refused = await draggable(b.page);
        await dragMarcher(b.page, refused.drillNumber, { x: 70, y: 70 });
        await waitForIdle(b.page);
        await expectCanvasMatchesShow(b);
        expect(
            await b.readSnapshot((q) =>
                q("SELECT * FROM timeline_slot_destinations ORDER BY id"),
            ),
        ).toEqual(bSavedBefore);
        const refusals = b.pageErrors.slice(errorsBefore);
        console.log("B's errors while offline:", refusals);

        // A edits while B is away
        const awayMarcher = await draggable(a.page, 2);
        await dragMarcher(a.page, awayMarcher.drillNumber, { x: 50, y: 50 });
        await pendingZero(a.page);
        await expectCanvasMatchesShow(a);
        expect(await positions(b.page)).not.toEqual(await positions(a.page));

        // B reconnects and catches up
        const seqBefore = await b.page.evaluate(() => window.__sync!.seq());
        await b.page.evaluate(() => window.__sync!.reconnect());
        await expect.poll(() => syncState(b.page)).toBe("live");
        await expect(b.page.getByTestId("sync-readonly-banner")).toHaveCount(0);
        await expect.poll(() => positions(b.page)).toEqual(await positions(a.page));
        await expectCanvasMatchesShow(b);
        expect(await b.page.evaluate(() => window.__sync!.seq())).toBeGreaterThan(seqBefore);
        expect(await syncedTables(b.page)).toEqual(await syncedTables(a.page));

        // Only B's refused edits logged errors, and A logged none (the fixture checks A)
        for (const message of b.pageErrors)
            expect(message).toMatch(/read-only until the session reconnects/);

        const all = [...latencies, fromB];
        const stats = (
            key: "ack" | "received" | "writeMs" | "applied" | "drawn",
        ) => {
            const v = all.map((l) => l[key]).sort((x, y) => x - y);
            return { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
        };
        const report = {
            samples: all,
            ack: stats("ack"),
            received: stats("received"),
            writeMs: stats("writeMs"),
            applied: stats("applied"),
            drawn: stats("drawn"),
        };
        console.log("Remote edit latency (ms):", JSON.stringify(report));
        await testInfo.attach("latency.json", {
            body: JSON.stringify(report, null, 2),
            contentType: "application/json",
        });
    } finally {
        await b.close();
    }
});
