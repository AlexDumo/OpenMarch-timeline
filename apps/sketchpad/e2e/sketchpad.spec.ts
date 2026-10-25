import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

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

/** The sketches as the IndexedDB store keeps them */
const storedSketches = (page: Page) =>
    page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("openmarch-sketchpad");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const rows = await new Promise<
            { doc: string; render: { pages: { svg: string }[] } }[]
        >((resolve) => {
            const req = db
                .transaction("sketches")
                .objectStore("sketches")
                .getAll();
            req.onsuccess = () => resolve(req.result);
        });
        return rows.map((row) => {
            const doc = JSON.parse(row.doc) as {
                name: string;
                pages: {
                    name: string;
                    elements: {
                        type: string;
                        fillStyle: string;
                        isDeleted: boolean;
                    }[];
                }[];
            };
            return { doc, renders: row.render.pages.length };
        });
    });

test("draw, fill with dots, add a page, switch tabs, and find it all after a reload", async ({
    page,
}) => {
    const external: string[] = [];
    page.on("request", (r) => {
        if (!/^(http:\/\/localhost:5290|data:|blob:)/.test(r.url()))
            external.push(r.url());
    });
    await page.goto("/");
    await expect(inTab(page, "sketch-toolbar")).toBeVisible();
    await expect(inTab(page, "field-underlay")).toBeVisible();

    // A rectangle on the field, filled with dots
    await inTab(page, "tool-rectangle").click();
    await drag(page, [700, 640], [820, 740]);
    await inTab(page, "sketch-properties")
        .getByTestId("pattern-om-dots")
        .click();
    await expect(inTab(page, "dot-count")).toContainText(/\d+ dots/);
    await expect(inTab(page, "readout-dots")).toContainText("dots");

    // A second page with its own drawing
    await inTab(page, "add-page").click();
    await expect(
        page.getByTestId("sketch-tab-active").getByTestId("page-item"),
    ).toHaveCount(2);
    await inTab(page, "tool-ellipse").click();
    await drag(page, [900, 400], [1000, 480]);

    // A second sketch in its own tab, then back to the first
    await page.getByTestId("new-sketch").click();
    await page.getByTestId("create-sketch").click();
    await expect(page.getByTestId("sketch-tab")).toHaveCount(2);
    await expect(inTab(page, "sketch-name")).toHaveText("Sketch 2");
    await page
        .getByTestId("sketch-tab")
        .first()
        .locator("button")
        .first()
        .click();
    await expect(inTab(page, "sketch-name")).toHaveText("Sketch 1");

    // Autosave runs about 2 s after the last change
    await expect(inTab(page, "save-status")).toHaveText("Saved", {
        timeout: 10_000,
    });

    await page.reload();
    await expect(inTab(page, "sketch-toolbar")).toBeVisible();
    await expect(page.getByTestId("sketch-tab")).toHaveCount(2);
    await expect(
        page.getByTestId("sketch-tab-active").getByTestId("page-item"),
    ).toHaveCount(2);

    const sketches = await storedSketches(page);
    const first = sketches.find((s) => s.doc.name === "Sketch 1")!;
    expect(first.doc.pages.map((p) => p.name)).toEqual(["Page 1", "Page 2"]);
    expect(
        first.doc.pages[0]!.elements.filter((e) => !e.isDeleted).map(
            (e) => e.fillStyle,
        ),
    ).toEqual([expect.stringMatching(/^om-dots:/)]);
    expect(
        first.doc.pages[1]!.elements.filter((e) => !e.isDeleted).map(
            (e) => e.type,
        ),
    ).toEqual(["ellipse"]);
    expect(first.renders).toBe(2);

    // Offline: nothing loads from a CDN (ADR 0006 D-1)
    expect(external).toEqual([]);
});

test("exports a page to SVG with the field under the drawing", async ({
    page,
}) => {
    await page.goto("/");
    await expect(inTab(page, "sketch-toolbar")).toBeVisible();
    await inTab(page, "tool-rectangle").click();
    await drag(page, [700, 640], [820, 740]);
    await inTab(page, "sketch-properties")
        .getByTestId("pattern-om-staggered")
        .click();

    await inTab(page, "export-button").click();
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        inTab(page, "export-svg").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const svg = await readFile((await download.path())!, "utf8");
    expect(svg).toContain('data-om-layer="field"');
    expect(svg).toContain('data-om-layer="sketch"');
    // The field's yard numbers and the drawing's dots are both there
    expect(svg).toMatch(/>50</);
    expect(svg.indexOf('data-om-layer="field"')).toBeLessThan(
        svg.indexOf('data-om-layer="sketch"'),
    );
});
