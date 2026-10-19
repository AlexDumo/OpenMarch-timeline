import { DIMMED_OPACITY, sameMembers, type FieldDimming } from "./fieldDimming";

/**
 * Which marchers the field draws faded because they're Following at the
 * playhead's count (#300: no coordinate of their own on that count), outside
 * React. Its own channel next to isolation's `FieldDimming`: a Following
 * marcher stays selectable and draggable, so the editor's "dimmed can't be
 * selected or hit" rules never read it, and isolation's dim wins where both
 * apply (`marcherOpacity`). The marchers and labels layers redraw when
 * `version` changes.
 *
 * On Stop the fade eases in over {@link FOLLOWING_EASE_MS} (#302). Who's
 * Following is known at once, so selecting and dragging never wait on it;
 * only how faded they're drawn catches up, a frame at a time.
 */
export class FieldFollowing {
    /** Goes up whenever who's Following changes, and on each frame of an ease. */
    version = 0;
    /** The Following marchers; null fades nobody (playing, or before the resolver). */
    private following: ReadonlySet<number> | null = null;
    private readonly listeners = new Set<() => void>();
    /** When the running ease started, or null when the fade is at full strength. */
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
     * Fades `following`; null fades nobody. Nothing changes, and nothing
     * redraws, when the set is the same as before, so moving the playhead
     * between counts with the same Set marchers costs nothing here. With
     * `ease`, the fade comes in over {@link FOLLOWING_EASE_MS} instead of at
     * once (Stop).
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

    /** How far the fade has come in, 0 (solid) to 1 (full fade). */
    strength(): number {
        if (this.easeStart === null) return 1;
        const t = (this.clock.now() - this.easeStart) / FOLLOWING_EASE_MS;
        if (t >= 1) return 1;
        // Ease out: quick at first, settling into the fade
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

/** How long the fade takes to come in on Stop. */
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

/** How opaque a Following marcher and its label are: fainter than Set, clearer than dimmed. */
export const FOLLOWING_OPACITY = 0.5;

/** Whether a marcher is drawn faded as Following: isolation's dim takes over from the fade. */
export const drawnFollowing = (
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
): boolean => !dimming.isDimmed(id) && following.isFollowing(id);

/**
 * How the field draws Following marchers (study variant, #308): `fade`
 * draws them at {@link FOLLOWING_OPACITY}; `hollow` draws them as a ring in
 * their own color with no fill, at full opacity. Set marchers are filled in
 * both, and labels stay at full strength in `hollow`.
 *
 * `fade` by default; `localStorage["openmarch.followingLook"] = "hollow"`
 * switches it (read on every redraw, so a study can switch it live).
 */
export type FollowingLook = "fade" | "hollow";
export const FOLLOWING_LOOK_KEY = "openmarch.followingLook";

/** The Following look the study flag asks for. */
export function followingLook(): FollowingLook {
    try {
        return globalThis.localStorage?.getItem(FOLLOWING_LOOK_KEY) === "hollow"
            ? "hollow"
            : "fade";
    } catch {
        return "fade";
    }
}

/** How opaque a marcher's dot and label are drawn. */
export function marcherOpacity(
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
    look: FollowingLook = "fade",
): number {
    if (dimming.isDimmed(id)) return DIMMED_OPACITY;
    if (look === "hollow" || !following.isFollowing(id)) return 1;
    return 1 - (1 - FOLLOWING_OPACITY) * following.strength();
}

/**
 * How hollow a marcher's dot is drawn, 0 (filled) to 1 (a ring, no fill):
 * only Following marchers in the `hollow` look. On Stop the fill eases out
 * as the fade eases in.
 */
export function marcherHollow(
    dimming: FieldDimming,
    following: FieldFollowing,
    id: number,
    look: FollowingLook,
): number {
    if (look !== "hollow" || !drawnFollowing(dimming, following, id)) return 0;
    return following.strength();
}
