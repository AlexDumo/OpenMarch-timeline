import { beatToX, clamp } from "./TimelineGeometry";

/**
 * The timeline's x axis: where a view beat is drawn and which beat is under a pixel. The normal
 * timeline has a fixed width per count (`countsAxis`); the Align view (E7, Tempo lab `alignView`)
 * draws the same lanes in seconds (`secondsAxis`), so the music stays put and the counts move over
 * it. Every lane takes an axis instead of a zoom, so the two views share their components.
 *
 * Positions are pixels from the left of the timeline's pointer surface (view beat 0).
 */
export interface TimelineXAxis {
    readonly kind: "counts" | "seconds";
    /** Pixels per unit: per count on the counts axis, per second on the seconds axis */
    readonly scale: number;
    /** The surface's length in units (counts, or seconds); `width` is `extent * scale` */
    readonly extent: number;
    /** The surface's width in pixels */
    readonly width: number;
    /** The number of view beats */
    readonly beatCount: number;
    /** A view beat's x */
    readonly x: (beat: number) => number;
    /** The pixels from beat `from` to beat `to` (negative when `to` is before `from`) */
    readonly span: (from: number, to: number) => number;
    /**
     * The fractional view beat under `px`. The seconds axis keeps it in `[0, beatCount]`; the
     * counts axis doesn't clamp (as before the axis existed), so callers clamp.
     */
    readonly beatAt: (px: number) => number;
    /** A view beat in the axis's unit: the beat itself, or its time in seconds */
    readonly toUnit: (beat: number) => number;
    /** How many pixels a count is wide around `beat`, for snapping distances */
    readonly pxPerBeatAt: (beat: number) => number;
    /**
     * The beat offset that moves something starting at `fromBeat` by `dx` pixels (a clip drag):
     * `dx / pixelsPerBeat` on the counts axis
     */
    readonly beatOffset: (fromBeat: number, dx: number) => number;
}

/**
 * The normal timeline's axis (UI-12): a fixed `pixelsPerBeat` per count. Its arithmetic is the
 * same as before the axis existed (`beatToX`, `(to - from) * pixelsPerBeat`, `px /
 * pixelsPerBeat`), so the normal view draws exactly what it drew.
 */
export function countsAxis(
    pixelsPerBeat: number,
    beatCount: number,
): TimelineXAxis {
    return {
        kind: "counts",
        scale: pixelsPerBeat,
        extent: beatCount,
        width: beatCount * pixelsPerBeat,
        beatCount,
        x: (beat) => beatToX(beat, pixelsPerBeat),
        span: (from, to) => (to - from) * pixelsPerBeat,
        beatAt: (px) => px / pixelsPerBeat,
        toUnit: (beat) => beat,
        pxPerBeatAt: () => pixelsPerBeat,
        beatOffset: (_fromBeat, dx) => dx / pixelsPerBeat,
    };
}

/**
 * The Align view's axis: x = seconds × `pixelsPerSecond`.
 *
 * @param times when each view beat starts, in seconds of show time, plus the end of the last
 *   (length `beatCount + 1`, ascending; equal times are zero-length counts)
 * @param origin seconds added to every time, so a preview that moves count 1 can draw it against
 *   the music it was laid out on (count 1 is always show time 0 in the data)
 * @param minExtent the surface is at least this many seconds long, such as the recording's length
 */
export function secondsAxis({
    times,
    pixelsPerSecond,
    origin = 0,
    minExtent = 0,
}: {
    times: ArrayLike<number>;
    pixelsPerSecond: number;
    origin?: number;
    minExtent?: number;
}): TimelineXAxis {
    const beatCount = Math.max(times.length - 1, 0);
    const end = times[beatCount] ?? 0;
    const extent = Math.max(end + origin, minExtent, 0);
    const timeAt = (beat: number) => {
        if (beatCount === 0) return 0;
        if (!(beat > 0)) return times[0]!;
        if (beat >= beatCount) return end;
        const b = Math.floor(beat);
        return times[b]! + (beat - b) * (times[b + 1]! - times[b]!);
    };
    const x = (beat: number) => (timeAt(beat) + origin) * pixelsPerSecond;
    const beatAt = (px: number) => {
        if (beatCount === 0) return 0;
        const t = px / pixelsPerSecond - origin;
        if (t <= times[0]!) return 0;
        if (t >= end) return beatCount;
        // The last beat starting at or before t; ties go to the later beat, as in timeMap
        let lo = 0;
        let hi = beatCount - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (times[mid]! <= t) lo = mid;
            else hi = mid - 1;
        }
        const length = times[lo + 1]! - times[lo]!;
        return length > 0 ? lo + (t - times[lo]!) / length : lo;
    };
    return {
        kind: "seconds",
        scale: pixelsPerSecond,
        extent,
        width: extent * pixelsPerSecond,
        beatCount,
        x,
        span: (from, to) => x(to) - x(from),
        beatAt,
        toUnit: timeAt,
        pxPerBeatAt: (beat) => {
            const b = clamp(Math.floor(beat), 0, Math.max(beatCount - 1, 0));
            const length = (times[b + 1] ?? end) - (times[b] ?? 0);
            return Math.max(length * pixelsPerSecond, 1e-6);
        },
        beatOffset: (fromBeat, dx) => beatAt(x(fromBeat) + dx) - fromBeat,
    };
}

/** The fewest and most pixels a second gets in the Align view */
export const ALIGN_MIN_PX_PER_SECOND = 2;
export const ALIGN_MAX_PX_PER_SECOND = 400;

/**
 * The Align view's zoom on entering it (11-ui.md A, "Switching keeps your place"): the playhead's
 * page keeps its width, so px/s is px/count over that page's seconds per count.
 */
export function alignPixelsPerSecond(
    pixelsPerBeat: number,
    secondsPerCount: number | null,
): number {
    const perCount =
        secondsPerCount != null && secondsPerCount > 0 ? secondsPerCount : 0.5;
    return clamp(
        pixelsPerBeat / perCount,
        ALIGN_MIN_PX_PER_SECOND,
        ALIGN_MAX_PX_PER_SECOND,
    );
}

/**
 * The scroll that keeps `beat` at the same screen x after the axis changes: it was at
 * `before.x(beat) - scrollLeft`, and is put there again on `after`.
 */
export function scrollKeepingBeat({
    beat,
    before,
    after,
    scrollLeft,
}: {
    beat: number;
    before: Pick<TimelineXAxis, "x">;
    after: Pick<TimelineXAxis, "x">;
    scrollLeft: number;
}): number {
    return Math.max(0, scrollLeft + after.x(beat) - before.x(beat));
}
