import { useAlignmentEventStore } from "@/stores/AlignmentEventStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";

/**
 * Whether the app takes an edit press on the new field for itself, so the
 * field editor does nothing with it (`FieldEditorPorts.takePress`, fork #202):
 *
 * - While a paused preview holds a frame (UI-11), the field shows that frame,
 *   not the playhead, where edits land. The first press only puts the field
 *   back on the playhead (#189 story 60), so nothing is selected or dragged
 *   from the held positions. Fabric swallows the same press in `Canvas.tsx`.
 * - While the line tool is on, presses are the tool's, and no marcher can be
 *   selected (story 20; on Fabric a marcher whose dimming ends mid-tool
 *   becomes selectable, a known gap). The line tool isn't on the new field yet
 *   (#203), so until then its presses do nothing.
 */
export function takeFieldPress(): boolean {
    const timeline = useTimelineSelectionStore.getState();
    if (timeline.cursorBeat !== null && timeline.playback === null) {
        timeline.clearCursor();
        return true;
    }
    return useAlignmentEventStore.getState().alignmentEvent === "line";
}
