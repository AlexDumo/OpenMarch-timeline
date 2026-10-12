/**
 * The ground-truth format of the tempo test-show kit (see README.md). One file per map, written as
 * `<name>.json` next to the audio rendered from it. Every time is in seconds from the start of the
 * audio file, so a show's count times must be moved by the show's audio offset before comparing
 * (`score.mts` does this).
 *
 * This file only holds types, so `score.mts` can import it under Node's type stripping.
 */

/** What happens on a count, besides the click. */
export type TruthEvent = "hit" | "fermata" | "caesura";

/** One count: one OpenMarch beat. The pickup counts too. */
export interface TruthCount {
    /** 1-based. The show's beat with this position (beat 0 is the zero-length start beat) */
    index: number;
    /** Seconds from the start of the audio file */
    time: number;
    /** Seconds to the next count (to the end of the music for the last count) */
    duration: number;
    /** The score's measure number; a pickup is measure 0 */
    measure: number;
    /** 1-based count within the measure */
    beat: number;
    /** The count's note value in quarter notes: 1 = ♩, 1.5 = ♩., 0.5 = ♪ */
    unit: number;
    /** Quarter notes per minute played on this count (ramps change it count by count) */
    qpm: number;
    /** Quarter notes per minute printed in the score at this point (ramps keep their start mark) */
    markedQpm: number;
    /** On a measure's first count when the measure has a rehearsal mark */
    mark?: string;
    events?: TruthEvent[];
    /** For a fermata or caesura: the seconds the count would have had without it */
    plainDuration?: number;
}

/** One measure of the score. */
export interface TruthMeasure {
    number: number;
    /** `index` of its first count */
    firstCount: number;
    counts: number;
    /** As printed: "4/4", "7/8", "12/8" */
    meter: string;
    /** Beat-type units per count, e.g. [2, 2, 3] for 7/8 counted 2+2+3; null when even */
    grouping: number[] | null;
    mark?: string;
    /** Printed tempo text at the start of the measure, e.g. "♩=132", "♩.=88", "rit.", "a tempo" */
    text?: string[];
    /** A pickup bar (MusicXML `implicit="yes"`) */
    pickup?: boolean;
}

export interface TempoTruth {
    /** File stem: steady, score, rubato, corps, priya, … */
    name: string;
    title: string;
    /** Who the map is for and what it tests */
    description: string;
    personas: string[];
    /** Seconds of silence before the first count */
    leadIn: number;
    /** Seconds from the start of the audio to the end of the last count */
    end: number;
    /** Seconds of the rendered audio file (end plus a tail) */
    audioLength: number;
    /** The audio offset a show synced to this audio stores (`audioOffsetSeconds` = -leadIn) */
    syncedAudioOffsetSeconds: number;
    /** Measure number of the first measure, 0 when there is a pickup (`measurementOffset`) */
    firstMeasureNumber: number;
    /** `index` of the first count of each page in the kit's shows */
    pages: number[];
    counts: TruthCount[];
    measures: TruthMeasure[];
}
