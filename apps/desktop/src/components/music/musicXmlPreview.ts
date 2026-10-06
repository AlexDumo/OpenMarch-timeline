import {
    formatTempoMarking,
    type Meter,
    type MusicXmlParseResult,
    type ParseWarning,
} from "@openmarch/musicxml-parser";

/**
 * Pure helpers for the MusicXML import preview: which measures get a row, and how a meter, a
 * tempo and the summary read. The dialog (`MusicXmlImportPreview.tsx`) only lays these out.
 */

export type PreviewTranslate = (
    key: string,
    params?: Record<string, string | number>,
) => string;

/** One row of the preview table. */
export interface PreviewRow {
    measureIndex: number;
    /** The file's measure number, as written ("0" for a pickup) */
    measure: string;
    rehearsalMark?: string;
    /** "6/8", "7/8 (2+2+3)"; set when the meter changes here */
    meter?: string;
    /** "♩. = 88"; set when a tempo marking is written here */
    tempo?: string;
    counts: number;
    warnings: ParseWarning[];
    notes: ParseWarning[];
}

/**
 * "7/8 (2+2+3)" for a grouped meter (written 7/8 or 2+2+3/8), "3/2 (in ♩)" for an x/2 meter
 * counted in quarters, "6/8" otherwise.
 */
export function meterLabel(meter: Meter): string {
    const parts = meter.text.split("/");
    if (meter.inQuarters) return `${meter.text} (in ♩)`;
    if (!meter.grouping || parts.length !== 2) return meter.text;
    const total = meter.grouping
        .split("+")
        .reduce((sum, g) => sum + Number(g), 0);
    return `${total}/${parts[1]} (${meter.grouping})`;
}

/**
 * The rows the preview shows. With `all` false, only measures where something happens: the
 * first measure, rehearsal marks, meter and tempo changes, and anything with a warning or note.
 */
export function previewRows(
    report: MusicXmlParseResult,
    { all = false }: { all?: boolean } = {},
): PreviewRow[] {
    const byMeasure = new Map<number, ParseWarning[]>();
    for (const w of report.warnings) {
        const list = byMeasure.get(w.measureIndex) ?? [];
        list.push(w);
        byMeasure.set(w.measureIndex, list);
    }
    const rows: PreviewRow[] = [];
    report.measures.forEach((m, i) => {
        const entries = byMeasure.get(i) ?? [];
        const row: PreviewRow = {
            measureIndex: i,
            measure: m.label ?? String(m.number),
            rehearsalMark: m.rehearsalMark,
            meter: m.meterChanged && m.meter ? meterLabel(m.meter) : undefined,
            tempo: m.tempo ? formatTempoMarking(m.tempo) : undefined,
            counts: m.beats.length,
            warnings: entries.filter((w) => w.severity === "warning"),
            notes: entries.filter((w) => w.severity === "info"),
        };
        const interesting =
            i === 0 ||
            row.rehearsalMark ||
            row.meter ||
            row.tempo ||
            entries.length > 0;
        if (all || interesting) rows.push(row);
    });
    return rows;
}

/** "A–H" for consecutive letters, otherwise the marks joined by commas. */
export function marksRange(marks: string[]): string {
    if (marks.length === 0) return "";
    if (marks.length === 1) return marks[0]!;
    const singleLetters = marks.every((m) => /^[A-Z]$/i.test(m));
    const consecutive = marks.every(
        (m, i) =>
            i === 0 || m.charCodeAt(0) === marks[i - 1]!.charCodeAt(0) + 1,
    );
    if (singleLetters && consecutive)
        return `${marks[0]}–${marks[marks.length - 1]}`;
    return marks.join(", ");
}

/** "m:ss" */
export const formatDuration = (seconds: number): string => {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The summary line's parts: "142 measures", "4 tempo changes", "marks A–H", "3 meter changes",
 * "2 warnings", "4:12". Parts that would say zero are left out, except measures and warnings.
 */
export function summaryParts(
    report: MusicXmlParseResult,
    t: PreviewTranslate,
): string[] {
    const s = report.summary;
    const parts = [
        t("music.xmlPreview.summary.measures", { count: s.measures }),
    ];
    if (s.tempoChanges > 0)
        parts.push(
            t("music.xmlPreview.summary.tempoChanges", {
                count: s.tempoChanges,
            }),
        );
    if (s.ramps > 0)
        parts.push(t("music.xmlPreview.summary.ramps", { count: s.ramps }));
    if (s.rehearsalMarks.length > 0)
        parts.push(
            t("music.xmlPreview.summary.marks", {
                marks: marksRange(s.rehearsalMarks),
            }),
        );
    if (s.meterChanges > 0)
        parts.push(
            t("music.xmlPreview.summary.meterChanges", {
                count: s.meterChanges,
            }),
        );
    parts.push(t("music.xmlPreview.summary.warnings", { count: s.warnings }));
    parts.push(formatDuration(s.durationSeconds));
    return parts;
}

/** A warning's text in the app's language (without the measure, which has its own column). */
export function warningText(w: ParseWarning, t: PreviewTranslate): string {
    const params = { ...w.params };
    if (w.code === "ramp-not-applied")
        params.reason = t(`music.xmlPreview.rampReasons.${w.params.reason}`, {
            window: w.params.window ?? "",
        });
    return t(`music.xmlPreview.warnings.${w.code}`, params);
}

/**
 * The measure number the app should start from so its measure row reads like the score: the
 * file's first number (0 for a pickup). Undefined when the file's first number isn't a number.
 */
export function firstMeasureNumber(
    report: MusicXmlParseResult,
): number | undefined {
    const first = report.measures[0];
    if (!first || first.number < 0) return undefined;
    return first.number;
}
