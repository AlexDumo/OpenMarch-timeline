import { expect, Page } from "@playwright/test";
import { test } from "../fixtures.mjs";

test("Launch page is visible", async ({ electronAppEmpty }) => {
    const { app, page } = electronAppEmpty;
    const isPackaged = await app.evaluate(async ({ app }) => {
        // This runs in Electron's main process, parameter here is always
        // the result of the require('electron') in the main app script.
        return app.isPackaged;
    });

    expect(isPackaged).toBe(false);
    await expect(page.getByText("OpenMarch", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Recent Files" })).toBeVisible();
});

test("Launch page sub-menus", async ({ electronAppEmpty }) => {
    const { page } = electronAppEmpty;
    await page.getByRole("tab", { name: "Learn" }).click();
    await expect(page.getByRole("heading", { name: "Learn" })).toBeVisible();

    await page.getByRole("tab", { name: "Files" }).click();
    await expect(
        page.getByRole("heading", { name: "Learn" }),
    ).not.toBeVisible();

    await expect(page.getByRole("button", { name: "New File" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open File" })).toBeVisible();

    const { app } = electronAppEmpty;
    const [settings] = await Promise.all([
        app.waitForEvent("window"),
        page.getByRole("button", { name: "Settings" }).click(),
    ]);
    await settings.waitForLoadState("domcontentloaded");
    await expect(settings.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
        settings.getByRole("button", { name: "Privacy", exact: true }),
    ).toBeVisible();
});

const canvasIsVisible = async (page: Page) => {
    await expect(page.getByTestId("timeline-page-ruler")).toBeVisible();
    await expect(page.getByTestId("fieldCanvas")).toBeVisible();
};

test("Canvas is visible", async ({ electronApp }) => {
    const { app, page } = electronApp;
    const isPackaged = await app.evaluate(async ({ app }) => {
        // This runs in Electron's main process, parameter here is always
        // the result of the require('electron') in the main app script.
        return app.isPackaged;
    });

    expect(isPackaged).toBe(false);
    await canvasIsVisible(page);
});

test("Toolbars are visible", async ({ electronApp }) => {
    const { page } = electronApp;
    await canvasIsVisible(page);
    await page.getByRole("tab", { name: "File" }).click();
    await expect(page.getByText("Open FileNew FileSave Copy")).toBeVisible();
    console.log("checking the field display bar");
    await expect(page.getByTestId("field-display-bar")).toBeVisible();
    console.log("clicking alignment tab");
    await page.getByRole("tab", { name: "Alignment" }).click();
    await expect(
        page.getByRole("tabpanel", { name: "Alignment" }).locator("div").nth(3),
    ).toBeVisible();
});

test("Export modal is visible", async ({ electronApp }) => {
    const { page } = electronApp;
    await page.getByRole("tab", { name: "File" }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Export", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Coordinate Sheets" }).click();
    await expect(page.getByText("PreviewB1Example")).toBeVisible();
    await page.getByRole("tab", { name: "Drill Charts" }).click();
    await expect(
        page.getByRole("heading", { name: "Export Not Available" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
        page.getByRole("dialog", { name: "Export" }),
    ).not.toBeVisible();
});

test("Sidebars are visible", async ({ electronApp }) => {
    const { page } = electronApp;
    await page.locator("#sidebar-launcher-marchers").click();
    await expect(page.getByRole("heading", { name: "Marchers" })).toBeVisible();
    await expect(
        page.locator("#workspace div").filter({ hasText: "Marchers" }).nth(1),
    ).toBeVisible();
    await page.locator("#sidebar-launcher-marchers").click();
    // The Field button edits the field in place (#824): its bar takes the toolbar's place
    await page.locator("#sidebar-launcher-field").click();
    await expect(page.getByTestId("field-edit-bar")).toBeVisible();
    await expect(page.getByText("Editing field")).toBeVisible();
    await expect(page.locator("header")).toBeVisible();
    await page.getByTestId("field-edit-done").click();
    await expect(page.getByTestId("field-edit-bar")).toBeHidden();
});

test("Field inspector sections are visible", async ({ electronApp }) => {
    const { page } = electronApp;
    await page.locator("#sidebar-launcher-field").click();
    const inspector = page.getByTestId("field-inspector");
    await expect(inspector).toBeVisible();
    // Lines and Size and steps start open
    await expect(inspector.getByText("X · side to side")).toBeVisible();
    await expect(inspector.getByText("Y · front to back")).toBeVisible();
    await expect(inspector.getByText("Draw as hashes")).toBeVisible();
    await expect(
        inspector.getByText("Step Size", { exact: true }),
    ).toBeVisible();
    await expect(inspector.getByText("Measurement System")).toBeVisible();
    for (const [section, inside] of [
        ["Template and files", "Field Template"],
        ["Name and sides", "Side Descriptions"],
        ["Markings and labels", "Yard numbers"],
        ["Background image", "Show Background Image"],
        ["Colors", "Marchers and paths"],
    ] as const) {
        await inspector.getByRole("button", { name: section }).click();
        await expect(inspector.getByText(inside)).toBeVisible();
    }
    await expect(
        inspector.getByRole("button", { name: "Import Field" }),
    ).toBeVisible();
    await expect(
        inspector.getByRole("button", { name: "Import Image" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
});
