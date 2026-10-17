/* eslint-disable no-console */
/**
 * The collaboration spike's per-user undo, conflict feedback and presence (WP-D), in two
 * windows against the real sync server (see `collaboration.spec.mts` for how the two windows
 * and the server are set up).
 *
 * A and B start from one seeded show with four marchers and a move on page 1, and both work on
 * page 1:
 *
 * - A's undo reverts only A's edit; B's later edit stays, in both windows;
 * - a partial undo keeps what B changed since, and says so;
 * - undoing a delete brings the marcher back with the same id in both windows;
 * - an overwritten edit offers "Put mine back", which restores it everywhere;
 * - an edit while offline raises the read-only toast;
 * - B sees A's selection as rings on the field and A's playhead on the timeline, and "Go to"
 *   in the people list moves B's playhead to A's.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import {
    clickMarcher,
    dragMarcher,
    drawnMarchers,
    expectCanvasMatchesShow,
    marcherRowAction,
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
    type SyncServer,
} from "../collab.mjs";

const ids = [1, 2, 3, 4];
test.use({
    seedSql: seedShowSql({
        beats: 16,
        measureStarts: [1, 5, 9, 13],
        pageStarts: [1],
        marchers: ids.map((id) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: [
            ids.map(
                (id) => [id, 400 + 80 * id, 300] as [number, number, number],
            ),
            ids.map(
                (id) => [id, 400 + 80 * id, 380] as [number, number, number],
            ),
        ],
    }),
    initScript: SYNC_DEV_INIT,
    allowedPageErrors: [/Audio worklet error/],
});

let server: SyncServer;
let stateDir: string;

test.beforeAll(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sync-undo-e2e-"));
    server = await startSyncServer(stateDir);
});

test.afterAll(async () => {
    await server?.stop();
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
});

type Spot = { x: number; y: number };

/** Every drawn marcher's spot, by drill number, rounded. */
const spots = async (page: Page): Promise<Record<string, Spot>> =>
    Object.fromEntries(
        (await drawnMarchers(page)).map((m) => [
            m.drillNumber,
            { x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100 },
        ]),
    );

const pendingZero = (page: Page) =>
    expect
        .poll(() => page.evaluate(() => window.__sync!.state().pending))
        .toBe(0);

/** Both windows have handled everything and draw the same thing. */
async function converged(a: Page, b: Page) {
    await pendingZero(a);
    await pendingZero(b);
    try {
        const seq = (page: Page) =>
            page.evaluate(async () => {
                await window.__sync!.idle();
                return window.__sync!.seq();
            });
        await expect.poll(async () => (await seq(b)) - (await seq(a))).toBe(0);
        await expect
            .poll(async () => {
                const [x, y] = await Promise.all([spots(a), spots(b)]);
                return JSON.stringify(x) === JSON.stringify(y);
            })
            .toBe(true);
    } catch (error) {
        for (const page of [a, b])
            console.log(
                "sync state:",
                JSON.stringify(
                    await page.evaluate(() => ({
                        state: window.__sync!.state(),
                        events: window.__sync!.events().slice(-6),
                    })),
                ),
            );
        throw error;
    }
}

const undo = async (page: Page) => {
    await page.keyboard.press("Control+z");
    await waitForIdle(page);
    await pendingZero(page);
};

// eslint-disable-next-line max-lines-per-function
test("per-user undo, put mine back, offline toast and presence", async ({
    show,
    chromium,
}, testInfo) => {
    test.setTimeout(240_000);
    const a = show;
    await allowSyncServer(a.page, server.url);
    const { sessionId } = await a.page.evaluate(() =>
        window.__sync!.makeCollaborative(),
    );
    const b = await openPeer(chromium!, testInfo, "window-b");
    try {
        await allowSyncServer(b.page, server.url);
        await b.page.evaluate(
            (id) => window.__sync!.joinSession(id),
            sessionId,
        );
        await selectPage(a, "Page 1");
        await selectPage(b, "Page 1");
        await converged(a.page, b.page);
        const start = await spots(a.page);

        // 1. A moves T1, then B moves T2; A's undo puts T1 back and leaves B's T2
        await dragMarcher(a.page, "T1", { x: 60, y: 0 });
        await converged(a.page, b.page);
        await dragMarcher(b.page, "T2", { x: 0, y: 60 });
        await converged(a.page, b.page);
        const afterB = await spots(a.page);
        expect(afterB.T1).not.toEqual(start.T1);
        expect(afterB.T2).not.toEqual(start.T2);
        await undo(a.page);
        await converged(a.page, b.page);
        const afterUndo = await spots(a.page);
        expect(afterUndo.T1).toEqual(start.T1);
        expect(afterUndo.T2).toEqual(afterB.T2);
        await expectCanvasMatchesShow(a);
        await expectCanvasMatchesShow(b);

        // 2. A moves T3 and T4 together; B moves T4 since; A's undo puts T3 back, keeps B's T4
        await clickMarcher(a.page, "T3");
        await clickMarcher(a.page, "T4", { add: true });
        await dragMarcher(a.page, "T3", { x: 40, y: 40 });
        await converged(a.page, b.page);
        await dragMarcher(b.page, "T4", { x: -50, y: -30 });
        await converged(a.page, b.page);
        const bT4 = (await spots(a.page)).T4;
        await undo(a.page);
        await converged(a.page, b.page);
        const partial = await spots(a.page);
        expect(partial.T3).toEqual(start.T3);
        expect(partial.T4).toEqual(bT4);
        await expect(
            a.page.getByText(/except what .* changed since\. That was kept\./),
        ).toBeVisible();

        // 3. A deletes T2 and undoes: T2 is back with the same id in both windows
        const t2Id = (await drawnMarchers(a.page)).find(
            (m) => m.drillNumber === "T2",
        )!.id;
        await marcherRowAction(a.page, "T2", "Delete");
        await a.page.getByRole("button", { name: "Save Changes" }).click();
        await a.page
            .getByRole("alertdialog", { name: "Warning" })
            .getByRole("button", { name: "Delete" })
            .click();
        await expect
            .poll(async () => Object.keys(await spots(a.page)))
            .not.toContain("T2");
        await converged(a.page, b.page);
        expect(Object.keys(await spots(b.page))).not.toContain("T2");
        await a.page.locator("#sidebar-launcher-marchers").click();
        await undo(a.page);
        await expect
            .poll(async () => Object.keys(await spots(a.page)))
            .toContain("T2");
        await converged(a.page, b.page);
        for (const page of [a.page, b.page])
            expect(
                (await drawnMarchers(page)).find((m) => m.drillNumber === "T2")
                    ?.id,
            ).toBe(t2Id);
        expect(await syncedTables(b.page)).toEqual(await syncedTables(a.page));

        // 4. A and B move T1 at once; B's lands last; A puts theirs back
        await b.page.evaluate(() => window.__sync!.holdIncoming(true));
        await dragMarcher(a.page, "T1", { x: 30, y: 30 });
        await pendingZero(a.page);
        const mine = (await spots(a.page)).T1;
        await dragMarcher(b.page, "T1", { x: -30, y: 30 });
        await b.page.evaluate(() => window.__sync!.holdIncoming(false));
        await converged(a.page, b.page);
        expect((await spots(a.page)).T1).not.toEqual(mine);
        const putBack = a.page.getByRole("button", { name: "Put mine back" });
        await expect(putBack).toBeVisible();
        await putBack.click();
        await waitForIdle(a.page);
        await converged(a.page, b.page);
        expect((await spots(a.page)).T1).toEqual(mine);
        expect((await spots(b.page)).T1).toEqual(mine);
        await expectCanvasMatchesShow(b);

        // 5. B offline: an edit is refused with one read-only toast
        await b.page.evaluate(() => window.__sync!.disconnect());
        await expect(b.page.getByTestId("sync-readonly-banner")).toBeVisible();
        await dragMarcher(b.page, "T3", { x: 40, y: 0 });
        await expect(
            b.page.getByText("You're offline, so the show is read-only"),
        ).toBeVisible();
        await b.page.evaluate(() => window.__sync!.reconnect());
        await expect
            .poll(() => b.page.evaluate(() => window.__sync!.state().state))
            .toBe("live");
        await converged(a.page, b.page);

        // 6. Presence: B sees A's selection and playhead, and goes to it
        await clickMarcher(a.page, "T3");
        const t3Id = (await drawnMarchers(a.page)).find(
            (m) => m.drillNumber === "T3",
        )!.id;
        const aName = await a.page.evaluate(() => {
            const s = window.__sync!.state();
            return s.people.find((p) => p.user.id === s.userId)!.user.name;
        });
        await expect(
            b.page.locator(
                `[data-testid="sync-presence-ring"][data-marcher-id="${t3Id}"][data-user-name="${aName}"]`,
            ),
        ).toHaveCount(1);
        await selectPage(a, "Page 0");
        const aLine = b.page.locator(
            `[data-testid="sync-presence-playhead"][data-user-name="${aName}"]`,
        );
        await expect(aLine).toHaveCount(1);
        await expect(aLine).toHaveAttribute("data-beat", "0");
        await b.page.getByTestId("sync-status").click();
        const person = b.page.locator(
            `[data-testid="sync-person"][data-user-name="${aName}"]`,
        );
        await expect(person).toContainText("1 selected");
        // Optional pictures of what B sees, for reviewing the spike by eye
        const shots = process.env.SPIKE_SHOTS;
        if (shots) {
            await b.page.screenshot({ path: `${shots}/presence-b.png` });
            await a.page.screenshot({ path: `${shots}/presence-a.png` });
        }
        const playheadLabel = (page: Page) =>
            page.getByTestId("timeline-playhead").getAttribute("aria-label");
        expect(await playheadLabel(b.page)).not.toEqual(
            await playheadLabel(a.page),
        );
        await person.getByRole("button", { name: "Go to" }).click();
        await expect
            .poll(() => playheadLabel(b.page))
            .toEqual(await playheadLabel(a.page));

        console.log("B's errors:", b.pageErrors);
    } finally {
        await b.close();
    }
});
