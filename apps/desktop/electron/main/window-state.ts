/**
 * Opens the editor and the 3D View where they belong (window-placement.ts) and remembers where
 * they're left. The "Open on" settings live in Settings › General.
 */
import { screen, type BrowserWindow } from "electron";
import type Store from "electron-store";
import {
    listDisplays,
    parseSavedWindowState,
    resolvePlacement,
    type DisplayArea,
    type Placement,
    type SavedWindowState,
    type WindowDefaults,
} from "./window-placement";
import {
    OPEN_ON_LAST,
    WINDOW_OPEN_ON_SETTINGS,
    type DisplayListing,
    type PlacedWindow,
} from "../../src/settings/windowPlacementSettings";

const STATE_KEYS: Record<PlacedWindow, string> = {
    editor: "editorWindowState",
    view3d: "view3dWindowState",
};

function displayAreas(): DisplayArea[] {
    return screen
        .getAllDisplays()
        .map((d) => ({ id: d.id, workArea: d.workArea }));
}

/** Where the window opens: its constructor options take `bounds` and `fullScreen` */
export function windowPlacement(
    store: Store,
    kind: PlacedWindow,
    defaults: WindowDefaults,
): Placement {
    const primary = screen.getPrimaryDisplay();
    return resolvePlacement({
        saved: parseSavedWindowState(store.get(STATE_KEYS[kind])),
        openOn: store.get(WINDOW_OPEN_ON_SETTINGS[kind], OPEN_ON_LAST),
        displays: displayAreas(),
        primary: { id: primary.id, workArea: primary.workArea },
        defaults,
    });
}

/**
 * Shows a window created hidden at its placement, once it has something to draw, so it never
 * shows at one size and jumps to another. `inactive` shows it without taking focus.
 */
export function showWhenReady(
    win: BrowserWindow,
    placement: Placement,
    { inactive = false }: { inactive?: boolean } = {},
) {
    let shown = false;
    const show = () => {
        if (shown || win.isDestroyed()) return;
        shown = true;
        // `maximize()` shows a hidden window already maximized (without focus)
        if (placement.maximized && !placement.fullScreen) win.maximize();
        if (inactive) {
            if (!win.isVisible()) win.showInactive();
        } else {
            win.show();
        }
    };
    win.once("ready-to-show", show);
    // A page that is slow to paint still gets its window
    setTimeout(show, 5000);
}

function currentState(win: BrowserWindow): SavedWindowState {
    return {
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen(),
        displayId: screen.getDisplayMatching(win.getBounds()).id,
    };
}

/**
 * Saves where the window is whenever it moves, resizes, maximizes or goes full screen, and when
 * it closes. Saving as it goes also covers windows closed with `destroy()`, which emits no
 * "close".
 */
export function rememberWindowState(
    store: Store,
    kind: PlacedWindow,
    win: BrowserWindow,
) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
        clearTimeout(timer);
        timer = undefined;
        // A hidden window (not shown yet, or closing) reports nothing useful
        if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
        store.set(STATE_KEYS[kind], currentState(win));
    };
    const saveSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 500);
    };
    for (const event of [
        "resize",
        "move",
        "maximize",
        "unmaximize",
        "enter-full-screen",
        "leave-full-screen",
    ] as const) {
        win.on(event as "resize", saveSoon);
    }
    win.on("close", save);
    win.on("closed", () => clearTimeout(timer));
}

/**
 * Moves an open window to the display just chosen in Settings, keeping its size (or keeping it
 * maximized). A full-screen window stays put and moves the next time it opens.
 */
export function moveToChosenDisplay(
    store: Store,
    kind: PlacedWindow,
    win: BrowserWindow | null,
    defaults: WindowDefaults,
) {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isFullScreen())
        return;
    const openOn = store.get(WINDOW_OPEN_ON_SETTINGS[kind], OPEN_ON_LAST);
    if (openOn === OPEN_ON_LAST) return;
    const state = currentState(win);
    if (String(state.displayId) === openOn) return;

    const primary = screen.getPrimaryDisplay();
    const placement = resolvePlacement({
        saved: state,
        openOn,
        displays: displayAreas(),
        primary: { id: primary.id, workArea: primary.workArea },
        defaults,
    });
    if (!win.isMaximized()) {
        win.setBounds(placement.bounds);
        return;
    }
    // Moved while un-maximized, then maximized again. On Linux the window manager applies each
    // step after the call returns, and its restore resize lands just after "unmaximize": bounds
    // set before it settles are overwritten, and maximizing before the move lands makes the
    // whole display the size it restores to. So each step waits a moment for the last.
    const SETTLE_MS = 100;
    let moved = false;
    const move = () => {
        if (moved || win.isDestroyed()) return;
        moved = true;
        setTimeout(() => {
            if (win.isDestroyed()) return;
            win.setBounds(placement.bounds);
            setTimeout(() => {
                if (!win.isDestroyed()) win.maximize();
            }, SETTLE_MS);
        }, SETTLE_MS);
    };
    win.once("unmaximize", move);
    // A window manager that never reports it
    setTimeout(move, 500);
    win.unmaximize();
}

/** The connected displays, for the "Open on" menus */
export function displayListing(): DisplayListing[] {
    return listDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}
