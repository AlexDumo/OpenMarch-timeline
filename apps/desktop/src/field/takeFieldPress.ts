import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import type { FieldPointer } from "./editor/fieldEditor";
import { takeFieldPoint } from "./fieldPointPick";

/**
 * Whether the app takes an edit press on the field for itself, so the
 * field editor does nothing with it (`FieldEditorPorts.takePress`, fork #202).
 *
 * While a paused preview holds a frame (UI-11), the field shows that frame,
 * not the playhead, where edits land. The first press only puts the field
 * back on the playhead (#189 story 60), so nothing is selected or dragged
 * from the held positions.
 *
 * The line tool's presses are the editor's own (`FieldEditor.setLineTool`,
 * #203), and select no marcher.
 *
 * A press while something asks for a field point (`requestFieldPoint`, a
 * Facing cue toward a point) is that point, and nothing more.
 */
export function takeFieldPress(pointer?: FieldPointer): boolean {
    if (pointer && takeFieldPoint(pointer.field)) return true;
    const timeline = useTimelineSelectionStore.getState();
    if (timeline.cursorBeat === null || timeline.playback !== null)
        return false;
    timeline.clearCursor();
    return true;
}
