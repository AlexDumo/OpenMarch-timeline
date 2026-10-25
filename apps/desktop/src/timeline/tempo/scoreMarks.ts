/**
 * The tempo map marks a MusicXML score gives its measures (FX-3): the meter as the score counts
 * it (6/8 in ♩., 7/8 2+2+3, 3/2 in ♩, the pickup's 4/4) and the unit and number of each tempo
 * marking, so the map reads "6/8 ♩.=88" rather than "2/4 ♩=88". Pure.
 */
import {
    UNIT_SIXTEENTHS,
    defaultUnit,
    meterFromWeights,
    type BeatUnit,
    type Meter,
} from "./tempoMapParse";
import type { TempoMapMark } from "./tempoMap";

/** A measure as the parser reads it (`@openmarch/musicxml-parser`'s `Measure`), as far as marks go. */
export interface ScoreMarkMeasure {
    readonly meter?: {
        readonly text: string;
        /** Each count's length in quarter notes */
        readonly counts: readonly number[];
        readonly inQuarters?: boolean;
    };
    readonly meterChanged?: boolean;
    readonly tempo?: {
        readonly quarterBpm: number;
        readonly beatUnit: string;
        readonly dots: number;
    };
}

/** The tempo map's unit for a metronome mark's note, or null for one it has no unit for. */
export function unitOfMarking(beatUnit: string, dots: number): BeatUnit | null {
    if (dots > 1) return null;
    const plain: Record<string, BeatUnit> = {
        "16th": "s",
        eighth: "e",
        quarter: "q",
        half: "h",
    };
    const unit = plain[beatUnit];
    if (!unit) return null;
    if (dots === 0) return unit;
    if (unit === "s") return null;
    return `d${unit}` as BeatUnit;
}

const QUARTER_SIXTEENTHS = 4;

/** The tempo map's meter for the parser's, with the score's own text when it counts differently. */
export function meterOfScore(
    meter: NonNullable<ScoreMarkMeasure["meter"]>,
): { meter: Meter; label?: string } | null {
    const weights = meter.counts.map((c) => c * QUARTER_SIXTEENTHS);
    if (
        weights.length === 0 ||
        weights.some((w) => !Number.isInteger(w) || w < 1)
    )
        return null;
    const counted = meterFromWeights(weights);
    // "3/2" counted in ♩ is 6/4 here, "3/4+3/8" is 9/8 2+2+2+3: keep the score's words
    const composite = (meter.text.match(/\//g) ?? []).length > 1;
    return meter.inQuarters || composite
        ? { meter: counted, label: meter.text }
        : { meter: counted };
}

/**
 * A mark at the first measure, at every meter change and at every tempo marking, by measure
 * index. A marking gives the unit and number; a meter change without one takes the meter's usual
 * unit (♩. in 6/8, ♩ in 7/8 2+2+3).
 */
export function scoreTempoMarks(
    measures: readonly ScoreMarkMeasure[],
): Map<number, TempoMapMark> {
    const marks = new Map<number, TempoMapMark>();
    measures.forEach((m, i) => {
        const meterChange = i === 0 || m.meterChanged === true;
        if (!meterChange && !m.tempo) return;
        const read = m.meter ? meterOfScore(m.meter) : null;
        const markingUnit = m.tempo
            ? unitOfMarking(m.tempo.beatUnit, m.tempo.dots)
            : null;
        const unit: BeatUnit =
            markingUnit ?? (read ? defaultUnit(read.meter) : "q");
        // From the quarter tempo the counts are timed from (a <sound tempo> wins over the print)
        const bpm = m.tempo
            ? (m.tempo.quarterBpm * QUARTER_SIXTEENTHS) / UNIT_SIXTEENTHS[unit]
            : undefined;
        marks.set(i, {
            ...(read ? { meter: read.meter } : {}),
            unit,
            ...(bpm !== undefined ? { bpm } : {}),
            source: "import",
            ...(read?.label ? { label: read.label } : {}),
        });
    });
    return marks;
}
