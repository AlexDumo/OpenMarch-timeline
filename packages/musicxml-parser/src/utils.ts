import type { Meter } from "./meter";
import type { TempoMarking } from "./tempo";

/**
 * Represents a beat in a musical performance or composition.
 * Provides details about the beat's position, duration, and optional notes.
 *
 * Includes only specific properties needed for parsing functionality.
 */
export interface Beat {
    /** Duration from this beat to the next in seconds. This is derived from tempo */
    duration: number;
    /** Human-readable notes about this beat. These are not the musical "notes" that are played. */
    notes?: string;
}

/**
 * Represents a musical measure in a musical composition.
 * Contains information about the structure and content of a specific measure.
 *
 * Includes only specific properties needed for parsing functionality.
 */
export interface Measure {
    /**
     * The measure's number as the file writes it, as an integer (-1 when it has none). Not unique:
     * a repeated measure keeps its number each time it is played.
     */
    number: number;
    /** Optional rehearsal mark for the measure. I.e. "Big Box A" or "Measure 128" */
    rehearsalMark?: string;
    /** Human-readable notes about the measure. These are not the musical "notes" that are played. */
    notes?: string;
    /** The beats that belong to this measure */
    beats: Beat[];
    /**
     * The measure number as the file writes it (the `number` attribute), for example "0" for a
     * pickup or "12a". `number` is its integer value, or -1 when it has none.
     */
    label?: string;
    /** True for a measure the score doesn't count (`implicit="yes"`), such as a pickup */
    implicit?: boolean;
    /** The meter in effect in this measure, and how it is counted */
    meter?: Meter;
    /** True when the meter differs from the previous measure's (and for the first measure) */
    meterChanged?: boolean;
    /** The tempo marking written in this measure (the last one, when there are several) */
    tempo?: TempoMarking;
    /** Index of the written measure this is (repeats play a written measure more than once) */
    writtenIndex?: number;
    /** How many times the written measure has been played, counting this time (1 the first time) */
    time?: number;
}

/**
 * 60 seconds divided by beats per minute gives us the number of seconds per quarter note.
 * @param tempo
 */
export function secondsPerQuarterNote(tempo: number): number {
    if (tempo <= 0) throw new Error("Invalid tempo: " + tempo);

    return 60 / tempo;
}
