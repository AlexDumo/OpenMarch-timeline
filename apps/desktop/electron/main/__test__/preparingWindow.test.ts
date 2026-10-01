// @vitest-environment node
/**
 * The "preparing your file" window (P9.3) never leaves a window behind: the
 * window can't be closed by hand, so any failure while showing it must destroy
 * it. Uses a fake window in place of a `BrowserWindow`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    showPreparingWindow,
    type PreparingParent,
    type PreparingWindow,
} from "../preparingWindow";

function fakeWindow(
    overrides: Partial<{
        loadURL: () => Promise<void>;
        executeJavaScript: () => Promise<unknown>;
        readyToShow: boolean;
    }> = {},
) {
    const state = { destroyed: false, shown: false, destroyCalls: 0 };
    const window: PreparingWindow = {
        once: (_event, listener) => {
            if (overrides.readyToShow !== false) setTimeout(listener, 0);
        },
        loadURL: overrides.loadURL ?? (async () => {}),
        show: () => {
            state.shown = true;
        },
        destroy: () => {
            state.destroyCalls++;
            state.destroyed = true;
        },
        isDestroyed: () => state.destroyed,
        webContents: {
            executeJavaScript:
                overrides.executeJavaScript ?? (async () => true),
        },
    };
    return { window, state };
}

function fakeParent() {
    const progress: number[] = [];
    const parent: PreparingParent = {
        setProgressBar: (p) => progress.push(p),
        isDestroyed: () => false,
    };
    return { parent, progress };
}

describe("showPreparingWindow", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("shows the window and waits for it to paint", async () => {
        const { window, state } = fakeWindow();
        const { parent, progress } = fakeParent();

        const shown = await showPreparingWindow(
            parent,
            "show.dots",
            () => window,
        );

        expect(shown).toBe(window);
        expect(state).toMatchObject({ shown: true, destroyed: false });
        expect(progress).toEqual([2]);
    });

    it("destroys the window when its webContents is gone before the paint wait", async () => {
        const { window, state } = fakeWindow({
            executeJavaScript: () =>
                Promise.reject(new Error("Object has been destroyed")),
        });
        const { parent, progress } = fakeParent();

        const shown = await showPreparingWindow(
            parent,
            "show.dots",
            () => window,
        );

        expect(shown).toBeUndefined();
        expect(state.destroyCalls).toBe(1);
        expect(progress).toEqual([2, -1]);
    });

    it("destroys the window when loading its page fails", async () => {
        const { window, state } = fakeWindow({
            loadURL: () => Promise.reject(new Error("ERR_FAILED")),
        });
        const { parent } = fakeParent();

        expect(
            await showPreparingWindow(parent, "show.dots", () => window),
        ).toBeUndefined();
        expect(state).toMatchObject({ shown: false, destroyCalls: 1 });
    });

    it("returns nothing, without throwing, when the window can't be made", async () => {
        const { parent } = fakeParent();

        expect(
            await showPreparingWindow(parent, "show.dots", () => {
                throw new Error("no display");
            }),
        ).toBeUndefined();
    });
});
