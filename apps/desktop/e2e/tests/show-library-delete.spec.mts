/* eslint-disable max-lines-per-function -- one journey, step by step */
/**
 * Deleting the show's copy of a Library item while a cue uses it (package C3.4; props-spec.md
 * section 2, [26.10]): two silks are imported into the open show, a Silk cue names the first,
 * and deleting it from This show is refused with the cue listed and "Replace with…". Replacing
 * points the cue at the second silk; the first stays while Undo can bring it back, and Undo does.
 *
 * There is no Silk tab yet (C3.6), so the cue is written straight to the show file. With
 * `SHOW_LIBRARY_DELETE_SCREENSHOTS=<dir>` set, the run saves a screenshot of each dialog state
 * there, in the dark theme.
 */
import { markQualityNoticeSeen, test } from "../fixtures.mjs";
import { expect, type Page } from "playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, "../..");
const requireFromDesktop = createRequire(path.join(DESKTOP, "package.json"));
const MAIN_FILE = path.join(DESKTOP, "dist-electron/main/index.js");
const SCREENSHOTS = process.env.SHOW_LIBRARY_DELETE_SCREENSHOTS ?? null;
/** Importing converts images in a worker: be patient. */
const SLOW = 120_000;

test.describe.configure({ timeout: 4 * 60_000 });

/** A 600 × 900 px silk in one color, named so its import is recognizable. */
async function makeSilk(dir: string, name: string, color: string) {
    const sharp = requireFromDesktop("sharp") as typeof import("sharp");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${color}"/><circle cx="300" cy="450" r="180" fill="#f5d76e"/></svg>`;
    const file = path.join(dir, `${name}.png`);
    await sharp(Buffer.from(svg)).png().toFile(file);
    return file;
}

async function launch(databasePath: string, userData: string) {
    const app = await electron.launch({
        executablePath: requireFromDesktop("electron") as string,
        args: [
            MAIN_FILE,
            databasePath,
            `--user-data-dir=${userData}`,
            "--no-audio",
            "--disable-audio-output",
            "--disable-audio-input",
        ],
        env: {
            ...process.env,
            NODE_ENV: "development",
            PLAYWRIGHT_SESSION: "true",
        },
    });
    await markQualityNoticeSeen(app);
    return app;
}

/** Imports one PNG through the review; it lands in the Library and the open show. */
async function importSilk(app: ElectronApplication, page: Page, file: string) {
    await app.evaluate(
        ({ dialog }, filePaths) => {
            dialog.showOpenDialog = (async () => ({
                canceled: false,
                filePaths,
            })) as unknown as typeof dialog.showOpenDialog;
        },
        [file],
    );
    if (!(await page.getByTestId("assets-panel").count()))
        await page.getByTestId("assets-tab").click();
    await page.getByTestId("import-to-library").click();
    await expect(page.getByTestId("import-add")).toBeEnabled({
        timeout: SLOW,
    });
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-review-host")).toHaveCount(0, {
        timeout: SLOW,
    });
}

type Sql = (
    sql: string,
    params: unknown[],
    method: "all" | "run" | "get",
) => Promise<{ rows: unknown }>;

/** Runs SQL against the open show through the renderer's proxy; `all` gives rows as arrays. */
async function sql<T>(
    page: Page,
    statement: string,
    params: unknown[] = [],
    method: "all" | "run" | "get" = "all",
): Promise<T> {
    return (await page.evaluate(
        async ([s, p, m]) =>
            (
                await (
                    window as unknown as { electron: { sqlProxy: Sql } }
                ).electron.sqlProxy(s, p, m)
            ).rows,
        [statement, params, method] as const,
    )) as T;
}

async function screenshot(page: Page, name: string) {
    if (!SCREENSHOTS) return;
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
}

test("refuses deleting a silk a cue uses, and replaces it", async ({
    setupDb,
}, testInfo) => {
    const files = path.join(testInfo.outputDir, "silks");
    await fs.ensureDir(files);
    const home = await makeSilk(files, "home_silk", "#2d4f9e");
    const away = await makeSilk(files, "away_silk", "#e0306a");
    const userData = path.join(testInfo.outputDir, "user-data");
    await fs.remove(userData);
    if (SCREENSHOTS) await fs.ensureDir(SCREENSHOTS);

    const app = await launch(setupDb.databasePath, userData);
    try {
        const page = await app.firstWindow();
        await app.evaluate(({ BrowserWindow, nativeTheme }, dark) => {
            if (dark) nativeTheme.themeSource = "dark";
            BrowserWindow.getAllWindows()
                .find((w) => w.isVisible())
                ?.setSize(1440, 900);
        }, SCREENSHOTS !== null);
        if (SCREENSHOTS) {
            await page.evaluate(() =>
                (
                    window as unknown as {
                        electron: { setTheme(theme: string): Promise<void> };
                    }
                ).electron.setTheme("dark"),
            );
            await page.reload();
            await expect(page.locator("html")).toHaveClass(/dark/, {
                timeout: SLOW,
            });
        }

        await importSilk(app, page, home);
        await importSilk(app, page, away);
        // The show embeds each import after the review closes
        const embedded = () =>
            sql<[string, string, string][]>(
                page,
                "SELECT item_id, version_hash, name FROM library_items ORDER BY name DESC",
            );
        await expect
            .poll(async () => (await embedded()).length, { timeout: SLOW })
            .toBe(2);
        const items = await embedded();
        const [homeItem, awayItem] = items.map(
            ([itemId, versionHash, name]) => ({
                itemId,
                versionHash,
                name,
            }),
        );
        expect([homeItem!.name, awayItem!.name]).toEqual([
            "home silk",
            "away silk",
        ]);

        // A Silk cue on the first beat names the home silk
        await sql(
            page,
            `INSERT INTO cues (channel, kind, target_kind, target_section, beat_id, value)
             VALUES ('silk', 'state', 'section', 'Flag',
                     (SELECT id FROM beats ORDER BY position, id LIMIT 1), ?)`,
            [`library:${homeItem!.itemId}@${homeItem!.versionHash}`],
            "run",
        );

        await page.getByTestId("assets-section-show").click();
        const row = (itemId: string) =>
            page.locator(`[data-testid="show-item"][data-item-id="${itemId}"]`);
        await expect(row(homeItem!.itemId)).toBeVisible();
        await row(homeItem!.itemId).hover();
        await screenshot(page, "01-this-show");

        await row(homeItem!.itemId).getByTestId("show-item-delete").click();
        const dialog = page.getByTestId("delete-show-asset");
        await expect(dialog).toContainText("is in use");
        await expect(dialog.getByTestId("delete-show-asset-uses")).toHaveText(
            "Silk · Flag · count 0",
        );
        const confirm = dialog.getByTestId("delete-show-asset-confirm");
        await expect(confirm).toBeDisabled();
        await screenshot(page, "02-refused-with-uses");

        await dialog.getByTestId("delete-show-asset-replacement").click();
        await page.getByRole("option", { name: awayItem!.name }).click();
        await expect(confirm).toBeEnabled();
        await screenshot(page, "03-replacement-chosen");
        await confirm.click();

        await expect(dialog).toHaveCount(0);
        const cueValues = () => sql<string[][]>(page, "SELECT value FROM cues");
        await expect
            .poll(cueValues)
            .toEqual([
                [`library:${awayItem!.itemId}@${awayItem!.versionHash}`],
            ]);
        // Undo could bring the home silk back, so it stays in the show for now
        await expect(row(homeItem!.itemId)).toBeVisible();
        await screenshot(page, "04-replaced-kept-for-undo");

        // The replacement is in use now, so it can't go either
        await row(awayItem!.itemId).getByTestId("show-item-delete").click();
        await expect(dialog).toContainText("is in use");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);

        // Undo points the cue back at the home silk, which the show still has
        await page.locator("body").click({ position: { x: 1000, y: 600 } });
        await page.keyboard.press("ControlOrMeta+z");
        await expect
            .poll(cueValues)
            .toEqual([
                [`library:${homeItem!.itemId}@${homeItem!.versionHash}`],
            ]);
    } finally {
        await app.close();
    }
});
