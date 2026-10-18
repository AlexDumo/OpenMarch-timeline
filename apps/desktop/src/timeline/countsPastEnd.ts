/**
 * How a show's counts go on past its last stored one (endless counts: docs/timeline/endless-counts.md).
 * The counts never end: past the last stored count they continue the last measure as it sounds
 * (`countContinuation`), which the count grid draws (`countGrid.ts`) and
 * `ensureCountsInTransaction` stores when something lands there. Also where the music ends, and
 * where "Create pages every N counts to the end" puts flags.
 *
 * Beats are spec beats in show order, beat 0 (the fixed zero-length beat) included, so beat `n`
 * here is the same ordinal as timeline rows and `readPageGrid`. Measures are given by the ordinal
 * of their first beat. Times are in seconds.
 */

import type { CountGrid } from "./countGrid";

/** The seconds per count when a show has no timed count to continue (120 BPM) */
export const FALLBACK_BEAT_DURATION = 0.5;

/** How the counts after a show's last count go on: its last tempo and its last measure's meter. */
export interface CountContinuation {
    /** Whether the show has measures, so appended counts get measure lines */
    readonly measured: boolean;
    /**
     * How many counts the pattern repeats over: the meter with measures, else 1. Count `k` is as
     * long as count `k + period`, and with measures a period starts on a downbeat.
     */
    readonly period: number;
    /** Which count of a period the first appended count is (0 when it starts a measure) */
    readonly phase: number;
    /** The duration in seconds of the `k`th appended count (from 0) */
    durationAt(k: number): number;
    /** Whether the `k`th appended count (from 0) starts a measure */
    isDownbeat(k: number): boolean;
}

const usable = (duration: number | undefined): duration is number =>
    duration !== undefined && Number.isFinite(duration) && duration > 0;

/**
 * How the show's counts go on after its last count.
 *
 * - With no measures, every new count is as long as the last count.
 * - With measures, the last measure that has a measure after it sets the meter (its length in
 *   counts), and the last measure's counts (then that one's, for counts the last measure lacks)
 *   set the pattern of count lengths, so mixed meter (long and short counts) and the tempo carry
 *   on. With one measure, it sets both itself. If the last measure is short of that meter, the
 *   first new counts finish it; otherwise the first new count starts a measure.
 *
 * `measureStarts` are ordinals of measures' first beats, in any order. A count with no usable
 * length (zero, or none at all) takes the last usable one, else `fallbackDuration`.
 */
export function countContinuation({
    beats,
    measureStarts,
    fallbackDuration = FALLBACK_BEAT_DURATION,
}: {
    beats: readonly { readonly duration: number }[];
    measureStarts: readonly number[];
    fallbackDuration?: number;
}): CountContinuation {
    let lastDuration = fallbackDuration;
    for (let b = beats.length - 1; b >= 1; b--)
        if (usable(beats[b]!.duration)) {
            lastDuration = beats[b]!.duration;
            break;
        }

    const starts = [...new Set(measureStarts)]
        .filter((s) => s >= 1 && s < beats.length)
        .sort((a, b) => a - b);
    if (starts.length === 0)
        return {
            measured: false,
            period: 1,
            phase: 0,
            durationAt: () => lastDuration,
            isDownbeat: () => false,
        };

    const last = starts[starts.length - 1]!;
    const reference = starts.length >= 2 ? starts[starts.length - 2]! : last;
    const meter = starts.length >= 2 ? last - reference : beats.length - last;
    const lastMeasureCounts = beats.length - last;
    // The newest lengths: the last measure's own counts, then the measure before it for the rest
    const pattern = Array.from({ length: meter }, (_, i) => {
        const duration =
            beats[i < lastMeasureCounts ? last + i : reference + i]?.duration;
        return usable(duration) ? duration : lastDuration;
    });
    const phase = lastMeasureCounts < meter ? lastMeasureCounts : 0;
    return {
        measured: true,
        period: meter,
        phase,
        durationAt: (k) => pattern[(phase + k) % meter]!,
        isDownbeat: (k) => (phase + k) % meter === 0,
    };
}

/** The first `count` appended counts: each one's duration, and whether it starts a measure. */
export function continuedCounts(
    continuation: CountContinuation,
    count: number,
): { duration: number; downbeat: boolean }[] {
    return Array.from({ length: Math.max(0, count) }, (_, k) => ({
        duration: continuation.durationAt(k),
        downbeat: continuation.isDownbeat(k),
    }));
}

/**
 * Where the music ends on the show's clock: the end of the last envelope slot that the waveform
 * lane would draw (louder than `floorDb` below the loudest moment). Trailing digital silence, such
 * as the padding the audio player adds to cover a longer show, is not music. `null` with no audio
 * or only silence.
 */
export function musicEndSeconds(
    envelope: { readonly peaks: ArrayLike<number>; readonly rate: number },
    floorDb: number,
): number | null {
    let loudest = 0;
    for (let i = 0; i < envelope.peaks.length; i++)
        if (envelope.peaks[i]! > loudest) loudest = envelope.peaks[i]!;
    if (loudest <= 0 || !(envelope.rate > 0)) return null;
    const quietest = loudest * 10 ** (-floorDb / 20);
    for (let i = envelope.peaks.length - 1; i >= 0; i--)
        if (envelope.peaks[i]! > quietest) return (i + 1) / envelope.rate;
    return null;
}

/**
 * The music's end (`musicEndSeconds`) as a count: the first whole count at or after it, as a spec
 * beat. A hair of float error past a count line doesn't make it the next count. 0 with no counts.
 * Where playback stops, how far the waveform lane draws, and where pages to the end go up to.
 */
export function musicEndBeat(
    grid: Pick<CountGrid, "storedCount" | "beatAtTime">,
    seconds: number,
): number {
    return grid.storedCount > 0
        ? Math.ceil(grid.beatAtTime(seconds) - 1e-6)
        : 0;
}

/**
 * Where "Create pages every N counts to the end" puts flags (endless counts EC-10): every
 * `counts` counts after the last flag while the counts last, and a last, shorter page on the end
 * of the show when counts are left over, so the pages cover the whole song. Flags are spec beat
 * positions (the end of the show is the beat count). Empty when no count lies past the last flag.
 */
export function pageFlagsToEnd(
    lastFlag: number,
    showEnd: number,
    counts: number,
): number[] {
    if (!Number.isInteger(counts) || counts < 1 || showEnd <= lastFlag)
        return [];
    const flags: number[] = [];
    for (let flag = lastFlag + counts; flag <= showEnd; flag += counts)
        flags.push(flag);
    if ((flags[flags.length - 1] ?? lastFlag) < showEnd) flags.push(showEnd);
    return flags;
}
