import {
    appearanceIsHidden,
    type AppearanceComponentOptional,
} from "@/entity-components/appearance";
import type { MarcherAppearanceTimeline } from "./type";

/**
 * How far before a keyframe a time still counts as on it, in milliseconds. The paused playhead's
 * time (`timeAtBeat`) and a flag's time (`Page.timestamp + duration`) are summed differently, so
 * on a flag they can differ by float error; appearance is a step function, so landing a hair short
 * would show the previous page's appearance.
 */
const KEYFRAME_TOLERANCE_MS = 1e-3;

/**
 * The appearance stack in effect at `timeMs` (ported from `coordinates-v2`): the one at the most
 * recent timestamp at or before it, or the first before the first timestamp. A binary search, so
 * it is cheap enough to run for every marcher on every frame. `null` for an empty timeline.
 *
 * The returned array is the one stored in the timeline, so callers can skip re-applying an
 * unchanged appearance by comparing references (`dbToMarcherAppearanceTimeline` keeps only
 * keyframes that change the appearance).
 */
export function getAppearanceAtTime(
    timeline: MarcherAppearanceTimeline,
    timeMs: number,
): AppearanceComponentOptional[] | null {
    const { timestamps, stacks } = timeline;
    if (stacks.length === 0) return null;
    const t = timeMs + KEYFRAME_TOLERANCE_MS;
    let lo = 0;
    let hi = timestamps.length - 1;
    let found = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (timestamps[mid]! <= t) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return stacks[found]!;
}

/** The marchers whose appearance at `timeMs` is hidden, so they can't be selected. */
export function hiddenMarcherIdsAt(
    timelines: ReadonlyMap<number, MarcherAppearanceTimeline>,
    timeMs: number,
): Set<number> {
    const hidden = new Set<number>();
    for (const [marcherId, timeline] of timelines) {
        const stack = getAppearanceAtTime(timeline, timeMs);
        if (stack && appearanceIsHidden(stack)) hidden.add(marcherId);
    }
    return hidden;
}
