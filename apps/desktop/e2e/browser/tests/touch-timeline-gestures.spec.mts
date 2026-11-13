import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CDPSession, Locator, Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    FINGERTIP_WIDTH,
    drawnMarchers,
    pinch,
    touchDrag,
    twoFingerPan,
    waitForField,
} from "../app.mjs";
import { goToPage, pageBox } from "../timeline.mjs";

// Fingers on the timeline (tablet plan 3.1, fork #884): the ruler and the page
// row scrub with one finger; on the track body one finger on a clip moves it
// and on empty space pans; two fingers pan and pinch anywhere; a second finger
// cancels a drag and puts back what it was dragging. A mouse presses as it
// always has (the last test, and every timeline scenario).

const desktop = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

// A converted demo show: every page is a move. The move over the page box
// that starts at beat 53 has 4 of the 95 marchers.
test.use({
    showFile: path.join(desktop, "view3d-web/public/demos/part1-demo.dots"),
    appSettings: { optOutAnalytics: true, editorMode: "expert" },
    // The time-stretch worklet (#216) can't load in the harness (see props.spec.mts)
    allowedPageErrors: [/Audio worklet error/],
    // A touch screen, in the touch layout
    touchScreen: true,
    initScript: "localStorage.setItem('openmarch:inputMode', 'touch');",
});

const PAGE_START = 53;

type Point = { x: number; y: number };

const viewport = (page: Page) => page.getByTestId("timeline-viewport");

/** The playhead's spoken position (its accessible name), which changes with its beat */
const playheadAt = (page: Page) =>
    page.getByTestId("timeline-playhead").getAttribute("aria-label");

const scroll = (page: Page) =>
    viewport(page).evaluate((el) => ({
        left: el.scrollLeft,
        top: el.scrollTop,
        width: el.scrollWidth,
    }));

const centerOf = async (locator: Locator): Promise<Point> => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Zooms the timeline in with the mouse (Ctrl+wheel), so it can scroll sideways. */
async function zoomIn(page: Page) {
    const at = await centerOf(viewport(page));
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect
        .poll(async () =>
            viewport(page).evaluate(
                (el) => el.scrollWidth > el.clientWidth * 2,
            ),
        )
        .toBe(true);
}

/**
 * A point on bare track space: below the pinned ruler and page row, above the
 * scrollbar, and away from the playhead's line.
 */
async function bareTrack(page: Page): Promise<Point> {
    const view = (await viewport(page).boundingBox())!;
    const header = (await page
        .getByTestId("timeline-pinned-header")
        .boundingBox())!;
    const bottom = view.y + view.height - 18;
    const top = header.y + header.height;
    expect(bottom - top, "the track body is on screen").toBeGreaterThan(16);
    const playhead = await centerOf(page.getByTestId("timeline-playhead"));
    const x =
        Math.abs(playhead.x - (view.x + view.width / 3)) > 80
            ? view.x + view.width / 3
            : view.x + (view.width * 2) / 3;
    return { x, y: (top + bottom) / 2 };
}

/**
 * Touches the screen through CDP in phases, so the test can look in between:
 * `start` puts the fingers down, each `move` moves them (a new finger in a
 * later step lands then), and `end` lifts them all.
 */
async function fingers(page: Page) {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const send = (
        type: "touchStart" | "touchMove" | "touchEnd",
        points: Point[],
    ) =>
        cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: points.map((p, id) => ({
                x: p.x,
                y: p.y,
                radiusX: FINGERTIP_WIDTH / 2,
                radiusY: FINGERTIP_WIDTH / 2,
                force: 1,
                id,
            })),
        });
    let down = 0;
    return {
        /** Moves the fingers to `points`; a finger past the ones down lands */
        async to(...points: Point[]) {
            await send(
                points.length > down ? "touchStart" : "touchMove",
                points,
            );
            down = points.length;
        },
        /** Drags the first finger from `from` by `dx` in `steps` moves */
        async drag(from: Point, dx: number, steps = 8) {
            for (let i = 1; i <= steps; i++)
                await this.to({ x: from.x + (dx * i) / steps, y: from.y });
        },
        async end() {
            await send("touchEnd", []);
            await cdp.detach();
        },
    };
}

/** Every stored move's start beat, by id */
const moveStarts = async (query: Show["query"]) =>
    Object.fromEntries(
        (
            await query<{ id: number; start: number }>(
                "SELECT id, start_beat AS start FROM timelines ORDER BY id",
            )
        ).map((r) => [r.id, r.start]),
    );

/** Splits one of the beat-53 move's marchers into a new move, which has a clip; returns it */
async function splitIntoClip(show: Show): Promise<Locator> {
    const { page, query } = show;
    const before = await moveStarts(query);
    const marcher = (await drawnMarchers(page)).find(
        (m) => m.onScreen && !m.dimmed,
    )!;
    await page.mouse.click(marcher.screen.x, marcher.screen.y);
    await expect
        .poll(() => page.evaluate(() => window.fieldTest!.selection()))
        .toEqual([marcher.id]);
    await expect(async () => {
        await pageBox(page, PAGE_START).click({ button: "right" });
        await page
            .getByRole("menuitem", { name: /^Split 1 selected into new move/ })
            .click({ timeout: 1000 });
    }).toPass();
    await expect
        .poll(async () => Object.keys(await moveStarts(query)).length)
        .toBe(Object.keys(before).length + 1);
    const splitId = Math.max(
        ...Object.keys(await moveStarts(query)).map(Number),
    );
    await expect(page.getByTestId("timeline-isolation-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-isolation-bar")).toBeHidden();
    const clip = page.locator(
        `[data-testid="timeline-clip"][data-move-id="${splitId}"]`,
    );
    await expect(clip).toBeVisible();
    return clip;
}

test.beforeEach(async ({ show }) => {
    await waitForField(show.page);
    await goToPage(show.page, PAGE_START);
});

test("one finger on bare track space pans the timeline and leaves the playhead", async ({
    show,
}) => {
    const { page } = show;
    await zoomIn(page);
    const before = await playheadAt(page);
    const from = await bareTrack(page);
    const start = await scroll(page);
    // Pan towards the end of the show, which is wider than the view
    await touchDrag(page, from, { x: from.x - 200, y: from.y });
    await expect
        .poll(async () => (await scroll(page)).left - start.left)
        .toBeGreaterThan(150);
    expect(await playheadAt(page)).toBe(before);
});

test("one finger along the page row scrubs the playhead", async ({ show }) => {
    const { page } = show;
    const before = await playheadAt(page);
    const box = await centerOf(pageBox(page, PAGE_START));
    const start = await scroll(page);
    await touchDrag(page, box, { x: box.x + 120, y: box.y });
    await expect.poll(() => playheadAt(page)).not.toBe(before);
    // It scrubbed; it didn't pan
    expect((await scroll(page)).left).toBe(start.left);
});

test("two fingers pan anywhere, the page row too, without scrubbing", async ({
    show,
}) => {
    const { page } = show;
    await zoomIn(page);
    const before = await playheadAt(page);
    const start = await scroll(page);
    const box = await centerOf(pageBox(page, PAGE_START));
    await twoFingerPan(page, box, { x: -200, y: 0 });
    await expect
        .poll(async () => (await scroll(page)).left - start.left)
        .toBeGreaterThan(150);
    expect(await playheadAt(page)).toBe(before);
});

test("two fingers pinch the timeline's zoom", async ({ show }) => {
    const { page } = show;
    const before = await playheadAt(page);
    const width = (await scroll(page)).width;
    const at = await bareTrack(page);
    await pinch(page, at, { from: 30, to: 150 });
    await expect
        .poll(async () => (await scroll(page)).width)
        .toBeGreaterThan(width * 2);
    expect(await playheadAt(page)).toBe(before);
});

test("a second finger cancels a finger's scrub and puts the playhead back", async ({
    show,
}) => {
    const { page } = show;
    const before = await playheadAt(page);
    const box = await centerOf(pageBox(page, PAGE_START));
    const touch = await fingers(page);
    await touch.to(box);
    await touch.drag(box, 120);
    await expect.poll(() => playheadAt(page)).not.toBe(before);
    // A second finger lands, and the two move a little
    await touch.to(
        { x: box.x + 120, y: box.y },
        { x: box.x + 260, y: box.y + 40 },
    );
    await touch.to(
        { x: box.x + 110, y: box.y },
        { x: box.x + 250, y: box.y + 40 },
    );
    await touch.end();
    await expect.poll(() => playheadAt(page)).toBe(before);
});

test("one finger on a clip moves it", async ({ show }) => {
    const { page, query } = show;
    const clip = await splitIntoClip(show);
    const id = Number(await clip.getAttribute("data-move-id"));
    const before = (await moveStarts(query))[id];
    const playhead = await playheadAt(page);
    const from = await centerOf(clip);
    await touchDrag(page, from, { x: from.x + 120, y: from.y });
    await expect
        .poll(async () => (await moveStarts(query))[id])
        .toBeGreaterThan(before);
    // The finger moved the clip, not the playhead
    expect(await playheadAt(page)).toBe(playhead);
});

test("a second finger cancels a clip's move and puts it back, with nothing saved", async ({
    show,
}) => {
    const { page, query } = show;
    const clip = await splitIntoClip(show);
    const before = await moveStarts(query);
    const left = (await clip.boundingBox())!.x;
    const from = await centerOf(clip);
    const touch = await fingers(page);
    await touch.to(from);
    await touch.drag(from, 120);
    await expect
        .poll(async () => (await clip.boundingBox())!.x)
        .toBeGreaterThan(left + 40);
    await touch.to(
        { x: from.x + 120, y: from.y },
        { x: from.x + 260, y: from.y - 40 },
    );
    await touch.to(
        { x: from.x + 110, y: from.y },
        { x: from.x + 250, y: from.y - 40 },
    );
    await touch.end();
    await expect
        .poll(async () => (await clip.boundingBox())!.x)
        .toBeCloseTo(left, 0);
    expect(await moveStarts(query)).toEqual(before);
});

test("a mouse drag on bare track space still scrubs", async ({ show }) => {
    const { page } = show;
    const before = await playheadAt(page);
    const from = await bareTrack(page);
    const start = await scroll(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 150, from.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => playheadAt(page)).not.toBe(before);
    expect((await scroll(page)).left).toBe(start.left);
});
