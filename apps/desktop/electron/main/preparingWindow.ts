/* eslint-disable no-console */
/**
 * The "preparing your file" window for convert on open (P9.3), apart from
 * Electron so tests can drive it with a fake window. `convertOnOpenDialogs.ts`
 * passes a real `BrowserWindow`.
 */

const escapeHtml = (s: string) =>
    s.replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );

function preparingHtml(fileName: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Preparing your file</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: light dark; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; justify-content: center;
  padding: 0 24px; box-sizing: border-box; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas; color: CanvasText; user-select: none; cursor: default; }
h1 { font-size: 15px; margin: 0 0 6px; }
p { margin: 0; opacity: .75; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>
<h1>Preparing your file…</h1>
<p>Backing up ${escapeHtml(fileName)} and converting it to timelines. This takes a few seconds.</p>
</body></html>`;
}

/** Resolves `promise`, or undefined after `ms`, so a window problem can never hang the open. */
const withTimeout = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([
        promise,
        new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
    ]);

/** The parts of a `BrowserWindow` the preparing window uses (tests pass a fake). */
export interface PreparingWindow {
    once(event: "ready-to-show", listener: () => void): unknown;
    loadURL(url: string): Promise<void>;
    show(): void;
    destroy(): void;
    isDestroyed(): boolean;
    webContents: { executeJavaScript(code: string): Promise<unknown> };
}

/** The parts of the main window the preparing window uses. */
export interface PreparingParent {
    setProgressBar(progress: number): void;
    isDestroyed(): boolean;
}

/**
 * Shows a small modal window over `parent`, and waits until it has painted:
 * `ready-to-show`, then two animation frames after showing it. Only then does
 * the blocking work start. Never throws, and never leaves a window behind when
 * something fails (the window can't be closed by hand); the window is a
 * courtesy.
 */
export async function showPreparingWindow<Parent extends PreparingParent>(
    parent: Parent,
    fileName: string,
    createWindow: (parent: Parent) => PreparingWindow,
): Promise<PreparingWindow | undefined> {
    let preparing: PreparingWindow | undefined;
    try {
        preparing = createWindow(parent);
        const window = preparing;
        const ready = new Promise<void>((resolve) =>
            window.once("ready-to-show", () => resolve()),
        );
        await window.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(preparingHtml(fileName))}`,
        );
        await withTimeout(ready, 2000);
        window.show();
        parent.setProgressBar(2); // indeterminate
        // Two animation frames after showing: the window's first frame has been produced.
        await withTimeout(
            window.webContents.executeJavaScript(
                "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
            ),
            1000,
        );
        return window;
    } catch (error) {
        console.error("Could not show the preparing window:", error);
        try {
            if (preparing && !preparing.isDestroyed()) preparing.destroy();
        } catch {
            // already gone
        }
        if (!parent.isDestroyed()) parent.setProgressBar(-1);
        return undefined;
    }
}
