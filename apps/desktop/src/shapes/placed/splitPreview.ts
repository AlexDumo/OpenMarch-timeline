import { create } from "zustand";
import type { XY } from "../types";

/**
 * Where a split would cut a placed line (#1336), which the field marks across (`FieldOverlay`):
 * the two spots either side of the gap, while Split here is pointed at in a menu or the pointer
 * is over a gap of the selected line; and with the latter, the scissors a click on splits there,
 * just off the line at the end of the mark. Null otherwise.
 */
export const useSplitPreviewStore = create<{
    readonly gap: { readonly from: XY; readonly to: XY } | null;
    readonly scissors: XY | null;
    /** A box's cut (#1337), drawn across the whole box to the scissors' end; a line's is the gap's */
    readonly cut: { readonly from: XY; readonly to: XY } | null;
    /** The pointer is on the scissors: they light up, as a button does under the pointer */
    readonly hot: boolean;
}>(() => ({ gap: null, scissors: null, cut: null, hot: false }));

/**
 * How long the pointer rests over a gap before its scissors show (#1337, owner): long enough that
 * passing over a shape to drag it or reach a handle doesn't flash them, short enough that a pause
 * to look finds them. A tap shows them at once.
 */
export const SCISSORS_DWELL_MS = 350;

/** The scissors waiting for the pointer to rest: cleared when anything takes the split mark away */
let dwell: ReturnType<typeof setTimeout> | null = null;

/**
 * Runs `show` once the pointer has rested {@link SCISSORS_DWELL_MS}, unless the split mark is
 * cleared first (`showSplit(null)`, as when the shape is put down) or this is called again.
 * Returns what cancels it.
 */
export function afterDwell(show: () => void): () => void {
    cancelDwell();
    const timer = setTimeout(() => {
        if (dwell === timer) dwell = null;
        show();
    }, SCISSORS_DWELL_MS);
    dwell = timer;
    return () => {
        if (dwell === timer) cancelDwell();
    };
}

function cancelDwell(): void {
    if (dwell !== null) clearTimeout(dwell);
    dwell = null;
}

/** The scissors' round button as drawn, in screen pixels: its radius, and its ring's width */
export const SCISSORS_RADIUS_PX = 11;
export const SCISSORS_RING_PX = 2;

/** Shows `gap` (and `scissors`), or nothing, setting the store only when that changes */
export function showSplit(
    gap: { readonly from: XY; readonly to: XY } | null,
    scissors: XY | null = null,
    cut: { readonly from: XY; readonly to: XY } | null = null,
): void {
    if (gap === null) cancelDwell();
    const now = useSplitPreviewStore.getState();
    const same = (a: XY | null, b: XY | null) =>
        a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
    if (
        same(now.gap?.from ?? null, gap?.from ?? null) &&
        same(now.gap?.to ?? null, gap?.to ?? null) &&
        same(now.scissors, scissors) &&
        same(now.cut?.from ?? null, cut?.from ?? null) &&
        same(now.cut?.to ?? null, cut?.to ?? null)
    )
        return;
    useSplitPreviewStore.setState({ gap, scissors, cut, hot: false });
}

/** Whether the pointer is on the scissors shown */
export function showScissorsHot(hot: boolean): void {
    const now = useSplitPreviewStore.getState();
    if (now.hot === hot || (hot && !now.scissors)) return;
    useSplitPreviewStore.setState({ hot });
}
