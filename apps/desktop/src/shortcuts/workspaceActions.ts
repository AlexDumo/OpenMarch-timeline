import { isVisualsView } from "@/stores/WorkspaceViewStore";
import { getActionDefinition, type ActionId } from "./definitions";

/**
 * Whether `id` edits the drill (the marchers' positions, the pages or the moves): each action
 * says so in its definition (`ActionDefinition.editsDrill`).
 */
export function isDrillEditingAction(id: ActionId): boolean {
    return getActionDefinition(id).editsDrill;
}

/**
 * Whether the workspace on screen turns `id` off: Visuals mode edits cues,
 * not the drill (performer-behavior.md section 7.1), so its drill edits do
 * nothing there, from a key, the palette or a button. Selecting, playback,
 * page navigation, the view, and undo and redo still work.
 */
export function isActionOffInWorkspace(id: ActionId): boolean {
    return isVisualsView() && isDrillEditingAction(id);
}
