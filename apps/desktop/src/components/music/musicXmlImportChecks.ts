import {
    warningMessage,
    type MusicXmlParseResult,
    type ParseWarningCode,
} from "@openmarch/musicxml-parser";

/** One thing to check in the score after an import, with the measures it is in. */
export interface ImportCheck {
    code: ParseWarningCode;
    /** What to check, in English (the parser's message without its measure) */
    message: string;
    /** The measures, as the file numbers them, in the order they are played */
    measures: string[];
}

/**
 * Warnings that are about the file rather than the counts, so they aren't worth a check: the
 * app numbers measures by itself.
 */
const NOT_A_CHECK: ReadonlySet<ParseWarningCode> = new Set(["measure-numbers"]);

/**
 * The things to check after importing a score: the parser's warnings (not its notes, which say
 * it did the expected thing), with the same check in several measures as one check listing them.
 * A check whose text changes from measure to measure (a tempo, a jump) is listed once per text.
 */
export function importChecks(result: MusicXmlParseResult): ImportCheck[] {
    const checks = new Map<string, ImportCheck>();
    for (const warning of result.warnings) {
        if (warning.severity !== "warning" || NOT_A_CHECK.has(warning.code))
            continue;
        const message = warningMessage(warning);
        const key = `${warning.code}\n${message}`;
        const check = checks.get(key) ?? {
            code: warning.code,
            message,
            measures: [],
        };
        const label = result.measures[warning.measureIndex]?.label;
        if (label !== undefined && !check.measures.includes(label))
            check.measures.push(label);
        checks.set(key, check);
    }
    return [...checks.values()];
}
