import { useEffect } from "react";
import { notifyActionHandlersChanged } from "@/shortcuts/registry";

/**
 * Visuals mode edits cues, not the drill (performer-behavior.md section
 * 7.1): an open shape waits out of sight there until the Editor is back
 * (#416, `useShapeHidden`), and the drill edits' buttons and palette entries read as
 * off there (`isActionOffInWorkspace`). The field stops moving marchers on
 * its own (`FieldEditor.setReadOnly`).
 */
export function useVisualsWorkspaceLock(visuals: boolean) {
    useEffect(() => {
        notifyActionHandlersChanged();
    }, [visuals]);
}
