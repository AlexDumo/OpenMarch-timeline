// @vitest-environment jsdom
/**
 * The "Preparing your file…" overlay (P9.3, P9.8, P9.9). It is drawn in the
 * main window's page through `executeJavaScript`; these tests run its scripts
 * against jsdom in place of that page, with a fake window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    describePreparingProgress,
    hidePreparingOverlay,
    PREPARING_OVERLAY_ID,
    showPreparingOverlay,
    showPreparingProgress,
    throttleProgress,
    type PreparingTarget,
} from "../preparingOverlay";

/** A main window whose page is this jsdom document. */
function fakeMainWindow(
    executeJavaScript: (code: string) => Promise<unknown> = async (code) =>
        // eslint-disable-next-line no-eval
        (0, eval)(code) as unknown,
) {
    const state = { destroyed: false, progress: [] as number[] };
    const target: PreparingTarget = {
        setProgressBar: (p) => state.progress.push(p),
        isDestroyed: () => state.destroyed,
        webContents: { executeJavaScript },
    };
    return { target, state };
}

const overlay = () => document.getElementById(PREPARING_OVERLAY_ID);
const text = (id: string) => document.getElementById(id)?.textContent;

beforeEach(() => {
    document.body.innerHTML =
        '<div id="root"><button id="app-button">Open</button></div><div id="portal" inert></div>';
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
        setTimeout(cb, 0),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("showPreparingOverlay (P9.9)", () => {
    it("covers the page, makes the rest of it inert, and waits for it to paint", async () => {
        const { target, state } = fakeMainWindow();

        await showPreparingOverlay(target, "show.dots");

        const shown = overlay()!;
        expect(shown).not.toBeNull();
        expect(shown.getAttribute("role")).toBe("alertdialog");
        expect(shown.textContent).toContain("Preparing your file…");
        expect(shown.textContent).toContain(
            "Backing up show.dots and converting it to timelines.",
        );
        expect(text("om-preparing-status")).toBe("Starting…");
        expect(document.getElementById("root")!.hasAttribute("inert")).toBe(
            true,
        );
        expect(state.progress).toEqual([2]);
    });

    it("sets the file name as text, never as HTML", async () => {
        const { target } = fakeMainWindow();

        await showPreparingOverlay(target, '<img src=x onerror="boom()">.dots');

        expect(overlay()!.querySelector("img")).toBeNull();
        expect(overlay()!.textContent).toContain(
            '<img src=x onerror="boom()">',
        );
    });

    it("hiding it restores the page, leaving what was inert before as it was", async () => {
        const { target, state } = fakeMainWindow();
        await showPreparingOverlay(target, "show.dots");

        hidePreparingOverlay(target);
        await Promise.resolve();

        expect(overlay()).toBeNull();
        expect(document.getElementById("root")!.hasAttribute("inert")).toBe(
            false,
        );
        expect(document.getElementById("portal")!.hasAttribute("inert")).toBe(
            true,
        );
        expect(state.progress).toEqual([2, -1]);
    });

    it("showing it twice leaves one overlay", async () => {
        const { target } = fakeMainWindow();
        await showPreparingOverlay(target, "a.dots");
        await showPreparingOverlay(target, "b.dots");

        expect(
            document.querySelectorAll(`#${PREPARING_OVERLAY_ID}`),
        ).toHaveLength(1);
        expect(overlay()!.textContent).toContain("b.dots");
    });

    it("never throws or hangs when the page can't run it, or the window is gone", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const failing = fakeMainWindow(() =>
            Promise.reject(new Error("Object has been destroyed")),
        );
        await expect(
            showPreparingOverlay(failing.target, "show.dots"),
        ).resolves.toBeUndefined();

        vi.useFakeTimers();
        try {
            const hanging = fakeMainWindow(() => new Promise(() => {}));
            const shown = showPreparingOverlay(hanging.target, "show.dots");
            await vi.advanceTimersByTimeAsync(1000);
            await expect(shown).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }

        const gone = fakeMainWindow();
        gone.state.destroyed = true;
        await showPreparingOverlay(gone.target, "show.dots");
        expect(() => hidePreparingOverlay(gone.target)).not.toThrow();
        expect(() => hidePreparingOverlay(undefined)).not.toThrow();
        expect(gone.state.progress).toEqual([]);
        expect(overlay()).toBeNull();
    });
});

describe("showPreparingProgress (P9.8)", () => {
    it("shows the backup, then pages done out of total, in the overlay and on the taskbar", async () => {
        const { target, state } = fakeMainWindow();
        await showPreparingOverlay(target, "show.dots");
        const bar = () =>
            document.getElementById("om-preparing-bar") as HTMLProgressElement;

        showPreparingProgress(target, { phase: "backup" });
        await Promise.resolve();
        expect(text("om-preparing-status")).toBe("Backing up…");
        expect(bar().hasAttribute("value")).toBe(false);

        showPreparingProgress(target, {
            phase: "convert",
            pagesDone: 25,
            pagesTotal: 100,
        });
        await Promise.resolve();
        expect(text("om-preparing-status")).toBe("Converting page 25 of 100…");
        expect(bar().value).toBe(0.25);
        expect(state.progress).toEqual([2, 2, 0.25]);
    });

    it("never throws, with no window, a destroyed one, or a failing script", () => {
        expect(() =>
            showPreparingProgress(undefined, { phase: "backup" }),
        ).not.toThrow();
        const { target, state } = fakeMainWindow(async () => {
            throw new Error("gone");
        });
        expect(() =>
            showPreparingProgress(target, { phase: "backup" }),
        ).not.toThrow();
        state.destroyed = true;
        expect(() =>
            showPreparingProgress(target, {
                phase: "convert",
                pagesDone: 0,
                pagesTotal: 0,
            }),
        ).not.toThrow();
        expect(
            describePreparingProgress({
                phase: "convert",
                pagesDone: 0,
                pagesTotal: 0,
            }).fraction,
        ).toBeUndefined();
    });
});

describe("throttleProgress (P9.8)", () => {
    it("passes on at most one update per interval, plus each new phase and the final page", () => {
        let t = 0;
        const shown: string[] = [];
        const report = throttleProgress(
            (p) =>
                shown.push(
                    p.phase === "backup"
                        ? "backup"
                        : `${p.pagesDone}/${p.pagesTotal}`,
                ),
            100,
            () => t,
        );

        report({ phase: "backup" });
        // 200 pages, 2 ms apart: 400 ms of progress.
        for (let page = 1; page <= 200; page++) {
            t += 2;
            report({ phase: "convert", pagesDone: page, pagesTotal: 200 });
        }

        expect(shown[0]).toBe("backup");
        expect(shown[1]).toBe("1/200"); // the new phase, at once
        expect(shown.at(-1)).toBe("200/200"); // always the final state
        expect(shown.length).toBeLessThanOrEqual(2 + 4 + 1);
        expect(shown.length).toBeGreaterThanOrEqual(5);
    });
});
