import { useState } from "react";
import { getPageRange, getTrackRange } from "./TimelineGeometry";
import type {
    TimelinePageMarker,
    TimelineTrack,
    TimelineTrackId,
} from "./TimelineViewModel";

/**
 * Clips that drop out of a page box (ui.md UI-9 **+**, "the move drops out of the page"). A
 * page's own move is not drawn as a clip: its box stands for it (`timelinesOffPages`). Adding a
 * page at a mid-page count splits the box, so the move no longer fits a box and shows as a clip
 * for the first time. That clip slides down from the page row into its track row, so it reads
 * as coming out of the page, not as appearing (`TimelineTrackClip`).
 *
 * Found from the view model alone: a track new to the rows whose range was a page box's range
 * the last time the rows changed. So the inspector's **Split page**, and redo, drop the same
 * way; a move created on purpose (a window, **Add selected marchers**) doesn't.
 */

export type ClipDrops = ReadonlySet<TimelineTrackId>;

const NO_DROPS: ClipDrops = new Set();

/** The page boxes' ranges, as `start:end`, for matching against tracks */
export function pageBoxKeys(
    pages: readonly TimelinePageMarker[],
    beatCount: number,
): ReadonlySet<string> {
    const ordered = pages
        .filter((page) => !page.isInitial)
        .sort((a, b) => a.atBeat - b.atBeat);
    const keys = new Set<string>();
    for (const page of ordered) {
        const range = getPageRange({
            pages: ordered,
            pageId: page.id,
            beatCount,
        });
        if (range) keys.add(`${range.startBeatIndex}:${range.endBeatIndex}`);
    }
    return keys;
}

/** The ids of the tracks in `current` not in `previous` whose range was one of `previousBoxes` */
export function droppedClips(
    previous: readonly TimelineTrack[],
    previousBoxes: ReadonlySet<string>,
    current: readonly TimelineTrack[],
): ClipDrops {
    const before = new Set(previous.map((track) => track.id));
    let drops: Set<TimelineTrackId> | undefined;
    for (const track of current) {
        if (before.has(track.id)) continue;
        const range = getTrackRange(track);
        if (
            range &&
            previousBoxes.has(`${range.startBeatIndex}:${range.endBeatIndex}`)
        )
            (drops ??= new Set()).add(track.id);
    }
    return drops ?? NO_DROPS;
}

/**
 * The clips dropping out of a page box since `tracks` last changed, kept until it changes again.
 * Worked out while rendering, from the tracks and pages of the render before, so a clip's first
 * paint can already be up in the page row.
 */
export function useClipDrops(
    tracks: readonly TimelineTrack[],
    pages: readonly TimelinePageMarker[],
    beatCount: number,
): ClipDrops {
    const [state, setState] = useState<{
        tracks: readonly TimelineTrack[];
        boxes: ReadonlySet<string>;
        drops: ClipDrops;
    }>(() => ({
        tracks,
        boxes: pageBoxKeys(pages, beatCount),
        drops: NO_DROPS,
    }));
    if (state.tracks === tracks) return state.drops;
    const drops = droppedClips(state.tracks, state.boxes, tracks);
    setState({ tracks, boxes: pageBoxKeys(pages, beatCount), drops });
    return drops;
}
