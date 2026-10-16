/**
 * What the parser couldn't read, had to guess, or read in a way worth checking. Each entry has a
 * stable `code` and `params`, so an app can show its own translated text, and an English
 * `message` for everyone else.
 */

export type ParseWarningCode =
    /**
     * A `<time>` the counting rule doesn't cover; the previous meter (`kept`) is kept. With no
     * meter before it, `kept` is left out and the music is counted in quarters, as with no time
     * signature
     */
    | "unknown-meter"
    /** The file gave no grouping for a meter like 7/8; the rule's grouping was used */
    | "assumed-grouping"
    /** No time signature before the first measure; counted in quarters, as long as the music */
    | "no-time-signature"
    /** A pickup measure got only the counts its music fills */
    | "pickup"
    /** A pickup isn't a whole number of counts; it was rounded up */
    | "pickup-rounded"
    /** A short measure that completes a pickup got the counts the pickup didn't */
    | "completes-pickup"
    /** A measure longer than its meter got extra counts for its music */
    | "long-measure"
    /** A measure shorter than its meter got only the counts its music fills */
    | "short-measure"
    /** A short measure isn't a whole number of counts; it was rounded up */
    | "short-measure-rounded"
    /** A tempo number that isn't a positive number; the previous tempo is kept */
    | "invalid-tempo"
    /** The printed tempo and the tempo the file plays (`<sound tempo>`) differ; played was used */
    | "printed-tempo-differs"
    /** A `<sound tempo>` that was a mistake in the file; the printed tempo was used */
    | "sound-tempo-ignored"
    /** A tempo so slow or fast it is likely a mistake in the file */
    | "unusual-tempo"
    /** An approximate tempo ("c. 132") was read as its number */
    | "approximate-tempo"
    /** A metric modulation (♩. = ♩) with no number; read as "new note = old note" */
    | "metric-modulation"
    /** A tempo word ("Allegro") with no number in its measure */
    | "tempo-word-without-number"
    /** No tempo in the whole file */
    | "no-tempo"
    /** No tempo at the first count */
    | "no-start-tempo"
    /** A rit. or accel. that was applied up to the next marking */
    | "ramp-applied"
    /** A rit. or accel. whose target tempo isn't known; the counts keep their tempo */
    | "ramp-not-applied"
    /** "a tempo" went back to the tempo before the last rit. or accel. */
    | "a-tempo"
    /** "Tempo I" went back to the first tempo */
    | "tempo-primo"
    /** "a tempo" with no rit. or accel. before it */
    | "a-tempo-unknown"
    /** A fermata: its count keeps its length */
    | "fermata"
    /** A repeat, read with `repeats: "once"`: the music is counted once, not played out */
    | "repeat"
    /** D.C. or D.S., read with `repeats: "once"`: the jump is not played out */
    | "jump"
    /** A repeat that was played out */
    | "repeat-played"
    /** D.C. or D.S. that was played out */
    | "jump-played"
    /** A jump read from words with no symbol or playback mark: worth checking */
    | "navigation-from-words"
    /** D.S. with no segno: not played */
    | "missing-segno"
    /** To Coda with no coda after it: not played */
    | "missing-coda"
    /** An ending no repeat leads to: played straight through */
    | "unreachable-ending"
    /** Repeats that would play for too long: stopped */
    | "endless-repeats"
    /** Parts with a different number of measures than the first part */
    | "mismatched-parts"
    /** The file's measure numbers aren't consecutive from here */
    | "measure-numbers";

export interface ParseWarning {
    code: ParseWarningCode;
    /** "warning": the counts may not match the music. "info": read as the score says, FYI */
    severity: "warning" | "info";
    /** Index of the measure in the parse result (0 is the first measure in the file) */
    measureIndex: number;
    params: Record<string, string | number>;
    /** English text, starting with the measure ("m33: …") */
    message: string;
}

const SOUND_REASONS: Record<string, string> = {
    "beat-unit": "the printed number in the wrong note value",
    implausible: "which can't be meant",
};

const RAMP_REASONS: Record<string, string> = {
    "no-target": "no tempo marking says where it arrives",
    "too-far": "the next tempo marking is more than {window} measures later",
    "wrong-direction": "the next tempo marking goes the other way",
};

const MESSAGES: Record<ParseWarningCode, string> = {
    "unknown-meter": "{meter} isn't a meter OpenMarch can count; kept {kept}",
    "assumed-grouping":
        "{meter} has no grouping in the file; counted {grouping}",
    "no-time-signature":
        "No time signature; each measure counted in quarter notes, as long as its music",
    pickup: "Pickup: {counts} count(s)",
    "long-measure":
        "Holds {quarters} quarter note(s), more than {meter}; given {counts} count(s)",
    "completes-pickup": "Completes the pickup in m{pickup}: {counts} count(s)",
    "short-measure":
        "Shorter than {meter}: {counts} count(s), as the music is written",
    "short-measure-rounded":
        "Shorter than {meter} ({quarters} quarter note(s)), not a whole number of counts; given {counts} count(s)",
    "pickup-rounded":
        "Pickup is {quarters} quarter note(s), not a whole number of counts; given {counts} count(s)",
    "invalid-tempo": 'Tempo "{text}" isn\'t a number; kept {kept}',
    "printed-tempo-differs":
        "The score shows {printed} but plays {tempo}; used {tempo}",
    "sound-tempo-ignored":
        "The file plays {sound} quarters a minute, {reason}; used the printed {tempo}",
    "unusual-tempo": "{tempo} is an unusual tempo; check it in the score",
    "approximate-tempo": "Approximate tempo read as {tempo}",
    "metric-modulation":
        "Metric modulation {text} has no number; read as the new note lasting as long as the old one: {tempo}",
    "tempo-word-without-number":
        '"{text}" has no metronome number; the tempo doesn\'t change',
    "no-tempo": "No tempo marking in the file; all counts use {tempo}",
    "no-start-tempo":
        "No tempo at the start; counts before the first marking use {tempo}",
    "ramp-applied": "{text} from {from} to {to} at m{target}",
    "ramp-not-applied": "{text} not applied: {reason}",
    "a-tempo": "{text}: back to {tempo}",
    "tempo-primo": "{text}: back to {tempo}",
    "a-tempo-unknown": '"{text}" has no rit. or accel. before it; kept {kept}',
    fermata: "Fermata: its count keeps its length",
    repeat: "Repeat: the music is counted once, not played out",
    jump: "{jump}: the jump is not played out",
    "repeat-played": "Repeat: played {times} times",
    "jump-played": "{jump}: played out",
    "navigation-from-words":
        '"{text}" read as a jump from its words; check where it goes',
    "missing-segno": "D.S. has no segno to go back to; not played",
    "missing-coda": "To Coda has no coda after it; not played",
    "unreachable-ending":
        "Ending {numbers} has no repeat before it; played straight through",
    "endless-repeats": "The repeats don't end; stopped after {played} measures",
    "mismatched-parts":
        "Some parts have a different number of measures ({parts}); the first part's were used",
    "measure-numbers":
        "The file's measure numbers aren't consecutive after m{previous}; OpenMarch numbers this measure m{appNumber}",
};

/** An unread signature with no meter before it to keep: counted as if there were none. */
const UNKNOWN_FIRST_METER =
    "{meter} isn't a meter OpenMarch can count; each measure counted in quarter notes, as long as its music";

const fill = (template: string, params: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) =>
        String(params[key] ?? ""),
    );

/** The English message for a warning, starting with its measure when it has one. */
export function warningMessage(
    warning: Omit<ParseWarning, "message">,
    measureLabel?: string,
): string {
    const params = { ...warning.params };
    if (warning.code === "ramp-not-applied")
        params.reason = fill(
            RAMP_REASONS[String(params.reason)] ?? String(params.reason),
            params,
        );
    if (warning.code === "sound-tempo-ignored")
        params.reason =
            SOUND_REASONS[String(params.reason)] ?? String(params.reason);
    const template =
        warning.code === "unknown-meter" && params.kept === undefined
            ? UNKNOWN_FIRST_METER
            : MESSAGES[warning.code];
    const text = fill(template, params);
    return measureLabel ? `m${measureLabel}: ${text}` : text;
}
