import { create } from "zustand";

/**
 * A log of what the field's pointer input saw, for chasing drags undone on release: off unless
 * the page was opened with `?debugInput` (kept until `?debugInput=0`). It records presses,
 * releases and button changes, what cancelled a drag, and what happened to the window and the
 * field's canvas around it (focus, display scale, a lost GPU context, the canvas rebuilt).
 */

const STORAGE_KEY = "openmarch:debugFieldInput";
const MAX_ENTRIES = 60;

export type FieldInputLogEntry = {
    /** `performance.now()` when it happened */
    t: number;
    kind: string;
    detail: string;
    /** A drag, marquee or press that was under way got cancelled */
    cancelled: boolean;
};

type FieldInputDebugState = {
    enabled: boolean;
    entries: readonly FieldInputLogEntry[];
    /** The last cancel of something under way, for the banner */
    lastCancel: FieldInputLogEntry | null;
    /** Counts the requests to rebuild the field's canvas, as a lost GPU context would */
    rebuilds: number;
};

function readEnabled(): boolean {
    try {
        const param = new URLSearchParams(window.location.search).get(
            "debugInput",
        );
        if (param !== null) {
            const on = param !== "0" && param !== "false";
            localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
            return on;
        }
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export const useFieldInputDebug = create<FieldInputDebugState>(() => ({
    enabled: typeof window !== "undefined" && readEnabled(),
    entries: [],
    lastCancel: null,
    rebuilds: 0,
}));

/** Adds a line to the log, when it's on */
export function logFieldInput(kind: string, detail = "", cancelled = false) {
    const state = useFieldInputDebug.getState();
    if (!state.enabled) return;
    const entry: FieldInputLogEntry = {
        t: performance.now(),
        kind,
        detail,
        cancelled,
    };
    console.debug(`[field input] ${kind}${detail ? ` ${detail}` : ""}`);
    useFieldInputDebug.setState({
        entries: [...state.entries, entry].slice(-MAX_ENTRIES),
        lastCancel: cancelled ? entry : state.lastCancel,
    });
}

export const fieldInputDebugOn = () => useFieldInputDebug.getState().enabled;

/** A pointer event's buttons, for the log */
export function describePointer(event: PointerEvent): string {
    return `button=${event.button} buttons=${event.buttons} ${event.pointerType} id=${event.pointerId}`;
}

/** The log as text, for pasting into a bug report */
export function fieldInputLogText(): string {
    const { entries } = useFieldInputDebug.getState();
    const first = entries[0]?.t ?? 0;
    return entries
        .map(
            (e) =>
                `${((e.t - first) / 1000).toFixed(3).padStart(8)}s ${e.cancelled ? "!! " : "   "}${e.kind} ${e.detail}`,
        )
        .join("\n");
}

/** Rebuilds the field's canvas, as giving up on a lost GPU context does */
export function requestFieldRebuild() {
    logFieldInput("test", "rebuilding the field's canvas");
    useFieldInputDebug.setState((s) => ({ rebuilds: s.rebuilds + 1 }));
}

/** Loses the field canvas's GPU context, and gives it back `restoreAfterMs` later */
export function loseFieldContext(restoreAfterMs: number) {
    const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="fieldCanvas"] canvas',
    );
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const lose = gl?.getExtension("WEBGL_lose_context");
    if (!lose) {
        logFieldInput("test", "can't lose the GPU context here");
        return;
    }
    logFieldInput("test", "losing the GPU context");
    lose.loseContext();
    setTimeout(() => {
        logFieldInput("test", "giving the GPU context back");
        lose.restoreContext();
    }, restoreAfterMs);
}
