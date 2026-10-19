import { useCallback, useState } from "react";
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
 * Deleting a flag but not its moves works the same way: the merged box fits neither page's move,
 * so both show as clips and drop out of the page row.
 *
 * Found from the view model alone: a track new to the rows whose range was a page box's range
 * in a render since the rows last gained or lost a track. Every box since then, not only the
 * last ones: the new pages can arrive a render before the tracks catch up (`useHeldWhileStale`),
 * and the boxes the move fitted are gone by then. So the inspector's **Split page**, and redo,
 * drop the same way; a move created on purpose (a window, **Add selected marchers**) doesn't.
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

/** What `useClipDrops` keeps between renders */
export interface ClipDropState {
    readonly tracks: readonly TimelineTrack[];
    readonly pages: readonly TimelinePageMarker[];
    readonly beatCount: number;
    /** Every page box's range since the rows last gained or lost a track */
    readonly boxes: ReadonlySet<string>;
    /** The clips dropping now, until each lands */
    readonly drops: ClipDrops;
}

export const initialClipDrops = (
    tracks: readonly TimelineTrack[],
    pages: readonly TimelinePageMarker[],
    beatCount: number,
): ClipDropState => ({
    tracks,
    pages,
    beatCount,
    boxes: pageBoxKeys(pages, beatCount),
    drops: NO_DROPS,
});

/**
 * The drops after a render with `tracks` and `pages`: the clips new to the rows with a range one
 * of the boxes was, added to those still dropping. A drop stays until its clip lands (`landClip`)
 * or leaves the rows, however often the view model is rebuilt meanwhile (a query settling)
 */
export function nextClipDrops(
    state: ClipDropState,
    tracks: readonly TimelineTrack[],
    pages: readonly TimelinePageMarker[],
    beatCount: number,
): ClipDropState {
    if (
        state.tracks === tracks &&
        state.pages === pages &&
        state.beatCount === beatCount
    )
        return state;
    const ids = new Set(tracks.map((track) => track.id));
    const before = new Set(state.tracks.map((track) => track.id));
    const rowsChanged =
        ids.size !== before.size || [...ids].some((id) => !before.has(id));
    const boxesNow = pageBoxKeys(pages, beatCount);
    let drops: ClipDrops = state.drops;
    if (rowsChanged) {
        const added = droppedClips(state.tracks, state.boxes, tracks);
        const kept = [...state.drops].filter((id) => ids.has(id));
        drops =
            kept.length === 0 && added.size === 0
                ? NO_DROPS
                : new Set([...kept, ...added]);
    }
    return {
        tracks,
        pages,
        beatCount,
        boxes: rowsChanged ? boxesNow : new Set([...state.boxes, ...boxesNow]),
        drops,
    };
}

/** `state` with `trackId`'s clip landed */
export function landClip(
    state: ClipDropState,
    trackId: TimelineTrackId,
): ClipDropState {
    if (!state.drops.has(trackId)) return state;
    const drops = new Set(state.drops);
    drops.delete(trackId);
    return { ...state, drops: drops.size === 0 ? NO_DROPS : drops };
}

/**
 * The clips dropping out of a page box, each until its clip calls `land` (or leaves the rows).
 * Worked out while rendering, from the tracks and pages of the renders before, so a clip's first
 * paint can already be up in the page row.
 */
export function useClipDrops(
    tracks: readonly TimelineTrack[],
    pages: readonly TimelinePageMarker[],
    beatCount: number,
): { drops: ClipDrops; land: (trackId: TimelineTrackId) => void } {
    const [state, setState] = useState(() =>
        initialClipDrops(tracks, pages, beatCount),
    );
    const next = nextClipDrops(state, tracks, pages, beatCount);
    if (next !== state) setState(next);
    const land = useCallback(
        (trackId: TimelineTrackId) =>
            setState((current) => landClip(current, trackId)),
        [],
    );
    return { drops: next.drops, land };
}
