import { useEffect } from "react";
import { isMenuAction } from "@/global/menuActions";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import type { ActionId } from "../definitions";
import { runAction, subscribeToActionRuns } from "../registry";

/**
 * Playback controls, peeks that only change what's drawn, and looks that change nothing on the
 * field (the command bar, settings, the shortcuts list, moving focus) leave a held preview frame
 * alone (UI-11). An action the command bar then runs still puts it back.
 */
const KEEPS_PREVIEW_FRAME: ReadonlySet<ActionId> = new Set<ActionId>([
    "playPause",
    "timelinePlayPause",
    "toggleLoop",
    "playPage",
    "playOn",
    "toggleMetronome",
    "holdFasterPlayback",
    "holdSlowerPlayback",
    "nextPlaybackSpeed",
    "resetPlaybackSpeed",
    "toggleStartFlagPositions",
    "openCommandPalette",
    "openSettings",
    "showShortcuts",
    "focusCanvas",
    "focusTimeline",
    "exitTimelineFocus",
]);

export function useTimelineActionEffects() {
    // UI-11: anything but the transport (and a look, `KEEPS_PREVIEW_FRAME`) puts a held preview
    // frame back on the playhead, so edits start from the positions they change
    useEffect(
        () =>
            subscribeToActionRuns((id) => {
                if (KEEPS_PREVIEW_FRAME.has(id)) return;
                const timelineSelection = useTimelineSelectionStore.getState();
                if (timelineSelection.playback === null)
                    timelineSelection.clearCursor();
            }),
        [],
    );

    // The app menu's playback and help items run their action here, and only those
    // (docs/adr/0003-menu-actions-ipc.md)
    useEffect(
        () =>
            window.electron?.onMenuAction?.((action) => {
                if (isMenuAction(action)) runAction(action as ActionId);
            }),
        [],
    );
}
