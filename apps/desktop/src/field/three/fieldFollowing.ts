import { DIMMED_OPACITY, sameMembers, type FieldDimming } from "./fieldDimming";

/**
 * Which marchers the field draws faded because they're Following at the
 * playhead's count (#300: no coordinate of their own on that count), outside
 * React. Its own channel next to isolation's `FieldDimming`: a Following
 * marcher stays selectable and draggable, so the editor's "dimmed can't be
 * selected or hit" rules never read it, and isolation's dim wins where both
 * apply (`marcherOpacity`). The marchers and labels layers redraw when
 * `version` changes.
 */
export class FieldFollowing {
    /** Goes up whenever who's Following changes. */
    version = 0;
    /** The Following marchers; null fades nobody (playing, or before the resolver). */
    private following: ReadonlySet<number> | null = null;
    private readonly listeners = new Set<() => void>();

    /** Calls `listener` after each change (a layer asks for a frame). Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Fades `following`; null fades nobody. Nothing changes, and nothing
     * redraws, when the set is the same as before, so moving the playhead
     * between counts with the same Set marchers costs nothing here.
     */
    set(following: ReadonlySet<number> | null) {
        if (sameMembers(following, this.following)) return;
        this.following = following;
        this.version++;
        for (const listener of this.listeners) listener();
    }

    isFollowing(id: number): boolean {
        return this.following?.has(id) ?? false;
    }
}

/** How opaque a Following marcher and its label are: fainter than Set, clearer than dimmed. */
export const FOLLOWING_OPACITY = 0.5;

/** Whether a marcher is drawn faded as Following: isolation's dim takes over from the fade. */
export const drawnFollowing = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): boolean => !dimming.isDimmed(id) && following.isFollowing(id);

/** How opaque a marcher's dot and label are drawn. */
export function marcherOpacity(
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): number {
    if (dimming.isDimmed(id)) return DIMMED_OPACITY;
    return following.isFollowing(id) ? FOLLOWING_OPACITY : 1;
}
