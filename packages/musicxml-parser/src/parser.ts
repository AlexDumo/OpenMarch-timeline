import { type Measure, type Beat } from "./utils";
import {
    DEFAULT_METER,
    meterFromTimeSignature,
    meterLength,
    type Meter,
    type TimeSignaturePart,
} from "./meter";
import {
    formatBpm,
    formatTempoMarking,
    isBeatUnit,
    markingFromQuarterBpm,
    readPerMinute,
    readSoundTempo,
    readTempoText,
    readTempoWords,
    unitQuarters,
    type TempoMarking,
    type TempoWords,
} from "./tempo";
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
    measures: number;
    counts: number;
    /** Markings that change the tempo after the first one, including "a tempo" and "Tempo I" */
    tempoChanges: number;
    /** rit. and accel. that were applied */
    ramps: number;
    meterChanges: number;
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
}

// ---------------------------------------------------------------------------
// Scanning: one measure's elements, in order, with their positions
// ---------------------------------------------------------------------------

/** A tempo-related thing that happens at a position (in quarter notes) inside a measure. */
type RawEvent = { pos: number; seq: number } & (
    | { kind: "tempo"; marking: TempoMarking; needsUnit: boolean }
    | { kind: "invalid-tempo"; text: string }
    | { kind: "modulation"; text: string }
    | { kind: "words"; words: TempoWords }
);

interface RawMeasure {
    label: string;
    implicit: boolean;
    rehearsalMark?: string;
    /** Undefined when the measure has no `<time>` */
    time?:
        | { kind: "read"; parts: TimeSignaturePart[]; text: string }
        | { kind: "unknown"; text: string };
    events: RawEvent[];
    /** How much music the measure holds, in quarter notes (0 when it has no timed notes) */
    contentQuarters: number;
    fermata: boolean;
    backwardRepeat: boolean;
    jump?: string;
}

const ELEMENT =
    /<(note|backup|forward|direction|attributes|sound|barline)(?=[\s>/])(?:[^>]*\/>|[\s\S]*?<\/\1>)/g;

const firstMatch = (text: string, re: RegExp) => text.match(re)?.[1];

const decodeXml = (text: string) =>
    text
        .replace(/<[^>]*>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
            String.fromCodePoint(parseInt(n, 16)),
        )
        .replace(/&amp;/g, "&")
        .trim();

const elementDuration = (text: string) =>
    Number(firstMatch(text, /<duration>\s*([\d.]+)\s*<\/duration>/) ?? 0);

/** Reads the tempo a `<metronome>` prints, or why it isn't one. */
function readMetronome(
    metronome: string,
):
    | { kind: "marking"; marking: TempoMarking }
    | { kind: "invalid"; text: string }
    | { kind: "modulation"; text: string }
    | undefined {
    const units = [
        ...metronome.matchAll(
            /<beat-unit>\s*([^<]*?)\s*<\/beat-unit>((?:\s*<beat-unit-dot\s*\/>)*)/g,
        ),
    ].map((m) => ({
        unit: m[1]!,
        dots: (m[2]!.match(/<beat-unit-dot/g) ?? []).length,
    }));
    const perMinute = firstMatch(
        metronome,
        /<per-minute[^>]*>([\s\S]*?)<\/per-minute>/,
    );
    const first = units[0];
    if (perMinute !== undefined && first && isBeatUnit(first.unit)) {
        const reading = readPerMinute(decodeXml(perMinute));
        if (!reading.ok) return { kind: "invalid", text: decodeXml(perMinute) };
        return {
            kind: "marking",
            marking: {
                quarterBpm:
                    reading.value * unitQuarters(first.unit, first.dots),
                beatUnit: first.unit,
                dots: first.dots,
                perMinute: reading.value,
                approximate: reading.approximate || undefined,
            },
        };
    }
    if (units.length >= 2)
        return {
            kind: "modulation",
            text: units
                .map((u) => `${u.unit}${".".repeat(u.dots)}`)
                .join(" = "),
        };
    if (perMinute !== undefined)
        return { kind: "invalid", text: decodeXml(perMinute) };
    return undefined;
}

/** The tempo events of one `<direction>` at `pos`. */
function directionEvents(
    direction: string,
    pos: number,
    nextSeq: () => number,
): RawEvent[] {
    const events: RawEvent[] = [];
    const soundAttr = firstMatch(direction, /<sound\b[^>]*\btempo="([^"]*)"/);
    const sound =
        soundAttr !== undefined ? readSoundTempo(soundAttr) : undefined;
    const metronomeText = firstMatch(
        direction,
        /<metronome\b[^>]*>([\s\S]*?)<\/metronome>/,
    );
    const metronome = metronomeText ? readMetronome(metronomeText) : undefined;
    const words = [...direction.matchAll(/<words\b[^>]*>([\s\S]*?)<\/words>/g)]
        .map((m) => decodeXml(m[1]!))
        .join(" ")
        .trim();
    const textMarking = words ? readTempoText(words) : undefined;
    const printed =
        metronome?.kind === "marking" ? metronome.marking : textMarking;

    if (sound !== undefined) {
        // <sound tempo> is the playback truth, in quarters; the printed marking is only shown
        events.push({
            pos,
            seq: nextSeq(),
            kind: "tempo",
            marking: printed
                ? { ...printed, quarterBpm: sound, approximate: undefined }
                : {
                      quarterBpm: sound,
                      beatUnit: "quarter",
                      dots: 0,
                      perMinute: sound,
                  },
            needsUnit: !printed,
        });
    } else if (printed) {
        events.push({
            pos,
            seq: nextSeq(),
            kind: "tempo",
            marking: printed,
            needsUnit: false,
        });
    } else if (metronome?.kind === "invalid") {
        events.push({
            pos,
            seq: nextSeq(),
            kind: "invalid-tempo",
            text: metronome.text,
        });
    } else if (soundAttr !== undefined) {
        events.push({
            pos,
            seq: nextSeq(),
            kind: "invalid-tempo",
            text: soundAttr,
        });
    } else if (metronome?.kind === "modulation") {
        events.push({
            pos,
            seq: nextSeq(),
            kind: "modulation",
            text: metronome.text,
        });
    }

    const tempoWords = words ? readTempoWords(words) : undefined;
    const hasNumber = events.some((e) => e.kind === "tempo");
    // A number in the same direction says more than "a tempo" or "Allegro" does
    if (
        tempoWords &&
        !(
            hasNumber &&
            (tempoWords.kind === "tempo-word" ||
                tempoWords.kind === "a-tempo" ||
                tempoWords.kind === "tempo-primo")
        )
    )
        events.push({ pos, seq: nextSeq(), kind: "words", words: tempoWords });
    return events;
}

/** Reads a `<time>` element's signature. */
function readTime(time: string): RawMeasure["time"] {
    const parts = [
        ...time.matchAll(
            /<beats>([^<]*)<\/beats>\s*<beat-type>([^<]*)<\/beat-type>/g,
        ),
    ].map((m) => ({ beats: m[1]!, beatType: m[2]! }));
    const text = parts
        .map((p) => `${p.beats.trim()}/${p.beatType.trim()}`)
        .join("+");
    if (parts.length === 0 || /<senza-misura/.test(time))
        return { kind: "unknown", text: text || "senza misura" };
    return { kind: "read", parts, text };
}

/** Reads one `<measure>` element. `state.divisions` carries over between measures. */
// eslint-disable-next-line max-lines-per-function
function scanMeasure(
    measureText: string,
    state: { divisions: number; seq: number },
): RawMeasure {
    const openTag = measureText.match(/^<measure\b[^>]*>/)?.[0] ?? "";
    const raw: RawMeasure = {
        label: firstMatch(openTag, /\bnumber="([^"]*)"/) ?? "",
        implicit: /\bimplicit="yes"/.test(openTag),
        events: [],
        contentQuarters: 0,
        fermata: /<fermata\b/.test(measureText),
        backwardRepeat: /<repeat\b[^>]*direction="backward"/.test(measureText),
    };
    const rehearsal = firstMatch(
        measureText,
        /<rehearsal[^>]*>([\s\S]*?)<\/rehearsal>/,
    );
    if (rehearsal !== undefined && decodeXml(rehearsal))
        raw.rehearsalMark = decodeXml(rehearsal);
    const jump = measureText.match(/<sound\b[^>]*\b(dacapo|dalsegno)="yes"/);
    if (jump) raw.jump = jump[1] === "dacapo" ? "D.C." : "D.S.";

    const nextSeq = () => state.seq++;
    let cur = 0;
    let max = 0;
    for (const match of measureText.matchAll(ELEMENT)) {
        const text = match[0];
        switch (match[1]) {
            case "attributes": {
                const divisions = Number(
                    firstMatch(text, /<divisions>\s*([\d.]+)\s*<\/divisions>/),
                );
                if (divisions > 0) state.divisions = divisions;
                const time = firstMatch(
                    text,
                    /<time\b[^>]*>([\s\S]*?)<\/time>/,
                );
                if (time !== undefined && raw.time === undefined)
                    raw.time = readTime(time);
                break;
            }
            case "note":
                if (/<grace\b/.test(text) || /<chord\s*\/>/.test(text)) break;
                cur += elementDuration(text);
                max = Math.max(max, cur);
                break;
            case "backup":
                cur = Math.max(0, cur - elementDuration(text));
                break;
            case "forward":
                cur += elementDuration(text);
                max = Math.max(max, cur);
                break;
            case "direction": {
                const offset = Number(
                    firstMatch(
                        text,
                        /<offset[^>]*>\s*(-?[\d.]+)\s*<\/offset>/,
                    ) ?? 0,
                );
                const pos = Math.max(0, cur + offset) / state.divisions;
                raw.events.push(...directionEvents(text, pos, nextSeq));
                break;
            }
            case "sound": {
                // A <sound> straight inside the measure, outside any direction
                const tempoAttr = firstMatch(text, /\btempo="([^"]*)"/);
                if (tempoAttr === undefined) break;
                const tempo = readSoundTempo(tempoAttr);
                const pos = cur / state.divisions;
                raw.events.push(
                    tempo !== undefined
                        ? {
                              pos,
                              seq: nextSeq(),
                              kind: "tempo",
                              marking: {
                                  quarterBpm: tempo,
                                  beatUnit: "quarter",
                                  dots: 0,
                                  perMinute: tempo,
                              },
                              needsUnit: true,
                          }
                        : {
                              pos,
                              seq: nextSeq(),
                              kind: "invalid-tempo",
                              text: tempoAttr,
                          },
                );
                break;
            }
        }
    }
    raw.contentQuarters = max / state.divisions;
    return raw;
}

/** The first part's `<measure>` elements, as text. */
function measureTexts(xmlText: string): string[] {
    let text = xmlText;
    // If the XML has multiple parts, stop after the first part
    const partStart = text.search(/<part[\s>]/);
    if (partStart !== -1) {
        const partEnd = text.indexOf("</part>", partStart);
        if (partEnd === -1)
            throw new Error("Malformed XML: Missing closing </part> tag.");
        text = text.substring(partStart, partEnd + 7);
    }
    const texts: string[] = [];
    const open = /<measure(?=[\s>/])[^>]*?(\/)?>/g;
    let match: RegExpExecArray | null;
    while ((match = open.exec(text))) {
        if (match[1]) {
            texts.push(match[0]);
            continue;
        }
        const end = text.indexOf("</measure>", match.index);
        if (end === -1)
            throw new Error("Malformed XML: Missing closing </measure> tag.");
        texts.push(text.substring(match.index, end + 10));
        open.lastIndex = end + 10;
    }
    return texts;
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
    return raws.map((raw, i) => {
        let meterChanged = false;
        const read =
            raw.time?.kind === "read"
                ? meterFromTimeSignature(raw.time.parts)
                : undefined;
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
            warn("metric-modulation", "warning", e.measureIndex, {
                text: e.text,
                kept: keptTempo(),
            });
            return;
        }
        const words = e.words;
        if (words.kind === "tempo-word") return;
        if (words.kind === "a-tempo" || words.kind === "tempo-primo") {
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
        if (next?.kind === "tempo") {
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

/** Warnings about what the counts can't show, and about the file's measure numbers. */
function warnAboutStructure(
    resolved: ResolvedMeasure[],
    measures: Measure[],
    warn: Warn,
) {
    resolved.forEach((m, i) => {
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
        if (m.raw.backwardRepeat) warn("repeat", "warning", i, {});
        if (m.raw.jump) warn("jump", "warning", i, { jump: m.raw.jump });
    });
    const gap = measures.findIndex(
        (m, i) =>
            i > 0 && (m.number < 0 || m.number !== measures[i - 1]!.number + 1),
    );
    if (gap > 0)
        warn("measure-numbers", "warning", gap, {
            previous: measures[gap - 1]!.label ?? "",
            appNumber: measures[0]!.number + gap,
        });
}

/**
 * Parses a MusicXML string into measures, with a report of what was read: warnings for anything
 * it couldn't read or had to guess, rit./accel. ranges, and a summary.
 *
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
 * - Measure numbers: each measure keeps the file's `number` attribute as `label` (and its
 *   integer value as `number`), so a pickup reads m0.
 */
export function parseMusicXmlWithReport(xmlText: string): MusicXmlParseResult {
    const warnings: ParseWarning[] = [];
    const warn: Warn = (code, severity, measureIndex, params) =>
        warnings.push({ code, severity, measureIndex, params, message: "" });

    const state = { divisions: 1, seq: 0 };
    const raws = measureTexts(xmlText).map((t) => scanMeasure(t, state));
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
        };
        if (m.raw.rehearsalMark) measure.rehearsalMark = m.raw.rehearsalMark;
        if (m.raw.implicit) measure.implicit = true;
        const tempo = measureTempo.get(i);
        if (tempo) measure.tempo = tempo;
        return measure;
    });
    warnAboutStructure(resolved, measures, warn);

    for (const w of warnings)
        w.message = warningMessage(w, measures[w.measureIndex]?.label);
    warnings.sort((a, b) => a.measureIndex - b.measureIndex);

    return {
        measures,
        warnings,
        ramps: ramps.map(({ startCount, endCount, ...ramp }) => ramp),
        summary: {
            measures: measures.length,
            counts: slots.length,
            tempoChanges,
            ramps: ramps.filter((r) => r.applied).length,
            meterChanges: measures.filter((m, i) => i > 0 && m.meterChanged)
                .length,
            rehearsalMarks: measures.flatMap((m) =>
                m.rehearsalMark ? [m.rehearsalMark] : [],
            ),
            warnings: warnings.filter((w) => w.severity === "warning").length,
            durationSeconds: measures.reduce(
                (sum, m) => sum + m.beats.reduce((s, b) => s + b.duration, 0),
                0,
            ),
        },
    };
}

/**
 * Parses a MusicXML string and converts it into an array of musical measures.
 * @param xmlText The raw XML text representing a musical score
 * @returns An array of Measure objects representing the parsed musical composition
 */
export function parseMusicXml(xmlText: string): Measure[] {
    return parseMusicXmlWithReport(xmlText).measures;
}
