// The field chapter (guides/field/*).

/** Closes notices that would sit over the picture (the low-quality field notice, toasts). */
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

/** The open sidebar panel (Field, Show settings, Metronome…). */
const panel = (page) => page.locator("div.absolute.z-40.bg-modal").first();

/** Opens a sidebar panel by its launcher's content id and waits for it. */
async function openPanel(page, wait, contentId) {
    await tidy(page);
    await page.locator(`[id="sidebar-launcher-${contentId}"]`).click();
    await panel(page).waitFor();
    await wait(600);
}

/** Opens the Field panel (#824) from the sidebar, on its Setup tab, and waits for it */
async function openFieldPanel(page, wait) {
    await tidy(page);
    await page.locator("#sidebar-launcher-field").click();
    await page.getByTestId("field-edit-panel").waitFor();
    await wait(800);
}

/** Opens the Field panel on its Lines tab (the mode for lines), and waits for it */
async function editField(page, wait) {
    await openFieldPanel(page, wait);
    await page.getByTestId("field-tab-lines").click();
    await page.waitForFunction(() => window.fieldTest?.fieldEdit?.() != null);
    await wait(800);
}

/** The mode's lines (window.fieldTest.fieldEdit()), X side 1 to side 2 then Y front to back */
const fieldLines = (page) =>
    page.evaluate(() => window.fieldTest.fieldEdit().lines);

/** Two neighboring X lines on side 2, the second and third out from the center */
async function sideTwoPair(page) {
    const xs = (await fieldLines(page))
        .filter((l) => l.axis === "x" && l.steps > 0)
        .sort((a, b) => a.steps - b.steps);
    return [xs[1], xs[2]];
}

/** Where the back of the field (the backmost Y line) is drawn on screen, window points */
async function backEdgeY(page) {
    const ys = (await fieldLines(page)).filter((l) => l.axis === "y");
    return Math.min(...ys.map((l) => l.screen.y));
}

/** The field's pane: the rulers and the field, beside the Field panel */
async function fieldPane(page) {
    const field = await page.locator("canvas").first().boundingBox();
    return {
        x: field.x - 4,
        y: field.y - 4,
        width: field.width + 8,
        height: field.height + 8,
    };
}

/** Pages forward from the first for the step size warning picture */
const STEP_WARNING_PAGES = 5;
/** A threshold low enough that the demo's moves on that page go over it */
const STEP_WARNING_INCHES = "9";

/** Lowers the step limit, closes the Field panel and goes to the page whose moves break it. */
async function stepWarningsPage(page, wait) {
    await wait(3000);
    await openFieldPanel(page, wait);
    const input = page.getByTestId("field-step-warning");
    await input.fill(STEP_WARNING_INCHES);
    await input.press("Enter");
    await wait(600);
    await page.getByTestId("field-edit-done").click();
    await wait(600);
    for (let i = 0; i < STEP_WARNING_PAGES; i++) {
        await page.keyboard.press("KeyE");
        await wait(500);
    }
    await wait(1500);
}

/** A box around the marchers whose labels match, grown by `pad` (window points). */
async function aroundMarchers(page, labels, pad) {
    const pts = (await page.evaluate(() => window.fieldTest.marchers())).filter(
        (m) => labels.test(m.label),
    );
    if (pts.length === 0) throw new Error(`no marchers match ${labels}`);
    const xs = pts.map((m) => m.screen.x);
    const ys = pts.map((m) => m.screen.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return {
        x,
        y,
        width: Math.max(...xs) + pad - x,
        height: Math.max(...ys) + pad - y,
    };
}

const shots = [
    {
        id: "field-edit-mode",
        kind: "still",
        // The Lines tab beside the field: the list and the picked line's Line section, the rulers,
        // the hint and the dimmed drill (the window's toolbar, inspector and timeline cut away)
        async setup({ page, wait, union }) {
            await wait(3000);
            await editField(page, wait);
            const [line] = await sideTwoPair(page);
            await page.mouse.click(line.screen.x, line.screen.y);
            await page.mouse.move(800, 990);
            await wait(600);
            const panelBox = await page
                .getByTestId("field-edit-panel")
                .boundingBox();
            const field = await fieldPane(page);
            const b = union(panelBox, field);
            return {
                box: {
                    x: b.x - 6,
                    y: b.y - 6,
                    width: b.width + 12,
                    height: b.height + 12,
                },
            };
        },
    },
    {
        id: "field-ruler-drag",
        kind: "clip",
        // A line dragged out of the top ruler between two yard lines; its twin comes with it
        // Cropped to the top ruler and the top of the field, from side 1's 35 to past side 2's 30
        async setup({ page, wait }) {
            await wait(3000);
            await editField(page, wait);
            await page.mouse.move(800, 990);
            await wait(400);
            const field = await fieldPane(page);
            const xs = (await fieldLines(page))
                .filter((l) => l.axis === "x")
                .sort((p, q) => p.steps - q.steps);
            const at = (steps) => xs.find((l) => l.steps === steps).screen.x;
            const left = at(-24) - 40;
            const right = at(32) + 260;
            return {
                box: {
                    x: left,
                    y: field.y,
                    width: right - left,
                    height: (await backEdgeY(page)) + 160 - field.y,
                },
            };
        },
        async perform({ page, film, overlay }) {
            await overlay.enable();
            const [a, b] = await sideTwoPair(page);
            const from = { x: (a.tab.x + b.tab.x) / 2 + 2, y: a.tab.y };
            await page.mouse.move(from.x, from.y + 160);
            await film.moveTo(page, { x: from.x, y: from.y + 160 }, from, 0.6);
            await film.hold(0.3);
            const to = { x: from.x, y: (await backEdgeY(page)) + 110 };
            await film.drag(page, from, to, 1.6);
            await film.hold(1.2);
        },
    },
    {
        id: "field-line-detail",
        kind: "still",
        // The Lines tab's Line section for a picked yard line: its values, all changed here
        async setup({ page, wait, around }) {
            await wait(3000);
            await editField(page, wait);
            const [line] = await sideTwoPair(page);
            await page.mouse.click(line.screen.x, line.screen.y);
            await page.mouse.move(800, 990);
            const detail = page.getByTestId("field-line-detail");
            await detail.getByTestId("field-line-position").waitFor();
            await wait(500);
            return { box: await around(detail, 8) };
        },
    },
    {
        id: "field-inspector",
        kind: "still",
        // The Field panel as it opens: Done and X, the tabs, and Setup (template, size, names)
        async setup({ page, wait, around }) {
            await wait(3000);
            await openFieldPanel(page, wait);
            await page.mouse.move(800, 990);
            await wait(500);
            return {
                box: await around(page.getByTestId("field-edit-panel"), 6),
            };
        },
    },
    {
        id: "field-template",
        kind: "still",
        // Another template picked: the sheet says what changes before it switches
        async setup({ page, wait, around }) {
            await wait(3000);
            await openFieldPanel(page, wait);
            await page.getByTestId("field-template-select").click();
            await page
                .getByRole("option", { name: "Indoor 50x70 - 24-inch steps" })
                .click();
            const dialog = page.getByRole("alertdialog");
            await dialog.waitFor();
            await wait(600);
            return { box: await around(dialog, 8) };
        },
    },
    {
        id: "field-step-warnings",
        kind: "still",
        // Warnings are off until turned on in Settings › Field
        uiSettings: { stepSizeWarnings: true },
        // The threshold lowered so this page's long moves show in red; cropped to a few guard
        // marchers (G19 to G25) so the dashed red paths read
        async setup({ page, wait }) {
            await stepWarningsPage(page, wait);
            return { box: await aroundMarchers(page, /^G(19|2[0-5])$/, 40) };
        },
    },
    {
        id: "field-step-inspector",
        kind: "still",
        uiSettings: { stepSizeWarnings: true },
        // Guard marchers selected: the inspector's step sizes, the largest with its red warning icon
        async setup({ page, wait }) {
            await stepWarningsPage(page, wait);
            const guard = (
                await page.evaluate(() => window.fieldTest.marchers())
            ).filter((m) => /^G(19|2[0-5])$/.test(m.label));
            await page.mouse.click(guard[0].screen.x, guard[0].screen.y);
            await page.keyboard.down("Shift");
            for (const m of guard.slice(1))
                await page.mouse.click(m.screen.x, m.screen.y);
            await page.keyboard.up("Shift");
            await page.mouse.move(800, 990);
            await wait(800);
            // The marcher section is under Arrange and the page: scroll the inspector to it
            const label = page.getByText("Largest step size").first();
            await label.waitFor();
            await label.scrollIntoViewIfNeeded();
            await wait(500);
            const l = await label.boundingBox();
            const smallest = await page
                .getByText("Smallest step size")
                .first()
                .boundingBox();
            const top = (smallest ?? l).y - 16;
            return {
                box: {
                    x: l.x - 16,
                    y: top,
                    width: 320,
                    height: l.y + l.height + 30 - top,
                },
            };
        },
    },
    {
        id: "field-show-settings",
        kind: "still",
        // The whole panel: the show's details, the numbers, Performer defaults and the buttons
        async setup({ page, wait, around }) {
            await wait(3000);
            await openPanel(page, wait, "workspace-settings");
            await page.mouse.move(800, 990);
            return { box: await around(panel(page), 4) };
        },
    },
    {
        id: "field-appearance",
        kind: "still",
        // The Field panel's Appearance tab: markings and labels, the background image, colors
        async setup({ page, wait, around }) {
            await wait(3000);
            await openFieldPanel(page, wait);
            await page.getByTestId("field-tab-appearance").click();
            await wait(800);
            await page.mouse.move(800, 990);
            return {
                box: await around(page.getByTestId("field-edit-panel"), 6),
            };
        },
    },
];

export default shots;
