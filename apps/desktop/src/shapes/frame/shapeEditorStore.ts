import { create } from "zustand";
import { DEFAULT_PIVOT, type PivotKey } from "./frame";

/**
 * The shape editor's own choices (08-shape-system-ux.md): what a plain selection turns and flips
 * around (the Transform section's pivot grid, #349; the center by default, in Basic and Expert
 * alike), and the box's ratio lock (off by default). They last for the session, not the show. A
 * shape keeps its own pivot in its params instead (`pivot.ts`, #350).
 */
export const useShapeEditorStore = create<{
    pivot: PivotKey;
    ratioLocked: boolean;
}>(() => ({ pivot: DEFAULT_PIVOT, ratioLocked: false }));

export const setShapePivot = (pivot: PivotKey): void =>
    useShapeEditorStore.setState({ pivot });

export const toggleRatioLock = (): void =>
    useShapeEditorStore.setState((s) => ({ ratioLocked: !s.ratioLocked }));
