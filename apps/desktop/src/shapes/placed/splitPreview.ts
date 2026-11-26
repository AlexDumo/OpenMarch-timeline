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

/** The scissors' round button as drawn, in screen pixels: its radius, and its ring's width */
export const SCISSORS_RADIUS_PX = 11;
export const SCISSORS_RING_PX = 2;

/** Shows `gap` (and `scissors`), or nothing, setting the store only when that changes */
export function showSplit(
    gap: { readonly from: XY; readonly to: XY } | null,
    scissors: XY | null = null,
    cut: { readonly from: XY; readonly to: XY } | null = null,
): void {
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
