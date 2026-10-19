import { useEffect } from "react";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { useIsPreviewMode } from "@/stores/PreviewModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";

/**
 * The store follows the editor mode: in Expert the start flag stays put (UI-26, `startStays`); in
 * Basic it follows the playhead's page, and there is no loop region and no isolation (UI-19,
 * docs/timeline/research/basic-mode). Switching to Basic, or opening a show in it, clears
 * whichever of them is set, so Basic's edits always go where its page bar says.
 *
 * Preview has no start flag on screen, so there the start flag follows the playhead's page as in
 * Basic: a pause or click before it moves the playhead there, rather than swapping the two. The
 * loop doesn't follow it there either, so leaving Preview with looping on goes back to the loop, as
 * Expert's window and loop are one (UI-26).
 */
export function useBasicModeGuards(enabled: boolean): void {
    const basic = useIsBasicMode() && enabled;
    const preview = useIsPreviewMode();
    useEffect(() => {
        if (!enabled) return;
        const store = useTimelineSelectionStore.getState();
        const startStays = !basic && !preview;
        store.setStartStays(startStays);
        if (startStays && store.loop) store.setLoop(store.loop);
    }, [enabled, basic, preview]);
    useEffect(() => {
        if (!basic) return;
        const clear = (s = useTimelineSelectionStore.getState()) => {
            if (s.isolation) s.exitIsolation();
            if (s.loop) s.setLoop(null);
        };
        clear();
        // Anything that sets them later (a stale shortcut, undo's window restore) is undone too
        return useTimelineSelectionStore.subscribe((s) => {
            if (s.isolation || s.loop) clear(s);
        });
    }, [basic]);
}
