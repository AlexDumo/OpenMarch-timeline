// The music chapter (guides/music/*).
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPO_SHOW = "scripts/docs-media/shows/music-tempo.dots";
/** A score with repeats, a D.S. al Coda written in words, and no problems otherwise */
const SCORE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../packages/musicxml-parser/src/__test__/corpus/files/scorewriter-comparison/Finale/RepeatsTest/RepeatsTest Finale.musicxml",
);

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

async function box(locator) {
    const b = await locator.boundingBox();
    if (!b) throw new Error(`not on screen: ${locator}`);
    return b;
}

/** Turns Edit music on and waits for its lanes. */
async function editMusic(page, wait) {
    await tidy(page);
    await page.getByTestId("timeline-tempo-mode").click();
    await page.getByTestId("tempo-band").waitFor();
    await wait(1200);
}

/** The timeline pane, where Edit music's lanes are. */
const pane = (page) => page.getByTestId("timeline-pane");

/** The pane cut to its left part (measures 1 to about 10), so it shows near full size on the page. */
async function leftOfPane(page, around, width = 860) {
    const b = await around(pane(page), 4);
    return { ...b, width: Math.min(b.width, width) };
}

/** The tempo band's box, its pixels per count, and the x of the left edge of count `beat` (1-based). */
async function bandGeometry(page) {
    const band = page.getByTestId("tempo-band");
    const b = await box(band);
    const ppb = Number(await band.getAttribute("data-ppb"));
    return { band: b, ppb, xOfBeat: (beat) => b.x + (beat - 1) * ppb };
}

/** The band's first tempo label (♩118) and where its line is. */
async function tempoLine(page) {
    const label = await box(page.getByTestId("tempo-label").first());
    return { x: label.x, y: label.y + label.height + 2 };
}

const shots = [
    {
        id: "music-edit-music",
        kind: "still",
        show: TEMPO_SHOW,
        // Measures 1 to 10: the header's left half and the four lanes, with the ramp and the jump
        async setup({ page, wait, around }) {
            await wait(3000);
            await editMusic(page, wait);
            await page.mouse.move(800, 200);
            return { box: await leftOfPane(page, around) };
        },
    },
    {
        id: "music-timeline-waveform",
        kind: "still",
        show: TEMPO_SHOW,
        // The ordinary timeline: pages, counts, measures and the music's waveform, first two pages
        async setup({ page, wait, around }) {
            await wait(3000);
            await tidy(page);
            await page.mouse.move(800, 200);
            return { box: await leftOfPane(page, around, 780) };
        },
    },
    {
        id: "music-file-menu",
        kind: "still",
        show: TEMPO_SHOW,
        async setup({ page, wait, union }) {
            await wait(3000);
            await editMusic(page, wait);
            await page.getByTestId("tempo-music-file").click();
            const menu = page.getByTestId("tempo-music-menu");
            await menu.waitFor();
            await wait(500);
            const header = await box(page.getByTestId("tempo-mode-header"));
            const m = await box(menu);
            const b = union(
                { x: header.x, y: header.y, width: 520, height: header.height },
                m,
            );
            return {
                box: {
                    x: b.x - 8,
                    y: b.y - 8,
                    width: b.width + 16,
                    height: b.height + 16,
                },
            };
        },
    },
    {
        id: "music-tempo-drag",
        kind: "clip",
        show: TEMPO_SHOW,
        // The first tempo stretch's line dragged from ♩118 up
        async setup({ page, wait, around }) {
            await wait(3000);
            await editMusic(page, wait);
            await page.mouse.move(800, 200);
            return { box: await leftOfPane(page, around) };
        },
        async perform({ page, film, overlay }) {
            await overlay.enable();
            const line = await tempoLine(page);
            const at = { x: line.x + 160, y: line.y };
            await film.moveTo(page, { x: at.x + 200, y: at.y - 120 }, at, 0.6);
            await film.hold(0.3);
            await film.drag(page, at, { x: at.x, y: at.y - 24 }, 1.2);
            await film.hold(1.5);
        },
    },
    {
        id: "music-count-menu",
        kind: "still",
        show: TEMPO_SHOW,
        // A count made a hold, then right-clicked again: Hold length… and Not a hold, over the
        // tempo line's gap and the fermata sign
        async setup({ page, wait, union }) {
            await wait(3000);
            await editMusic(page, wait);
            const line = await tempoLine(page);
            const at = { x: line.x + 330, y: line.y + 20 };
            await page.mouse.click(at.x, at.y, { button: "right" });
            const menu = page.getByTestId("tempo-menu");
            await menu.waitFor();
            await menu.getByText("Make a hold (fermata)").click();
            await menu.waitFor({ state: "hidden" });
            // The band redraws from the saved tempo: wait until it lists the hold
            await page.waitForFunction(
                () =>
                    document
                        .querySelector('[data-testid="tempo-band"]')
                        ?.getAttribute("data-holds") !== "",
            );
            await wait(1500);
            await page.mouse.click(at.x, at.y, { button: "right" });
            await menu.getByText("Not a hold").waitFor();
            await wait(500);
            const band = await box(page.getByTestId("tempo-band"));
            const m = await box(menu);
            const left = Math.max(band.x, Math.min(at.x, m.x) - 200);
            const b = union({ x: left, y: band.y, width: 1, height: 130 }, m);
            return {
                box: {
                    x: b.x - 4,
                    y: b.y - 8,
                    width: b.width + 24,
                    height: b.height + 16,
                },
            };
        },
    },
    {
        id: "music-count-ask",
        kind: "still",
        show: TEMPO_SHOW,
        // Add a count after…: the box asks what happens to everything after it
        async setup({ page, wait, union }) {
            await wait(3000);
            await editMusic(page, wait);
            const line = await tempoLine(page);
            const at = { x: line.x + 250, y: line.y + 20 };
            await page.mouse.click(at.x, at.y, { button: "right" });
            const menu = page.getByTestId("tempo-menu");
            await menu.waitFor();
            await menu.getByText("Add a count after…").click();
            const ask = page.getByTestId("tempo-count-ask");
            await ask.waitFor();
            await page.mouse.move(at.x, at.y + 300);
            await wait(600);
            const band = await box(page.getByTestId("tempo-band"));
            const a = await box(ask);
            const left = Math.max(band.x, Math.min(at.x, a.x) - 120);
            const b = union({ x: left, y: band.y, width: 1, height: 130 }, a);
            return {
                box: {
                    x: b.x - 4,
                    y: b.y - 8,
                    width: b.width + 24,
                    height: b.height + 16,
                },
            };
        },
    },
    {
        id: "music-gradual",
        kind: "clip",
        show: TEMPO_SHOW,
        // A jump from ♩118 to a faster tempo at measure 4 turned into a ramp with the square end
        // dot, then bent with the round handle in its middle
        async setup({ page, wait }) {
            await wait(3000);
            await editMusic(page, wait);
            const { band, ppb, xOfBeat } = await bandGeometry(page);
            const line = await tempoLine(page);
            // A tempo change at measure 4 (count 13), then that stretch dragged faster: a jump
            await page.mouse.dblclick(xOfBeat(13) + ppb / 2, line.y + 30);
            await wait(800);
            const from = { x: xOfBeat(17) + ppb / 2, y: line.y };
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x, from.y - 12, { steps: 4 });
            await page.mouse.move(from.x, from.y - 26, { steps: 6 });
            await page.mouse.up();
            await wait(800);
            await page.mouse.move(xOfBeat(30), band.y + 300);
            await wait(400);
            return {
                box: {
                    x: band.x - 60,
                    y: band.y - 4,
                    width: 24 * ppb + 60,
                    height: 42 + 76 + 10,
                },
            };
        },
        async perform({ page, film, overlay }) {
            await overlay.enable();
            const { ppb, xOfBeat } = await bandGeometry(page);
            const line = await tempoLine(page);
            // The square dot on the first stretch's last count (count 12)
            const end = { x: xOfBeat(12) + ppb / 2, y: line.y };
            await film.moveTo(
                page,
                { x: end.x - 120, y: end.y + 50 },
                { x: end.x - 40, y: end.y },
                0.5,
            );
            await film.moveTo(page, { x: end.x - 40, y: end.y }, end, 0.4);
            await film.hold(0.4);
            // Drag it up a pixel a frame until it catches at the next tempo (the drag tag reads it)
            const target = await page
                .getByTestId("tempo-label")
                .nth(1)
                .innerText();
            const bpm = target.replace(/[^0-9.]/g, "");
            await page.mouse.down();
            let dy = 0;
            for (; dy < 80; dy++) {
                await page.mouse.move(end.x, end.y - dy);
                await film.frame();
                const tag = await page
                    .getByTestId("tempo-drag-tag")
                    .first()
                    .innerText()
                    .catch(() => "");
                if (dy > 4 && tag.replace(/[^0-9.]/g, "") === bpm) break;
            }
            await film.hold(0.4);
            await page.mouse.up();
            await film.hold(0.8);
            // The ramp's round handle, in its middle (counts 1 to 12: x of count 7), bent down
            const top = end.y - dy;
            const mid = { x: xOfBeat(7), y: (end.y + top) / 2 };
            await film.moveTo(page, { x: end.x, y: top }, mid, 0.6);
            await film.hold(0.4);
            await film.drag(page, mid, { x: mid.x, y: mid.y + 12 }, 0.8);
            await film.hold(1.4);
        },
    },
    {
        id: "music-add",
        kind: "still",
        show: TEMPO_SHOW,
        // Edit music in a show with no music yet: Add music… in the header
        async setup({ page, wait, union }) {
            await wait(3000);
            await editMusic(page, wait);
            await page.getByTestId("tempo-music-file").click();
            await page.getByTestId("tempo-music-delete").click();
            await page.getByTestId("tempo-music-delete-confirm").click();
            await page.getByTestId("tempo-add-music").waitFor();
            await page.mouse.move(800, 200);
            await tidy(page);
            await wait(800);
            const header = await box(page.getByTestId("tempo-mode-header"));
            return {
                box: {
                    x: header.x - 4,
                    y: header.y - 4,
                    width: 640,
                    height: header.height + 8,
                },
            };
        },
    },
    {
        id: "music-time-signature",
        kind: "still",
        show: TEMPO_SHOW,
        // A time signature chip's menu, with the chip and the measures lane beside it
        async setup({ page, wait, union }) {
            await wait(3000);
            await editMusic(page, wait);
            const chipAt = page.getByTitle(/^Time signature 2\/4/).first();
            const chip = await box(chipAt);
            await chipAt.click();
            const menu = page.getByTestId("tempo-menu");
            await menu.waitFor();
            await wait(500);
            const m = await box(menu);
            const left = Math.min(chip.x, m.x) - 140;
            const b = union(
                { x: left, y: chip.y, width: 1, height: chip.height + 8 },
                m,
            );
            return {
                box: {
                    x: b.x - 4,
                    y: b.y - 8,
                    width: b.width + 24,
                    height: b.height + 16,
                },
            };
        },
    },
    {
        id: "music-import-score",
        kind: "still",
        show: TEMPO_SHOW,
        // Import › MusicXML score… asks before anything changes
        async setup({ page, wait, around }) {
            await wait(3000);
            await editMusic(page, wait);
            await page.getByTestId("tempo-import").click();
            await page.getByTestId("tempo-import-score").click();
            const dialog = page.getByRole("alertdialog");
            await dialog.waitFor();
            await wait(600);
            return { box: await around(dialog, 12) };
        },
    },
    {
        id: "music-import-checks",
        kind: "still",
        show: TEMPO_SHOW,
        // A score with repeats and a jump written in words: the things to check after import
        async setup({ page, wait, around }) {
            await wait(3000);
            await editMusic(page, wait);
            await page
                .locator('input[type="file"][accept*="musicxml"]')
                .setInputFiles(SCORE);
            const show = page
                .locator("[data-sonner-toast]")
                .getByRole("button", { name: "Show", exact: true });
            await show.waitFor({ timeout: 20000 });
            await show.click();
            const dialog = page.getByRole("dialog");
            await dialog.waitFor();
            await wait(800);
            return { box: await around(dialog, 12) };
        },
    },
    {
        id: "music-sound",
        kind: "still",
        show: TEMPO_SHOW,
        // The timeline's Sound button with the metronome on (the dot on the button): mute, volume
        // and the metronome
        async setup({ page, wait, union }) {
            await wait(3000);
            await tidy(page);
            await page.keyboard.press("Control+KeyM");
            await wait(400);
            const button = page.getByTestId("timeline-sound");
            await button.click();
            await wait(600);
            const pop = page
                .locator("[data-radix-popper-content-wrapper]")
                .last();
            const b = union(await box(button), await box(pop));
            return {
                box: {
                    x: b.x - 12,
                    y: b.y - 12,
                    width: b.width + 24,
                    height: b.height + 24,
                },
            };
        },
    },
];

export default shots;
