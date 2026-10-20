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
        // Only on switching: `leave` is new when the query client is
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visuals]);
}
