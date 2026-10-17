import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import type { ToolState } from "./toolMachine";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "./shapeToolStore";

/** How long the toast offers to bring a discarded shape back */
export const DISCARD_TOAST_MS = 8000;
const DISCARD_TOAST_ID = "shape-discarded";

/**
 * Escape on an open shape that was drawn (08-shape-system-ux.md, owner 2026-10-17): it closes,
 * placing nothing, and a toast offers to bring it back. The undo lives only in the toast: the
 * show's undo history never saw the shape. It comes back only while the same marchers are still
 * selected and no other shape has been opened.
 */
export function discardShapeTool(selectedIds: () => readonly number[]): void {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return;
    closeShapeTool();
    if (tool.params === null) return;
    const saved: ToolState = { ...tool, gesture: null };
    toast.info(tolgee.t("shapes.box.discarded.message", "Box discarded"), {
        id: DISCARD_TOAST_ID,
        duration: DISCARD_TOAST_MS,
        action: {
            label: tolgee.t("shapes.box.discarded.undo", "Undo"),
            onClick: () => restore(saved, selectedIds()),
        },
    });
}

function restore(saved: ToolState, selected: readonly number[]): void {
    if (useShapeToolStore.getState().tool) return;
    const ids = new Set(selected);
    const same =
        ids.size === saved.marchers.length &&
        saved.marchers.every((m) => ids.has(m.id));
    if (same) openShapeTool(saved);
}
