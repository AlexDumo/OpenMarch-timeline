/**
 * How long a show is next to its music (tempo experiment E1, "a show is as long as its music").
 *
 * A show's counts are its beats, and nothing after the last count can be planned, played or
 * flagged. So a new show with audio gets counts to the end of the recording, a show whose music
 * runs past its counts can be extended to the end, and **+ N counts** after the last count always
 * adds a page. All of them continue the show's last tempo and meter with the pure functions here.
 *
 * Beats are spec beats in show order, beat 0 (the fixed zero-length beat) included, so beat `n`
 * here is the same ordinal as timeline rows and `readPageGrid`. Measures are given by the ordinal
 * of their first beat. Times are in seconds.
 */

/** The seconds per count when a show has no timed count to continue (120 BPM) */
export const FALLBACK_BEAT_DURATION = 0.5;

/** The fewest counts a show without measures starts with (8 pages of 16, the wizard's Skip) */
export const MIN_SHOW_COUNTS = 128;

/**
 * How far short of the end of the music the counts may end and still reach it: the music's end
 * is only known to an envelope slot (5 ms), and a float sum over hundreds of counts lands a hair
 * off an exact end. Far less than any count.
 */
export const MUSIC_END_TOLERANCE_SECONDS = 0.05;

/** How the counts after a show's last count go on: its last tempo and its last measure's meter. */
export interface CountContinuation {
    /** Whether the show has measures, so appended counts get measure lines */
    readonly measured: boolean;
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
        durationAt: (k) => pattern[(phase + k) % meter]!,
        isDownbeat: (k) => (phase + k) % meter === 0,
    };
}

/**
 * How many counts to append so the show lasts until `untilSeconds`, from a show that ends at
 * `endSeconds`: enough for the last count to end at or after it, then, with measures, up to the
 * end of that measure, so the show ends on a bar line. 0 when the show already lasts that long.
 * Capped at `maxCounts`, so bad timing can't make a runaway show.
 */
export function countsToReach({
    continuation,
    endSeconds,
    untilSeconds,
    toleranceSeconds = MUSIC_END_TOLERANCE_SECONDS,
    maxCounts = 20_000,
}: {
    continuation: CountContinuation;
    endSeconds: number;
    untilSeconds: number;
    /** How far short of `untilSeconds` the show may end and still reach it */
    toleranceSeconds?: number;
    maxCounts?: number;
}): number {
    const target = untilSeconds - toleranceSeconds;
    let time = endSeconds;
    let k = 0;
    while (time < target && k < maxCounts) time += continuation.durationAt(k++);
    if (continuation.measured && k > 0)
        while (k < maxCounts && !continuation.isDownbeat(k)) k++;
    return k;
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
 * How many measures a new tempo-only show gets (the wizard's "Tempo only"): enough measures of
 * `beatsPerMeasure` counts at `beatDuration` seconds each to cover `audioSeconds` of music from
 * count 1, and never fewer than `minMeasures` (the starter pages need them). Without audio, the
 * minimum.
 */
export function measuresToCoverAudio({
    audioSeconds,
    beatDuration,
    beatsPerMeasure,
    minMeasures,
}: {
    audioSeconds: number | null | undefined;
    beatDuration: number;
    beatsPerMeasure: number;
    minMeasures: number;
}): number {
    if (
        audioSeconds == null ||
        !(audioSeconds > 0) ||
        !usable(beatDuration) ||
        beatsPerMeasure < 1
    )
        return minMeasures;
    const measureSeconds = beatDuration * beatsPerMeasure;
    return Math.max(
        minMeasures,
        Math.ceil(audioSeconds / measureSeconds - 1e-9),
    );
}

/**
 * How many counts a new show without measures gets (the wizard's "Skip for now"): enough counts
 * at `beatDuration` seconds to cover `audioSeconds` of music, and never fewer than `minCounts`.
 */
export function countsToCoverAudio({
    audioSeconds,
    beatDuration,
    minCounts = MIN_SHOW_COUNTS,
}: {
    audioSeconds: number | null | undefined;
    beatDuration: number;
    minCounts?: number;
}): number {
    if (audioSeconds == null || !(audioSeconds > 0) || !usable(beatDuration))
        return minCounts;
    return Math.max(minCounts, Math.ceil(audioSeconds / beatDuration - 1e-9));
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
 * Whether the music runs past the counts by enough to offer extending them: more than one more
 * count (of the show's last tempo) of music after the last count ends.
 */
export function musicRunsPastCounts({
    countsEndSeconds,
    musicEnd,
    continuation,
}: {
    countsEndSeconds: number;
    musicEnd: number | null;
    continuation: CountContinuation;
}): boolean {
    return (
        musicEnd !== null &&
        musicEnd - countsEndSeconds > continuation.durationAt(0)
    );
}

/** `m:ss` for a time in seconds, as the music player shows it (2:31). Rounds down. */
export function formatMinutesSeconds(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds + 1e-6));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
