/**
 * Sketchpad end to end (ADR 0006 D-4 Verification): open the Sketches panel, make a new sketch,
 * which opens the Sketchpad window, draw a rectangle, close the window (it saves first), find the
 * sketch with its thumbnail in the sidebar, reopen it and find the rectangle. Then duplicate it,
 * delete the copy and bring it back with Undo. The window loads nothing from the network.
 */
import { test } from "../fixtures.mjs";
import { expect, type Page } from "playwright/test";
import type { ElectronApplication } from "playwright";

const LOCAL = /^(file:|data:|blob:|devtools:|chrome|about:)/;

interface StoredElement {
    type: string;
    isDeleted?: boolean;
}

/** Opens the Sketchpad window by clicking `click`, and returns its page */
async function openWindow(
    app: ElectronApplication,
    click: () => Promise<void>,
    external: string[],
): Promise<Page> {
    const opened = app.waitForEvent("window");
    await click();
    const sketchpad = await opened;
    sketchpad.on("request", (r) => {
        if (!LOCAL.test(r.url())) external.push(r.url());
    });
    await sketchpad.waitForLoadState();
    expect(sketchpad.url()).toContain("view=sketchpad");
    await expect(sketchpad.getByTestId("sketchpad")).toBeVisible({
        timeout: 30_000,
    });
    return sketchpad;
}

/** Selectors inside the visible sketch tab (hidden tabs stay mounted) */
const inTab = (page: Page, id: string) =>
    page.getByTestId("sketch-tab-active").getByTestId(id).first();

async function drag(page: Page, from: [number, number], to: [number, number]) {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, {
        steps: 4,
    });
    await page.mouse.move(...to, { steps: 4 });
    await page.mouse.up();
}

/** Closes the Sketchpad window as its close button would, and waits until it's gone */
async function closeWindow(app: ElectronApplication, sketchpad: Page) {
    const closed = sketchpad.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes("view=sketchpad"))
            ?.close();
    });
    await closed;
}

test("make a sketch, draw, close the window, reopen it, and edit a template from the sidebar", async ({
    electronApp,
}) => {
    test.setTimeout(180_000);
    const { app, page: editor } = electronApp;
    const external: string[] = [];

    await editor.getByTestId("sketches-tab").click();
    const panel = editor.getByTestId("sketches-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("sketches-empty")).toBeVisible();

    // New sketch opens the window with the New sketch dialog
    let sketchpad = await openWindow(
        app,
        () => panel.getByTestId("sketches-new").click(),
        external,
    );
    await expect(sketchpad.getByTestId("new-sketch-dialog")).toBeVisible();
    await sketchpad.getByTestId("create-sketch").click();
    await expect(sketchpad.getByTestId("sketch-tab")).toHaveCount(1);
    await expect(inTab(sketchpad, "sketch-toolbar")).toBeVisible();
    await expect(inTab(sketchpad, "field-underlay")).toBeVisible();

    // A rectangle in the middle of the field
    await inTab(sketchpad, "tool-rectangle").click();
    const box = (await sketchpad
        .getByTestId("sketch-tab-active")
        .boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await drag(sketchpad, [cx - 80, cy - 50], [cx + 80, cy + 50]);

    // Closing the window saves it first
    await closeWindow(app, sketchpad);

    // The sidebar lists it with its thumbnail
    const card = panel.getByTestId("sketch-card");
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await expect(card.getByTestId("sketch-name")).toHaveText("Sketch 1");
    await expect(card.getByTestId("sketch-thumbnail")).toBeVisible({
        timeout: 10_000,
    });
    const id = (await card.getAttribute("data-sketch-id"))!;

    // Reopen it from the sidebar: its tab opens, and the rectangle is stored
    sketchpad = await openWindow(
        app,
        () => card.locator("button").first().click(),
        external,
    );
    await expect(sketchpad.getByTestId("sketch-tab")).toHaveCount(1);
    await expect(sketchpad.getByTestId("sketch-tab")).toContainText("Sketch 1");
    const elements = await sketchpad.evaluate(
        async (sketchId) =>
            (await window.sketchpad.load(sketchId)).pages[0]!
                .elements as unknown as StoredElement[],
        id,
    );
    expect(
        elements.filter((e) => e.type === "rectangle" && !e.isDeleted),
    ).toHaveLength(1);
    await closeWindow(app, sketchpad);

    // Duplicate, delete the copy, and Undo brings it back
    await card.getByTestId("sketch-menu").click();
    await editor.getByTestId("sketch-duplicate").click();
    await expect(panel.getByTestId("sketch-card")).toHaveCount(2);
    await expect(
        panel.getByTestId("sketch-card").nth(1).getByTestId("sketch-name"),
    ).toHaveText("Sketch 1 copy");
    await panel
        .getByTestId("sketch-card")
        .nth(1)
        .getByTestId("sketch-menu")
        .click();
    await editor.getByTestId("sketch-delete").click();
    await expect(panel.getByTestId("sketch-card")).toHaveCount(1);
    await editor.getByRole("button", { name: "Undo" }).click();
    await expect(panel.getByTestId("sketch-card")).toHaveCount(2);

    // Save the first sketch as a template in this show
    sketchpad = await openWindow(
        app,
        () =>
            panel
                .getByTestId("sketch-card")
                .first()
                .locator("button")
                .first()
                .click(),
        external,
    );
    await inTab(sketchpad, "sketch-menu").click();
    await sketchpad.getByTestId("menu-save-template").click();
    await expect(sketchpad.getByTestId("save-template-dialog")).toBeVisible();
    await sketchpad.getByTestId("template-name").fill("Block");
    await sketchpad.getByTestId("save-template").click();
    await expect(sketchpad.getByTestId("save-template-dialog")).toBeHidden();
    await closeWindow(app, sketchpad);

    const templateCard = panel.getByTestId("sketch-template");
    await expect(templateCard).toHaveCount(1);
    await expect(templateCard.getByTestId("sketch-thumbnail")).toBeVisible();
    const templateId = (await templateCard.getAttribute("data-sketch-id"))!;

    // Rename it in place
    await templateCard.getByTestId("sketch-menu").click();
    await editor.getByTestId("template-rename").click();
    await templateCard.getByTestId("sketch-name-input").fill("Block band");
    await templateCard.getByTestId("sketch-name-input").press("Enter");
    await expect(templateCard.getByTestId("sketch-name")).toHaveText(
        "Block band",
    );

    // Edit it in the window: a Template tab, and a drawing saved back to the template
    await templateCard.getByTestId("sketch-menu").click();
    sketchpad = await openWindow(
        app,
        () => editor.getByTestId("template-edit").click(),
        external,
    );
    await expect(sketchpad.getByTestId("tab-template-badge")).toBeVisible();
    await expect(inTab(sketchpad, "template-badge")).toBeVisible();
    await expect(sketchpad.getByTestId("sketch-tab")).toContainText(
        "Block band",
    );
    await inTab(sketchpad, "tool-ellipse").click();
    const templateBox = (await sketchpad
        .getByTestId("sketch-tab-active")
        .boundingBox())!;
    const tx = templateBox.x + templateBox.width / 2;
    const ty = templateBox.y + templateBox.height / 2;
    await drag(sketchpad, [tx + 120, ty - 40], [tx + 220, ty + 40]);
    await closeWindow(app, sketchpad);

    // Reopen it: the ellipse is in the template, which is still the only one
    await templateCard.getByTestId("sketch-menu").click();
    sketchpad = await openWindow(
        app,
        () => editor.getByTestId("template-edit").click(),
        external,
    );
    const template = await sketchpad.evaluate(
        (id) => window.sketchpad.templates.load(id, "show"),
        templateId,
    );
    expect(template.name).toBe("Block band");
    const shapes = (
        template.pages[0]!.elements as unknown as StoredElement[]
    ).filter((e) => !e.isDeleted);
    expect(shapes.map((e) => e.type).sort()).toEqual(["ellipse", "rectangle"]);
    expect(template).not.toHaveProperty("field");
    await closeWindow(app, sketchpad);
    await expect(templateCard).toHaveCount(1);
    await expect(panel.getByTestId("sketch-card")).toHaveCount(2);

    // Delete it, and Undo brings it back
    await templateCard.getByTestId("sketch-menu").click();
    await editor.getByTestId("template-delete").click();
    await expect(templateCard).toHaveCount(0);
    await editor.getByRole("button", { name: "Undo" }).click();
    await expect(templateCard).toHaveCount(1);
    await expect(templateCard.getByTestId("sketch-name")).toHaveText(
        "Block band",
    );

    expect(external).toEqual([]);
});
