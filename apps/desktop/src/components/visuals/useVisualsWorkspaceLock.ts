import { useEffect } from "react";
import { closeShapeTool } from "@/shapes/tool/shapeToolStore";
import { notifyActionHandlersChanged } from "@/shortcuts/registry";

/**
 * Visuals mode edits cues, not the drill (performer-behavior.md section
 * 7.1): entering it closes an open shape tool, and the drill
 * edits' buttons and palette entries read as off there
 * (`isActionOffInWorkspace`). The field stops moving marchers on its own
 * (`FieldEditor.setReadOnly`).
 */
export function useVisualsWorkspaceLock(visuals: boolean) {
    useEffect(() => {
        if (visuals) closeShapeTool();
        notifyActionHandlersChanged();
    }, [visuals]);
}
