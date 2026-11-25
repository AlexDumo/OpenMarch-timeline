import { create } from "zustand";
import type { ActionId } from "@/shortcuts/definitions";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { useShapeToolStore } from "../tool/shapeToolStore";

/**
 * The three ways a copy pastes: centered on the marchers selected (Paste), where it was copied
 * (Paste exactly), or mirrored through a point (Paste mirrored)
 */
export type PasteMode = "paste" | "exact" | "mirrored";

/** The action that pastes in each mode, and switches an open paste to it */
export const PASTE_MODE_ACTION: Record<PasteMode, ActionId> = {
    paste: "pasteFormation",
    exact: "pasteFormationInPlace",
    mirrored: "pasteMirrored",
};

/** The mode an action pastes in */
export const pasteModeOf = (action: ActionId): PasteMode =>
    action === "pasteFormationInPlace"
        ? "exact"
        : action === "pasteMirrored"
          ? "mirrored"
          : "paste";

/**
 * The paste last opened (owner 2026-11-25): its mode and the marchers it was pasted onto, so it
 * can be opened again in another mode while it's open. It's the open paste only while the open
 * shape is the one it opened (`openedAt` is that shape's own edit plan); placing or discarding it,
 * or another shape opening, ends it.
 */
export interface PasteSession {
    readonly mode: PasteMode;
    readonly ids: readonly number[];
    readonly openedAt: CanvasEditPlan | null;
}

export const usePasteSessionStore = create<{ session: PasteSession | null }>(
    () => ({ session: null }),
);

const liveIn = (
    session: PasteSession | null,
    tool: unknown,
    openedAt: CanvasEditPlan | null,
): PasteSession | null =>
    session && tool !== null && openedAt === session.openedAt ? session : null;

/** The open paste, or null when the open shape (if any) isn't one */
export function openPaste(): PasteSession | null {
    const { tool, openedAt } = useShapeToolStore.getState();
    return liveIn(usePasteSessionStore.getState().session, tool, openedAt);
}

/** The open paste's mode, for components; null with no paste open */
export function useOpenPasteMode(): PasteMode | null {
    const session = usePasteSessionStore((s) => s.session);
    const live = useShapeToolStore((s) => liveIn(session, s.tool, s.openedAt));
    return live?.mode ?? null;
}
