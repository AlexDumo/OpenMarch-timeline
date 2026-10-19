import { sameMembers, type FieldDimming } from "./fieldDimming";

/**
 * Which marchers the field draws as Following (`FOLLOWING_LOOK`) because they're Following at the
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
    /** The Following marchers; null draws nobody as Following (playing, or before the resolver). */
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
     * Draws `following` as Following; null draws nobody so. Nothing changes, and nothing
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
 * How a Following marcher is drawn (owner 2026-10-19): its edge dashed at
 * full strength, in its outline's color, or its fill's for a shape without an
 * outline, round its fill at 60%. An X dashes its own lines. Dashes keep the
 * shape's contrast and read by shape, not only by lightness; the label stays
 * solid. The marchers layer takes how far along the look is as one 0–1 value
 * per marcher (`aFollowing`), so an ease can open the gaps from solid.
 */
export const FOLLOWING_LOOK = {
    /** How opaque the fill is, at full strength. */
    fillOpacity: 0.6,
    /** The dashed edge's width, in field units; never under `minEdgePx`. */
    edgeWidth: 1.75,
    minEdgePx: 2,
    /** Dashes round a circle; squares, triangles and an X's arms get three a side, corners solid. */
    circleDashes: 8,
    sideDashes: 3,
    /** How much of each dash's share a gap takes. */
    gap: 0.4,
    /** Below this dot radius on screen, in CSS px, no dashes: the 60% fill alone. */
    minDashRadiusPx: 4,
} as const;

/** Whether a marcher is drawn as Following: isolation's dim takes over from it. */
export const drawnFollowing = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): boolean => !dimming.isDimmed(id) && following.isFollowing(id);
