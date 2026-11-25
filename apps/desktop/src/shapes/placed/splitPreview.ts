import { create } from "zustand";
import type { XY } from "../types";

/**
 * Where Split here would cut while its menu entry is pointed at (#1336): the two spots either side
 * of the gap, which the field marks across (`FieldOverlay`). Null otherwise.
 */
export const useSplitPreviewStore = create<{
    readonly gap: { readonly from: XY; readonly to: XY } | null;
}>(() => ({ gap: null }));
