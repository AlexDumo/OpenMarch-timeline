import { useEffect } from "react";
import { useLeaveShapeTool } from "@/shapes/tool/useShapeToolActions";
import { notifyActionHandlersChanged } from "@/shortcuts/registry";

/**
 * Visuals mode edits cues, not the drill (performer-behavior.md section
 * 7.1): entering it places an open shape where it was drawn and closes the
 * tool (spec #344), and the drill edits' buttons and palette entries read as
 * off there (`isActionOffInWorkspace`). The field stops moving marchers on
 * its own (`FieldEditor.setReadOnly`).
 */
export function useVisualsWorkspaceLock(visuals: boolean) {
    const leave = useLeaveShapeTool();
    useEffect(() => {
        if (visuals) leave();
        notifyActionHandlersChanged();
        // `leave` is stable (it changes only with the query client), so this runs on switching
    }, [visuals, leave]);
}
