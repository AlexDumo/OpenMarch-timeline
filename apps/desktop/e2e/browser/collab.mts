/* eslint-disable no-console */
/**
 * Helpers for the collaboration spike's two-window scenarios: the local sync server
 * (`sync-server/`, under `wrangler dev`) and a second app window in this process.
 *
 * Two windows, one process: the host holds one show per module instance (module-level connection
 * in `database.services.ts`), and `dist-browser-host/index.mjs` is one self-contained file, so
 * importing it again under another URL (`?instance=b`) gives a second, independent host with its
 * own database connection and IPC handlers (`openInBrowser`'s `hostInstance`). Each window has
 * its own browser context, so its own local storage and sync identity.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import {
    blankShow,
    openInBrowser,
    snapshotReader,
    startupStorage,
    type Show,
} from "./fixtures.mjs";
import { waitForField, waitForSettledField } from "./app.mjs";

const desktopDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const serverDir = path.join(desktopDir, "sync-server");
const wrangler = path.resolve(desktopDir, "../../node_modules/.bin/wrangler");

/** `localStorage` keys the sync code reads (`src/sync/connection.ts`, `SyncHost.tsx`). */
export const SYNC_DEV_INIT = `localStorage.setItem("openmarch:syncDev", "1");`;

const freePort = () =>
    new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address() as net.AddressInfo;
            srv.close(() => resolve(port));
        });
    });

export interface SyncServer {
    url: string;
    pid: number;
    stop: () => Promise<void>;
}

/**
 * Starts the sync server on free ports, with its own state folder, and waits until it answers.
 * Stopped by its process group's id (wrangler runs workerd as a child).
 */
export async function startSyncServer(stateDir: string): Promise<SyncServer> {
    const port = await freePort();
    const inspector = await freePort();
    fs.mkdirSync(stateDir, { recursive: true });
    const child: ChildProcess = spawn(
        wrangler,
        [
            "dev",
            "--port",
            String(port),
            "--ip",
            "127.0.0.1",
            "--inspector-port",
            String(inspector),
            "--persist-to",
            stateDir,
            "--show-interactive-dev-session=false",
            "--log-level",
            "warn",
        ],
        {
            cwd: serverDir,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        },
    );
    const log: string[] = [];
    child.stdout?.on("data", (d) => log.push(String(d)));
    child.stderr?.on("data", (d) => log.push(String(d)));
    const url = `http://127.0.0.1:${port}`;
    const stop = async () => {
        if (child.exitCode !== null || !child.pid) return;
        const exited = new Promise<void>((r) => child.once("exit", () => r()));
        try {
            process.kill(-child.pid, "SIGTERM");
        } catch {
            // already gone
        }
        await Promise.race([
            exited,
            new Promise((r) => setTimeout(r, 5000)),
        ]);
        if (child.exitCode === null)
            try {
                process.kill(-child.pid, "SIGKILL");
            } catch {
                // already gone
            }
    };
    const deadline = Date.now() + 60_000;
    for (;;) {
        if (child.exitCode !== null)
            throw new Error(`wrangler dev exited:\n${log.join("")}`);
        try {
            const res = await fetch(url);
            if (res.ok) break;
        } catch {
            // not up yet
        }
        if (Date.now() > deadline) {
            await stop();
            throw new Error(`wrangler dev did not start:\n${log.join("")}`);
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return { url, pid: child.pid!, stop };
}

/** Lets the page reach the sync server: the harness blocks every origin but the app's. */
export async function allowSyncServer(page: Page, serverUrl: string) {
    // An https page reaching a loopback address needs Chromium's local network access permission
    await page.context().grantPermissions(["local-network-access"]);
    // Routes run newest first, so this one wins over the harness's catch-all
    await page.route(`${serverUrl}/**`, (route) => route.continue());
    await page.evaluate(
        (url) => localStorage.setItem("openmarch:syncServer", url),
        serverUrl,
    );
}

export type Peer = Show & { close: () => Promise<void> };

/** A second app window with a blank show, in this process (see the file's header). */
export async function openPeer(
    browser: Browser,
    testInfo: TestInfo,
    name: string,
): Promise<Peer> {
    const databasePath = testInfo.outputPath(`${name}.dots`);
    fs.copyFileSync(blankShow, databasePath);
    const app = await openInBrowser(
        browser,
        databasePath,
        { optOutAnalytics: true },
        startupStorage(false),
        SYNC_DEV_INIT,
        testInfo.outputPath(`${name}-video`),
        name,
    );
    const { page } = app;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (message.text() === "Failed to load resource: net::ERR_FAILED")
            return;
        // The harness can't load the audio worklet (boot.spec fails on it too)
        if (message.text().startsWith("Audio worklet error")) return;
        pageErrors.push(message.text());
    });
    await expect(page.locator("canvas").first()).toBeVisible({
        timeout: 20_000,
    });
    await waitForField(page);
    await waitForSettledField(page);
    return {
        page,
        databasePath,
        pageErrors,
        query: app.query,
        readSnapshot: snapshotReader(app, (f) =>
            testInfo.outputPath(`${name}-${f}`),
        ),
        videoExportPath: testInfo.outputPath(`${name}-video`),
        close: app.close,
    };
}

/** The window's synced tables, read through the app (`window.__sync.snapshot`). */
export const syncedTables = (page: Page) =>
    page.evaluate(async () => {
        await window.__sync!.idle();
        return window.__sync!.snapshot();
    });

export const syncState = (page: Page) =>
    page.evaluate(() => window.__sync!.state().state);
