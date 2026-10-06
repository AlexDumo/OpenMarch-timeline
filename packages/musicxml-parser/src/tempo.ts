/**
 * Tempo markings: reading `<sound tempo>`, `<metronome>` and written tempo text, and showing a
 * marking the way a score prints it ("♩. = 88").
 *
 * `<sound tempo>` is always quarter notes per minute (MusicXML spec), so it is the playback
 * truth when present. `<metronome>` is what the score prints: a beat unit (with dots) and a
 * number per minute, so ♩. = 88 is 132 quarters per minute.
 */

/** A note value a metronome mark can use. */
export type BeatUnit =
    | "long"
    | "breve"
    | "whole"
    | "half"
    | "quarter"
    | "eighth"
    | "16th"
    | "32nd";

const QUARTERS_PER_UNIT: Record<BeatUnit, number> = {
    long: 16,
    breve: 8,
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    "16th": 0.25,
    "32nd": 0.125,
};

export const isBeatUnit = (value: string): value is BeatUnit =>
    value in QUARTERS_PER_UNIT;

/** Length of a (dotted) note value in quarter notes: a dot adds half, a second dot a quarter. */
export function unitQuarters(unit: BeatUnit, dots = 0): number {
    const base = QUARTERS_PER_UNIT[unit];
    return base * (2 - 1 / 2 ** dots);
}

/** A tempo as the score shows it. */
export interface TempoMarking {
    /** Quarter notes per minute: what the counts are timed from */
    quarterBpm: number;
    /** The note value the marking counts in */
    beatUnit: BeatUnit;
    /** Dots on the beat unit (♩. is one) */
    dots: number;
    /** The marking's number, in beat units per minute */
    perMinute: number;
    /** True when the file's number was approximate ("c. 132", "126-132") */
    approximate?: boolean;
    /** True when the file gave no beat unit and it was taken from the meter's count */
    derived?: boolean;
}

/** The result of reading a `<per-minute>` text. */
export type PerMinuteReading =
    | { ok: true; value: number; approximate: boolean }
    | { ok: false };

/**
 * Reads the number from a `<per-minute>` text. "132" and "127.5" are exact. "c. 132", "ca 132",
 * "~132" and ranges like "126-132" are read as their first number and marked approximate.
 * Anything without a positive number ("fast", "", "0") is not a tempo.
 */
export function readPerMinute(text: string): PerMinuteReading {
    const trimmed = text.trim();
    const exact = trimmed.match(/^(\d+(?:[.,]\d+)?)$/);
    const first = trimmed.match(/(\d+(?:[.,]\d+)?)/);
    const match = exact ?? first;
    if (!match) return { ok: false };
    const value = Number(match[1]!.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return { ok: false };
    return { ok: true, value, approximate: !exact };
}

/** Reads a `tempo` attribute of `<sound>`; undefined when it isn't a positive number. */
export function readSoundTempo(value: string): number | undefined {
    const tempo = Number(value.trim());
    return Number.isFinite(tempo) && tempo > 0 ? tempo : undefined;
}

/** Note-value glyphs and words for showing a marking. */
const UNIT_LABEL: Record<BeatUnit, string> = {
    long: "long",
    breve: "breve",
    whole: "whole",
    half: "half",
    quarter: "♩",
    eighth: "♪",
    "16th": "16th",
    "32nd": "32nd",
};

/** A number with at most two decimals and no trailing zeros: 132, 127.5, 117.33. */
export const formatBpm = (bpm: number): string =>
    String(Math.round(bpm * 100) / 100);

/** A marking the way a score prints it: "♩ = 132", "♩. = 88", "c. ♩ = 132", "half = 66". */
export function formatTempoMarking(marking: TempoMarking): string {
    const unit = UNIT_LABEL[marking.beatUnit] + ".".repeat(marking.dots);
    return `${marking.approximate ? "c. " : ""}${unit} = ${formatBpm(marking.perMinute)}`;
}

/**
 * The marking to show for a quarter-note tempo when the file gave no beat unit: in the meter's
 * own count when all its counts are one plain or dotted note value (6/8 shows ♩.), otherwise in
 * quarters.
 */
export function markingFromQuarterBpm(
    quarterBpm: number,
    countQuarters: number[],
): TempoMarking {
    const first = countQuarters[0];
    const uniform =
        first !== undefined && countQuarters.every((c) => c === first);
    if (uniform) {
        for (const unit of ["half", "quarter", "eighth"] as BeatUnit[]) {
            for (const dots of [0, 1]) {
                if (unitQuarters(unit, dots) === first)
                    return {
                        quarterBpm,
                        beatUnit: unit,
                        dots,
                        perMinute: quarterBpm / first,
                        derived: true,
                    };
            }
        }
    }
    return {
        quarterBpm,
        beatUnit: "quarter",
        dots: 0,
        perMinute: quarterBpm,
        derived: true,
    };
}

/** Glyphs some programs write as tempo text instead of a `<metronome>`. */
const GLYPH_UNITS: Record<string, BeatUnit> = {
    "♩": "quarter",
    "♪": "eighth",
    "\u{1D15E}": "half",
    "\u{1D15F}": "quarter",
    "\u{1D160}": "eighth",
};

/**
 * Reads a tempo written as text, like "Allegro ♩ = 132" or "♩. = c. 88". Undefined when the text
 * has no note glyph followed by "=" and a number.
 */
export function readTempoText(text: string): TempoMarking | undefined {
    const match = text.match(
        /(♩|♪|\u{1D15E}|\u{1D15F}|\u{1D160})\s*(\.*)\s*=\s*((?:c\.?|ca\.?|circa|~)?\s*\d+(?:[.,]\d+)?)/u,
    );
    if (!match) return undefined;
    const unit = GLYPH_UNITS[match[1]!];
    const reading = readPerMinute(match[3]!);
    if (!unit || !reading.ok) return undefined;
    const dots = match[2]!.length;
    return {
        quarterBpm: reading.value * unitQuarters(unit, dots),
        beatUnit: unit,
        dots,
        perMinute: reading.value,
        approximate: reading.approximate || undefined,
    };
}

/** Words that start a gradual slow-down. */
const SLOWER =
    /\b(rit|ritard|ritardando|ritenuto|riten|rall|rallentando|allarg|allargando|slower|slowing)\b\.?/i;
/** Words that start a gradual speed-up. */
const FASTER = /\b(accel|accelerando|stringendo|faster)\b\.?/i;
/** Words that return to the tempo before a rit. or accel. */
const A_TEMPO = /\ba\s+tempo\b/i;
/** Words that return to the first tempo. */
const TEMPO_PRIMO = /\btempo\s+(i|1|primo)\b/i;
/** Common tempo words that name a speed without giving a number. */
const TEMPO_WORDS =
    /^\s*(grave|largo|larghetto|lento|adagio|adagietto|andante|andantino|moderato|allegretto|allegro|vivace|vivo|presto|prestissimo|maestoso|march|marcia|ballad|swing|tempo di [a-z]+)\b/i;

/** What a direction's words say about tempo. */
export type TempoWords =
    | { kind: "slower" | "faster"; text: string }
    | { kind: "a-tempo"; text: string }
    | { kind: "tempo-primo"; text: string }
    | { kind: "tempo-word"; text: string };

/** Classifies tempo words. "a tempo" and "Tempo I" are checked before rit. and accel. */
export function readTempoWords(text: string): TempoWords | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (TEMPO_PRIMO.test(trimmed))
        return { kind: "tempo-primo", text: trimmed };
    if (A_TEMPO.test(trimmed)) return { kind: "a-tempo", text: trimmed };
    if (SLOWER.test(trimmed)) return { kind: "slower", text: trimmed };
    if (FASTER.test(trimmed)) return { kind: "faster", text: trimmed };
    if (TEMPO_WORDS.test(trimmed)) return { kind: "tempo-word", text: trimmed };
    return undefined;
}
