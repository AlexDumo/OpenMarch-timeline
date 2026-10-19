import { DIMMED_OPACITY, sameMembers, type FieldDimming } from "./fieldDimming";

/**
 * Which marchers the field draws hollow because they're Following at the
 * playhead's count (#300: no coordinate of their own on that count), outside
 * React. Its own channel next to isolation's `FieldDimming`: a Following
 * marcher stays selectable and draggable, so the editor's "dimmed can't be
 * selected or hit" rules never read it, and isolation's dim wins where both
 * apply (`drawnFollowing`). The marchers and labels layers redraw when
 * `version` changes.
 */
export class FieldFollowing {
    /** Goes up whenever who's Following changes. */
    version = 0;
    /** The Following marchers; null draws nobody hollow (playing, or before the resolver). */
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
     * Draws `following` hollow; null draws nobody hollow. Nothing changes, and nothing
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

/**
 * How opaque a Following marcher's fill is: it's drawn hollow, a ring in its
 * own color at full strength around a faint fill, so it stays easy to find
 * (the ring keeps the dot's contrast) and reads as Following by its shape, not
 * only by how light it is.
 */
export const HOLLOW_FILL_OPACITY = 0.25;

/** How opaque a Following marcher's label is: fainter than Set, still readable text. */
export const FOLLOWING_LABEL_OPACITY = 0.75;

/** Whether a marcher is drawn hollow as Following: isolation's dim takes over from it. */
export const drawnFollowing = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): boolean => !dimming.isDimmed(id) && following.isFollowing(id);

/** How opaque a marcher's label is drawn. */
export function labelOpacity(
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): number {
    if (dimming.isDimmed(id)) return DIMMED_OPACITY;
    return following.isFollowing(id) ? FOLLOWING_LABEL_OPACITY : 1;
}
