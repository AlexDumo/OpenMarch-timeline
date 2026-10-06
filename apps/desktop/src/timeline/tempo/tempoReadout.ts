/**
 * Tempo read-outs ("♩ ≈ 138") from count durations. Pure.
 */
import { spanOf, type CountDurations } from "./retime";

/** Relative difference under which two counts count as the same length. */
export const EVEN_TOLERANCE = 1e-9;

/** The average tempo of `[from, to)` in BPM, or null for an empty or zero-length range. */
export function bpmOfRange(
    durations: CountDurations,
    from: number,
    to: number,
): number | null {
    const span = spanOf(durations, from, to);
    if (to <= from || !(span > 0)) return null;
    return (60 * (to - from)) / span;
}

/** Whether every count in `[from, to)` has the same length, so the tempo is exact, not "≈". */
export function isEvenRange(
    durations: CountDurations,
    from: number,
    to: number,
): boolean {
    if (to - from < 2) return true;
    const first = durations[from];
    for (let i = from + 1; i < to; i++)
        if (
            Math.abs(durations[i] - first) >
            EVEN_TOLERANCE * Math.max(first, 1)
        )
            return false;
    return true;
}

export interface RangeTempo {
    readonly from: number;
    readonly to: number;
    /** Average BPM, or null for a page with no length. */
    readonly bpm: number | null;
    /** True when all counts are the same length (show "♩ = 120" rather than "♩ ≈ 120"). */
    readonly even: boolean;
}

/**
 * The average tempo of each page. `pageStarts` are the count indexes where pages start, ascending;
 * each page runs to the next start, and the last runs to `end` (default: the end of the show).
 */
export function pageTempos(
    durations: CountDurations,
    pageStarts: readonly number[],
    end: number = durations.length,
): RangeTempo[] {
    return pageStarts.map((from, i) => {
        const to = i + 1 < pageStarts.length ? pageStarts[i + 1] : end;
        return {
            from,
            to,
            bpm: bpmOfRange(durations, from, to),
            even: isEvenRange(durations, from, to),
        };
    });
}
