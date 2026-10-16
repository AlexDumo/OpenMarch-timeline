import { type Measure, type Beat } from "./utils";
import {
    DEFAULT_METER,
    meterFromTimeSignature,
    meterLength,
    type Meter,
} from "./meter";
import {
    formatBeatUnit,
    formatBpm,
    formatTempoMarking,
    markingFromQuarterBpm,
    unitQuarters,
    type BeatUnit,
    type TempoMarking,
} from "./tempo";
import { performanceOrder, type PerformanceIssue } from "./perform";
import { parseXmlDocument } from "./read";
import {
    scanScore,
    type RawEvent,
    type RawMeasure,
    type ScanResult,
} from "./scan";
import {
    warningMessage,
    type ParseWarning,
    type ParseWarningCode,
} from "./warnings";

/** Quarter notes per minute when a file has no tempo before its first marking. */
export const DEFAULT_QUARTER_BPM = 120;

/**
 * How far after a rit. or accel. its target tempo may be, in measures. A numbered tempo within
 * this many measures after the words is read as where the change arrives, and the counts between
 * get evenly changing tempos. Further away, the change is reported and not applied.
 */
export const RAMP_TARGET_WINDOW_MEASURES = 4;

/** A gradual tempo change written as words (rit., rall., accel.). */
export interface TempoRamp {
    kind: "slower" | "faster";
    /** The words as written, for example "poco rit." */
    text: string;
    /** Index (in the parse result's measures) of the measure the words are in */
    startMeasureIndex: number;
    /** Index of the measure the target tempo arrives in, when it was applied */
    targetMeasureIndex?: number;
    /** True when the counts were given changing tempos; false when only reported */
    applied: boolean;
    /** Quarter notes per minute where the change starts */
    fromQuarterBpm: number;
    /** Quarter notes per minute the change arrives at, when applied */
    toQuarterBpm?: number;
}

/** What an import would bring in, in numbers, for a preview's summary line. */
export interface ParseSummary {
    /** Measures as played (a repeated measure counts once per time it is played) */
    measures: number;
    /** Measures as written in the file */
    writtenMeasures: number;
    counts: number;
    /** Markings that change the tempo after the first one, including "a tempo" and "Tempo I" */
    tempoChanges: number;
    /** rit. and accel. that were applied */
    ramps: number;
    meterChanges: number;
    /** Each rehearsal mark once, in the order first played */
    rehearsalMarks: string[];
    /** Entries of severity "warning" (notes of severity "info" are not counted) */
    warnings: number;
    /** Length of all counts, in seconds */
    durationSeconds: number;
}

/** The full result of reading a MusicXML score. */
export interface MusicXmlParseResult {
    measures: Measure[];
    /** In measure order. Each has an English `message` and a `code` with `params` to translate */
    warnings: ParseWarning[];
    ramps: TempoRamp[];
    summary: ParseSummary;
    /** About the file itself */
    score: {
        title?: string;
        /** Part names in score order */
        parts: string[];
        /** The software that wrote the file, as `<encoding><software>` names it */
        software: string[];
    };
}

// ---------------------------------------------------------------------------
// Building counts and tempos
// ---------------------------------------------------------------------------

const EPSILON = 1e-6;

type Warn = (
    code: ParseWarningCode,
    severity: ParseWarning["severity"],
    measureIndex: number,
    params: Record<string, string | number>,
) => void;

interface ResolvedMeasure {
    raw: RawMeasure;
    meter: Meter;
    meterChanged: boolean;
    /** Length of each count in quarter notes (a pickup keeps only the counts it fills) */
    counts: number[];
}

/** Gives each measure its meter and counts, warning about what the rule couldn't read. */
// eslint-disable-next-line max-lines-per-function
function resolveMeasures(raws: RawMeasure[], warn: Warn): ResolvedMeasure[] {
    let meter: Meter | undefined;
    // The note value the tempo in effect is printed in (for counting x/2 meters)
    let printedUnit: { unit: BeatUnit; dots: number } | undefined;
    const notePrinted = (events: RawEvent[]) => {
        for (const e of events) {
            if (e.kind === "tempo" && !e.needsUnit)
                printedUnit = {
                    unit: e.marking.beatUnit,
                    dots: e.marking.dots,
                };
            if (e.kind === "modulation") printedUnit = e.modulation.newUnit;
        }
    };
    return raws.map((raw, i) => {
        let meterChanged = false;
        notePrinted(raw.events.filter((e) => e.pos < EPSILON));
        const read =
            raw.time?.kind === "read"
                ? meterFromTimeSignature(raw.time.parts, {
                      quarterMarked:
                          printedUnit?.unit === "quarter" &&
                          printedUnit.dots === 0,
                  })
                : undefined;
        notePrinted(raw.events);
        if (raw.time && !read)
            warn("unknown-meter", "warning", i, {
                meter: raw.time.text,
                kept: (meter ?? DEFAULT_METER).text,
            });
        if (read) {
            meterChanged = !meter || meter.text !== read.text;
            if (meterChanged && read.assumedGrouping)
                warn("assumed-grouping", "warning", i, {
                    meter: read.text,
                    grouping: read.grouping ?? "",
                });
            meter = read;
        }
        if (!meter) {
            warn("no-time-signature", "warning", i, {
                meter: DEFAULT_METER.text,
            });
            meter = DEFAULT_METER;
            meterChanged = true;
        }

        let counts = [...meter.counts];
        if (
            raw.implicit &&
            raw.contentQuarters > EPSILON &&
            raw.contentQuarters < meterLength(meter) - EPSILON
        ) {
            // A pickup (or the short half of a split measure): only the counts its music fills
            let k = counts.length;
            let filled = 0;
            while (k > 0 && filled < raw.contentQuarters - EPSILON)
                filled += counts[--k]!;
            counts = counts.slice(k);
            const exact = Math.abs(filled - raw.contentQuarters) <= EPSILON;
            warn(
                exact ? "pickup" : "pickup-rounded",
                exact ? "info" : "warning",
                i,
                {
                    counts: counts.length,
                    quarters: formatBpm(raw.contentQuarters),
                },
            );
        }
        return { raw, meter, meterChanged, counts };
    });
}

interface CountSlot {
    measureIndex: number;
    /** Start within its measure, in quarter notes */
    start: number;
    quarters: number;
}

type PlacedEvent = RawEvent & { measureIndex: number; count: number };
type PlacedTempo = PlacedEvent & { kind: "tempo" };
type Ramp = TempoRamp & { startCount: number; endCount: number };

/** Lays out every count, and finds the count each event applies from. */
function placeEvents(resolved: ResolvedMeasure[]) {
    const slots: CountSlot[] = [];
    const firstCount: number[] = [];
    resolved.forEach((m, measureIndex) => {
        firstCount.push(slots.length);
        let start = 0;
        for (const quarters of m.counts) {
            slots.push({ measureIndex, start, quarters });
            start += quarters;
        }
    });
    const placed: PlacedEvent[] = resolved.flatMap((m, measureIndex) =>
        m.raw.events.map((e) => {
            const first = firstCount[measureIndex]!;
            // The first count at or after the event; past the last count, the next measure
            const k = m.counts.findIndex(
                (_, j) => slots[first + j]!.start >= e.pos - EPSILON,
            );
            const count = first + (k === -1 ? m.counts.length : k);
            return { ...e, measureIndex, count };
        }),
    );
    placed.sort((a, b) => a.count - b.count || a.seq - b.seq);
    return { slots, firstCount, placed };
}

/**
 * Walks the tempo events in order: numbered tempos, "a tempo" and "Tempo I" change the tempo
 * from their count; rit. and accel. become ramps when a numbered tempo follows close enough.
 */
// eslint-disable-next-line max-lines-per-function
function walkTempos(
    placed: PlacedEvent[],
    resolved: ResolvedMeasure[],
    warn: Warn,
) {
    // The marking to show for a tempo that came without a beat unit: in its measure's count
    const shown = (e: PlacedTempo): TempoMarking =>
        e.needsUnit
            ? markingFromQuarterBpm(
                  e.marking.quarterBpm,
                  resolved[e.measureIndex]!.counts,
              )
            : e.marking;

    const changes: { count: number; quarterBpm: number }[] = [];
    const ramps: Ramp[] = [];
    const measureTempo = new Map<number, TempoMarking>();
    let current = DEFAULT_QUARTER_BPM;
    let currentMarking: TempoMarking | undefined;
    let firstMarking: TempoMarking | undefined;
    let beforeRamp: TempoMarking | undefined;
    // A ramp's target keeps "a tempo" pointing at the tempo before the ramp
    const rampTargets = new Set<PlacedEvent>();
    // Counts where a numbered tempo is written
    const numberedAt = new Set(
        placed.filter((e) => e.kind === "tempo").map((e) => e.count),
    );
    // Counts where "a tempo" or "Tempo I" is written: a ramp arriving there has no target
    const backAt = new Set(
        placed
            .filter(
                (e) =>
                    e.kind === "words" &&
                    (e.words.kind === "a-tempo" ||
                        e.words.kind === "tempo-primo"),
            )
            .map((e) => e.count),
    );
    const setTempo = (
        count: number,
        marking: TempoMarking,
        measureIndex: number,
    ) => {
        current = marking.quarterBpm;
        currentMarking = marking;
        firstMarking ??= marking;
        // Several markings on one count: the last one wins
        if (changes.at(-1)?.count === count) changes.pop();
        changes.push({ count, quarterBpm: current });
        measureTempo.set(measureIndex, marking);
    };
    const definesTempo = (e: PlacedEvent) =>
        e.kind === "tempo" ||
        (e.kind === "words" && e.words.kind !== "tempo-word");
    const keptTempo = () =>
        currentMarking
            ? formatTempoMarking(currentMarking)
            : `♩ = ${DEFAULT_QUARTER_BPM}`;

    // eslint-disable-next-line max-lines-per-function
    placed.forEach((e, idx) => {
        if (e.kind === "tempo") {
            const marking = shown(e);
            if (marking.approximate)
                warn("approximate-tempo", "info", e.measureIndex, {
                    tempo: formatTempoMarking(marking),
                });
            setTempo(e.count, marking, e.measureIndex);
            if (!rampTargets.has(e)) beforeRamp = undefined;
            return;
        }
        if (e.kind === "invalid-tempo") {
            warn("invalid-tempo", "warning", e.measureIndex, {
                text: e.text,
                kept: keptTempo(),
            });
            return;
        }
        if (e.kind === "modulation") {
            // "♩. = ♩": the new ♩. lasts as long as the old ♩ did
            const { newUnit, oldUnit } = e.modulation;
            const perMinute = current / oldUnit.quarters;
            const marking: TempoMarking = {
                quarterBpm: perMinute * newUnit.quarters,
                beatUnit: newUnit.unit,
                dots: newUnit.dots,
                perMinute,
            };
            setTempo(e.count, marking, e.measureIndex);
            beforeRamp = undefined;
            warn("metric-modulation", "info", e.measureIndex, {
                text: `${formatBeatUnit(newUnit.unit, newUnit.dots)} = ${formatBeatUnit(oldUnit.unit, oldUnit.dots)}`,
                tempo: formatTempoMarking(marking),
            });
            return;
        }
        const words = e.words;
        if (words.kind === "tempo-word") return;
        if (words.kind === "a-tempo" || words.kind === "tempo-primo") {
            // A number on the same count already says which tempo
            if (numberedAt.has(e.count)) {
                beforeRamp = undefined;
                return;
            }
            const back = words.kind === "a-tempo" ? beforeRamp : firstMarking;
            if (back) {
                setTempo(e.count, back, e.measureIndex);
                warn(words.kind, "info", e.measureIndex, {
                    text: words.text,
                    tempo: formatTempoMarking(back),
                });
            } else
                warn("a-tempo-unknown", "warning", e.measureIndex, {
                    text: words.text,
                    kept: keptTempo(),
                });
            beforeRamp = undefined;
            return;
        }

        // rit. or accel.: does a numbered tempo say where it arrives?
        const from =
            currentMarking ?? markingFromQuarterBpm(current, [1, 1, 1, 1]);
        beforeRamp ??= from;
        const next = placed.slice(idx + 1).find(definesTempo);
        const ramp: Ramp = {
            kind: words.kind,
            text: words.text,
            startMeasureIndex: e.measureIndex,
            applied: false,
            fromQuarterBpm: current,
            startCount: e.count,
            endCount: e.count,
        };
        let reason = "no-target";
        if (
            next?.kind === "tempo" &&
            !backAt.has(next.count) &&
            Math.abs(next.marking.quarterBpm - current) > EPSILON
        ) {
            const to = next.marking.quarterBpm;
            const towards =
                words.kind === "slower" ? to < current : to > current;
            if (
                next.measureIndex - e.measureIndex >
                RAMP_TARGET_WINDOW_MEASURES
            )
                reason = "too-far";
            else if (!towards || next.count <= e.count)
                reason = "wrong-direction";
            else {
                ramp.applied = true;
                ramp.toQuarterBpm = to;
                ramp.targetMeasureIndex = next.measureIndex;
                ramp.endCount = next.count;
                rampTargets.add(next);
                warn("ramp-applied", "info", e.measureIndex, {
                    text: words.text,
                    from: formatTempoMarking(from),
                    to: formatTempoMarking(shown(next)),
                    target: resolved[next.measureIndex]!.raw.label,
                });
            }
        }
        if (!ramp.applied)
            warn("ramp-not-applied", "warning", e.measureIndex, {
                text: words.text,
                reason,
                window: RAMP_TARGET_WINDOW_MEASURES,
            });
        ramps.push(ramp);
    });
    const tempoChanges = changes.filter(
        (change, i) =>
            i > 0 &&
            Math.abs(change.quarterBpm - changes[i - 1]!.quarterBpm) > EPSILON,
    ).length;
    return { changes, ramps, measureTempo, tempoChanges };
}

/** Each count's quarter notes per minute: the step changes, then the ramps on top. */
function countTempos(
    countTotal: number,
    changes: { count: number; quarterBpm: number }[],
    ramps: Ramp[],
): number[] {
    const bpm: number[] = new Array(countTotal);
    let step = DEFAULT_QUARTER_BPM;
    let c = 0;
    for (let k = 0; k < countTotal; k++) {
        while (c < changes.length && changes[c]!.count <= k)
            step = changes[c++]!.quarterBpm;
        bpm[k] = step;
    }
    for (const ramp of ramps) {
        if (!ramp.applied || ramp.toQuarterBpm === undefined) continue;
        // Like newBeatsFromTempoGroup: the last ramp count is one step short of the target
        const n = ramp.endCount - ramp.startCount;
        for (let k = ramp.startCount; k < ramp.endCount; k++)
            bpm[k] =
                ramp.fromQuarterBpm +
                ((ramp.toQuarterBpm - ramp.fromQuarterBpm) *
                    (k - ramp.startCount)) /
                    n;
    }
    return bpm;
}

/**
 * Warnings about what the counts can't show, about repeats and jumps, and about the file's
 * measure numbers. `played` maps each played measure to its written measure.
 */
// eslint-disable-next-line max-lines-per-function
function warnAboutStructure(
    resolved: ResolvedMeasure[],
    written: RawMeasure[],
    played: PlayedRef[],
    issues: PerformanceIssue[],
    repeats: RepeatMode,
    warn: Warn,
) {
    // Where a written measure is first played, for warnings about the written score
    const firstPlay = new Map<number, number>();
    played.forEach((p, i) => {
        if (!firstPlay.has(p.index)) firstPlay.set(p.index, i);
    });
    const at = (writtenIndex: number) =>
        firstPlay.get(writtenIndex) ??
        // A measure that is never played: warn at the next one that is
        played.findIndex((p) => p.index > writtenIndex);

    resolved.forEach((m, i) => {
        if (played[i]!.time > 1) return;
        const word = m.raw.events.find(
            (e) => e.kind === "words" && e.words.kind === "tempo-word",
        );
        if (
            word?.kind === "words" &&
            !m.raw.events.some((e) => e.kind === "tempo")
        )
            warn("tempo-word-without-number", "warning", i, {
                text: word.words.text,
            });
        if (m.raw.fermata) warn("fermata", "warning", i, {});
    });

    written.forEach((raw, w) => {
        const nav = raw.navigation;
        const i = at(w);
        if (i < 0) return;
        const jump = nav.daCapo
            ? "D.C."
            : nav.dalSegno !== undefined
              ? "D.S."
              : undefined;
        if (repeats === "once") {
            if (nav.backwardRepeat) warn("repeat", "warning", i, {});
            if (jump) warn("jump", "warning", i, { jump });
            return;
        }
        if (nav.backwardRepeat)
            warn("repeat-played", "info", i, {
                times: nav.backwardRepeat.times,
            });
        if (jump) warn("jump-played", "info", i, { jump });
        for (const words of raw.navigationFromWords ?? [])
            warn("navigation-from-words", "warning", i, { text: words });
    });
    if (repeats === "play")
        for (const issue of issues) {
            const i = Math.max(0, at(issue.index));
            if (issue.code === "endless")
                warn("endless-repeats", "warning", i, {
                    played: issue.played,
                });
            else if (issue.code === "unreachable-ending")
                warn("unreachable-ending", "warning", i, {
                    numbers: issue.numbers.join(", "),
                });
            else
                warn(issue.code, "warning", i, {
                    name: issue.name,
                });
        }

    // Measure numbers, in the written score
    const gap = written.findIndex((m, w) => {
        if (w === 0) return false;
        const previous = parseInt(written[w - 1]!.label);
        const current = parseInt(m.label);
        // A file that doesn't number its measures has nothing to warn about
        if (Number.isNaN(previous) && Number.isNaN(current)) return false;
        return Number.isNaN(current) || current !== previous + 1;
    });
    if (gap > 0 && at(gap) >= 0)
        warn("measure-numbers", "warning", at(gap), {
            previous: written[gap - 1]!.label,
            appNumber: at(gap) + 1,
        });
}

/** How repeats, endings and jumps are read. */
export type RepeatMode =
    /** Played out: the counts follow the music as it is performed (the default) */
    | "play"
    /** Each written measure once, in the order it is written */
    | "once";

export interface ParseOptions {
    repeats?: RepeatMode;
}

/** A played measure: which written measure it is, and how many times it has been played. */
type PlayedRef = { index: number; time: number };

/**
 * Parses a MusicXML string into measures, with a report of what was read: warnings for anything
 * it couldn't read or had to guess, rit./accel. ranges, and a summary.
 *
 * - Reading: every part is read (see `scan.ts`); the first part's measures set the measure count.
 * - Order: repeats, endings, D.C., D.S., To Coda and Fine are played out (see `perform.ts`), so
 *   the measures come in the order they are performed and a repeated measure appears once per
 *   time it is played, with `time` counting the plays. `repeats: "once"` keeps the written order.
 * - Counts: see `meter.ts` for which note value is the count in each meter. A pickup
 *   (`implicit="yes"` and shorter than its meter) keeps only the counts its music fills.
 * - Tempo: `<sound tempo>` (quarters per minute) when present, otherwise the `<metronome>` mark
 *   with its beat unit and dots, otherwise tempo text with a note glyph ("♩ = 132"). A marking
 *   in the middle of a measure applies from the first count at or after it. A marking that
 *   isn't a number keeps the previous tempo, with a warning.
 * - rit./accel.: applied only when a numbered tempo follows within
 *   `RAMP_TARGET_WINDOW_MEASURES` measures, as evenly changing tempos up to it; otherwise
 *   reported. "a tempo" goes back to the tempo before the last rit. or accel., "Tempo I" to the
 *   first tempo.
 * - A metric modulation printed with no number (♩. = ♩) is read as "the new note lasts as long
 *   as the old one", with a warning to check it.
 * - Measure numbers: each measure keeps the file's `number` attribute as `label` (and its
 *   integer value as `number`), so a pickup reads m0.
 *
 * Blank text reads as no measures. Throws when the text isn't well-formed XML or isn't a
 * MusicXML score.
 */
// eslint-disable-next-line max-lines-per-function
export function parseMusicXmlWithReport(
    xmlText: string,
    { repeats = "play" }: ParseOptions = {},
): MusicXmlParseResult {
    const warnings: ParseWarning[] = [];
    const warn: Warn = (code, severity, measureIndex, params) =>
        warnings.push({ code, severity, measureIndex, params, message: "" });

    const scan: ScanResult = xmlText.trim()
        ? scanScore(parseXmlDocument(xmlText))
        : { measures: [], parts: [], software: [], mismatchedParts: [] };
    const written = scan.measures;
    const performance =
        repeats === "play"
            ? performanceOrder(written.map((m) => m.navigation))
            : {
                  order: written.map((_, index) => ({ index, time: 1 })),
                  issues: [],
              };
    const played: PlayedRef[] = performance.order;
    const raws = played.map((p) => written[p.index]!);

    const resolved = resolveMeasures(raws, warn);
    const { slots, firstCount, placed } = placeEvents(resolved);
    const { changes, ramps, measureTempo, tempoChanges } = walkTempos(
        placed,
        resolved,
        warn,
    );
    if (resolved.length > 0 && (changes.length === 0 || changes[0]!.count > 0))
        warn(
            changes.length === 0 ? "no-tempo" : "no-start-tempo",
            "warning",
            0,
            {
                tempo: `♩ = ${DEFAULT_QUARTER_BPM}`,
            },
        );
    const bpm = countTempos(slots.length, changes, ramps);

    const measures: Measure[] = resolved.map((m, i) => {
        const beats: Beat[] = m.counts.map((quarters, j) => ({
            duration: (quarters * 60) / bpm[firstCount[i]! + j]!,
        }));
        const parsedNumber = parseInt(m.raw.label);
        const measure: Measure = {
            number: Number.isNaN(parsedNumber) ? -1 : parsedNumber,
            beats,
            label: m.raw.label,
            meter: m.meter,
            meterChanged: m.meterChanged,
            writtenIndex: played[i]!.index,
            time: played[i]!.time,
        };
        if (m.raw.rehearsalMark) measure.rehearsalMark = m.raw.rehearsalMark;
        if (m.raw.implicit) measure.implicit = true;
        const tempo = measureTempo.get(i);
        if (tempo) measure.tempo = tempo;
        return measure;
    });
    if (scan.mismatchedParts.length > 0)
        warn("mismatched-parts", "warning", 0, {
            parts: scan.mismatchedParts.join(", "),
        });
    warnAboutStructure(
        resolved,
        written,
        played,
        performance.issues,
        repeats,
        warn,
    );

    for (const w of warnings)
        w.message = warningMessage(w, measures[w.measureIndex]?.label);
    warnings.sort((a, b) => a.measureIndex - b.measureIndex);

    return {
        measures,
        warnings,
        ramps: ramps.map(({ startCount, endCount, ...ramp }) => ramp),
        summary: {
            measures: measures.length,
            writtenMeasures: written.length,
            counts: slots.length,
            tempoChanges,
            ramps: ramps.filter((r) => r.applied).length,
            meterChanges: measures.filter((m, i) => i > 0 && m.meterChanged)
                .length,
            rehearsalMarks: measures.flatMap((m) =>
                m.rehearsalMark && m.time === 1 ? [m.rehearsalMark] : [],
            ),
            warnings: warnings.filter((w) => w.severity === "warning").length,
            durationSeconds: measures.reduce(
                (sum, m) => sum + m.beats.reduce((s, b) => s + b.duration, 0),
                0,
            ),
        },
        score: {
            title: scan.title,
            parts: scan.parts,
            software: scan.software,
        },
    };
}

/**
 * Parses a MusicXML string and converts it into an array of musical measures, in the order they
 * are played. See `parseMusicXmlWithReport`.
 */
export function parseMusicXml(
    xmlText: string,
    options: ParseOptions = {},
): Measure[] {
    return parseMusicXmlWithReport(xmlText, options).measures;
}
