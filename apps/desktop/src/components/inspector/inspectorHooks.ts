import { useMemo, useRef } from "react";
import { useTranslate } from "@tolgee/react";
import {
    useTimelineSelectionStore,
    windowMove,
    type StoredTimelineMembership,
} from "@/stores/TimelineSelectionStore";
import {
    TIMELINE_INSPECTOR_STRINGS,
    type TimelineInspectorStringKey,
} from "./timelineInspectorStrings";

type Params = Record<string, string | number>;

/** Looks a string up by key, with its English text as the default. */
export type InspectorTranslate = (
    key: TimelineInspectorStringKey,
    params?: Params,
) => string;

/** The inspector's translator: Tolgee's `t`, falling back to the English text. */
export function useInspectorTranslate(): InspectorTranslate {
    const { t } = useTranslate();
    return useMemo(
        () => (key, params) =>
            t(key, {
                defaultValue: TIMELINE_INSPECTOR_STRINGS[key],
                ...params,
            }),
        [t],
    );
}

/**
 * The playhead's beat and the move the window is on, held together while the playhead is scrubbed
 * (code review): the Move card is rebuilt once the scrub ends, not on every beat it passes, and
 * keeps showing the last settled move meanwhile rather than going blank. While scrubbing the
 * store's selectors return the same value, so the scrub doesn't render this at all.
 */
export function useSettledInspectorWindow(): {
    beat: number;
    move: StoredTimelineMembership | null;
} {
    const liveBeat = useTimelineSelectionStore((s) =>
        s.scrubbing ? null : s.playheadBeat,
    );
    const liveMove = useTimelineSelectionStore((s) =>
        s.scrubbing ? undefined : windowMove(s),
    );
    const held = useRef<{
        beat: number;
        move: StoredTimelineMembership | null;
    } | null>(null);
    if (held.current === null) {
        // Mounted mid-scrub: what the store has now
        const state = useTimelineSelectionStore.getState();
        held.current = { beat: state.playheadBeat, move: windowMove(state) };
    }
    if (liveBeat !== null && liveMove !== undefined)
        held.current = { beat: liveBeat, move: liveMove };
    return held.current;
}
