/* eslint-disable no-console */
/**
 * The "Preparing your file…" overlay for convert on open (P9.3, P9.8, P9.9),
 * apart from Electron so tests can drive it with a fake window.
 *
 * It is drawn inside the main window's page, not in a native window of its
 * own: P9.4's packaged run found that a `modal: true, closable: false` native
 * window refused the close that a macOS Quit asks every window for, which
 * cancelled the quit. An overlay in the page never refuses a close. The main
 * process injects it with `executeJavaScript` (no IPC channel), and it needs
 * no database query, since the renderer's SQL is suspended during an open.
 */
import type { ConvertProgress } from "../database/convertOnOpenProtocol";

/** The overlay's element ids, in the main window's page. */
export const PREPARING_OVERLAY_ID = "om-preparing-overlay";
const STATUS_ID = "om-preparing-status";
const BAR_ID = "om-preparing-bar";
/** Marks the page elements the overlay made inert, so hiding it restores only those. */
const INERT_MARK = "data-om-preparing-inert";
/** Where the page keeps the overlay's key listener, so hiding it removes that listener. */
const KEY_BLOCKER = "__omPreparingKeyBlocker";

/** The status line and bar fraction (undefined: indeterminate) for `progress`. */
export function describePreparingProgress(progress: ConvertProgress): {
    status: string;
    fraction: number | undefined;
} {
    if (progress.phase === "backup")
        return { status: "Backing up…", fraction: undefined };
    const { pagesDone, pagesTotal } = progress;
    return {
        status: `Converting page ${pagesDone} of ${pagesTotal}…`,
        fraction: pagesTotal > 0 ? pagesDone / pagesTotal : undefined,
    };
}

/**
 * Passes progress on to `show` at most every `intervalMs` (10 a second by
 * default), so a show with many pages doesn't flood the window with scripts.
 * A new phase and the final page are always passed on.
 */
export function throttleProgress(
    show: (progress: ConvertProgress) => void,
    intervalMs = 100,
    now: () => number = () => Date.now(),
): (progress: ConvertProgress) => void {
    let lastShown = -Infinity;
    let lastPhase: ConvertProgress["phase"] | undefined;
    return (progress) => {
        const t = now();
        const final =
            progress.phase === "convert" &&
            progress.pagesDone >= progress.pagesTotal;
        if (
            progress.phase !== lastPhase ||
            final ||
            t - lastShown >= intervalMs
        ) {
            lastShown = t;
            lastPhase = progress.phase;
            show(progress);
        }
    };
}

/** The script that removes the overlay and makes the page usable again. */
const removeOverlayScript = `
  if (window.${KEY_BLOCKER}) {
    for (const type of ["keydown", "keypress", "keyup"])
      window.removeEventListener(type, window.${KEY_BLOCKER}, true);
    delete window.${KEY_BLOCKER};
  }
  document.getElementById(${JSON.stringify(PREPARING_OVERLAY_ID)})?.remove();
  for (const el of Array.from(document.querySelectorAll("[${INERT_MARK}]"))) {
    el.removeAttribute("inert");
    el.removeAttribute(${JSON.stringify(INERT_MARK)});
  }`;

export interface OverlayOptions {
    /**
     * Draw minimize and close buttons in the overlay's title strip: on
     * Windows and Linux the window's own controls are part of the page, which
     * the overlay makes inert. Close takes the quit-during-conversion path.
     */
    windowControls: boolean;
}

/**
 * The script that puts the overlay over the page. It makes the rest of the
 * page inert (no clicks or focus reach it), and stops every key from reaching
 * the page's handlers (undo, redo, playback and the like); keys with Cmd,
 * Ctrl or Alt keep their default, so menu shortcuts such as Quit still work
 * (the main process blocks Reload). The top strip still drags the window.
 * Resolves two animation frames after adding the overlay, once it has been
 * painted. The file name is set as text, never as HTML.
 */
export function showOverlayScript(
    fileName: string,
    { windowControls }: OverlayOptions = { windowControls: false },
): string {
    return `(() => {${removeOverlayScript}
  const make = (tag, css, text) => {
    const el = document.createElement(tag);
    if (css) el.style.cssText = css;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const overlay = make("div", "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);cursor:wait;user-select:none;-webkit-app-region:no-drag;");
  overlay.id = ${JSON.stringify(PREPARING_OVERLAY_ID)};
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-busy", "true");
  overlay.setAttribute("aria-label", "Preparing your file");
  const card = make("div", 'color-scheme:light dark;background:Canvas;color:CanvasText;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);padding:20px 24px;width:420px;max-width:calc(100% - 32px);box-sizing:border-box;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;');
  card.append(
    make("h1", "font-size:15px;font-weight:600;margin:0 0 6px;", "Preparing your file…"),
    make("p", "margin:0;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", ${JSON.stringify(`Backing up ${fileName} and converting it to timelines.`)}),
  );
  const bar = make("progress", "width:100%;margin:10px 0 4px;");
  bar.id = ${JSON.stringify(BAR_ID)};
  const status = make("p", "margin:0;opacity:.75;", "Starting…");
  status.id = ${JSON.stringify(STATUS_ID)};
  status.setAttribute("aria-live", "polite");
  card.append(bar, status);
  const strip = make("div", "position:absolute;top:0;left:0;right:0;height:40px;display:flex;justify-content:flex-end;align-items:stretch;-webkit-app-region:drag;");
  if (${JSON.stringify(windowControls)}) {
    const control = (label, symbol, action) => {
      const button = make("button", "-webkit-app-region:no-drag;cursor:pointer;border:0;background:transparent;color:#fff;font:16px sans-serif;padding:0 16px;", symbol);
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => window.electron?.[action]?.());
      return button;
    };
    strip.append(control("Minimize", "\u2013", "minimizeWindow"), control("Close", "\u2715", "closeWindow"));
  }
  overlay.append(strip, card);
  const blockKey = (event) => {
    event.stopImmediatePropagation();
    if (!event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault();
  };
  window.${KEY_BLOCKER} = blockKey;
  for (const type of ["keydown", "keypress", "keyup"])
    window.addEventListener(type, blockKey, true);
  for (const el of Array.from(document.body.children)) {
    if (el.hasAttribute("inert")) continue;
    el.setAttribute("inert", "");
    el.setAttribute(${JSON.stringify(INERT_MARK)}, "");
  }
  document.body.append(overlay);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
})()`;
}

/** The script that shows `progress` in the overlay. */
export function progressScript(progress: ConvertProgress): string {
    const { status, fraction } = describePreparingProgress(progress);
    return `(() => {
  const status = document.getElementById(${JSON.stringify(STATUS_ID)});
  if (status) status.textContent = ${JSON.stringify(status)};
  const bar = document.getElementById(${JSON.stringify(BAR_ID)});
  if (bar) { ${fraction === undefined ? 'bar.removeAttribute("value");' : `bar.value = ${fraction};`} }
})()`;
}

/** The script that hides the overlay. */
export const hideOverlayScript = `(() => {${removeOverlayScript}
})()`;

/** The parts of the main window the overlay uses (tests pass a fake). */
export interface PreparingTarget {
    setProgressBar(progress: number): void;
    isDestroyed(): boolean;
    webContents: { executeJavaScript(code: string): Promise<unknown> };
}

/** Resolves `promise`, or undefined after `ms`, so a page problem can never hang the open. */
const withTimeout = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([
        promise,
        new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
    ]);

const run = (target: PreparingTarget, code: string) =>
    target.webContents.executeJavaScript(code);

/**
 * Shows the overlay over the main window's page and the indeterminate
 * taskbar or dock progress, and waits (at most a second) until it has
 * painted. Never throws: the overlay is a courtesy, and the open goes on
 * without it.
 */
export async function showPreparingOverlay(
    target: PreparingTarget,
    fileName: string,
    options: OverlayOptions = {
        windowControls: process.platform !== "darwin",
    },
): Promise<void> {
    try {
        if (target.isDestroyed()) return;
        target.setProgressBar(2); // 2: indeterminate
        await withTimeout(
            run(target, showOverlayScript(fileName, options)),
            1000,
        );
    } catch (error) {
        console.error("Could not show the preparing overlay:", error);
    }
}

/**
 * Shows `progress` in the overlay (its status line and bar) and on the
 * taskbar or dock icon. Runs in the main process while the worker converts
 * (P9.8); never throws.
 */
export function showPreparingProgress(
    target: PreparingTarget | undefined,
    progress: ConvertProgress,
): void {
    if (!target) return;
    try {
        if (target.isDestroyed()) return;
        target.setProgressBar(
            describePreparingProgress(progress).fraction ?? 2,
        );
        void run(target, progressScript(progress)).catch(() => undefined);
    } catch (error) {
        console.error("Could not show the conversion progress:", error);
    }
}

/** Removes the overlay and the taskbar progress. Never throws. */
export function hidePreparingOverlay(target: PreparingTarget | undefined) {
    if (!target) return;
    try {
        if (target.isDestroyed()) return;
        target.setProgressBar(-1);
        void run(target, hideOverlayScript).catch(() => undefined);
    } catch (error) {
        console.error("Could not hide the preparing overlay:", error);
    }
}
