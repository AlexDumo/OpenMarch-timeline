import { sameMembers, type FieldDimming } from "./fieldDimming";

/**
 * Which marchers the field draws as Following (`FOLLOWING_LOOK`) because they're Following at the
 * playhead's count (#300: no coordinate of their own on that count), outside
 * React. Its own channel next to isolation's `FieldDimming`: a Following
 * marcher stays selectable and draggable, so the editor's "dimmed can't be
 * selected or hit" rules never read it, and isolation's dim wins where both
 * apply (`drawnFollowing`). The marchers and labels layers redraw when
 * `version` changes.
 *
 * On Stop the look eases in over {@link FOLLOWING_EASE_MS} (#302): the gaps
 * open from a solid edge. Who's Following is known at once, so selecting and
 * dragging never wait on it; only how far along the look is drawn catches up,
 * a frame at a time.
 */
export class FieldFollowing {
    /** Goes up whenever who's Following changes, and on each frame of an ease. */
    version = 0;
    /** The Following marchers; null draws nobody as Following (playing, or before the resolver). */
    private following: ReadonlySet<number> | null = null;
    private readonly listeners = new Set<() => void>();
    /** When the running ease started, or null when the look is at full strength. */
    private easeStart: number | null = null;
    private frame: number | null = null;

    constructor(private readonly clock: FadeClock = browserClock) {}

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
     * With `ease`, the look comes in over {@link FOLLOWING_EASE_MS} instead
     * of at once (Stop).
     */
    set(
        following: ReadonlySet<number> | null,
        { ease = false }: { ease?: boolean } = {},
    ) {
        if (following === null) this.stopEase();
        else if (ease && this.following === null) this.startEase();
        if (sameMembers(following, this.following)) return;
        this.following = following;
        this.changed();
    }

    isFollowing(id: number): boolean {
        return this.following?.has(id) ?? false;
    }

    /** How far the Following look has come in, 0 (solid) to 1 (full). */
    strength(): number {
        if (this.easeStart === null) return 1;
        const t = (this.clock.now() - this.easeStart) / FOLLOWING_EASE_MS;
        if (t >= 1) return 1;
        // Ease out: quick at first, settling into the look
        return 1 - (1 - Math.max(0, t)) ** 2;
    }

    private changed() {
        this.version++;
        for (const listener of this.listeners) listener();
    }

    private startEase() {
        this.easeStart = this.clock.now();
        this.requestFrame();
    }

    private stopEase() {
        this.easeStart = null;
        if (this.frame !== null) this.clock.cancelFrame(this.frame);
        this.frame = null;
    }

    private requestFrame() {
        if (this.frame !== null) return;
        this.frame = this.clock.requestFrame(() => {
            this.frame = null;
            if (this.easeStart === null) return;
            const done = this.clock.now() - this.easeStart >= FOLLOWING_EASE_MS;
            if (done) this.easeStart = null;
            else this.requestFrame();
            this.changed();
        });
    }
}

/** How long the Following look takes to come in on Stop. */
export const FOLLOWING_EASE_MS = 150;

/** The time and frames the ease runs on: the browser's, or a test's. */
export type FadeClock = {
    now(): number;
    requestFrame(callback: () => void): number;
    cancelFrame(handle: number): void;
};

const browserClock: FadeClock = {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/**
 * How a Following marcher is drawn (owner 2026-10-19): its edge dashed at
 * full strength. A shape with an outline dashes the outline round its fill at
 * 60%; one without dashes its edge in its fill's color, with nothing inside.
 * An X dashes its own lines. Dashes keep the
 * shape's contrast and read by shape, not only by lightness. The label is
 * drawn lighter in weight at full opacity (#324), so it keeps its contrast
 * too. The marchers layer takes how far along the look is as one 0–1 value
 * per marcher (`aFollowing`), and the labels layer thins by the same amount,
 * so an ease can open the gaps and thin the label from solid.
 */
export const FOLLOWING_LOOK = {
    /**
     * How much lighter the label's strokes are than a Set label's bold, in em
     * off each side (`TextLabel.weight`): clearly lighter, with bold Courier
     * New's curves still whole; more broke them up (#324's contact sheet).
     * Small on screen it's less, so the strokes stay whole.
     */
    labelThinning: 0.02,
    /** How opaque the fill is inside a dashed outline. */
    fillOpacity: 0.6,
    /** The dashed edge's width, in field units; never under `minEdgePx`. */
    edgeWidth: 1.75,
    minEdgePx: 2,
    /** Dashes round a circle; squares, triangles and an X's arms get three a side, corners solid. */
    circleDashes: 8,
    sideDashes: 3,
    /** How much of each dash's share a gap takes. */
    gap: 0.4,
    /**
     * Below this dot radius on screen, in CSS px, fewer, longer dashes, so the
     * gaps still show: four gaps round a circle, one a side (owner 2026-10-19:
     * dashes at any size, never a fade).
     */
    fewDashesBelowPx: 4,
    smallCircleDashes: 4,
    smallSideDashes: 2,
    /** The least a gap is, in CSS px, however small the shape. */
    minGapPx: 2,
} as const;

/**
 * How far along the Following look a marcher is drawn (`aFollowing`), 0
 * (solid) to 1 (dashed): 0 when Set or dimmed, partway while the look eases
 * in on Stop.
 */
export const followingAmount = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): number =>
    drawnFollowing(dimming, following, id) ? following.strength() : 0;

/** Whether a marcher is drawn as Following: isolation's dim takes over from it. */
export const drawnFollowing = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): boolean => !dimming.isDimmed(id) && following.isFollowing(id);

/**
 * How opaque a marcher's label is drawn: as its dot (isolation's dim, an open
 * shape's fade or hidden members), solid when Following.
 */
export const labelOpacity = (dimming: FieldDimming, id: number): number =>
    dimming.opacityOf(id);

/**
 * How much lighter a marcher's label is drawn (`TextLabel.weight`): 0 (bold)
 * when Set or dimmed, `FOLLOWING_LOOK.labelThinning` when Following, and
 * partway while the look eases in on Stop.
 */
export const labelWeight = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): number =>
    FOLLOWING_LOOK.labelThinning * followingAmount(dimming, following, id);
