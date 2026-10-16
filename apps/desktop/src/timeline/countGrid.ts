/**
 * Counts that never end (docs/tempo/endless-counts.md). A show's counts are its `beats` rows, but
 * the timeline draws, scrubs and plays on past the last one: the counts after it repeat the last
 * stored measure as it sounds (`countContinuation`), and its meter's measure lines carry on.
 * Nothing marks where the stored counts stop.
 *
 * The grid answers for any beat `b >= 0` and time `s >= 0`. Inside the stored counts it agrees
 * exactly with `timeMap.ts`, which stays for code that means "the stored counts" (conversion,
 * exports, the page converter). Past them it steps through the continuation's repeating pattern
 * (one length, or one measure's lengths) in closed form, so a count far past the end costs no
 * more than one near it.
 *
 * Beats are spec beats in show order, the fixed zero-length beat 0 included, with the cumulative
 * timestamps `calculateTimestamps` makes. Measures are given by the ordinal of their first beat.
 * Times are in seconds.
 */
import {
    countContinuation,
    FALLBACK_BEAT_DURATION,
    type CountContinuation,
} from "./showLength";
import {
    BEAT_BOUNDARY_EPSILON_SECONDS,
    beatAtTime as storedBeatAtTime,
    showEndTime,
    timeAtBeat as storedTimeAtBeat,
    type BeatTiming,
} from "./timeMap";

/** One count line in a range (`CountGrid.countsIn`) */
export interface GridCount {
    /** The count's spec beat */
    readonly beat: number;
    /** When it starts, in seconds of show time */
    readonly seconds: number;
    /** Its length in seconds */
    readonly duration: number;
    /** Whether a measure starts on it */
    readonly downbeat: boolean;
    /** Whether it is a stored `beats` row */
    readonly stored: boolean;
}

export interface CountGrid {
    /** How many counts are stored (`beats.length`, beat 0 included) */
    readonly storedCount: number;
    /** When the last stored count ends: where the endless counts begin */
    readonly storedEndSeconds: number;
    /** Whether the counts have measure lines, so the endless counts carry them on */
    readonly measured: boolean;
    /** Whether whole beat `beat` is a stored count */
    isStored(beat: number): boolean;
    /** Show time at a real-valued beat: no clamp at the stored end; 0 below beat 0 */
    timeAtBeat(beat: number): number;
    /** The real-valued beat at a show time: no clamp at the stored end; 0 before the first beat */
    beatAtTime(seconds: number): number;
    /** The length in seconds of whole beat `beat` */
    durationAt(beat: number): number;
    /** Whether a measure starts on whole beat `beat` */
    isDownbeat(beat: number): boolean;
    /**
     * Each count line from `fromBeat` to `toBeat` (whole beats, both ends included), for drawing
     * what is on screen. At most `limit` of them.
     */
    countsIn(fromBeat: number, toBeat: number, limit?: number): GridCount[];
}

/** The most counts `countsIn` returns unless asked for more: far more than a screen holds */
export const COUNTS_IN_LIMIT = 100_000;

/** The repeating pattern of the counts after the stored ones, with its running sums */
interface Pattern {
    /** Count lengths, one period */
    readonly lengths: readonly number[];
    /** `sums[i]` is the length of the first `i` counts of a period; `sums[P]` the whole period */
    readonly sums: readonly number[];
    /** Which count of the period the first endless count is */
    readonly phase: number;
}

/** The period of the continuation: one measure's counts with measures, else one count */
function patternOf(
    continuation: CountContinuation,
    measured: boolean,
): Pattern {
    // The continuation repeats with its meter; its downbeats mark where a period starts
    let period = 1;
    let phase = 0;
    if (measured) {
        // The first downbeat at or after the first endless count gives the phase; the next one
        // the period. Meters are small, so a short scan finds both.
        let first = -1;
        for (let k = 0; k < 4096; k++)
            if (continuation.isDownbeat(k)) {
                if (first < 0) first = k;
                else {
                    period = k - first;
                    break;
                }
            }
        phase = first <= 0 ? 0 : period - first;
    }
    const lengths = Array.from({ length: period }, (_, i) =>
        continuation.durationAt((i - phase + period) % period),
    );
    const sums = [0];
    for (const length of lengths) sums.push(sums[sums.length - 1]! + length);
    return { lengths, sums, phase };
}

/** Seconds from the start of the period to the start of its `n`th count (any `n >= 0`) */
const offsetOf = (pattern: Pattern, n: number): number => {
    const period = pattern.lengths.length;
    const whole = Math.floor(n / period);
    return whole * pattern.sums[period]! + pattern.sums[n - whole * period]!;
};

const NO_COUNTS: CountGrid = {
    storedCount: 0,
    storedEndSeconds: 0,
    measured: false,
    isStored: () => false,
    timeAtBeat: (beat) => (Number.isNaN(beat) ? NaN : 0),
    beatAtTime: (seconds) => (Number.isNaN(seconds) ? NaN : 0),
    durationAt: () => 0,
    isDownbeat: () => false,
    countsIn: () => [],
};

/**
 * The show's count grid. With no beats at all (a file still loading) every answer is 0, as in
 * `timeMap.ts`; every real show has beat 0.
 *
 * @param beats the show's beats, ascending by position, with cumulative timestamps
 * @param measureStarts ordinals of measures' first beats, in any order
 */
export function createCountGrid({
    beats,
    measureStarts,
    fallbackDuration = FALLBACK_BEAT_DURATION,
}: {
    beats: readonly BeatTiming[];
    measureStarts: readonly number[];
    fallbackDuration?: number;
}): CountGrid {
    if (beats.length === 0) return NO_COUNTS;
    const storedCount = beats.length;
    const storedEndSeconds = showEndTime(beats);
    const continuation = countContinuation({
        beats,
        measureStarts,
        fallbackDuration,
    });
    const measured = continuation.measured;
    const pattern = patternOf(continuation, measured);
    const period = pattern.lengths.length;
    const downbeats = new Set(measureStarts);
    const startOffset = offsetOf(pattern, pattern.phase);

    /** Seconds from the stored end to the start of endless count `k` (count `storedCount + k`) */
    const endlessOffset = (k: number) =>
        offsetOf(pattern, pattern.phase + k) - startOffset;
    const endlessLength = (k: number) =>
        pattern.lengths[(pattern.phase + k) % period]!;

    const timeAtBeat = (beat: number): number => {
        if (Number.isNaN(beat)) return NaN;
        if (beat < storedCount) return storedTimeAtBeat(beats, beat);
        const k = Math.floor(beat - storedCount);
        const fraction = beat - storedCount - k;
        return (
            storedEndSeconds + endlessOffset(k) + fraction * endlessLength(k)
        );
    };

    const beatAtTime = (seconds: number): number => {
        if (Number.isNaN(seconds)) return NaN;
        if (seconds + BEAT_BOUNDARY_EPSILON_SECONDS < storedEndSeconds)
            return storedBeatAtTime(beats, seconds);
        // Seconds into the pattern, counted from the start of a period
        const into =
            Math.max(seconds - storedEndSeconds, 0) +
            startOffset +
            BEAT_BOUNDARY_EPSILON_SECONDS;
        const whole = Math.floor(into / pattern.sums[period]!);
        const rest = into - whole * pattern.sums[period]!;
        // The last count of the period starting at or before `rest`
        let i = 0;
        while (i + 1 < period && pattern.sums[i + 1]! <= rest) i++;
        const n = whole * period + i;
        const k = Math.max(n - pattern.phase, 0);
        const begins = storedEndSeconds + endlessOffset(k);
        // The epsilon can put `seconds` a hair before the count's start: that is the boundary
        return (
            storedCount + k + Math.max(seconds - begins, 0) / endlessLength(k)
        );
    };

    const durationAt = (beat: number): number => {
        if (beat < 0) return 0;
        if (beat < storedCount) {
            const next = beats[beat + 1];
            return next
                ? next.timestamp - beats[beat]!.timestamp
                : beats[beat]!.duration;
        }
        return endlessLength(beat - storedCount);
    };

    const isDownbeat = (beat: number): boolean =>
        beat < storedCount
            ? downbeats.has(beat)
            : measured && continuation.isDownbeat(beat - storedCount);

    return {
        storedCount,
        storedEndSeconds,
        measured,
        isStored: (beat) =>
            Number.isInteger(beat) && beat >= 0 && beat < storedCount,
        timeAtBeat,
        beatAtTime,
        durationAt,
        isDownbeat,
        countsIn: (fromBeat, toBeat, limit = COUNTS_IN_LIMIT) => {
            const first = Math.max(0, Math.ceil(fromBeat));
            const last = Math.min(Math.floor(toBeat), first + limit - 1);
            const counts: GridCount[] = [];
            for (let beat = first; beat <= last; beat++)
                counts.push({
                    beat,
                    seconds: timeAtBeat(beat),
                    duration: durationAt(beat),
                    downbeat: isDownbeat(beat),
                    stored: beat < storedCount,
                });
            return counts;
        },
    };
}
