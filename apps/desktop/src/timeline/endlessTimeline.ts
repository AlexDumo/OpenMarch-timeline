/**
 * The counts the timeline draws past the last stored one (docs/timeline/endless-counts.md rules 1, 6
 * and 7). The timeline's lanes draw `Beat`s and `Measure`s, so past the stored counts it gets
 * stand-ins from the count grid (`countGrid.ts`) up to the scroll extent: beats and measures with
 * negative ids that nothing stores. They look the same as stored ones. A write that lands on one
 * stores the counts first (`ensureCountsInTransaction`); an edit that names an endless measure by
 * id finds its beat with `endlessBeatOfId`.
 */
import type Beat from "@/global/classes/Beat";
import type Measure from "@/global/classes/Measure";
import type { CountGrid } from "./countGrid";
import { musicEndBeat } from "./countsPastEnd";

/** Endless ids are this minus the spec beat, far below any stored id or `tempBeat`'s -1 */
const ENDLESS_ID_BASE = -1_000_000;

/** The id an endless beat or measure at spec beat `beat` gets */
export const endlessIdOf = (beat: number) => ENDLESS_ID_BASE - beat;

/** The spec beat of an endless beat's or measure's id, or null for a stored one */
export const endlessBeatOfId = (id: number): number | null =>
    id <= ENDLESS_ID_BASE ? ENDLESS_ID_BASE - id : null;

/**
 * The stored beats and, after them, endless ones up to spec beat `through` (exclusive), timed by
 * the grid. The same array when nothing is past the stored counts.
 */
export function beatsThrough(
    grid: CountGrid,
    beats: readonly Beat[],
    through: number,
): readonly Beat[] {
    const end = Math.floor(through);
    if (end <= beats.length || beats.length === 0) return beats;
    const last = beats[beats.length - 1]!;
    const out = beats.slice();
    for (let index = beats.length; index < end; index++)
        out.push({
            id: endlessIdOf(index),
            position: last.position + (index - beats.length) + 1,
            duration: grid.durationAt(index),
            includeInMeasure: true,
            notes: null,
            index,
            timestamp: grid.timeAtBeat(index),
        });
    return out;
}

/**
 * The counts the metronome clicks (EC-6): the stored ones and endless ones up to the stop point
 * `stopBeat`, which is a count boundary. The count starting at the stop point is left out, so no
 * click lands where playing on stops; with only stored counts it is the stored beats, as before
 * endless counts.
 */
export function metronomeBeats(
    grid: CountGrid,
    beats: readonly Beat[],
    stopBeat: number,
): readonly Beat[] {
    return beatsThrough(grid, beats, stopBeat);
}

/**
 * The stored measures and, after them, the endless measures that start before `drawn` ends (the
 * output of `beatsThrough`), numbered on from the last stored measure. The same array when none
 * starts past the stored counts.
 */
export function measuresThrough(
    grid: CountGrid,
    measures: readonly Measure[],
    drawn: readonly Beat[],
    measurementNumberOffset = 1,
): readonly Measure[] {
    if (!grid.measured || drawn.length <= grid.storedCount) return measures;
    const starts: number[] = [];
    for (let beat = grid.storedCount; beat < drawn.length; beat++)
        if (grid.isDownbeat(beat)) starts.push(beat);
    if (starts.length === 0) return measures;
    const last = measures[measures.length - 1];
    let number = last ? last.number + 1 : measurementNumberOffset;
    const out = measures.slice();
    starts.forEach((start, i) => {
        const end = starts[i + 1] ?? drawn.length;
        const beats = drawn.slice(start, end) as Beat[];
        const startBeat = drawn[start]!;
        out.push({
            id: endlessIdOf(start),
            startBeat,
            number: number++,
            rehearsalMark: null,
            notes: null,
            duration: beats.reduce((sum, beat) => sum + beat.duration, 0),
            counts: beats.length,
            beats,
            timestamp: startBeat.timestamp,
        });
    });
    return out;
}

/**
 * Where playback stops and Fit fits (rule 6): the latest of the show's end (the last page's
 * flag), the end of the music and the end of the last move, as a spec beat. The music's end is
 * a time, so it is the first whole count at or after it.
 */
export function playbackStopBeat({
    grid,
    showEndBeat,
    musicEndSeconds,
    lastMoveEndBeat,
}: {
    grid: CountGrid;
    showEndBeat: number;
    musicEndSeconds: number | null;
    lastMoveEndBeat: number;
}): number {
    const musicBeat =
        musicEndSeconds !== null ? musicEndBeat(grid, musicEndSeconds) : 0;
    return Math.max(showEndBeat, musicBeat, lastMoveEndBeat);
}

/**
 * The moves that run past the show's end (rule 9), which exports leave out: how many end after
 * it, and where the last one ends (a spec beat). `count` is 0 when every move ends by the end.
 */
export function movesPastEnd(
    timelines: readonly { readonly start: number; readonly end: number }[],
    showEndBeat: number,
): { readonly count: number; readonly lastEndBeat: number } {
    let count = 0;
    let lastEndBeat = showEndBeat;
    for (const timeline of timelines)
        if (timeline.end > showEndBeat) {
            count++;
            lastEndBeat = Math.max(lastEndBeat, timeline.end);
        }
    return { count, lastEndBeat };
}
