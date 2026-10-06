import type { TempoTruth, TruthCount, TruthEvent, TruthMeasure } from "./truth";

/**
 * The tempo maps of the test-show kit (README.md), as score-like bar lists, and `buildTruth`, which
 * turns a map into exact count times. Pure: no files, no audio.
 */

/** How a meter is counted: one entry per count, in quarter notes. */
export interface MeterSpec {
    beats: string;
    beatType: number;
    units: number[];
    /** Beat-type units per count when the counts are uneven or compound */
    grouping: number[] | null;
}

const repeat = (n: number, v: number) => Array.from({ length: n }, () => v);

/**
 * The meters the kit uses and how each is counted. 6/8 and 12/8 count dotted quarters, 7/8 and 5/8
 * count their groups, and 3/2 counts quarters (a step per quarter at ♩=176, see
 * docs/tempo/decisions.md).
 */
export const METERS = {
    "4/4": { beats: "4", beatType: 4, units: repeat(4, 1), grouping: null },
    "3/4": { beats: "3", beatType: 4, units: repeat(3, 1), grouping: null },
    "3/2": { beats: "3", beatType: 2, units: repeat(6, 1), grouping: null },
    "6/8": {
        beats: "6",
        beatType: 8,
        units: repeat(2, 1.5),
        grouping: [3, 3],
    },
    "12/8": {
        beats: "12",
        beatType: 8,
        units: repeat(4, 1.5),
        grouping: [3, 3, 3, 3],
    },
    "7/8 2+2+3": {
        beats: "2+2+3",
        beatType: 8,
        units: [1, 1, 1.5],
        grouping: [2, 2, 3],
    },
    "5/8 3+2": {
        beats: "3+2",
        beatType: 8,
        units: [1.5, 1],
        grouping: [3, 2],
    },
} as const satisfies Record<string, MeterSpec>;
export type MeterKey = keyof typeof METERS;

/** A printed metronome mark. `modulation` prints "♩. = ♩" (a metric modulation) instead of a number. */
export interface PrintedTempo {
    unit: "quarter" | "dotted-quarter";
    perMinute: number;
    modulation?: boolean;
    /** What a Sibelius-style export prints in `<per-minute>` instead of the number (e.g. "c. 132") */
    sibeliusText?: string;
}

/** One or more bars that share a meter and a tempo (or one ramp across all their counts). */
export interface BarSpec {
    meter: MeterKey;
    /** How many bars; default 1 */
    bars?: number;
    /** Quarter notes per minute, or a ramp from the first count to the last count of these bars */
    qpm: number | { from: number; to: number };
    /** Rehearsal mark on the first bar */
    mark?: string;
    /** Metronome mark printed on the first bar */
    print?: PrintedTempo;
    /** Tempo words printed on the first bar, e.g. "rit.", "a tempo" */
    words?: string[];
    /** A one-count pickup bar (only as the first spec) */
    pickup?: boolean;
}

export type EventSpec =
    | { measure: number; beat: number; kind: "hit" }
    /** The count lasts `seconds` in all */
    | { measure: number; beat: number; kind: "fermata"; seconds: number }
    /** `seconds` of silence after the count */
    | { measure: number; beat: number; kind: "caesura"; seconds: number };

export interface TempoMap {
    name: string;
    title: string;
    description: string;
    personas: string[];
    leadIn: number;
    bars: BarSpec[];
    events: EventSpec[];
    /** Page starts: explicit measure numbers, or "a page at every mark, else every N counts" */
    pages: { measures: number[] } | { everyCounts: number };
    /** Seconds of audio after the end of the last count */
    tail?: number;
}

const printText = (p: PrintedTempo): string => {
    const note = p.unit === "dotted-quarter" ? "♩." : "♩";
    if (p.modulation) return `${note}=♩`;
    return `${note}=${p.perMinute}`;
};

interface Placed {
    measure: TruthMeasure;
    units: number[];
    tempos: number[];
    marked: number[];
}

/** Lays the bars out as measures with a played and a marked tempo per count. */
const placeBars = (map: TempoMap): Placed[] => {
    const placed: Placed[] = [];
    let number = map.bars[0]?.pickup ? 0 : 1;
    let firstCount = 1;
    for (const spec of map.bars) {
        const meter: MeterSpec = METERS[spec.meter];
        const bars = spec.bars ?? 1;
        const unitsPerBar = spec.pickup ? [1] : meter.units;
        const total = bars * unitsPerBar.length;
        const qpmAt = (i: number) =>
            typeof spec.qpm === "number"
                ? spec.qpm
                : spec.qpm.from +
                  ((spec.qpm.to - spec.qpm.from) * i) / Math.max(1, total - 1);
        for (let b = 0; b < bars; b++) {
            const offset = b * unitsPerBar.length;
            const tempos = unitsPerBar.map((_, k) => qpmAt(offset + k));
            const marked = unitsPerBar.map(() =>
                typeof spec.qpm === "number" ? spec.qpm : spec.qpm.from,
            );
            const text =
                b === 0
                    ? [
                          ...(spec.print ? [printText(spec.print)] : []),
                          ...(spec.words ?? []),
                      ]
                    : [];
            placed.push({
                measure: {
                    number,
                    firstCount,
                    counts: unitsPerBar.length,
                    meter: spec.meter.split(" ")[0]!,
                    grouping: meter.grouping,
                    ...(b === 0 && spec.mark ? { mark: spec.mark } : {}),
                    ...(text.length > 0 ? { text } : {}),
                    ...(spec.pickup ? { pickup: true } : {}),
                },
                units: unitsPerBar,
                tempos,
                marked,
            });
            number++;
            firstCount += unitsPerBar.length;
        }
    }
    return placed;
};

const pageStarts = (map: TempoMap, measures: TruthMeasure[]): number[] => {
    const rule = map.pages;
    if ("measures" in rule)
        return rule.measures.map((n) => {
            const m = measures.find((x) => x.number === n);
            if (!m) throw new Error(`${map.name}: no measure ${n} for a page`);
            return m.firstCount;
        });
    const starts = [1];
    for (const m of measures) {
        const since = m.firstCount - starts[starts.length - 1]!;
        if (since >= rule.everyCounts || (m.mark && since >= 4))
            starts.push(m.firstCount);
    }
    return starts;
};

/** The exact count times of a map. */
export const buildTruth = (map: TempoMap): TempoTruth => {
    const placed = placeBars(map);
    const counts: TruthCount[] = [];
    let time = map.leadIn;
    for (const { measure, units, tempos, marked } of placed) {
        for (const [k, unit] of units.entries()) {
            const beat = k + 1;
            const qpm = tempos[k]!;
            const plain = (unit * 60) / qpm;
            let duration = plain;
            const events: TruthEvent[] = [];
            for (const e of map.events) {
                if (e.measure !== measure.number || e.beat !== beat) continue;
                events.push(e.kind);
                if (e.kind === "fermata") duration = e.seconds;
                if (e.kind === "caesura") duration += e.seconds;
            }
            counts.push({
                index: counts.length + 1,
                time,
                duration,
                measure: measure.number,
                beat,
                unit,
                qpm,
                markedQpm: marked[k]!,
                ...(beat === 1 && measure.mark ? { mark: measure.mark } : {}),
                ...(events.length > 0 ? { events } : {}),
                ...(duration !== plain ? { plainDuration: plain } : {}),
            });
            time += duration;
        }
    }
    for (const e of map.events)
        if (!counts.some((c) => c.measure === e.measure && c.beat === e.beat))
            throw new Error(
                `${map.name}: no count m${e.measure} beat ${e.beat} for a ${e.kind}`,
            );
    const measures = placed.map((p) => p.measure);
    return {
        name: map.name,
        title: map.title,
        description: map.description,
        personas: map.personas,
        leadIn: map.leadIn,
        end: time,
        audioLength: time + (map.tail ?? 2),
        syncedAudioOffsetSeconds: map.leadIn === 0 ? 0 : -map.leadIn,
        firstMeasureNumber: measures[0]!.number,
        pages: pageStarts(map, measures),
        counts,
        measures,
    };
};

// ---------------------------------------------------------------------------
// The maps
// ---------------------------------------------------------------------------

const q = (perMinute: number): PrintedTempo => ({ unit: "quarter", perMinute });
const dq = (perMinute: number): PrintedTempo => ({
    unit: "dotted-quarter",
    perMinute,
});

/** Dana: a steady stock arrangement, 2:30, ♩=138 then ♩=112 at C with a big hit on C. */
export const steadyMap: TempoMap = {
    name: "steady",
    title: "Steady (Dana)",
    description:
        "About 2:30 of 4/4. 1.6 s of silence before count 1, ♩=138 to letter C, ♩=112 from C, a big hit on count 1 of C and a final hit. No pickup notes.",
    personas: ["Dana"],
    leadIn: 1.6,
    bars: [
        { meter: "4/4", bars: 8, qpm: 138, print: q(138) },
        { meter: "4/4", bars: 16, qpm: 138, mark: "A" },
        { meter: "4/4", bars: 16, qpm: 138, mark: "B" },
        { meter: "4/4", bars: 16, qpm: 112, mark: "C", print: q(112) },
        { meter: "4/4", bars: 22, qpm: 112, mark: "D" },
    ],
    events: [
        { measure: 41, beat: 1, kind: "hit" },
        { measure: 78, beat: 1, kind: "hit" },
    ],
    pages: { everyCounts: 16 },
};

export interface ScoreVariant {
    /** The tempo printed (and, for a truth, played) at letter F; the v1 typo is 138 */
    fTempo?: number;
    /** Bars added before letter L (v3 adds 2) */
    barsBeforeL?: number;
    /** The live take: 3% slower, a deeper rit. and a 1.2 s fermata at the end of I */
    live?: boolean;
}

/**
 * Marcus: a 97-bar concert-style chart with letters A–M, a one-count pickup, a rit. into H, a 6/8
 * section at I (♩.=88, one bar at ♩.=85 = ♩=127.5) and a 3/4 bar before J. The audio is v2 (F is
 * ♩=132); v1 prints ♩=138 at F (the typo), v3 adds two bars before L.
 */
// eslint-disable-next-line max-lines-per-function
export const scoreMap = ({
    fTempo = 132,
    barsBeforeL = 0,
    live = false,
}: ScoreVariant = {}): TempoMap => {
    const s = live ? 0.97 : 1;
    const t = (v: number) => v * s;
    const ritTo = live ? 92 : 100;
    const lStart = 83 + barsBeforeL;
    const bars: BarSpec[] = [
        { meter: "4/4", pickup: true, qpm: t(132), print: q(132) },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "A" },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "B" },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "C" },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "D" },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "E" },
        {
            meter: "4/4",
            bars: 8,
            qpm: t(fTempo),
            mark: "F",
            print: q(fTempo),
        },
        {
            meter: "4/4",
            bars: 4,
            qpm: t(132),
            mark: "G",
            print: q(132),
        },
        {
            meter: "4/4",
            bars: 2,
            qpm: { from: t(132), to: ritTo },
            words: ["rit."],
        },
        {
            meter: "4/4",
            bars: 8,
            qpm: t(132),
            mark: "H",
            print: q(132),
            words: ["a tempo"],
        },
        { meter: "6/8", bars: 4, qpm: t(132), mark: "I", print: dq(88) },
        { meter: "6/8", qpm: t(127.5), print: dq(85) },
        { meter: "6/8", bars: 2, qpm: t(132), print: dq(88) },
        { meter: "3/4", qpm: t(132), print: q(132) },
        { meter: "4/4", bars: 6, qpm: t(132), mark: "J" },
        {
            meter: "4/4",
            bars: 6 + barsBeforeL,
            qpm: t(132),
            mark: "K",
            print: { ...q(132), sibeliusText: "c. 132" },
        },
        { meter: "4/4", bars: 6, qpm: t(132), mark: "L" },
        { meter: "4/4", bars: 8, qpm: t(132), mark: "M" },
    ];
    const v = [
        fTempo !== 132 ? "v1 (F printed ♩=138, the typo)" : "",
        barsBeforeL
            ? `v3 (${barsBeforeL} bars added before L, now m${lStart})`
            : "",
        live ? "live take" : "",
    ].filter(Boolean);
    return {
        name: live
            ? "score-live"
            : barsBeforeL
              ? "score-v3"
              : fTempo !== 132
                ? "score-v1"
                : "score",
        title: `Score (Marcus)${v.length ? ` ${v.join(", ")}` : ""}`,
        description: live
            ? "The band's live take of the score: every tempo 3% slower, the rit. into H goes down to ♩=92 instead of ♩=100, and the last count of I (m70 beat 3) is held for 1.2 s."
            : 'Letters A–M, m0 pickup, 4/4 at ♩=132, a rit. over m53–54 to ♩=100 into H (a tempo), 6/8 at I with ♩.=88 and one bar (m67) at ♩.=85 (♩=127.5), a 3/4 bar (m70) before J, and "c. 132" printed at K in the Sibelius export.',
        personas: ["Marcus"],
        leadIn: live ? 1.35 : 1.0,
        bars,
        events: [
            { measure: 55, beat: 1, kind: "hit" },
            { measure: 96 + barsBeforeL, beat: 1, kind: "hit" },
            ...(live
                ? [
                      {
                          measure: 70,
                          beat: 3,
                          kind: "fermata" as const,
                          seconds: 1.2,
                      },
                  ]
                : []),
        ],
        pages: { everyCounts: 16 },
    };
};

/** Jo: a live-style rubato chart: pickup, rit. 72→44, fermatas, a caesura and a rushing break. */
export const rubatoMap: TempoMap = {
    name: "rubato",
    title: "Rubato (Jo)",
    description:
        "A one-count pickup at 1.84 s, a ♩=72 ballad with a 3.2 s fermata on m5 beat 4 (inside a page), a rit. from 72 to 44 over m11–12 (8 counts), a 6.5 s fermata on m13 beat 1 (a page start), ♩=60 after it, a 1.5 s caesura after m14 beat 4, then a drum break at C accelerating from 132 to 141 over 32 counts, ♩=141 at D and a final hit.",
    personas: ["Jo"],
    leadIn: 1.84,
    bars: [
        { meter: "4/4", pickup: true, qpm: 72, print: q(72) },
        { meter: "4/4", bars: 8, qpm: 72, mark: "A" },
        { meter: "4/4", bars: 2, qpm: 72, mark: "B" },
        { meter: "4/4", bars: 2, qpm: { from: 72, to: 44 }, words: ["rit."] },
        { meter: "4/4", bars: 2, qpm: 60, print: q(60) },
        {
            meter: "4/4",
            bars: 8,
            qpm: { from: 132, to: 141 },
            mark: "C",
            print: q(132),
            words: ["accel."],
        },
        { meter: "4/4", bars: 9, qpm: 141, mark: "D", print: q(141) },
    ],
    events: [
        { measure: 5, beat: 4, kind: "fermata", seconds: 3.2 },
        { measure: 13, beat: 1, kind: "fermata", seconds: 6.5 },
        { measure: 14, beat: 4, kind: "caesura", seconds: 1.5 },
        { measure: 15, beat: 1, kind: "hit" },
        { measure: 31, beat: 1, kind: "hit" },
    ],
    pages: { everyCounts: 8 },
};

/** Sam: a drum corps movement with odd meters, a decimal tempo and a metric modulation. */
export const corpsMap: TempoMap = {
    name: "corps",
    title: "Corps (Sam)",
    description:
        "m0 pickup, ♩=176 4/4 for 16 bars (A, B), 7/8 counted 2+2+3 for 8 bars (C), 5/8 counted 3+2 for 4 bars (D), one 3/2 bar counted in quarters (E, m29), ♩=152.5 4/4 for 8 bars (F, m30), then ♩.=♩ into 12/8 for 8 bars (G, m38, ♩.=152.5) and a final 12/8 bar with a hit.",
    personas: ["Sam"],
    leadIn: 0.5,
    bars: [
        { meter: "4/4", pickup: true, qpm: 176, print: q(176) },
        { meter: "4/4", bars: 8, qpm: 176, mark: "A" },
        { meter: "4/4", bars: 8, qpm: 176, mark: "B" },
        { meter: "7/8 2+2+3", bars: 8, qpm: 176, mark: "C" },
        { meter: "5/8 3+2", bars: 4, qpm: 176, mark: "D" },
        { meter: "3/2", qpm: 176, mark: "E" },
        { meter: "4/4", bars: 8, qpm: 152.5, mark: "F", print: q(152.5) },
        {
            meter: "12/8",
            bars: 9,
            qpm: 228.75,
            mark: "G",
            print: {
                unit: "dotted-quarter",
                perMinute: 152.5,
                modulation: true,
            },
        },
    ],
    events: [
        { measure: 38, beat: 1, kind: "hit" },
        { measure: 46, beat: 1, kind: "hit" },
    ],
    pages: { everyCounts: 16 },
};

/**
 * Priya's written show: opener ♩=168 (A–C, m1–24), ballad ♩=72 (D–F, m25–64, F at m41), closer
 * ♩=176 (G–J, m65–96). Pages are fixed so page 23 is an 8-count page in the closer.
 */
export const priyaMap: TempoMap = {
    name: "priya",
    title: "Priya's show",
    description:
        "A written show, 70% done: opener ♩=168 (A–C, m1–24), ballad ♩=72 (D–F, m25–64, F at m41), closer ♩=176 (G–J, m65–96), 25 pages. Page 23 is 8 counts in the closer.",
    personas: ["Priya"],
    leadIn: 0.8,
    bars: [
        { meter: "4/4", bars: 8, qpm: 168, mark: "A", print: q(168) },
        { meter: "4/4", bars: 8, qpm: 168, mark: "B" },
        { meter: "4/4", bars: 8, qpm: 168, mark: "C" },
        { meter: "4/4", bars: 8, qpm: 72, mark: "D", print: q(72) },
        { meter: "4/4", bars: 8, qpm: 72, mark: "E" },
        { meter: "4/4", bars: 24, qpm: 72, mark: "F" },
        { meter: "4/4", bars: 8, qpm: 176, mark: "G", print: q(176) },
        { meter: "4/4", bars: 8, qpm: 176, mark: "H" },
        { meter: "4/4", bars: 8, qpm: 176, mark: "I" },
        { meter: "4/4", bars: 8, qpm: 176, mark: "J" },
    ],
    events: [
        { measure: 41, beat: 1, kind: "hit" },
        { measure: 65, beat: 1, kind: "hit" },
    ],
    pages: {
        measures: [
            1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69,
            73, 77, 81, 83, 85, 87, 91,
        ],
    },
};

/** Every map with ground truth and audio, in kit order. */
export const kitMaps = (): TempoMap[] => [
    steadyMap,
    scoreMap(),
    scoreMap({ live: true }),
    scoreMap({ barsBeforeL: 2 }),
    rubatoMap,
    corpsMap,
    priyaMap,
];

/** A truth as the kit's JSON text: one measure or count per line, so diffs stay small. */
export const formatTruthJson = (t: TempoTruth): string => {
    const { counts, measures, ...head } = t;
    const rows = (xs: unknown[]) =>
        `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`;
    const headJson = JSON.stringify(head, null, 2).slice(0, -2);
    return `${headJson},\n  "measures": ${rows(measures)},\n  "counts": ${rows(counts)}\n}\n`;
};
