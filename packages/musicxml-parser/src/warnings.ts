/**
 * What the parser couldn't read, had to guess, or read in a way worth checking. Each entry has a
 * stable `code` and `params`, so an app can show its own translated text, and an English
 * `message` for everyone else.
 */

export type ParseWarningCode =
    /** A `<time>` the counting rule doesn't cover; the previous meter is kept */
    | "unknown-meter"
    /** The file gave no grouping for a meter like 7/8; the rule's grouping was used */
    | "assumed-grouping"
    /** No time signature before the first measure; 4/4 was used */
    | "no-time-signature"
    /** A pickup measure got only the counts its music fills */
    | "pickup"
    /** A pickup isn't a whole number of counts; it was rounded up */
    | "pickup-rounded"
    /** A tempo number that isn't a positive number; the previous tempo is kept */
    | "invalid-tempo"
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
    /** A repeat: the music is counted once, not played out */
    | "repeat"
    /** D.C. or D.S.: the jump is not played out */
    | "jump"
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

const RAMP_REASONS: Record<string, string> = {
    "no-target": "no tempo marking says where it arrives",
    "too-far": "the next tempo marking is more than {window} measures later",
    "wrong-direction": "the next tempo marking goes the other way",
};

const MESSAGES: Record<ParseWarningCode, string> = {
    "unknown-meter": "{meter} isn't a meter OpenMarch can count; kept {kept}",
    "assumed-grouping":
        "{meter} has no grouping in the file; counted {grouping}",
    "no-time-signature": "No time signature; counted {meter}",
    pickup: "Pickup: {counts} count(s)",
    "pickup-rounded":
        "Pickup is {quarters} quarter note(s), not a whole number of counts; given {counts} count(s)",
    "invalid-tempo": 'Tempo "{text}" isn\'t a number; kept {kept}',
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
    "measure-numbers":
        "The file's measure numbers aren't consecutive after m{previous}; OpenMarch numbers this measure m{appNumber}",
};

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
    const text = fill(MESSAGES[warning.code], params);
    return measureLabel ? `m${measureLabel}: ${text}` : text;
}
