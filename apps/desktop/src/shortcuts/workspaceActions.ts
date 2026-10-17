import { isVisualsView } from "@/stores/WorkspaceViewStore";
import {
    getActionDefinition,
    type ActionCategory,
    type ActionId,
} from "./definitions";

/** The kinds of action that edit the drill: moving, aligning and shaping marchers. */
const DRILL_EDITING_CATEGORIES: ReadonlySet<ActionCategory> = new Set([
    "movement",
    "alignment",
    "batchEdit",
    "cursor",
    "shape",
]);

/** Drill edits filed under other kinds: K keeps the selected marchers on later pages (UI-18). */
const DRILL_EDITING_ACTIONS: ReadonlySet<ActionId> = new Set([
    "toggleKeepOnPage",
]);

/** Whether `id` edits the drill (the marchers' positions or the moves). */
export function isDrillEditingAction(id: ActionId): boolean {
    return (
        DRILL_EDITING_ACTIONS.has(id) ||
        DRILL_EDITING_CATEGORIES.has(getActionDefinition(id).category)
    );
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
