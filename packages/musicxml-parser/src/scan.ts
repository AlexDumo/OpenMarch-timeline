/**
 * Scanning: reads a parsed MusicXML document into one `RawMeasure` per written measure, with what
 * timing needs (meter, tempo marks and their positions, the music's length) and how the measure
 * takes part in repeats and jumps.
 *
 * Every part is read, not just the first. Exporters spread these marks differently: Finale writes a
 * `<sound tempo>` into every part, Sibelius puts system text on the top staff only, MuseScore puts
 * rehearsal marks on the first part, and a score's first part is often a rest-only part (a click
 * or a conductor part) with no marks at all. So each measure takes:
 *
 * - its number, `implicit` flag and time signature from the first part that has them,
 * - its length from the longest part,
 * - tempo marks, rehearsal marks, repeats and jumps from every part, each mark counted once
 *   (the same mark in several parts of one measure is one mark, at its earliest position).
 */

import { type TimeSignaturePart } from "./meter";
import { type MeasureNavigation } from "./perform";
import {
    UNUSUAL_TEMPO,
    isBeatUnit,
    readPerMinute,
    readSoundTempo,
    readTempoText,
    readTempoWords,
    unitQuarters,
    type BeatUnit,
    type TempoMarking,
    type TempoWords,
} from "./tempo";

/** The parts of the DOM the scanner uses, so any DOM implementation works. */
export interface XmlNode {
    nodeType: number;
    textContent: string | null;
    childNodes: ArrayLike<XmlNode>;
}
export interface XmlElement extends XmlNode {
    localName?: string | null;
    nodeName: string;
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
}

/** A tempo-related thing that happens at a position (in quarter notes) inside a measure. */
export type RawEvent = { pos: number; seq: number } & (
    | {
          kind: "tempo";
          marking: TempoMarking;
          needsUnit: boolean;
          /** The printed tempo, in quarters, when `<sound tempo>` plays a different one */
          printedQuarterBpm?: number;
          /** A `<sound tempo>` that was a mistake, so the printed tempo was used */
          soundIgnored?: { quarterBpm: number; reason: SoundMistake };
      }
    | { kind: "invalid-tempo"; text: string }
    | { kind: "modulation"; modulation: Modulation }
    | { kind: "words"; words: TempoWords }
);

/** A note value a metronome mark counts in: its unit and dots, and its length with any ties. */
export interface BeatGroup {
    unit: BeatUnit;
    dots: number;
    /** Length in quarter notes, including notes tied to it */
    quarters: number;
}

/**
 * Why a `<sound tempo>` was taken for a mistake: written in the printed note value instead of
 * quarters (Notion writes ♩. = 120 as tempo="120"), or too slow or fast to be meant while the
 * printed tempo is not (MuseScore 2 has written ♩ = 76 as tempo="7602").
 */
export type SoundMistake = "beat-unit" | "implausible";

/** A metric modulation printed as "new note = old note", like ♩. = ♩. */
export interface Modulation {
    newUnit: BeatGroup;
    oldUnit: BeatGroup;
}

export interface RawMeasure {
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
    navigation: MeasureNavigation;
    /** Navigation read from words ("D.S. al Coda") rather than from symbols or `<sound>` */
    navigationFromWords?: string[];
}

export interface ScanResult {
    measures: RawMeasure[];
    /** Part names in score order */
    parts: string[];
    /** `<encoding><software>` values, for reports */
    software: string[];
    title?: string;
    /** Parts whose measure count differs from the first part's */
    mismatchedParts: string[];
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const ELEMENT_NODE = 1;

const nameOf = (el: XmlElement) => el.localName || el.nodeName;

export function childElements(el: XmlNode, name?: string): XmlElement[] {
    const out: XmlElement[] = [];
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as XmlElement;
        if (node.nodeType === ELEMENT_NODE && (!name || nameOf(node) === name))
            out.push(node);
    }
    return out;
}

const firstChild = (el: XmlNode | undefined, name: string) =>
    el ? childElements(el, name)[0] : undefined;

/** All descendants with this name, in document order. */
export function descendants(el: XmlNode, name: string, out: XmlElement[] = []) {
    for (const child of childElements(el)) {
        if (nameOf(child) === name) out.push(child);
        descendants(child, name, out);
    }
    return out;
}

/** An attribute's value, or undefined when the element doesn't have it. */
export const attrOf = (el: XmlElement | undefined, name: string) =>
    el?.hasAttribute(name) ? (el.getAttribute(name) ?? "") : undefined;

const textOf = (el: XmlNode | undefined) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const numberOf = (el: XmlNode | undefined) => {
    const value = Number(textOf(el));
    return Number.isFinite(value) ? value : 0;
};

// ---------------------------------------------------------------------------
// Directions: tempo marks and the words that go with them
// ---------------------------------------------------------------------------

/** Reads the tempo a `<metronome>` prints, or why it isn't one. */
function readMetronome(
    metronome: XmlElement,
):
    | { kind: "marking"; marking: TempoMarking }
    | { kind: "invalid"; text: string }
    | { kind: "modulation"; modulation: Modulation }
    | undefined {
    // Each <beat-unit> is followed by its <beat-unit-dot>s and any <beat-unit-tied> notes
    // (MusicXML 4: ♩. tied to ♪. is one beat of 2.25 quarters)
    const units: BeatGroup[] = [];
    let valid = true;
    for (const child of childElements(metronome)) {
        const name = nameOf(child);
        const last = units[units.length - 1];
        if (name === "beat-unit") {
            const unit = textOf(child);
            if (!isBeatUnit(unit)) valid = false;
            else units.push({ unit, dots: 0, quarters: unitQuarters(unit) });
        } else if (name === "beat-unit-dot" && last) {
            last.dots++;
            last.quarters += unitQuarters(last.unit) / 2 ** last.dots;
        } else if (name === "beat-unit-tied" && last) {
            const unit = textOf(firstChild(child, "beat-unit"));
            const dots = childElements(child, "beat-unit-dot").length;
            if (isBeatUnit(unit)) last.quarters += unitQuarters(unit, dots);
        }
    }
    // The <metronome-note> form is mostly swing marks (♪♪ = ♩♪³): no tempo
    if (!valid) units.length = 0;
    const perMinuteEl = firstChild(metronome, "per-minute");
    const perMinute = perMinuteEl ? textOf(perMinuteEl) : undefined;
    const first = units[0];
    if (perMinute !== undefined && first) {
        const reading = readPerMinute(perMinute);
        if (!reading.ok) return { kind: "invalid", text: perMinute };
        return {
            kind: "marking",
            marking: {
                quarterBpm: reading.value * first.quarters,
                beatUnit: first.unit,
                dots: first.dots,
                perMinute: reading.value,
                approximate: reading.approximate || undefined,
            },
        };
    }
    const [left, right] = units;
    if (left && right)
        return {
            kind: "modulation",
            modulation: { newUnit: left, oldUnit: right },
        };
    if (perMinute !== undefined) return { kind: "invalid", text: perMinute };
    return undefined;
}

/** The text a direction prints in `<words>`, joined. */
const directionWords = (direction: XmlElement) =>
    descendants(direction, "words")
        .map(textOf)
        .filter(Boolean)
        .join(" ")
        .trim();

/** The tempo events of one `<direction>` at `pos`. */
// eslint-disable-next-line max-lines-per-function
function directionEvents(
    direction: XmlElement,
    pos: number,
    nextSeq: () => number,
): RawEvent[] {
    const events: RawEvent[] = [];
    const soundAttr = attrOf(firstChild(direction, "sound"), "tempo");
    const sound =
        soundAttr !== undefined ? readSoundTempo(soundAttr) : undefined;
    const metronomeEl = descendants(direction, "metronome")[0];
    const metronome = metronomeEl ? readMetronome(metronomeEl) : undefined;
    const words = directionWords(direction);
    const textMarking = words ? readTempoText(words) : undefined;
    // With a <sound tempo>, a printed modulation (♪ = ♪) still says which note the tempo is in
    const modulationUnit =
        sound !== undefined && metronome?.kind === "modulation"
            ? metronome.modulation.newUnit
            : undefined;
    const printed: TempoMarking | undefined =
        metronome?.kind === "marking"
            ? metronome.marking
            : modulationUnit && sound !== undefined
              ? {
                    quarterBpm: sound,
                    beatUnit: modulationUnit.unit,
                    dots: modulationUnit.dots,
                    perMinute: sound / modulationUnit.quarters,
                }
              : textMarking;

    const plausible = (bpm: number) =>
        bpm >= UNUSUAL_TEMPO.below && bpm <= UNUSUAL_TEMPO.above;
    const printedMark =
        metronome?.kind === "marking" ? metronome.marking : undefined;
    const soundMistake: SoundMistake | undefined =
        sound === undefined || !printedMark
            ? undefined
            : sound === printedMark.perMinute &&
                Math.abs(printedMark.quarterBpm - sound) > 0.5
              ? "beat-unit"
              : !plausible(sound) && plausible(printedMark.quarterBpm)
                ? "implausible"
                : undefined;

    if (sound !== undefined && soundMistake && printedMark) {
        events.push({
            pos,
            seq: nextSeq(),
            kind: "tempo",
            marking: printedMark,
            needsUnit: false,
            soundIgnored: { quarterBpm: sound, reason: soundMistake },
        });
    } else if (sound !== undefined) {
        // <sound tempo> is the playback truth, in quarters; the printed marking is only shown
        const differs =
            printed !== undefined &&
            Math.abs(printed.quarterBpm - sound) > 0.5 &&
            metronome?.kind === "marking";
        events.push({
            pos,
            seq: nextSeq(),
            kind: "tempo",
            ...(differs ? { printedQuarterBpm: printed!.quarterBpm } : {}),
            marking: printed
                ? {
                      ...printed,
                      quarterBpm: sound,
                      // Shown in the printed note value, at the tempo that plays
                      perMinute:
                          (sound * printed.perMinute) / printed.quarterBpm,
                      approximate: undefined,
                  }
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
            modulation: metronome.modulation,
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
function readTime(time: XmlElement): RawMeasure["time"] {
    if (firstChild(time, "senza-misura"))
        return { kind: "unknown", text: "senza misura" };
    const parts: TimeSignaturePart[] = [];
    let beats: string | undefined;
    for (const child of childElements(time)) {
        if (nameOf(child) === "beats") beats = textOf(child);
        else if (nameOf(child) === "beat-type" && beats !== undefined) {
            parts.push({ beats, beatType: textOf(child) });
            beats = undefined;
        }
    }
    const text = parts.map((p) => `${p.beats}/${p.beatType}`).join("+");
    if (parts.length === 0) return { kind: "unknown", text: text || "?" };
    return { kind: "read", parts, text };
}

// ---------------------------------------------------------------------------
// Navigation: repeats, endings, segno, coda, D.C., D.S., Fine
// ---------------------------------------------------------------------------

/** What words in a direction say about jumps, when the file gives no `<sound>` for them. */
export function readNavigationWords(text: string): (keyof MeasureNavigation)[] {
    const t = text.replace(/\s+/g, " ").trim();
    const found: (keyof MeasureNavigation)[] = [];
    if (/\b(d\.?\s?c\.?|da capo)(?![a-z])/i.test(t)) found.push("daCapo");
    if (/\b(d\.?\s?s\.?|dal segno)(?![a-z])/i.test(t)) found.push("dalSegno");
    // "To Coda" and "al Coda" at a jump are where the coda is jumped to; "D.S. al Coda" is not
    if (/\bto\s+coda\b/i.test(t) || /^⊕?\s*to\s*⊕/i.test(t))
        found.push("toCoda");
    else if (/^(⊕\s*)?coda\.?$/i.test(t)) found.push("coda");
    if (/^fine\.?$/i.test(t)) found.push("fine");
    return found;
}

interface NavigationMarks {
    navigation: MeasureNavigation;
    fromWords: string[];
    /** `<coda>` symbols with no `<sound>` or words to say which kind they are */
    codaSymbols: number;
}

/** Reads one part's repeats, endings and jump marks in one measure into `marks`. */
// eslint-disable-next-line max-lines-per-function
function readNavigation(measure: XmlElement, marks: NavigationMarks) {
    const nav = marks.navigation;
    for (const barline of childElements(measure, "barline")) {
        const repeat = firstChild(barline, "repeat");
        const direction = repeat?.getAttribute("direction");
        if (direction === "forward") nav.forwardRepeat = true;
        if (direction === "backward") {
            const times = Number(repeat!.getAttribute("times"));
            nav.backwardRepeat = {
                times: Math.max(
                    nav.backwardRepeat?.times ?? 0,
                    Number.isInteger(times) && times >= 1 ? times : 2,
                ),
            };
        }
        const ending = firstChild(barline, "ending");
        if (ending?.getAttribute("type") === "start") {
            const numbers = (ending.getAttribute("number") ?? "")
                .split(/[^0-9]+/)
                .filter(Boolean)
                .map(Number);
            // An unnumbered bracket is numbered by its place in its group (see settleNavigation)
            nav.ending = { numbers, start: true };
        }
    }

    const applySound = (sound: XmlElement, { fine = true } = {}) => {
        const attr = (name: string) => attrOf(sound, name);
        if (attr("segno") !== undefined) nav.segno = attr("segno") || "segno";
        if (attr("coda") !== undefined) nav.coda = attr("coda") || "coda";
        if (attr("tocoda") !== undefined) nav.toCoda = attr("tocoda") || "coda";
        if (attr("dalsegno") !== undefined)
            nav.dalSegno = attr("dalsegno") || "segno";
        if (attr("dacapo") === "yes") nav.daCapo = true;
        if (fine && attr("fine") !== undefined) nav.fine = true;
        if (attr("forward-repeat") === "yes") nav.forwardRepeat = true;
    };
    // <sound> outside directions: straight in the measure, or on a barline
    for (const sound of childElements(measure, "sound")) applySound(sound);
    for (const barline of childElements(measure, "barline"))
        for (const sound of childElements(barline, "sound")) applySound(sound);

    const JUMPS = ["segno", "coda", "tocoda", "dalsegno", "dacapo"];
    for (const direction of childElements(measure, "direction")) {
        const sound = firstChild(direction, "sound");
        const words = directionWords(direction);
        const fromWords = words ? readNavigationWords(words) : [];
        const wordsJump =
            fromWords.includes("daCapo") || fromWords.includes("dalSegno");
        if (sound) {
            const soundJump = JUMPS.some((a) => sound.hasAttribute(a));
            // Sibelius writes "D.S. al Fine" with only fine=: the words say what it does
            if (!soundJump && wordsJump) {
                applySound(sound, { fine: false });
            } else {
                applySound(sound);
                // A <sound> with a jump or Fine already said what this direction does
                if (soundJump || sound.hasAttribute("fine")) continue;
            }
        }
        for (const kind of fromWords) {
            if (kind === "daCapo") nav.daCapo ??= true;
            if (kind === "dalSegno") nav.dalSegno ??= "segno";
            if (kind === "toCoda") nav.toCoda ??= "coda";
            if (kind === "coda") nav.coda ??= "coda";
            if (kind === "fine") nav.fine ??= true;
        }
        if (fromWords.length > 0) marks.fromWords.push(words);
        if (descendants(direction, "segno").length > 0) nav.segno ??= "segno";
        if (descendants(direction, "coda").length > 0 && fromWords.length === 0)
            marks.codaSymbols++;
    }
}

/**
 * Gives `<coda>` symbols that nothing else explains a meaning, gives each bracket its full span,
 * and points jumps at targets that exist. Exporters often print a coda symbol at both the To Coda
 * spot and the coda itself, and name jump targets "yes" or not at all.
 */
// eslint-disable-next-line max-lines-per-function
function settleNavigation(
    measures: RawMeasure[],
    codaSymbols: number[],
    endingStops: (number[] | undefined)[],
) {
    const marksByMeasure = measures.map((m) => m.navigation);

    // Coda symbols: with no explicit coda, the last symbol is the coda and earlier ones To Coda
    const hasCoda = marksByMeasure.some((n) => n.coda !== undefined);
    const hasToCoda = marksByMeasure.some((n) => n.toCoda !== undefined);
    const symbolAt = codaSymbols
        .map((count, i) => (count > 0 ? i : -1))
        .filter((i) => i >= 0);
    if (!hasCoda && symbolAt.length > 0) {
        const last = symbolAt[symbolAt.length - 1]!;
        if (hasToCoda || symbolAt.length > 1)
            marksByMeasure[last]!.coda = "coda";
        if (!hasToCoda)
            for (const i of symbolAt.slice(0, -1)) {
                // The symbol sits where the jump happens: at the end of the measure before it,
                // when it is the first thing in its measure; either way, this measure is played
                marksByMeasure[i]!.toCoda = "coda";
            }
    }

    // Endings: a bracket runs from its start to its stop or discontinue. An unnumbered bracket
    // plays on the pass its place in its group says (the second bracket on the second pass)
    let open: number[] | undefined;
    let place = 0;
    marksByMeasure.forEach((nav, i) => {
        if (nav.ending?.start) {
            place++;
            if (nav.ending.numbers.length === 0) nav.ending.numbers = [place];
            open = nav.ending.numbers;
        } else if (open) nav.ending = { numbers: open, start: false };
        else place = 0;
        if (endingStops[i]) open = undefined;
    });

    // Jump targets: a name with no matching mark goes to the only (or first) mark there is
    const settle = (target: "segno" | "coda", jump: "dalSegno" | "toCoda") => {
        const names = marksByMeasure.flatMap((n) =>
            n[target] !== undefined ? [n[target]!] : [],
        );
        for (const nav of marksByMeasure) {
            const name = nav[jump];
            if (name !== undefined && !names.includes(name) && names[0])
                nav[jump] = names[0];
        }
    };
    settle("segno", "dalSegno");
    settle("coda", "toCoda");
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

/** One part's measure: `attrs` holds the measure's attributes and `content` its children. */
interface PartMeasure {
    attrs: XmlElement;
    content: XmlElement;
}

/** Each part's measures, for partwise and timewise scores. */
function partMeasures(root: XmlElement): Map<string, PartMeasure[]> {
    const parts = new Map<string, PartMeasure[]>();
    if (nameOf(root) === "score-timewise") {
        for (const measure of childElements(root, "measure"))
            for (const part of childElements(measure, "part")) {
                const id = part.getAttribute("id") ?? "";
                if (!parts.has(id)) parts.set(id, []);
                parts.get(id)!.push({ attrs: measure, content: part });
            }
        return parts;
    }
    for (const part of childElements(root, "part")) {
        const id = part.getAttribute("id") || String(parts.size);
        parts.set(
            id,
            childElements(part, "measure").map((m) => ({
                attrs: m,
                content: m,
            })),
        );
    }
    return parts;
}

interface PartState {
    divisions: number;
    /** True once the part has said what its divisions are */
    declared: boolean;
    /** The first divisions the part gives, and the index of the measure that gives it */
    firstDivisions?: number;
    declaredAt?: number;
}

/** What one part says about one measure. */
interface PartReading {
    time?: RawMeasure["time"];
    events: RawEvent[];
    contentQuarters: number;
    rehearsalMark?: string;
    fermata: boolean;
    endingStop: boolean;
}

/** Reads one part's measure. `state.divisions` carries over between this part's measures. */
// eslint-disable-next-line max-lines-per-function
function readPartMeasure(
    measure: XmlElement,
    state: PartState,
    nextSeq: () => number,
): PartReading {
    const reading: PartReading = {
        events: [],
        contentQuarters: 0,
        fermata: descendants(measure, "fermata").length > 0,
        endingStop: childElements(measure, "barline").some((b) => {
            const type = firstChild(b, "ending")?.getAttribute("type");
            return type === "stop" || type === "discontinue";
        }),
    };
    // Some exporters write the first <divisions> after the measure's first note: until a part
    // says, use the first value in this measure from its start
    if (!state.declared) {
        const first = descendants(measure, "divisions")[0];
        if (numberOf(first) > 0) {
            state.divisions = numberOf(first);
            state.firstDivisions = state.divisions;
            state.declared = true;
        }
    }
    // Positions in quarter notes: <divisions> can change in the middle of a measure
    let cur = 0;
    let max = 0;
    for (const el of childElements(measure)) {
        switch (nameOf(el)) {
            case "attributes": {
                const divisions = numberOf(firstChild(el, "divisions"));
                if (divisions > 0) {
                    state.divisions = divisions;
                    state.declared = true;
                }
                const time = firstChild(el, "time");
                if (time && reading.time === undefined)
                    reading.time = readTime(time);
                break;
            }
            case "note":
                if (firstChild(el, "grace") || firstChild(el, "chord")) break;
                cur += numberOf(firstChild(el, "duration")) / state.divisions;
                max = Math.max(max, cur);
                break;
            case "backup":
                cur = Math.max(
                    0,
                    cur -
                        numberOf(firstChild(el, "duration")) / state.divisions,
                );
                break;
            case "forward":
                cur += numberOf(firstChild(el, "duration")) / state.divisions;
                max = Math.max(max, cur);
                break;
            case "direction": {
                const pos = Math.max(
                    0,
                    cur + numberOf(firstChild(el, "offset")) / state.divisions,
                );
                reading.events.push(...directionEvents(el, pos, nextSeq));
                const rehearsal = textOf(descendants(el, "rehearsal")[0]);
                if (rehearsal && reading.rehearsalMark === undefined)
                    reading.rehearsalMark = rehearsal;
                break;
            }
            case "sound": {
                // A <sound> straight inside the measure, outside any direction
                const tempoAttr = attrOf(el, "tempo");
                if (tempoAttr === undefined) break;
                const tempo = readSoundTempo(tempoAttr);
                const pos = cur;
                reading.events.push(
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
    reading.contentQuarters = max;
    return reading;
}

/** A time signature's length in quarter notes, or undefined when it isn't read. */
function timeQuarters(time: RawMeasure["time"]): number | undefined {
    if (time?.kind !== "read") return undefined;
    let total = 0;
    for (const part of time.parts) {
        const beats = part.beats
            .split("+")
            .reduce((sum, t) => sum + Number(t), 0);
        total += (beats * 4) / Number(part.beatType);
    }
    return Number.isFinite(total) && total > 0 ? total : undefined;
}

/**
 * A part that never says what its divisions are (some converters leave <divisions> out) was
 * read with one division per quarter. Its most common measure length, against the meter, says
 * how many divisions a quarter really has: rescale the part's lengths and positions by that.
 */
function inferDivisions(readings: (PartReading | undefined)[][], part: number) {
    let meter: number | undefined;
    const ratios = new Map<number, number>();
    for (const row of readings) {
        meter = timeQuarters(row.find((r) => r?.time)?.time) ?? meter;
        const reading = row[part];
        if (!meter || !reading || reading.contentQuarters <= 0) continue;
        const ratio = Math.round(reading.contentQuarters / meter);
        ratios.set(ratio, (ratios.get(ratio) ?? 0) + 1);
    }
    const [factor] = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
        1,
    ];
    if (factor > 1) rescale(readings, part, factor, readings.length);
}

/** Divides a part's lengths and positions by `factor` in its first `count` measures. */
function rescale(
    readings: (PartReading | undefined)[][],
    part: number,
    factor: number,
    count: number,
) {
    for (const row of readings.slice(0, count)) {
        const reading = row[part];
        if (!reading) continue;
        reading.contentQuarters /= factor;
        for (const e of reading.events) e.pos /= factor;
    }
}

/** A key that is the same for the same mark written in two parts. */
function eventKey(e: RawEvent): string {
    switch (e.kind) {
        case "tempo":
            return `tempo:${e.marking.quarterBpm}`;
        case "invalid-tempo":
            return `invalid:${e.text}`;
        case "modulation":
            return `mod:${JSON.stringify(e.modulation)}`;
        case "words":
            return `words:${e.words.kind}:${e.words.text.toLowerCase()}`;
    }
}

/** Marks closer than a sixteenth note are on the same spot, in quarter notes. */
const SAME_SPOT_QUARTERS = 1 / 4;

/**
 * The same mark in several parts of one measure is one mark: keeps each at its earliest position
 * (the first part's on a tie). A `<sound tempo>` and a printed marking of the same tempo merge to
 * whichever says more (the one with a beat unit). A mark written twice in one part's measure
 * (♩=120, ♩=100, ♩=120) at two spots is two marks: the nth of each part merge.
 */
function mergeEvents(readings: PartReading[]): RawEvent[] {
    const byKey = new Map<string, RawEvent>();
    for (const reading of readings) {
        // Per mark: how many times this part wrote it, and where it last did
        const occurrences = new Map<string, { nth: number; pos: number }>();
        const inOrder = [...reading.events].sort(
            (a, b) => a.pos - b.pos || a.seq - b.seq,
        );
        for (const e of inOrder) {
            const mark = eventKey(e);
            const last = occurrences.get(mark);
            // Written again on about the same spot (once per staff, nudged a little) is one mark
            const nth = !last
                ? 0
                : Math.abs(e.pos - last.pos) <= SAME_SPOT_QUARTERS
                  ? last.nth
                  : last.nth + 1;
            occurrences.set(mark, { nth, pos: e.pos });
            const key = `${mark}#${nth}`;
            const seen = byKey.get(key);
            if (!seen) byKey.set(key, e);
            else {
                const better =
                    e.kind === "tempo" &&
                    seen.kind === "tempo" &&
                    seen.needsUnit &&
                    !e.needsUnit;
                if (better) byKey.set(key, { ...e, pos: seen.pos });
                else if (e.pos < seen.pos - 1e-6)
                    byKey.set(key, { ...seen, pos: e.pos });
            }
        }
    }
    return [...byKey.values()].sort((a, b) => a.pos - b.pos || a.seq - b.seq);
}

/** Reads a parsed MusicXML document. Throws when it isn't a MusicXML score. */
// eslint-disable-next-line max-lines-per-function
export function scanScore(doc: {
    documentElement: XmlElement | null;
}): ScanResult {
    const root = doc.documentElement;
    if (
        !root ||
        (nameOf(root) !== "score-partwise" && nameOf(root) !== "score-timewise")
    )
        throw new Error(
            `Not a MusicXML score (the root element is <${root ? nameOf(root) : "none"}>)`,
        );

    const partList = firstChild(root, "part-list");
    const names = new Map(
        childElements(partList ?? root, "score-part").map((p) => [
            p.getAttribute("id") ?? "",
            textOf(firstChild(p, "part-name")),
        ]),
    );
    const identification = firstChild(root, "identification");
    const software = descendants(identification ?? root, "software").map(
        textOf,
    );
    const title =
        textOf(firstChild(firstChild(root, "work"), "work-title")) ||
        textOf(firstChild(root, "movement-title")) ||
        undefined;

    const parts = [...partMeasures(root).entries()];
    const measureCount = parts[0]?.[1].length ?? 0;
    const mismatchedParts = parts
        .filter(([, ms]) => ms.length !== measureCount)
        .map(([id]) => names.get(id) || id);

    let seq = 0;
    const nextSeq = () => seq++;
    const states = parts.map(
        (): PartState => ({ divisions: 1, declared: false }),
    );
    const codaSymbols: number[] = [];
    const endingStops: (number[] | undefined)[] = [];

    // Each part's reading of each measure, and the measure's repeats and jumps
    const readings: (PartReading | undefined)[][] = [];
    const allMarks: NavigationMarks[] = [];
    for (let i = 0; i < measureCount; i++) {
        const marks: NavigationMarks = {
            navigation: {},
            fromWords: [],
            codaSymbols: 0,
        };
        readings.push(
            parts.map(([, ms], p) => {
                const m = ms[i];
                if (!m) return undefined;
                const state = states[p]!;
                const declared = state.declared;
                const reading = readPartMeasure(m.content, state, nextSeq);
                if (!declared && state.declared) state.declaredAt = i;
                const before = marks.codaSymbols;
                readNavigation(m.content, marks);
                // A coda symbol printed in every part is one symbol
                marks.codaSymbols = Math.min(marks.codaSymbols, before + 1);
                return reading;
            }),
        );
        allMarks.push(marks);
    }
    states.forEach((state, p) => {
        if (!state.declared) inferDivisions(readings, p);
        // A part whose first <divisions> comes in a later measure: the measures before it were
        // read with one division per quarter, and are taken to use that first value too
        else if (state.declaredAt! > 0)
            rescale(readings, p, state.firstDivisions!, state.declaredAt!);
    });

    const measures: RawMeasure[] = [];
    for (let i = 0; i < measureCount; i++) {
        const read = readings[i]!.filter((r): r is PartReading => !!r);
        const marks = allMarks[i]!;
        const first = parts[0]![1][i]!.attrs;
        const raw: RawMeasure = {
            label: first.getAttribute("number") ?? "",
            implicit: first.getAttribute("implicit") === "yes",
            time: read.find((r) => r.time)?.time,
            events: mergeEvents(read),
            contentQuarters: Math.max(0, ...read.map((r) => r.contentQuarters)),
            fermata: read.some((r) => r.fermata),
            navigation: marks.navigation,
        };
        const rehearsal = read.find((r) => r.rehearsalMark)?.rehearsalMark;
        if (rehearsal) raw.rehearsalMark = rehearsal;
        if (marks.fromWords.length > 0)
            raw.navigationFromWords = [...new Set(marks.fromWords)];
        measures.push(raw);
        codaSymbols.push(marks.codaSymbols);
        endingStops.push(read.some((r) => r.endingStop) ? [1] : undefined);
    }
    settleNavigation(measures, codaSymbols, endingStops);

    return {
        measures,
        parts: parts.map(([id]) => names.get(id) || id),
        software,
        title,
        mismatchedParts,
    };
}
