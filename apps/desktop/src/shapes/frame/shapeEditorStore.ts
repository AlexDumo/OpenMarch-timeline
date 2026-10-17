import { create } from "zustand";
import { DEFAULT_PIVOT, type PivotKey } from "./frame";

/**
 * The shape editor's own choices while editing any shape (08-shape-system-ux.md): what turns,
 * flips and resizes go around (the inspector's pivot grid; the back-left corner by default, and
 * always in Basic mode), and the box's ratio lock (off by default). They last for the session,
 * not the show.
 */
export const useShapeEditorStore = create<{
    pivot: PivotKey;
    ratioLocked: boolean;
}>(() => ({ pivot: DEFAULT_PIVOT, ratioLocked: false }));

export const setShapePivot = (pivot: PivotKey): void =>
    useShapeEditorStore.setState({ pivot });

export const toggleRatioLock = (): void =>
    useShapeEditorStore.setState((s) => ({ ratioLocked: !s.ratioLocked }));
