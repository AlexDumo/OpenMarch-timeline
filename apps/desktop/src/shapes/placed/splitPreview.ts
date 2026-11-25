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
}>(() => ({ gap: null, scissors: null }));

/** Shows `gap` (and `scissors`), or nothing, setting the store only when that changes */
export function showSplit(
    gap: { readonly from: XY; readonly to: XY } | null,
    scissors: XY | null = null,
): void {
    const now = useSplitPreviewStore.getState();
    const same = (a: XY | null, b: XY | null) =>
        a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
    if (
        same(now.gap?.from ?? null, gap?.from ?? null) &&
        same(now.gap?.to ?? null, gap?.to ?? null) &&
        same(now.scissors, scissors)
    )
        return;
    useSplitPreviewStore.setState({ gap, scissors });
}
