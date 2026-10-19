import { useEffect } from "react";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";

/**
 * The store follows the editor mode: in Expert the start flag stays put (UI-26, `startStays`); in
 * Basic it follows the playhead's page, and there is no loop region and no isolation (UI-19,
 * docs/timeline/research/basic-mode). Switching to Basic, or opening a show in it, clears
 * whichever of them is set, so Basic's edits always go where its page bar says.
 */
export function useBasicModeGuards(enabled: boolean): void {
    const basic = useIsBasicMode() && enabled;
    useEffect(() => {
        if (!enabled) return;
        useTimelineSelectionStore.getState().setStartStays(!basic);
    }, [enabled, basic]);
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
