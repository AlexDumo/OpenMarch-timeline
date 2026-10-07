/**
 * Saving through a working copy (docs/adr/0001), with the setting forced on.
 * The show file is read the way another program would: a copy of the main
 * file alone, with no -wal or -journal beside it.
 */
import { expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import initSqlJs from "sql.js";
import { test } from "../fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainFile = path.resolve(__dirname, "../../dist-electron/main/index.js");
const electronExecutable = createRequire(
    path.join(__dirname, "../package.json"),
)("electron") as string;

async function launch(
    databasePath: string,
    userData: string,
): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await electron.launch({
        executablePath: electronExecutable,
        args: [
            mainFile,
            databasePath,
            "--no-audio",
            `--user-data-dir=${userData}`,
        ],
        env: {
            ...process.env,
            NODE_ENV: "development",
            PLAYWRIGHT_SESSION: "true",
            OPENMARCH_WORKING_COPY: "1",
        },
    });
    const page = await app.firstWindow();
    return { app, page };
}

async function pageCount(databasePath: string): Promise<number> {
    const SQL = await initSqlJs({
        locateFile: (file: string) => `./node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database(fs.readFileSync(databasePath));
    try {
        return db.exec("SELECT count(*) FROM pages")[0].values[0][0] as number;
    } finally {
        db.close();
    }
}

/** Files that must never sit beside the show: -wal, -shm, -journal, temp files. */
function filesBeside(databasePath: string): string[] {
    const name = path.basename(databasePath);
    return fs
        .readdirSync(path.dirname(databasePath))
        .filter(
            (file) =>
                file.startsWith(`${name}-`) || file.startsWith(`.~${name}`),
        );
}

/** Adds page 1 to a new show and waits until the timeline shows it. */
async function addPage(page: Page) {
    const pages = page.locator("#pages");
    await expect(pages).toContainText("0");
    await pages.getByRole("button").click();
    await expect(pages).toContainText("1");
}

test("edits reach the show file without sidecar files", async ({
    setupDb,
}, testInfo) => {
    const { databasePath } = setupDb;
    const userData = path.resolve(testInfo.outputDir, "user-data");
    const workingCopies = path.join(userData, "working-copies");
    const { app, page } = await launch(databasePath, userData);
    try {
        await expect(page.locator("#pages")).toBeVisible();
        expect(fs.readdirSync(workingCopies)).toHaveLength(1);

        await addPage(page);
        await expect.poll(() => pageCount(databasePath)).toBe(2);
        expect(filesBeside(databasePath)).toEqual([]);
        await expect(page.getByTestId("working-copy-state")).toHaveCount(0);
    } finally {
        await app.close();
    }
    expect(fs.readdirSync(workingCopies)).toEqual([]);
    expect(filesBeside(databasePath)).toEqual([]);
});

test("unsaved changes survive a crash", async ({ setupDb }, testInfo) => {
    const { databasePath } = setupDb;
    const userData = path.resolve(testInfo.outputDir, "user-data");
    let { app, page } = await launch(databasePath, userData);
    await expect(page.locator("#pages")).toBeVisible();
    await addPage(page);
    app.process().kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await pageCount(databasePath)).toBe(1);

    ({ app, page } = await launch(databasePath, userData));
    try {
        const recovery = page.getByTestId("recoverable-shows");
        await expect(recovery).toBeVisible();
        await recovery.getByRole("button", { name: "Recover" }).click();
        await expect(page.locator("#pages")).toBeVisible();
        await expect.poll(() => pageCount(databasePath)).toBe(2);
    } finally {
        await app.close();
    }
});

test("a show changed on disk is never overwritten without asking", async ({
    setupDb,
}, testInfo) => {
    const { databasePath } = setupDb;
    const userData = path.resolve(testInfo.outputDir, "user-data");
    const { app, page } = await launch(databasePath, userData);
    try {
        await expect(page.locator("#pages")).toBeVisible();

        // Another program writes the show while it's open.
        const SQL = await initSqlJs({
            locateFile: (file: string) => `./node_modules/sql.js/dist/${file}`,
        });
        const other = new SQL.Database(fs.readFileSync(databasePath));
        other.exec("UPDATE pages SET notes = 'theirs' WHERE id = 0");
        fs.writeFileSync(databasePath, other.export());
        other.close();

        await addPage(page);
        await expect(page.getByTestId("working-copy-conflict")).toBeVisible();
        expect(await pageCount(databasePath)).toBe(1);

        await page.getByRole("button", { name: "Keep my version" }).click();
        await expect.poll(() => pageCount(databasePath)).toBe(2);
        await expect(page.getByTestId("working-copy-conflict")).toHaveCount(0);
    } finally {
        await app.close();
    }
});
