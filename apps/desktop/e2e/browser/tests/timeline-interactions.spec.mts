import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures.mjs";
import { drawnMarchers, readField, waitForField } from "../app.mjs";
import { goToPage, isolate, pageBox, splitMoveIntoClip } from "../timeline.mjs";

// The timeline's interactions on the field (#202; #189 user stories 18, 20,
// 59): Escape leaving isolation (and when it doesn't, as with the shape tool
// open). The first press
// after a paused preview (story 60) is `paused-preview.spec.mts`. What #201
// already pinned (a click on a dimmed marcher selects nothing; Escape with
// nobody selected leaves isolation) is in `timeline-visuals.spec.mts`.
//
// Escape during a clip move or resize belongs to the gesture, not to
// isolation. That rule is the timeline's alone, and the demo's moves are page
// moves, which have no clip: it's pinned by `TimelineClipResize.test.tsx`
// ("while a resize or move runs, Esc belongs to it, not to isolation").
//
// The "change:" scenarios are the rules-table changes decided in #189.
//
// Selecting a move's clip parks the playhead on its end, where the line is
// painted over the clip's end handle: the selected clip's end takes a mouse's
// press there (#593), and the playhead's line still takes it everywhere else.

const desktop = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

const isolationBar = (page: Page) => page.getByTestId("timeline-isolation-bar");

/**
 * Selects every marcher that can be selected, and waits for `count` of them
 * on the field and in the inspector: keys like B act on the app's
 * selection, which reaches the app's state a render after the field's.
 */
async function selectAll(page: Page, count: number) {
    await page.keyboard.press("ControlOrMeta+a");
    await expect
        .poll(async () => (await readField(page)).selection.length)
        .toBe(count);
    await expect(
        page.getByText(new RegExp(`^${count} Marchers$`)).first(),
    ).toBeVisible();
}

// A converted demo show: every page is a move. The move over the page box
// that starts at beat 53 has 4 of the 95 marchers; the others follow there.
test.use({
    showFile: path.join(desktop, "view3d-web/public/demos/part1-demo.dots"),
});

/** Isolates the 4-marcher move at beat 53 and selects its marchers. */
async function isolateAndSelect(page: Page) {
    await waitForField(page);
    await isolate(page, 53);
    await expect
        .poll(
            async () =>
                (await drawnMarchers(page)).filter((m) => !m.dimmed).length,
        )
        .toBe(4);
    await selectAll(page, 4);
}

test("Escape leaves isolation with marchers selected, in one press", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("Escape");
    await expect(isolationBar(page)).toBeHidden();
    await expect
        .poll(async () => (await drawnMarchers(page)).some((m) => m.dimmed))
        .toBe(false);
});

test("Escape in isolation with the shape tool open only closes the tool", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("b");
    await expect(page.getByTestId("shape-tool-hint")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shape-tool-hint")).toBeHidden();
    await page.waitForTimeout(300);
    await expect(isolationBar(page)).toBeVisible();
    // The tool keeps the selection; the next Escape leaves
    expect((await readField(page)).selection).toHaveLength(4);
    await page.keyboard.press("Escape");
    await expect(isolationBar(page)).toBeHidden();
});

test("Escape in isolation with a dialog open only closes the dialog", async ({
    show,
}) => {
    const { page } = show;
    await isolateAndSelect(page);
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    await expect(isolationBar(page)).toBeVisible();
});

test.describe("the selected clip's end under the playhead (#593)", () => {
    test.use({
        appSettings: { optOutAnalytics: true, editorMode: "expert" },
        allowedPageErrors: [/Audio worklet error/],
        initScript: "localStorage.setItem('openmarch:inputMode', 'mouse');",
    });

    const playheadLine = (page: Page) => page.getByTestId("timeline-playhead");
    const playheadAt = (page: Page) =>
        playheadLine(page).getAttribute("aria-label");
    const centerX = async (page: Page) => {
        const box = (await playheadLine(page).boundingBox())!;
        return box.x + box.width / 2;
    };

    test("a drag on the end resizes the move; the line is still dragged off the clip's row", async ({
        show,
    }) => {
        const { page } = show;
        await waitForField(page);
        await goToPage(page, 53);
        const clip = await splitMoveIntoClip(show, 53);
        // Zoomed in, so the clip is wide and its end handle is 6 px
        const view = (await page
            .getByTestId("timeline-viewport")
            .boundingBox())!;
        await page.mouse.move(
            view.x + view.width / 2,
            view.y + view.height / 2,
        );
        await page.keyboard.down("Control");
        for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
        await page.keyboard.up("Control");
        await expect
            .poll(async () => (await pageBox(page, 53).boundingBox())!.width)
            .toBeGreaterThan(160);
        await clip.evaluate((el) =>
            el.scrollIntoView({ block: "nearest", inline: "center" }),
        );
        await page.waitForTimeout(200);
        await clip.click();
        await expect(clip).toHaveAttribute("data-selected", "true");
        const box = (await clip.boundingBox())!;
        const y = box.y + box.height / 2;
        const end = box.x + box.width;
        // Selecting it parked the playhead on its end, over the end handle
        expect(Math.abs((await centerX(page)) - end)).toBeLessThan(2);
        const playhead = await playheadAt(page);
        await page.mouse.move(end - 2, y);
        await page.mouse.down();
        await page.mouse.move(end + 40, y, { steps: 6 });
        await expect(
            page.getByTestId("timeline-clip-resize-tag"),
        ).toBeVisible();
        expect(await playheadAt(page), "the playhead stayed").toBe(playhead);
        await page.mouse.up();
        await expect(page.getByTestId("timeline-clip-resize-tag")).toBeHidden();
        await expect
            .poll(async () => (await clip.boundingBox())!.width)
            .toBeGreaterThan(box.width + 20);
        await expect(clip).toHaveAttribute("data-selected", "true");
        // The playhead followed the new end. Above the clip rows, at that count, its line drags it
        await expect
            .poll(async () => {
                const now = (await clip.boundingBox())!;
                return Math.abs((await centerX(page)) - (now.x + now.width));
            })
            .toBeLessThan(2);
        const moved = await playheadAt(page);
        const header = (await page
            .getByTestId("timeline-pinned-header")
            .boundingBox())!;
        const above = header.y + header.height - 4;
        const line = await centerX(page);
        await page.mouse.move(line, above);
        await page.mouse.down();
        await page.mouse.move(line + 60, above, { steps: 6 });
        await page.mouse.up();
        await expect.poll(() => playheadAt(page)).not.toBe(moved);
        await expect(page.getByTestId("timeline-clip-resize-tag")).toBeHidden();
    });
});
