import { useCallback, useState } from "react";
import { getTrackRange } from "./TimelineGeometry";
import type { TimelineTrack, TimelineTrackId } from "./TimelineViewModel";

/**
 * Clips that drop out of a page box (ui.md UI-9 **+**, "the move drops out of the page"). A
 * page's own move is not drawn as a clip: its box stands for it (`timelinesOffPages`). Adding a
 * page at a mid-page count splits the box, so the move no longer fits a box and shows as a clip
 * for the first time; deleting a flag but not its moves does the same to both pages' moves.
 * That clip slides down from the page row into its track row, so it reads as coming out of the
 * page, not as appearing (`TimelineTrackClip`).
 *
 * Found by identity: a move the page boxes stood for (`pageMoves`) that now has a clip. So **+**,
 * the inspector's **Split page**, redo and **Delete page** drop the same way, whichever of the
 * pages and the tracks arrives first; a move made on purpose (a window, **Add selected
 * marchers**) was never behind a box, so it just appears.
 */

export type ClipDrops = ReadonlySet<TimelineTrackId>;

const NONE: ClipDrops = new Set();

/** What `useClipDrops` keeps between renders */
export interface ClipDropState {
    /** The moves the page boxes stood for, the last time they changed */
    readonly pageMoves: ReadonlySet<TimelineTrackId>;
    /** The clips dropping now, until each lands */
    readonly drops: ClipDrops;
}

export const initialClipDrops = (
    pageMoves: ReadonlySet<TimelineTrackId> = NONE,
): ClipDropState => ({ pageMoves, drops: NONE });

/**
 * The drops once the page boxes stand for `pageMoves`: the clips in `tracks` whose move a box
 * stood for before, added to those still dropping that still have a clip
 */
export function nextClipDrops(
    state: ClipDropState,
    tracks: readonly TimelineTrack[],
    pageMoves: ReadonlySet<TimelineTrackId> = NONE,
): ClipDropState {
    if (state.pageMoves === pageMoves) return state;
    const drops = new Set<TimelineTrackId>();
    for (const track of tracks) {
        const out = state.pageMoves.has(track.id) && !pageMoves.has(track.id);
        // A clip without a range isn't drawn, so it would never land
        if ((out || state.drops.has(track.id)) && getTrackRange(track) !== null)
            drops.add(track.id);
    }
    return { pageMoves, drops: drops.size === 0 ? NONE : drops };
}

/** `state` with `trackId`'s clip landed */
export function landClip(
    state: ClipDropState,
    trackId: TimelineTrackId,
): ClipDropState {
    if (!state.drops.has(trackId)) return state;
    const drops = new Set(state.drops);
    drops.delete(trackId);
    return { ...state, drops: drops.size === 0 ? NONE : drops };
}

/**
 * The clips dropping out of a page box, each until its clip calls `land`. Worked out while
 * rendering, so a clip's first paint can already be up in the page row; only when `pageMoves`
 * changes, so other renders cost nothing.
 */
export function useClipDrops(
    tracks: readonly TimelineTrack[],
    pageMoves: ReadonlySet<TimelineTrackId> | undefined,
): { drops: ClipDrops; land: (trackId: TimelineTrackId) => void } {
    const [state, setState] = useState(() => initialClipDrops(pageMoves));
    const next = nextClipDrops(state, tracks, pageMoves);
    if (next !== state) setState(next);
    const land = useCallback(
        (trackId: TimelineTrackId) =>
            setState((current) => landClip(current, trackId)),
        [],
    );
    return { drops: next.drops, land };
}
